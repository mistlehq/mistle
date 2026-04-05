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
    let duplicated_stdin = unsafe { nix::libc::dup(0) };
    assert!(duplicated_stdin >= 0, "expected stdin dup to succeed");

    let set_result =
        unsafe { nix::libc::fcntl(duplicated_stdin, nix::libc::F_SETFD, nix::libc::FD_CLOEXEC) };
    assert_eq!(set_result, 0, "expected setting cloexec to succeed");

    sandboxd::bootstrap::clear_close_on_exec(duplicated_stdin)
        .expect("expected cloexec clearing to succeed");

    let flags = unsafe { nix::libc::fcntl(duplicated_stdin, nix::libc::F_GETFD) };
    assert!(flags >= 0, "expected reading descriptor flags to succeed");
    assert_eq!(flags & nix::libc::FD_CLOEXEC, 0);

    let close_result = unsafe { nix::libc::close(duplicated_stdin) };
    assert_eq!(
        close_result, 0,
        "expected duplicated stdin close to succeed"
    );
}
