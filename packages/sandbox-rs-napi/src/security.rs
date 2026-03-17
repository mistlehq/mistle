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

pub fn exec_runtime_as_user_impl(input: ExecRuntimeAsUserInput) -> Result<(), String> {
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

    let command = std::ffi::CString::new(input.command)
        .map_err(|_| "runtime command must not contain NUL bytes".to_string())?;

    match nix::unistd::execve(&command, &argv, &environment) {
        Ok(_) => unreachable!("execve should not return on success"),
        Err(error) => Err(format!("failed to exec sandbox runtime: {error}")),
    }
}

fn set_supplementary_groups(gid: u32) -> Result<(), String> {
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

fn build_exec_argv(
    command: &str,
    args: &[String],
) -> Result<Vec<std::ffi::CString>, String> {
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
            std::ffi::CString::new(format!("{}={}", entry.name, entry.value))
                .map_err(|_| "runtime environment entries must not contain NUL bytes".to_string())?,
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

#[cfg(test)]
mod tests {
    use super::{
        ExecRuntimeAsUserInput, ProcessEnvironmentEntry, build_exec_environment,
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

        assert!(matches!(result, Err(message) if message.contains("uid")));
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
        let ready_path = std::env::var(DUMPABILITY_HELPER_READY_PATH_ENV)
            .expect("expected helper ready path");

        match helper_mode.as_str() {
            "non-dumpable" => {
                set_current_process_non_dumpable_impl()
                    .expect("expected helper process hardening to succeed");
            }
            other => panic!("unexpected helper mode {other}"),
        }

        let dumpable = current_process_dumpable().expect("expected helper dumpable query");
        std::fs::write(&ready_path, dumpable.to_string())
            .expect("expected helper readiness file write to succeed");

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
            assert!(status.success(), "expected helper process to exit successfully");
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
        let dumpable = read_helper_dumpable(&ready_path).expect("expected helper readiness file");

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
                    return value
                        .trim()
                        .parse::<bool>()
                        .map_err(|error| format!("failed to parse helper dumpable state: {error}"));
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
}
