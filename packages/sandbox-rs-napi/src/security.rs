use napi_derive::napi;

#[napi(object)]
pub struct ProcessEnvironmentEntry {
    pub name: String,
    pub value: String,
}

#[napi(object)]
pub struct ExecRuntimeAsUserInput {
    pub uid: i32,
    pub gid: i32,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<ProcessEnvironmentEntry>,
}

#[napi(object)]
pub struct UnixSocketPeerCredentials {
    pub pid: i32,
    pub uid: i32,
    pub gid: i32,
}

#[cfg(target_os = "linux")]
pub fn set_current_process_non_dumpable_impl() -> Result<(), String> {
    let result = unsafe { nix::libc::prctl(nix::libc::PR_SET_DUMPABLE, 0, 0, 0, 0) };
    if result != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }

    Ok(())
}

#[cfg(not(target_os = "linux"))]
pub fn set_current_process_non_dumpable_impl() -> Result<(), String> {
    Ok(())
}

fn ensure_running_as_root() -> Result<(), String> {
    if !nix::unistd::geteuid().is_root() {
        return Err("sandbox bootstrap must still be running as root".to_string());
    }

    Ok(())
}

pub fn exec_runtime_as_user_impl(input: ExecRuntimeAsUserInput) -> Result<(), String> {
    // This native boundary owns the actual privilege transition. TS resolves the
    // target sandbox identity first, but the syscall-level invariants live here.
    //
    // This intentionally follows the same broad methodology as a native privilege
    // drop helper like rust-privdrop: validate that we are still privileged, make
    // the group state explicit first, drop gid before uid, and only then cross the
    // exec boundary. We keep the implementation local instead of depending on a
    // general-purpose crate because this path also needs a repo-specific stdio
    // inheritance fix around execve() for the packaged Node runtime.
    //
    // 1. confirm the bootstrap process is still privileged
    // 2. replace supplementary groups with the sandbox gid only
    // 3. drop primary gid, then uid
    // 4. clear Node-added FD_CLOEXEC on stdio so exec inherits the original streams
    // 5. execve() the runtime binary so bootstrap code does not continue in-process
    ensure_running_as_root()?;

    if input.uid <= 0 {
        return Err("sandbox uid must be greater than zero".to_string());
    }
    if input.gid < 0 {
        return Err("sandbox gid must be non-negative".to_string());
    }
    if input.command.trim().is_empty() {
        return Err("runtime command is required".to_string());
    }

    let argv = build_exec_argv(&input.command, &input.args)?;
    let environment = build_exec_environment(input.env)?;

    set_supplementary_groups(input.gid as u32)?;
    nix::unistd::setgid(nix::unistd::Gid::from_raw(input.gid as u32))
        .map_err(|error| format!("failed to drop group privileges: {error}"))?;
    nix::unistd::setuid(nix::unistd::Uid::from_raw(input.uid as u32))
        .map_err(|error| format!("failed to drop user privileges: {error}"))?;
    // Node marks stdio fds as close-on-exec during process startup. We must clear
    // FD_CLOEXEC here so the sandbox runtime inherits the original stdin/stdout/stderr
    // streams across execve(), matching the Go bootstrap/runtime handoff.
    clear_close_on_exec(0)?;
    clear_close_on_exec(1)?;
    clear_close_on_exec(2)?;

    let command = std::ffi::CString::new(input.command)
        .map_err(|_| "runtime command must not contain NUL bytes".to_string())?;

    match nix::unistd::execve(&command, &argv, &environment) {
        Ok(_) => unreachable!("execve should not return on success"),
        Err(error) => Err(format!("failed to exec sandbox runtime: {error}")),
    }
}

