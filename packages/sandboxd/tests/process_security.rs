#[cfg(target_os = "linux")]
use std::os::unix::net::UnixStream;
#[cfg(target_os = "linux")]
#[test]
fn apply_current_process_security_sets_non_dumpable() {
    sandboxd::security::apply_current_process_security()
        .expect("process hardening should succeed on linux");

    let dumpable = unsafe { prctl(PR_GET_DUMPABLE, 0, 0, 0, 0) };
    assert_eq!(dumpable, 0, "current process should be non-dumpable");
}

#[cfg(target_os = "linux")]
#[test]
fn accepts_unix_socket_peer_with_same_uid() {
    let (client, server) = UnixStream::pair().expect("unix stream pair should be created");
    drop(client);

    sandboxd::security::ensure_unix_socket_peer_matches_current_process_uid(&server)
        .expect("peer verification should accept connections from the current uid");
}

#[cfg(target_os = "linux")]
const PR_GET_DUMPABLE: i32 = 3;

#[cfg(target_os = "linux")]
unsafe extern "C" {
    fn prctl(option: i32, arg2: i32, arg3: i32, arg4: i32, arg5: i32) -> i32;
}
