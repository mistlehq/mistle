use std::fmt::{Display, Formatter};
use std::net::IpAddr;
use std::os::fd::{AsRawFd, OwnedFd};
use std::str::FromStr;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use napi::{Error, Result as NapiResult, Status};
use napi_derive::napi;
use nix::fcntl::{FcntlArg, FdFlag, fcntl};
use nix::unistd::{pipe, write};
use rcgen::{
    BasicConstraints, CertificateParams, DistinguishedName, DnType, IsCa, KeyPair,
    KeyUsagePurpose, SanType,
};

const PROXY_CA_COMMON_NAME: &str = "Mistle Sandbox Proxy CA";
const PROXY_CA_VALIDITY: Duration = Duration::from_secs(24 * 60 * 60);
const PROXY_LEAF_VALIDITY: Duration = Duration::from_secs(12 * 60 * 60);

pub struct GeneratedProxyCa {
    pub certificate_pem: String,
    pub private_key_pem: String,
}

pub struct IssuedProxyLeafCertificate {
    pub certificate_chain_pem: String,
    pub private_key_pem: String,
}

#[napi(object)]
pub struct PrepareProxyCaRuntimeEnvInput {
    pub certificate_pem: String,
    pub private_key_pem: String,
}

#[napi]
pub struct NativePreparedProxyCaRuntimeEnv {
    certificate_fd: Mutex<Option<OwnedFd>>,
    private_key_fd: Mutex<Option<OwnedFd>>,
}

#[derive(Debug)]
pub struct ProxyCaError {
    message: String,
}

impl ProxyCaError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for ProxyCaError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ProxyCaError {}

fn validate_proxy_ca_payload(name: &str, payload: &str) -> NapiResult<()> {
    if payload.trim().is_empty() {
        return Err(Error::new(
            Status::InvalidArg,
            format!("{name} must not be empty"),
        ));
    }

    Ok(())
}

fn prepare_proxy_ca_fd_payload_impl(name: &str, payload: &str) -> NapiResult<OwnedFd> {
    validate_proxy_ca_payload(name, payload)?;

    let (read_fd, write_fd) = pipe().map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("failed to create {name} pipe: {error}"),
        )
    })?;

    let mut remaining_payload = payload.as_bytes();
    while !remaining_payload.is_empty() {
        match write(&write_fd, remaining_payload) {
            Ok(0) => {
                return Err(Error::new(
                    Status::GenericFailure,
                    format!("failed to write complete {name} payload"),
                ));
            }
            Ok(bytes_written) => {
                remaining_payload = &remaining_payload[bytes_written..];
            }
            Err(error) => {
                return Err(Error::new(
                    Status::GenericFailure,
                    format!("failed to write {name} payload: {error}"),
                ));
            }
        }
    }

    drop(write_fd);

    let flags_bits = fcntl(&read_fd, FcntlArg::F_GETFD).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("failed to read {name} fd flags: {error}"),
        )
    })?;
    let flags = FdFlag::from_bits_truncate(flags_bits);
    let updated_flags = flags & !FdFlag::FD_CLOEXEC;
    fcntl(&read_fd, FcntlArg::F_SETFD(updated_flags)).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("failed to clear close-on-exec for {name} fd: {error}"),
        )
    })?;

    Ok(read_fd)
}

fn lock_payload_fd<'a>(
    mutex: &'a Mutex<Option<OwnedFd>>,
    context: &str,
) -> NapiResult<std::sync::MutexGuard<'a, Option<OwnedFd>>> {
    mutex.lock().map_err(|_| {
        Error::new(
            Status::GenericFailure,
            format!("{context} lock is poisoned"),
        )
    })
}

fn extract_payload_fd(mutex: &Mutex<Option<OwnedFd>>, context: &str) -> NapiResult<i32> {
    let guard = lock_payload_fd(mutex, context)?;
    let fd = guard.as_ref().ok_or_else(|| {
        Error::new(
            Status::GenericFailure,
            format!("{context} has already been cleaned up"),
        )
    })?;

    Ok(fd.as_raw_fd())
}