#[cfg(target_os = "linux")]
fn get_unix_socket_peer_credentials_impl(
    fd: i32,
) -> Result<Option<UnixSocketPeerCredentials>, String> {
    if fd < 0 {
        return Err("socket fd must be non-negative".to_string());
    }

    let mut credentials = std::mem::MaybeUninit::<nix::libc::ucred>::zeroed();
    let mut credentials_length = std::mem::size_of::<nix::libc::ucred>() as nix::libc::socklen_t;
    let result = unsafe {
        nix::libc::getsockopt(
            fd,
            nix::libc::SOL_SOCKET,
            nix::libc::SO_PEERCRED,
            credentials.as_mut_ptr().cast(),
            &mut credentials_length,
        )
    };

    if result != 0 {
        return Err(format!(
            "failed to read unix socket peer credentials: {}",
            std::io::Error::last_os_error()
        ));
    }

    if credentials_length < std::mem::size_of::<nix::libc::ucred>() as nix::libc::socklen_t {
        return Err("unix socket peer credentials were truncated".to_string());
    }

    let credentials = unsafe { credentials.assume_init() };
    Ok(Some(UnixSocketPeerCredentials {
        pid: credentials.pid,
        uid: credentials.uid as i32,
        gid: credentials.gid as i32,
    }))
}

#[cfg(not(target_os = "linux"))]
fn get_unix_socket_peer_credentials_impl(
    _fd: i32,
) -> Result<Option<UnixSocketPeerCredentials>, String> {
    Ok(None)
}

fn clear_close_on_exec(fd: i32) -> Result<(), String> {
    if fd < 0 {
        return Err("fd must be non-negative".to_string());
    }

    // We intentionally preserve these descriptors across execve() for the sandbox
    // runtime handoff. This is especially important for fd 0, because startup input
    // is delivered on stdin and must still be readable by the runtime process.
    let current_flags = unsafe { nix::libc::fcntl(fd, nix::libc::F_GETFD) };
    if current_flags < 0 {
        return Err(format!(
            "failed to read fd flags for {fd}: {}",
            std::io::Error::last_os_error()
        ));
    }

    let updated_flags = current_flags & !nix::libc::FD_CLOEXEC;
    let result = unsafe { nix::libc::fcntl(fd, nix::libc::F_SETFD, updated_flags) };
    if result < 0 {
        return Err(format!(
            "failed to clear close-on-exec for fd {fd}: {}",
            std::io::Error::last_os_error()
        ));
    }

    Ok(())
}

