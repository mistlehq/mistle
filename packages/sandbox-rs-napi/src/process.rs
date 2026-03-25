use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::process::{Command, Stdio};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

use napi::bindgen_prelude::Function;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Error, Result, Status};
use napi_derive::napi;

use crate::security::ProcessEnvironmentEntry;

#[napi(object)]
pub struct SpawnManagedProcessInput {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<Vec<ProcessEnvironmentEntry>>,
}

#[napi(object)]
pub struct ProcessExitResult {
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
}

struct ExitState {
    exited: bool,
    exit_code: Option<i32>,
    signal: Option<String>,
}

type ExitCallback = ThreadsafeFunction<ProcessExitResult, (), ProcessExitResult, Status, false>;

struct NativeManagedProcessInner {
    process_group_id: nix::libc::pid_t,
    exit_state: Mutex<ExitState>,
    exit_changed: Condvar,
    exit_callback: Option<ExitCallback>,
}

#[napi]
pub struct NativeManagedProcess {
    inner: Arc<NativeManagedProcessInner>,
}

fn lock<'a, T>(mutex: &'a Mutex<T>, context: &str) -> Result<MutexGuard<'a, T>> {
    mutex.lock().map_err(|_| {
        Error::new(
            Status::GenericFailure,
            format!("{context} lock is poisoned"),
        )
    })
}

fn validate_environment_entry(entry: &ProcessEnvironmentEntry) -> Result<()> {
    if entry.name.trim().is_empty() {
        return Err(Error::new(
            Status::InvalidArg,
            "process environment entry name is required".to_string(),
        ));
    }
    if entry.name.contains('=') {
        return Err(Error::new(
            Status::InvalidArg,
            "process environment entry name must not contain '='".to_string(),
        ));
    }

    Ok(())
}

fn build_exit_callback(callback: Function<'_, ProcessExitResult, ()>) -> Result<ExitCallback> {
    callback
        .build_threadsafe_function::<ProcessExitResult>()
        .build_callback(|context| Ok(context.value))
}

fn mark_exited(inner: &Arc<NativeManagedProcessInner>, exit_result: ProcessExitResult) {
    if let Ok(mut exit_state) = inner.exit_state.lock() {
        exit_state.exited = true;
        exit_state.exit_code = exit_result.exit_code;
        exit_state.signal = exit_result.signal.clone();
        inner.exit_changed.notify_all();
    }

    if let Some(callback) = &inner.exit_callback {
        let status = callback.call(exit_result, ThreadsafeFunctionCallMode::NonBlocking);
        if !matches!(status, Status::Ok | Status::Closing)
            && let Ok(mut exit_state) = inner.exit_state.lock()
        {
            exit_state.exited = true;
            inner.exit_changed.notify_all();
        }
    }
}

#[cfg(test)]
fn wait_for_exit_state(
    inner: &Arc<NativeManagedProcessInner>,
    timeout: Option<std::time::Duration>,
) -> Result<ProcessExitResult> {
    let mut exit_state = lock(&inner.exit_state, "managed process exit state")?;
    if exit_state.exited {
        return Ok(ProcessExitResult {
            exit_code: exit_state.exit_code,
            signal: exit_state.signal.clone(),
        });
    }

    match timeout {
        None => {
            while !exit_state.exited {
                exit_state = inner.exit_changed.wait(exit_state).map_err(|_| {
                    Error::new(
                        Status::GenericFailure,
                        "managed process exit state lock is poisoned".to_string(),
                    )
                })?;
            }
        }
        Some(duration) => {
            let waited = inner
                .exit_changed
                .wait_timeout(exit_state, duration)
                .map_err(|_| {
                    Error::new(
                        Status::GenericFailure,
                        "managed process exit state lock is poisoned".to_string(),
                    )
                })?;
            exit_state = waited.0;
            if !exit_state.exited && waited.1.timed_out() {
                return Err(Error::new(
                    Status::GenericFailure,
                    "process exit wait timed out".to_string(),
                ));
            }

            while !exit_state.exited {
                exit_state = inner.exit_changed.wait(exit_state).map_err(|_| {
                    Error::new(
                        Status::GenericFailure,
                        "managed process exit state lock is poisoned".to_string(),
                    )
                })?;
            }
        }
    }

    Ok(ProcessExitResult {
        exit_code: exit_state.exit_code,
        signal: exit_state.signal.clone(),
    })
}