fn normalize_certificate_host(server_name: &str) -> String {
    let trimmed_server_name = server_name.trim().to_lowercase();
    if trimmed_server_name.is_empty() {
        return trimmed_server_name;
    }

    if trimmed_server_name.starts_with('[')
        && let Some(end_bracket_index) = trimmed_server_name.find(']')
    {
        return trimmed_server_name[1..end_bracket_index].to_string();
    }

    if trimmed_server_name.matches(':').count() == 1
        && let Some((host, port)) = trimmed_server_name.rsplit_once(':')
        && !host.is_empty()
        && !port.is_empty()
        && port.parse::<u16>().is_ok()
    {
        return host.to_string();
    }

    trimmed_server_name
}

fn base_proxy_ca_params() -> CertificateParams {
    let now = SystemTime::now();
    let mut distinguished_name = DistinguishedName::new();
    distinguished_name.push(DnType::CommonName, PROXY_CA_COMMON_NAME);

    let mut params = CertificateParams::default();
    params.distinguished_name = distinguished_name;
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.not_before = now.checked_sub(Duration::from_secs(60)).unwrap_or(now).into();
    params.not_after = now
        .checked_add(PROXY_CA_VALIDITY)
        .unwrap_or(now + PROXY_CA_VALIDITY)
        .into();
    params.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
        KeyUsagePurpose::DigitalSignature,
    ];
    params
}

pub fn generate_proxy_ca_impl() -> std::result::Result<GeneratedProxyCa, ProxyCaError> {
    let key_pair = KeyPair::generate()
        .map_err(|error| ProxyCaError::new(format!("failed to generate proxy ca private key: {error}")))?;
    let params = base_proxy_ca_params();
    let certificate = params
        .self_signed(&key_pair)
        .map_err(|error| ProxyCaError::new(format!("failed to generate proxy ca certificate: {error}")))?;

    Ok(GeneratedProxyCa {
        certificate_pem: certificate.pem(),
        private_key_pem: key_pair.serialize_pem(),
    })
}

pub fn issue_proxy_leaf_certificate_impl(
    ca_certificate_pem: String,
    ca_private_key_pem: String,
    server_name: String,
) -> std::result::Result<IssuedProxyLeafCertificate, ProxyCaError> {
    let normalized_server_name = normalize_certificate_host(&server_name);
    if normalized_server_name.is_empty() {
        return Err(ProxyCaError::new("server name is required"));
    }

    let ca_key_pair = KeyPair::from_pem(&ca_private_key_pem)
        .map_err(|error| ProxyCaError::new(format!("failed to parse proxy ca private key: {error}")))?;
    if ca_certificate_pem.trim().is_empty() {
        return Err(ProxyCaError::new("proxy ca certificate pem is invalid"));
    }

    let issuer_certificate = base_proxy_ca_params()
        .self_signed(&ca_key_pair)
        .map_err(|error| ProxyCaError::new(format!("failed to reconstruct proxy ca certificate: {error}")))?;

    let leaf_key_pair = KeyPair::generate().map_err(|error| {
        ProxyCaError::new(format!("failed to generate leaf private key for \"{normalized_server_name}\": {error}"))
    })?;

    let now = SystemTime::now();
    let mut distinguished_name = DistinguishedName::new();
    distinguished_name.push(DnType::CommonName, normalized_server_name.clone());

    let mut params = CertificateParams::new(Vec::new())
        .map_err(|error| ProxyCaError::new(format!("failed to create leaf certificate params: {error}")))?;
    params.distinguished_name = distinguished_name;
    params.not_before = now.checked_sub(Duration::from_secs(60)).unwrap_or(now).into();
    params.not_after = now
        .checked_add(PROXY_LEAF_VALIDITY)
        .unwrap_or(now + PROXY_LEAF_VALIDITY)
        .into();
    params.key_usages = vec![
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::KeyEncipherment,
    ];
    params.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::ServerAuth];

    if let Ok(ip_address) = IpAddr::from_str(&normalized_server_name) {
        params.subject_alt_names.push(SanType::IpAddress(ip_address));
    } else {
        params
            .subject_alt_names
            .push(SanType::DnsName(normalized_server_name.clone().try_into().map_err(
                |error| ProxyCaError::new(format!("failed to encode leaf dns name \"{normalized_server_name}\": {error}")),
            )?));
    }

    let leaf_certificate = params
        .signed_by(&leaf_key_pair, &issuer_certificate, &ca_key_pair)
        .map_err(|error| {
        ProxyCaError::new(format!(
            "failed to issue leaf certificate for \"{normalized_server_name}\": {error}"
        ))
    })?;

    Ok(IssuedProxyLeafCertificate {
        certificate_chain_pem: format!("{}{}", leaf_certificate.pem(), ca_certificate_pem),
        private_key_pem: leaf_key_pair.serialize_pem(),
    })
}