fn set_supplementary_groups(gid: u32) -> Result<(), String> {
    // Keep the supplementary group set explicit and minimal. We do not inherit the
    // bootstrap process groups, and we do not ask libc to resolve any "default"
    // user groups here. The sandbox runtime should run only with the sandbox gid.
    let groups = [gid as nix::libc::gid_t];
    let group_count = setgroups_count(groups.len())?;
    let result = unsafe { nix::libc::setgroups(group_count, groups.as_ptr()) };
    if result != 0 {
        return Err(format!(
            "failed to set supplementary groups: {}",
            std::io::Error::last_os_error()
        ));
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn setgroups_count(group_count: usize) -> Result<nix::libc::size_t, String> {
    nix::libc::size_t::try_from(group_count)
        .map_err(|_| "supplementary group count overflow".to_string())
}

#[cfg(not(target_os = "linux"))]
fn setgroups_count(group_count: usize) -> Result<nix::libc::c_int, String> {
    nix::libc::c_int::try_from(group_count)
        .map_err(|_| "supplementary group count overflow".to_string())
}

fn build_exec_argv(command: &str, args: &[String]) -> Result<Vec<std::ffi::CString>, String> {
    let mut argv = Vec::with_capacity(args.len() + 1);
    argv.push(
        std::ffi::CString::new(command)
            .map_err(|_| "runtime command must not contain NUL bytes".to_string())?,
    );

    for arg in args {
        argv.push(
            std::ffi::CString::new(arg.as_str())
                .map_err(|_| "runtime args must not contain NUL bytes".to_string())?,
        );
    }

    Ok(argv)
}

fn build_exec_environment(
    env: Vec<ProcessEnvironmentEntry>,
) -> Result<Vec<std::ffi::CString>, String> {
    let mut environment = Vec::with_capacity(env.len());

    for entry in env {
        if entry.name.trim().is_empty() {
            return Err("runtime environment entry name is required".to_string());
        }
        if entry.name.contains('=') {
            return Err("runtime environment entry name must not contain '='".to_string());
        }

        environment.push(
            std::ffi::CString::new(format!("{}={}", entry.name, entry.value)).map_err(|_| {
                "runtime environment entries must not contain NUL bytes".to_string()
            })?,
        );
    }

    Ok(environment)
}

#[napi]
pub fn set_current_process_non_dumpable() -> napi::Result<()> {
    set_current_process_non_dumpable_impl().map_err(napi::Error::from_reason)
}

#[napi]
pub fn exec_runtime_as_user(input: ExecRuntimeAsUserInput) -> napi::Result<()> {
    exec_runtime_as_user_impl(input).map_err(napi::Error::from_reason)
}

#[napi]
pub fn get_unix_socket_peer_credentials(
    fd: i32,
) -> napi::Result<Option<UnixSocketPeerCredentials>> {
    get_unix_socket_peer_credentials_impl(fd).map_err(napi::Error::from_reason)
}

#[cfg(test)]
mod tests {
    use super::{
        ExecRuntimeAsUserInput, ProcessEnvironmentEntry, build_exec_environment,
        clear_close_on_exec, ensure_running_as_root,
    };

    #[cfg(target_os = "linux")]
    use super::set_current_process_non_dumpable_impl;

    #[test]
    fn rejects_invalid_environment_entry_name() {
        let result = build_exec_environment(vec![ProcessEnvironmentEntry {
            name: "BAD=NAME".to_string(),
            value: "value".to_string(),
        }]);

        assert!(matches!(result, Err(message) if message.contains("must not contain '='")));
    }

    #[test]
    fn rejects_non_positive_uid_for_exec() {
        let result = super::exec_runtime_as_user_impl(ExecRuntimeAsUserInput {
            uid: 0,
            gid: 1000,
            command: "/usr/bin/node".to_string(),
            args: vec!["dist/main.js".to_string()],
            env: Vec::new(),
        });

        if nix::unistd::geteuid().is_root() {
            assert!(matches!(result, Err(message) if message.contains("uid")));
        } else {
            assert!(matches!(result, Err(message) if message.contains("still be running as root")));
        }
    }

    #[test]
    fn requires_root_for_native_exec_handoff() {
        let result = ensure_running_as_root();

        if nix::unistd::geteuid().is_root() {
            assert!(
                result.is_ok(),
                "expected root test environment to satisfy root check"
            );
        } else {
            assert!(matches!(result, Err(message) if message.contains("still be running as root")));
        }
    }

    #[test]
    fn clears_close_on_exec_for_descriptor() {
        let duplicated_stdin = unsafe { nix::libc::dup(0) };
        assert!(duplicated_stdin >= 0, "expected stdin dup to succeed");

        let set_result = unsafe {
            nix::libc::fcntl(duplicated_stdin, nix::libc::F_SETFD, nix::libc::FD_CLOEXEC)
        };
        assert_eq!(set_result, 0, "expected setting cloexec to succeed");

        clear_close_on_exec(duplicated_stdin).expect("expected cloexec clearing to succeed");

        let flags = unsafe { nix::libc::fcntl(duplicated_stdin, nix::libc::F_GETFD) };
        assert!(flags >= 0, "expected reading descriptor flags to succeed");
        assert_eq!(flags & nix::libc::FD_CLOEXEC, 0);

        let close_result = unsafe { nix::libc::close(duplicated_stdin) };
        assert_eq!(
            close_result, 0,
            "expected duplicated stdin close to succeed"
        );
    }

    #[cfg(target_os = "linux")]
    const DUMPABILITY_HELPER_MODE_ENV: &str = "MISTLE_SECURITY_DUMPABILITY_HELPER_MODE";

    #[cfg(target_os = "linux")]
    const DUMPABILITY_HELPER_READY_PATH_ENV: &str = "MISTLE_SECURITY_DUMPABILITY_HELPER_READY_PATH";

    #[cfg(target_os = "linux")]
    #[test]
    fn reports_non_dumpable_state_in_helper_process() {
        let helper = start_dumpability_helper("non-dumpable");
        assert!(!helper.dumpable);
        helper.close();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn dumpability_helper_process() {
        use std::io::Read as _;

        let helper_mode = match std::env::var(DUMPABILITY_HELPER_MODE_ENV) {
            Ok(value) => value,
            Err(_) => return,
        };
        let ready_path =
            std::env::var(DUMPABILITY_HELPER_READY_PATH_ENV).expect("expected helper ready path");

        match helper_mode.as_str() {
            "non-dumpable" => {
                set_current_process_non_dumpable_impl()
                    .expect("expected helper process hardening to succeed");
            }
            other => panic!("unexpected helper mode {other}"),
        }

        let dumpable = current_process_dumpable().expect("expected helper dumpable query");
        let ready_path_ref = std::path::Path::new(&ready_path);
        let staging_path = ready_path_ref.with_extension("tmp");
        std::fs::write(&staging_path, dumpable.to_string())
            .expect("expected helper readiness staging file write to succeed");
        std::fs::rename(&staging_path, ready_path_ref)
            .expect("expected helper readiness file rename to succeed");

        let mut line = [0_u8; 1];
        std::io::stdin()
            .read_exact(&mut line)
            .expect("expected helper stdin read to succeed");
    }

    #[cfg(target_os = "linux")]
    fn current_process_dumpable() -> Result<bool, String> {
        let result = unsafe { nix::libc::prctl(nix::libc::PR_GET_DUMPABLE, 0, 0, 0, 0) };
        if result < 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }

        Ok(result != 0)
    }

    #[cfg(target_os = "linux")]
    struct DumpabilityHelper {
        command: std::process::Child,
        stdin: std::process::ChildStdin,
        ready_path: std::path::PathBuf,
        dumpable: bool,
    }

    #[cfg(target_os = "linux")]
    impl DumpabilityHelper {
        fn close(mut self) {
            use std::io::Write as _;

            self.stdin
                .write_all(b"\n")
                .expect("expected helper stdin write to succeed");
            let status = self
                .command
                .wait()
                .expect("expected helper process wait to succeed");
            let _ = std::fs::remove_file(&self.ready_path);
            assert!(
                status.success(),
                "expected helper process to exit successfully"
            );
        }
    }

    #[cfg(target_os = "linux")]
    fn start_dumpability_helper(helper_mode: &str) -> DumpabilityHelper {
        let ready_path = helper_ready_path();
        let current_executable =
            std::env::current_exe().expect("expected current test executable path");
        let mut command = std::process::Command::new(current_executable);
        command
            .arg("--exact")
            .arg("security::tests::dumpability_helper_process")
            .env(DUMPABILITY_HELPER_MODE_ENV, helper_mode)
            .env(DUMPABILITY_HELPER_READY_PATH_ENV, &ready_path)
            .stdout(std::process::Stdio::inherit())
            .stdin(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit());

        let mut child = command
            .spawn()
            .expect("expected helper process spawn to succeed");

        let stdin = child.stdin.take().expect("expected helper stdin");
        let dumpable = match read_helper_dumpable(&ready_path) {
            Ok(value) => value,
            Err(error) => {
                cleanup_failed_helper(&mut child, &ready_path);
                panic!("expected helper readiness file: {error}");
            }
        };

        DumpabilityHelper {
            command: child,
            stdin,
            ready_path,
            dumpable,
        }
    }

    #[cfg(target_os = "linux")]
    fn read_helper_dumpable(ready_path: &std::path::Path) -> Result<bool, String> {
        for _ in 0..200 {
            match std::fs::read_to_string(ready_path) {
                Ok(value) => {
                    let trimmed = value.trim();
                    if trimmed.is_empty() {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                        continue;
                    }

                    match trimmed.parse::<bool>() {
                        Ok(parsed) => return Ok(parsed),
                        Err(error) => {
                            std::thread::sleep(std::time::Duration::from_millis(10));
                            if ready_path.exists() {
                                continue;
                            }

                            return Err(format!("failed to parse helper dumpable state: {error}"));
                        }
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(error) => {
                    return Err(format!("failed to read helper readiness file: {error}"));
                }
            }
        }

        Err("helper exited before reporting dumpable state".to_string())
    }

    #[cfg(target_os = "linux")]
    fn helper_ready_path() -> std::path::PathBuf {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("expected system time after unix epoch")
            .as_nanos();

        std::env::temp_dir().join(format!(
            "mistle-security-dumpability-{}-{timestamp}",
            std::process::id(),
        ))
    }

    #[cfg(target_os = "linux")]
    fn cleanup_failed_helper(child: &mut std::process::Child, ready_path: &std::path::Path) {
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_file(ready_path);
    }
}
