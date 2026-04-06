#[cfg(target_os = "linux")]
use nix::sys::prctl;
#[cfg(target_os = "linux")]
use std::os::unix::net::UnixStream;

#[cfg(target_os = "linux")]
#[test]
fn apply_current_process_security_sets_non_dumpable() {
    sandboxd::security::apply_current_process_security()
        .expect("process hardening should succeed on linux");

    let dumpable = prctl::get_dumpable().expect("dumpable state should be readable");
    assert!(!dumpable, "current process should be non-dumpable");
}

#[cfg(target_os = "linux")]
#[test]
fn accepts_unix_socket_peer_with_same_uid() {
    let (client, server) = UnixStream::pair().expect("unix stream pair should be created");
    drop(client);

    sandboxd::security::ensure_unix_socket_peer_matches_current_process_uid(&server)
        .expect("peer verification should accept connections from the current uid");
}
