//! Native bootstrap helpers for the future runtime exec handoff.
//!
//! This module owns the privileged preparation that must happen just before
//! `sandboxd` replaces the bootstrap process with the runtime binary: validate
//! the exec inputs, drop privileges in the right order, and preserve the
//! inherited stdio descriptors across the final `execve`.

use std::ffi::CString;
use std::fmt::{self, Display};
use std::os::fd::BorrowedFd;

use nix::fcntl::{FcntlArg, FdFlag, fcntl};

/// Carries one environment entry destined for the runtime process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessEnvironmentEntry {
    pub name: String,
    pub value: String,
}

/// Collects the privilege drop and exec parameters for one runtime handoff.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecRuntimeInput {
    pub uid: u32,
    pub gid: u32,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<ProcessEnvironmentEntry>,
}

/// Describes why one bootstrap preparation step failed.
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

/// Ensures the bootstrap process still has the privileges required for uid/gid handoff.
fn ensure_running_as_root() -> Result<(), BootstrapError> {
    if !nix::unistd::geteuid().is_root() {
        return Err(BootstrapError::new(
            "sandbox bootstrap must still be running as root",
        ));
    }

    Ok(())
}

/// Clears `FD_CLOEXEC` so the final runtime exec inherits the provided descriptor.
pub fn clear_close_on_exec(fd: i32) -> Result<(), BootstrapError> {
    if fd < 0 {
        return Err(BootstrapError::new("fd must be non-negative"));
    }

    let borrowed_fd = unsafe { BorrowedFd::borrow_raw(fd) };
    let current_flags = fcntl(borrowed_fd, FcntlArg::F_GETFD).map_err(|error| {
        BootstrapError::new(format!("failed to read fd flags for {fd}: {error}"))
    })?;

    let updated_flags = FdFlag::from_bits_truncate(current_flags) & !FdFlag::FD_CLOEXEC;
    fcntl(borrowed_fd, FcntlArg::F_SETFD(updated_flags)).map_err(|error| {
        BootstrapError::new(format!("failed to clear close-on-exec for fd {fd}: {error}"))
    })?;

    Ok(())
}

/// Replaces supplementary groups with the target runtime gid.
fn set_supplementary_groups(gid: u32) -> Result<(), BootstrapError> {
    #[cfg(target_os = "linux")]
    {
        nix::unistd::setgroups(&[nix::unistd::Gid::from_raw(gid)]).map_err(|error| {
            BootstrapError::new(format!("failed to set supplementary groups: {error}"))
        })
    }

    #[cfg(all(not(target_os = "linux"), test))]
    {
        // Keep local non-Linux test builds compiling, but do not treat this as
        // a supported production execution path for `sandboxd`.
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

    #[cfg(all(not(target_os = "linux"), not(test)))]
    {
        let _ = gid;
        Err(BootstrapError::new(
            "sandbox bootstrap is only supported in linux sandboxes",
        ))
    }
}

#[cfg(all(not(target_os = "linux"), test))]
fn setgroups_count(group_count: usize) -> Result<nix::libc::c_int, BootstrapError> {
    nix::libc::c_int::try_from(group_count)
        .map_err(|_| BootstrapError::new("supplementary group count overflow"))
}

/// Builds the argv vector that will be passed to `execve`.
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

/// Builds the environment vector that will be passed to `execve`.
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

/// Drops privileges and replaces the current process with the runtime binary.
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