#[napi]
pub fn prepare_proxy_ca_runtime_env(
    input: PrepareProxyCaRuntimeEnvInput,
) -> NapiResult<NativePreparedProxyCaRuntimeEnv> {
    let certificate_fd =
        prepare_proxy_ca_fd_payload_impl("proxy ca certificate", &input.certificate_pem)?;
    let private_key_fd =
        prepare_proxy_ca_fd_payload_impl("proxy ca private key", &input.private_key_pem)?;

    Ok(NativePreparedProxyCaRuntimeEnv {
        certificate_fd: Mutex::new(Some(certificate_fd)),
        private_key_fd: Mutex::new(Some(private_key_fd)),
    })
}

#[napi]
impl NativePreparedProxyCaRuntimeEnv {
    #[napi(getter)]
    pub fn certificate_fd(&self) -> NapiResult<i32> {
        extract_payload_fd(&self.certificate_fd, "proxy ca certificate fd")
    }

    #[napi(getter)]
    pub fn private_key_fd(&self) -> NapiResult<i32> {
        extract_payload_fd(&self.private_key_fd, "proxy ca private key fd")
    }

    #[napi]
    pub fn cleanup(&self) -> NapiResult<()> {
        let mut certificate_fd = lock_payload_fd(&self.certificate_fd, "proxy ca certificate fd")?;
        let mut private_key_fd = lock_payload_fd(&self.private_key_fd, "proxy ca private key fd")?;
        *certificate_fd = None;
        *private_key_fd = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::os::fd::BorrowedFd;

    use super::{
        NativePreparedProxyCaRuntimeEnv, generate_proxy_ca_impl, issue_proxy_leaf_certificate_impl,
        prepare_proxy_ca_runtime_env,
    };
    use nix::fcntl::{FcntlArg, FdFlag, fcntl};
    use nix::unistd::read;

    fn read_all_from_prepared_fd(
        prepared: &NativePreparedProxyCaRuntimeEnv,
        getter: fn(&NativePreparedProxyCaRuntimeEnv) -> napi::Result<i32>,
    ) -> String {
        let fd = getter(prepared).expect("expected prepared fd to be available");
        let duplicated_fd = nix::unistd::dup(unsafe { BorrowedFd::borrow_raw(fd) })
            .expect("expected fd duplication to succeed");
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
        let generated_proxy_ca =
            generate_proxy_ca_impl().expect("expected proxy ca generation to succeed");

        assert!(generated_proxy_ca.certificate_pem.contains("BEGIN CERTIFICATE"));
        assert!(generated_proxy_ca.private_key_pem.contains("BEGIN PRIVATE KEY"));

        let leaf_certificate = issue_proxy_leaf_certificate_impl(
            generated_proxy_ca.certificate_pem.clone(),
            generated_proxy_ca.private_key_pem.clone(),
            "api.openai.com:443".to_string(),
        )
        .expect("expected leaf certificate issuance to succeed");

        assert!(
            leaf_certificate
                .certificate_chain_pem
                .contains("BEGIN CERTIFICATE")
        );
        assert!(leaf_certificate.private_key_pem.contains("BEGIN PRIVATE KEY"));
        assert_eq!(
            leaf_certificate
                .certificate_chain_pem
                .matches("BEGIN CERTIFICATE")
                .count(),
            2
        );
    }

    #[test]
    fn rejects_empty_server_names() {
        let generated_proxy_ca =
            generate_proxy_ca_impl().expect("expected proxy ca generation to succeed");

        let error = match issue_proxy_leaf_certificate_impl(
            generated_proxy_ca.certificate_pem,
            generated_proxy_ca.private_key_pem,
            "   ".to_string(),
        ) {
            Ok(_) => panic!("expected empty server name to fail"),
            Err(error) => error,
        };

        assert_eq!(error.to_string(), "server name is required");
    }

    #[test]
    fn prepares_proxy_ca_runtime_env_with_pipe_backed_fds() {
        let generated_proxy_ca =
            generate_proxy_ca_impl().expect("expected proxy ca generation to succeed");

        let prepared = prepare_proxy_ca_runtime_env(super::PrepareProxyCaRuntimeEnvInput {
            certificate_pem: generated_proxy_ca.certificate_pem.clone(),
            private_key_pem: generated_proxy_ca.private_key_pem.clone(),
        })
        .expect("expected proxy ca runtime env preparation to succeed");

        let certificate_payload =
            read_all_from_prepared_fd(&prepared, NativePreparedProxyCaRuntimeEnv::certificate_fd);
        let private_key_payload =
            read_all_from_prepared_fd(&prepared, NativePreparedProxyCaRuntimeEnv::private_key_fd);

        assert_eq!(certificate_payload, generated_proxy_ca.certificate_pem);
        assert_eq!(private_key_payload, generated_proxy_ca.private_key_pem);

        let certificate_fd = prepared
            .certificate_fd()
            .expect("expected certificate fd to remain available");
        let flags_bits = fcntl(unsafe { BorrowedFd::borrow_raw(certificate_fd) }, FcntlArg::F_GETFD)
            .expect("expected certificate fd flags read to succeed");
        let flags = FdFlag::from_bits_truncate(flags_bits);
        assert!(
            !flags.contains(FdFlag::FD_CLOEXEC),
            "expected certificate fd to clear close-on-exec"
        );
    }

    #[test]
    fn cleanup_closes_proxy_ca_runtime_env_fds() {
        let prepared = prepare_proxy_ca_runtime_env(super::PrepareProxyCaRuntimeEnvInput {
            certificate_pem: "certificate".to_string(),
            private_key_pem: "private-key".to_string(),
        })
        .expect("expected proxy ca runtime env preparation to succeed");

        let certificate_fd = prepared
            .certificate_fd()
            .expect("expected certificate fd to be available");
        prepared
            .cleanup()
            .expect("expected proxy ca runtime env cleanup to succeed");

        let mut chunk = [0_u8; 1];
        let read_error = read(unsafe { BorrowedFd::borrow_raw(certificate_fd) }, &mut chunk)
            .expect_err("expected cleaned up certificate fd to be closed");
        assert_eq!(read_error, nix::errno::Errno::EBADF);
        assert!(prepared.certificate_fd().is_err());
        assert!(prepared.private_key_fd().is_err());
    }

    #[test]
    fn rejects_empty_proxy_ca_runtime_env_payloads() {
        let error = match prepare_proxy_ca_runtime_env(super::PrepareProxyCaRuntimeEnvInput {
            certificate_pem: "   ".to_string(),
            private_key_pem: "private-key".to_string(),
        }) {
            Ok(_) => panic!("expected empty certificate payload to fail"),
            Err(error) => error,
        };

        assert_eq!(error.reason, "proxy ca certificate must not be empty");
    }
}
