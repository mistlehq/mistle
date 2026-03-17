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
    let group_count = i32::try_from(groups.len())
        .map_err(|_| "supplementary group count overflow".to_string())?;
    let result = unsafe { nix::libc::setgroups(group_count, groups.as_ptr()) };
    if result != 0 {
        return Err(format!(
            "failed to set supplementary groups: {}",
            std::io::Error::last_os_error()
        ));
    }

    Ok(())
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
        use std::io::Write as _;

        let helper_mode = match std::env::var(DUMPABILITY_HELPER_MODE_ENV) {
            Ok(value) => value,
            Err(_) => return,
        };

        match helper_mode.as_str() {
            "non-dumpable" => {
                set_current_process_non_dumpable_impl()
                    .expect("expected helper process hardening to succeed");
            }
            other => panic!("unexpected helper mode {other}"),
        }

        let dumpable = current_process_dumpable().expect("expected helper dumpable query");
        println!("ready dumpable={dumpable}");
        std::io::stdout()
            .flush()
            .expect("expected helper stdout flush to succeed");

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
            assert!(status.success(), "expected helper process to exit successfully");
        }
    }

    #[cfg(target_os = "linux")]
    fn start_dumpability_helper(helper_mode: &str) -> DumpabilityHelper {
        let current_executable =
            std::env::current_exe().expect("expected current test executable path");
        let mut command = std::process::Command::new(current_executable);
        command
            .arg("--exact")
            .arg("security::tests::dumpability_helper_process")
            .env(DUMPABILITY_HELPER_MODE_ENV, helper_mode)
            .stdout(std::process::Stdio::piped())
            .stdin(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit());

        let mut child = command
            .spawn()
            .expect("expected helper process spawn to succeed");

        let stdout = child.stdout.take().expect("expected helper stdout");
        let stdin = child.stdin.take().expect("expected helper stdin");
        let mut reader = std::io::BufReader::new(stdout);
        let mut readiness_line = String::new();
        std::io::BufRead::read_line(&mut reader, &mut readiness_line)
            .expect("expected helper readiness line");

        let dumpable = parse_helper_dumpable(readiness_line.trim());

        DumpabilityHelper {
            command: child,
            stdin,
            dumpable,
        }
    }

    #[cfg(target_os = "linux")]
    fn parse_helper_dumpable(readiness_line: &str) -> bool {
        const PREFIX: &str = "ready dumpable=";

        assert!(
            readiness_line.starts_with(PREFIX),
            "unexpected helper readiness line: {readiness_line}"
        );

        readiness_line[PREFIX.len()..]
            .parse::<bool>()
            .expect("expected helper dumpable flag")
    }
}