fn signal_from_input(signal: &str) -> Result<nix::sys::signal::Signal> {
    match signal {
        "sigterm" => Ok(nix::sys::signal::Signal::SIGTERM),
        "sigkill" => Ok(nix::sys::signal::Signal::SIGKILL),
        _ => Err(Error::new(
            Status::InvalidArg,
            format!("unsupported process signal '{signal}'"),
        )),
    }
}

fn signal_managed_process_impl(inner: &Arc<NativeManagedProcessInner>, signal: &str) -> Result<()> {
    if is_process_exited(inner)? {
        return Ok(());
    }

    let signal = signal_from_input(signal)?;
    let result =
        nix::sys::signal::killpg(nix::unistd::Pid::from_raw(inner.process_group_id), signal);
    match result {
        Ok(()) => Ok(()),
        Err(nix::errno::Errno::ESRCH) => Ok(()),
        Err(error) => {
            if is_process_exited(inner)? {
                return Ok(());
            }

            Err(Error::new(
                Status::GenericFailure,
                format!("failed to signal process: {error}"),
            ))
        }
    }
}

fn is_process_exited(inner: &Arc<NativeManagedProcessInner>) -> Result<bool> {
    Ok(lock(&inner.exit_state, "managed process exit state")?.exited)
}

fn spawn_managed_process_impl(
    input: SpawnManagedProcessInput,
    exit_callback: Option<ExitCallback>,
) -> Result<NativeManagedProcess> {
    if input.command.trim().is_empty() {
        return Err(Error::new(
            Status::InvalidArg,
            "process command is required".to_string(),
        ));
    }

    let mut command = Command::new(&input.command);
    command.args(&input.args);
    command.stdin(Stdio::inherit());
    command.stdout(Stdio::inherit());
    command.stderr(Stdio::inherit());

    if let Some(cwd) = input.cwd
        && !cwd.trim().is_empty()
    {
        command.current_dir(cwd);
    }

    if let Some(environment) = input.env {
        command.env_clear();
        for entry in environment {
            validate_environment_entry(&entry)?;
            command.env(entry.name, entry.value);
        }
    }

    unsafe {
        command.pre_exec(|| {
            nix::unistd::setpgid(nix::unistd::Pid::from_raw(0), nix::unistd::Pid::from_raw(0))
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            Ok(())
        });
    }

    let mut child = command.spawn().map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("failed to start process command: {error}"),
        )
    })?;

    let pid = i32::try_from(child.id()).map_err(|_| {
        Error::new(
            Status::GenericFailure,
            "managed process pid overflow".to_string(),
        )
    })?;

    let inner = Arc::new(NativeManagedProcessInner {
        process_group_id: pid,
        exit_state: Mutex::new(ExitState {
            exited: false,
            exit_code: None,
            signal: None,
        }),
        exit_changed: Condvar::new(),
        exit_callback,
    });

    let wait_inner = inner.clone();
    std::thread::spawn(move || {
        let exit_result = match child.wait() {
            Ok(exit_status) => ProcessExitResult {
                exit_code: exit_status.code(),
                signal: exit_status
                    .signal()
                    .map(nix::sys::signal::Signal::try_from)
                    .and_then(|result| result.ok())
                    .map(|signal| format!("{signal:?}")),
            },
            Err(error) => ProcessExitResult {
                exit_code: Some(1),
                signal: Some(format!("WAIT_ERROR:{error}")),
            },
        };
        mark_exited(&wait_inner, exit_result);
    });

    Ok(NativeManagedProcess { inner })
}

