use std::ffi::CString;
use std::fmt::{self, Display};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessEnvironmentEntry {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecRuntimeInput {
    pub uid: u32,
    pub gid: u32,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<ProcessEnvironmentEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootstrapError {
    message: String,
}

impl BootstrapError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for BootstrapError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for BootstrapError {}

fn ensure_running_as_root() -> Result<(), BootstrapError> {
    if !nix::unistd::geteuid().is_root() {
        return Err(BootstrapError::new(
            "sandbox bootstrap must still be running as root",
        ));
    }

    Ok(())
}

pub fn clear_close_on_exec(fd: i32) -> Result<(), BootstrapError> {
    if fd < 0 {
        return Err(BootstrapError::new("fd must be non-negative"));
    }

    let current_flags = unsafe { nix::libc::fcntl(fd, nix::libc::F_GETFD) };
    if current_flags < 0 {
        return Err(BootstrapError::new(format!(
            "failed to read fd flags for {fd}: {}",
            std::io::Error::last_os_error()
        )));
    }

    let updated_flags = current_flags & !nix::libc::FD_CLOEXEC;
    let result = unsafe { nix::libc::fcntl(fd, nix::libc::F_SETFD, updated_flags) };
    if result < 0 {
        return Err(BootstrapError::new(format!(
            "failed to clear close-on-exec for fd {fd}: {}",
            std::io::Error::last_os_error()
        )));
    }

    Ok(())
}

fn set_supplementary_groups(gid: u32) -> Result<(), BootstrapError> {
    let groups = [gid as nix::libc::gid_t];
    let group_count = setgroups_count(groups.len())?;
    let result = unsafe { nix::libc::setgroups(group_count, groups.as_ptr()) };
    if result != 0 {
        return Err(BootstrapError::new(format!(
            "failed to set supplementary groups: {}",
            std::io::Error::last_os_error()
        )));
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn setgroups_count(group_count: usize) -> Result<nix::libc::size_t, BootstrapError> {
    nix::libc::size_t::try_from(group_count)
        .map_err(|_| BootstrapError::new("supplementary group count overflow"))
}

#[cfg(not(target_os = "linux"))]
fn setgroups_count(group_count: usize) -> Result<nix::libc::c_int, BootstrapError> {
    nix::libc::c_int::try_from(group_count)
        .map_err(|_| BootstrapError::new("supplementary group count overflow"))
}

fn build_exec_argv(command: &str, args: &[String]) -> Result<Vec<CString>, BootstrapError> {
    let mut argv = Vec::with_capacity(args.len() + 1);
    argv.push(
        CString::new(command)
            .map_err(|_| BootstrapError::new("runtime command must not contain NUL bytes"))?,
    );

    for arg in args {
        argv.push(
            CString::new(arg.as_str())
                .map_err(|_| BootstrapError::new("runtime args must not contain NUL bytes"))?,
        );
    }

    Ok(argv)
}

fn build_exec_environment(
    env: Vec<ProcessEnvironmentEntry>,
) -> Result<Vec<CString>, BootstrapError> {
    let mut environment = Vec::with_capacity(env.len());

    for entry in env {
        if entry.name.trim().is_empty() {
            return Err(BootstrapError::new(
                "runtime environment entry name is required",
            ));
        }
        if entry.name.contains('=') {
            return Err(BootstrapError::new(
                "runtime environment entry name must not contain '='",
            ));
        }

        environment.push(
            CString::new(format!("{}={}", entry.name, entry.value)).map_err(|_| {
                BootstrapError::new("runtime environment entries must not contain NUL bytes")
            })?,
        );
    }

    Ok(environment)
}

pub fn exec_runtime(input: ExecRuntimeInput) -> Result<(), BootstrapError> {
    if input.command.trim().is_empty() {
        return Err(BootstrapError::new("runtime command is required"));
    }

    let argv = build_exec_argv(&input.command, &input.args)?;
    let environment = build_exec_environment(input.env)?;
    ensure_running_as_root()?;

    // Keep the privilege drop and exec ordering in one place: explicit groups
    // first, then gid, then uid, then clear stdio CLOEXEC before execve.
    set_supplementary_groups(input.gid)?;
    nix::unistd::setgid(nix::unistd::Gid::from_raw(input.gid))
        .map_err(|error| BootstrapError::new(format!("failed to switch to runtime gid: {error}")))?;
    nix::unistd::setuid(nix::unistd::Uid::from_raw(input.uid))
        .map_err(|error| BootstrapError::new(format!("failed to switch to runtime uid: {error}")))?;
    clear_close_on_exec(0)?;
    clear_close_on_exec(1)?;
    clear_close_on_exec(2)?;

    let command = CString::new(input.command)
        .map_err(|_| BootstrapError::new("runtime command must not contain NUL bytes"))?;

    match nix::unistd::execve(&command, &argv, &environment) {
        Ok(_) => unreachable!("execve should not return on success"),
        Err(error) => Err(BootstrapError::new(format!(
            "failed to exec sandbox runtime: {error}"
        ))),
    }
}
