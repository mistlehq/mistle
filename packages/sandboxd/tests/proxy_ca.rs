use std::os::fd::BorrowedFd;

use nix::fcntl::{FcntlArg, FdFlag, fcntl};
use nix::unistd::{dup, read};
use sandboxd::time::SystemClock;

#[test]
fn proxy_ca_validity_is_long_lived_for_sandbox_instance_reuse() {
    assert_eq!(
        sandboxd::proxy_ca::PROXY_CA_VALIDITY_MS,
        10 * 365 * 24 * 60 * 60 * 1000
    );
}

fn read_all_from_prepared_fd(
    prepared: &sandboxd::proxy_ca::PreparedProxyCaRuntime,
    getter: fn(
        &sandboxd::proxy_ca::PreparedProxyCaRuntime,
    ) -> Result<i32, sandboxd::proxy_ca::ProxyCaError>,
) -> String {
    let fd = getter(prepared).expect("expected prepared fd to be available");
    let duplicated_fd =
        dup(unsafe { BorrowedFd::borrow_raw(fd) }).expect("expected fd duplication to succeed");
    let mut payload = Vec::new();
    let mut chunk = [0_u8; 1024];

    loop {
        let bytes_read = read(&duplicated_fd, &mut chunk).expect("expected fd read to succeed");
        if bytes_read == 0 {
            break;
        }

        payload.extend_from_slice(&chunk[..bytes_read]);
    }

    String::from_utf8(payload).expect("expected payload to be utf8")
}

#[test]
fn generates_a_ca_and_issues_leaf_certificates() {
    let generated_proxy_ca = sandboxd::proxy_ca::generate_proxy_ca(&SystemClock)
        .expect("expected proxy ca generation to succeed");

    assert!(
        generated_proxy_ca
            .certificate_pem
            .contains("BEGIN CERTIFICATE")
    );
    assert!(
        generated_proxy_ca
            .private_key_pem
            .contains("BEGIN PRIVATE KEY")
    );

    let leaf_certificate = sandboxd::proxy_ca::issue_proxy_leaf_certificate(
        generated_proxy_ca.certificate_pem.clone(),
        generated_proxy_ca.private_key_pem.clone(),
        "api.openai.com:443".to_string(),
        &SystemClock,
    )
    .expect("expected leaf certificate issuance to succeed");

    assert!(
        leaf_certificate
            .certificate_chain_pem
            .contains("BEGIN CERTIFICATE")
    );
    assert!(
        leaf_certificate
            .private_key_pem
            .contains("BEGIN PRIVATE KEY")
    );
    assert_eq!(
        leaf_certificate
            .certificate_chain_pem
            .matches("BEGIN CERTIFICATE")
            .count(),
        2
    );
}

#[test]
fn prepares_proxy_ca_runtime_with_pipe_backed_fds() {
    let generated_proxy_ca = sandboxd::proxy_ca::generate_proxy_ca(&SystemClock)
        .expect("expected proxy ca generation to succeed");

    let prepared = sandboxd::proxy_ca::prepare_proxy_ca_runtime(&generated_proxy_ca)
        .expect("expected proxy ca runtime preparation to succeed");

    let env = prepared
        .env()
        .expect("expected proxy ca runtime env to be available");
    assert!(env.contains_key(sandboxd::proxy_ca::PROXY_CA_CERT_FD_ENV));
    assert!(env.contains_key(sandboxd::proxy_ca::PROXY_CA_KEY_FD_ENV));

    let certificate_payload = read_all_from_prepared_fd(
        &prepared,
        sandboxd::proxy_ca::PreparedProxyCaRuntime::certificate_fd,
    );
    let private_key_payload = read_all_from_prepared_fd(
        &prepared,
        sandboxd::proxy_ca::PreparedProxyCaRuntime::private_key_fd,
    );

    assert_eq!(certificate_payload, generated_proxy_ca.certificate_pem);
    assert_eq!(private_key_payload, generated_proxy_ca.private_key_pem);

    let certificate_fd = prepared
        .certificate_fd()
        .expect("expected certificate fd to remain available");
    let flags_bits = fcntl(
        unsafe { BorrowedFd::borrow_raw(certificate_fd) },
        FcntlArg::F_GETFD,
    )
    .expect("expected certificate fd flags read to succeed");
    let flags = FdFlag::from_bits_truncate(flags_bits);
    assert!(
        flags.contains(FdFlag::FD_CLOEXEC),
        "expected certificate fd to remain close-on-exec until the child pre-exec handoff"
    );
}

#[test]
fn cleanup_closes_proxy_ca_runtime_fds() {
    let generated_proxy_ca = sandboxd::proxy_ca::generate_proxy_ca(&SystemClock)
        .expect("expected proxy ca generation to succeed");
    let mut prepared = sandboxd::proxy_ca::prepare_proxy_ca_runtime(&generated_proxy_ca)
        .expect("expected proxy ca runtime preparation to succeed");
    prepared.cleanup();

    assert!(prepared.certificate_fd().is_err());
    assert!(prepared.private_key_fd().is_err());
    assert!(prepared.env().is_err());
}