#[napi]
pub fn spawn_managed_process(
    input: SpawnManagedProcessInput,
    on_exit: Function<'_, ProcessExitResult, ()>,
) -> Result<NativeManagedProcess> {
    spawn_managed_process_impl(input, Some(build_exit_callback(on_exit)?))
}

#[napi]
impl NativeManagedProcess {
    #[napi]
    pub fn signal(&self, signal: String) -> Result<()> {
        signal_managed_process_impl(&self.inner, &signal)
    }

    #[napi]
    pub fn has_exited(&self) -> Result<bool> {
        is_process_exited(&self.inner)
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::time::Duration;

    use super::{
        SpawnManagedProcessInput, signal_managed_process_impl, spawn_managed_process_impl,
        wait_for_exit_state,
    };
    use crate::security::ProcessEnvironmentEntry;

    #[test]
    fn rejects_empty_command() {
        let result = spawn_managed_process_impl(
            SpawnManagedProcessInput {
                command: "".to_string(),
                args: Vec::new(),
                cwd: None,
                env: None,
            },
            None,
        );

        assert!(
            matches!(result, Err(error) if error.to_string().contains("process command is required"))
        );
    }

    #[test]
    fn waits_for_process_exit_code() {
        let process = spawn_managed_process_impl(
            SpawnManagedProcessInput {
                command: "/bin/sh".to_string(),
                args: vec!["-c".to_string(), "exit 17".to_string()],
                cwd: None,
                env: None,
            },
            None,
        )
        .expect("expected managed process start to succeed");

        let exit_result = wait_for_exit_state(&process.inner, Some(Duration::from_secs(2)))
            .expect("expected managed process to exit");

        assert_eq!(exit_result.exit_code, Some(17));
        assert_eq!(exit_result.signal, None);
    }

    #[test]
    fn signal_kills_process_group_tree() {
        let child_pid_path = helper_child_pid_path();
        let process = spawn_managed_process_impl(
            SpawnManagedProcessInput {
                command: "/bin/sh".to_string(),
                args: vec![
                    "-c".to_string(),
                    "sleep 30 & child=$!; printf '%s' \"$child\" > \"$CHILD_PID_PATH\"; trap '' TERM; wait"
                        .to_string(),
                ],
                cwd: None,
                env: Some(vec![ProcessEnvironmentEntry {
                    name: "CHILD_PID_PATH".to_string(),
                    value: child_pid_path.display().to_string(),
                }]),
            },
            None,
        )
        .expect("expected managed process start to succeed");

        let child_pid = wait_for_child_pid(&child_pid_path);
        signal_managed_process_impl(&process.inner, "sigkill")
            .expect("expected process signal to succeed");
        let exit_result = wait_for_exit_state(&process.inner, Some(Duration::from_secs(2)))
            .expect("expected managed process to exit");

        assert_eq!(exit_result.signal, Some("SIGKILL".to_string()));
        assert_process_absent(child_pid);
        let _ = std::fs::remove_file(child_pid_path);
    }

    fn helper_child_pid_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "mistle-runtime-client-child-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("expected system time after unix epoch")
                .as_nanos()
        ))
    }

    fn wait_for_child_pid(path: &Path) -> i32 {
        for _ in 0..200 {
            match std::fs::read_to_string(path) {
                Ok(value) => match value.trim().parse::<i32>() {
                    Ok(pid) if pid > 0 => return pid,
                    _ => std::thread::sleep(Duration::from_millis(10)),
                },
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("expected child pid file read to succeed: {error}"),
            }
        }

        panic!("expected child pid file to be written");
    }

    fn assert_process_absent(pid: i32) {
        for _ in 0..200 {
            let result = unsafe { nix::libc::kill(pid, 0) };
            if result != 0 {
                let error = std::io::Error::last_os_error();
                if matches!(error.raw_os_error(), Some(nix::libc::ESRCH)) {
                    return;
                }
            }

            std::thread::sleep(Duration::from_millis(10));
        }

        panic!("expected child pid {pid} to be absent");
    }
}
