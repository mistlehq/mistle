use std::os::fd::AsRawFd;

use nix::fcntl::{FcntlArg, FdFlag, fcntl};

#[test]
fn rejects_invalid_environment_entry_name() {
    let result = sandboxd::bootstrap::exec_runtime(sandboxd::bootstrap::ExecRuntimeInput {
        uid: nix::unistd::geteuid().as_raw(),
        gid: nix::unistd::getegid().as_raw(),
        command: "/definitely/missing/runtime".to_string(),
        args: vec!["runtime-internal".to_string()],
        env: vec![sandboxd::bootstrap::ProcessEnvironmentEntry {
            name: "BAD=NAME".to_string(),
            value: "value".to_string(),
        }],
    });

    assert!(matches!(
        result,
        Err(error) if error
            .to_string()
            .contains("runtime environment entry name must not contain '='")
    ));
}

#[test]
fn requires_root_for_runtime_exec_handoff() {
    let current_uid = nix::unistd::geteuid().as_raw();
    let current_gid = nix::unistd::getegid().as_raw();

    let result = sandboxd::bootstrap::exec_runtime(sandboxd::bootstrap::ExecRuntimeInput {
        uid: current_uid,
        gid: current_gid,
        command: "/definitely/missing/runtime".to_string(),
        args: vec!["runtime-internal".to_string()],
        env: Vec::new(),
    });

    if nix::unistd::geteuid().is_root() {
        assert!(matches!(
            result,
            Err(error) if error
                .to_string()
                .contains("failed to exec sandbox runtime")
        ));
    } else {
        assert!(matches!(
            result,
            Err(error) if error
                .to_string()
                .contains("sandbox bootstrap must still be running as root")
        ));
    }
}

#[test]
fn clears_close_on_exec_for_descriptor() {
    let dev_null = std::fs::File::open("/dev/null").expect("expected /dev/null to be openable");
    fcntl(&dev_null, FcntlArg::F_SETFD(FdFlag::FD_CLOEXEC))
        .expect("expected setting cloexec to succeed");

    sandboxd::bootstrap::clear_close_on_exec(dev_null.as_raw_fd())
        .expect("expected cloexec clearing to succeed");

    let flags_bits =
        fcntl(&dev_null, FcntlArg::F_GETFD).expect("expected reading descriptor flags to succeed");
    let flags = FdFlag::from_bits_truncate(flags_bits);
    assert!(
        !flags.contains(FdFlag::FD_CLOEXEC),
        "expected close-on-exec to be cleared"
    );
}
