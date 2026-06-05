//! Runtime-client process start/stop lifecycle helpers.
//!
//! This module owns environment merging, child spawn, readiness waiting, and
//! shutdown signal policy for generic runtime processes.

use std::collections::BTreeMap;
use std::process::{Child, Command, Stdio};

use nix::errno::Errno;
use nix::sys::signal::{Signal, kill as send_signal};
use nix::unistd::Pid;

use crate::cgroups::{attach_pid_to_scope, kill_scope};
use crate::process::*;
use crate::runtime::{RuntimeClientProcessReadiness, RuntimeClientProcessStopSignal};
use crate::time::{Clock, Sleeper};

/// Merges client-wide environment variables with any process-local overrides.
pub(super) fn merge_runtime_client_process_env(
    runtime_env: &BTreeMap<String, String>,
    runtime_client_env: &BTreeMap<String, String>,
    process_command_env: Option<&BTreeMap<String, String>>,
) -> Option<BTreeMap<String, String>> {
    if runtime_env.is_empty()
        && runtime_client_env.is_empty()
        && process_command_env.is_none_or(BTreeMap::is_empty)
    {
        return None;
    }

    let mut merged_env = runtime_env.clone();
    for (key, value) in runtime_client_env {
        merged_env.insert(key.clone(), value.clone());
    }
    if let Some(process_command_env) = process_command_env {
        for (key, value) in process_command_env {
            merged_env.insert(key.clone(), value.clone());
        }
    }

    Some(merged_env)
}

/// Spawns one runtime client child process with stdio detached from `sandboxd`.
pub(super) fn start_runtime_client_process(
    process_spec: &RuntimeClientProcessSpec,
) -> Result<RunningRuntimeClientProcess, String> {
    let (child, output_capture) = spawn_runtime_client_child(process_spec)?;

    Ok(RunningRuntimeClientProcess {
        spec: process_spec.clone(),
        child: Arc::new(Mutex::new(child)),
        output_capture,
        platform_scope: None,
    })
}

pub(super) fn start_scoped_runtime_client_process(
    process_spec: &RuntimeClientProcessSpec,
    platform_scope: RuntimeClientProcessPlatformScope,
) -> Result<RunningRuntimeClientProcess, String> {
    let (child, output_capture) = match spawn_runtime_client_child(process_spec) {
        Ok(started_process) => started_process,
        Err(error) => {
            if let Err(cleanup_error) =
                kill_runtime_client_process_platform_scope_by_scope(&platform_scope)
            {
                return Err(format!(
                    "{error}; platform scope cleanup failed: {cleanup_error}"
                ));
            }
            return Err(error);
        }
    };
    let process_id = child.id();
    if let Err(error) = attach_pid_to_scope(&platform_scope.scope_paths, process_id) {
        let mut failed_process = RunningRuntimeClientProcess {
            spec: process_spec.clone(),
            child: Arc::new(Mutex::new(child)),
            output_capture,
            platform_scope: Some(platform_scope.clone()),
        };
        let _ = signal_runtime_client_process(
            &mut failed_process,
            RuntimeClientProcessStopSignal::Sigkill,
        );
        if let Err(cleanup_error) =
            kill_runtime_client_process_platform_scope_by_scope(&platform_scope)
        {
            return Err(format!(
                "{error}; platform scope cleanup failed: {cleanup_error}"
            ));
        }
        return Err(error.to_string());
    }

    platform_scope.registry.replace_scope(
        platform_scope.registry_key.clone(),
        platform_scope.process_key.clone(),
        platform_scope.scope_paths.clone(),
        process_id,
    )?;

    Ok(RunningRuntimeClientProcess {
        spec: process_spec.clone(),
        child: Arc::new(Mutex::new(child)),
        output_capture,
        platform_scope: Some(platform_scope),
    })
}

pub(super) fn spawn_runtime_client_child(
    process_spec: &RuntimeClientProcessSpec,
) -> Result<(Child, ProcessOutputCapture), String> {
    let command = process_spec
        .command
        .args
        .first()
        .ok_or_else(|| "process command args must not be empty".to_string())?;
    let mut child_command = Command::new(command);
    child_command
        .args(&process_spec.command.args[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(cwd) = process_spec.command.cwd.as_deref() {
        child_command.current_dir(cwd);
    }
    if let Some(env) = &process_spec.command.env {
        child_command.envs(env);
    }

    let mut child = child_command
        .spawn()
        .map_err(|error| format!("failed to start process command: {error}"))?;

    let output_capture = ProcessOutputCapture::new();
    if let Some(stdout) = child.stdout.take() {
        output_capture.register_capture_thread(spawn_output_capture_thread(
            stdout,
            output_capture.clone(),
            OutputStream::Stdout,
        ));
    }
    if let Some(stderr) = child.stderr.take() {
        output_capture.register_capture_thread(spawn_output_capture_thread(
            stderr,
            output_capture.clone(),
            OutputStream::Stderr,
        ));
    }

    Ok((child, output_capture))
}

/// Waits until one process either becomes ready, exits early, or times out.
pub(super) fn wait_for_runtime_client_process_readiness(
    process: &mut RunningRuntimeClientProcess,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<(), String> {
    let mut child = process
        .child
        .lock()
        .expect("runtime client child lock should not be poisoned");
    wait_for_runtime_client_process_readiness_with(&process.spec, &mut child, clock, sleeper)
}

pub(super) fn wait_for_runtime_client_process_readiness_with(
    process_spec: &RuntimeClientProcessSpec,
    child: &mut Child,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<(), String> {
    let timeout_ms = match &process_spec.readiness {
        RuntimeClientProcessReadiness::None => return Ok(()),
        RuntimeClientProcessReadiness::Tcp { timeout_ms, .. }
        | RuntimeClientProcessReadiness::Http { timeout_ms, .. }
        | RuntimeClientProcessReadiness::Ws { timeout_ms, .. } => *timeout_ms,
    };
    let deadline_ms = clock.now_ms().saturating_add(timeout_ms);

    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("failed to poll process exit: {error}"))?
        {
            return Err(describe_process_exit(status));
        }

        match check_runtime_client_process_readiness_from_spec(process_spec) {
            Ok(()) => return Ok(()),
            Err(error) if clock.now_ms() >= deadline_ms => {
                return Err(format!(
                    "timed out after {timeout_ms}ms waiting for readiness: {error}"
                ));
            }
            Err(_) => {}
        }

        sleeper.sleep(DEFAULT_PROCESS_READINESS_POLL_INTERVAL);
    }
}

pub(super) fn check_runtime_client_process_readiness_from_spec(
    process_spec: &RuntimeClientProcessSpec,
) -> Result<(), String> {
    match &process_spec.readiness {
        RuntimeClientProcessReadiness::None => Ok(()),
        RuntimeClientProcessReadiness::Tcp { host, port, .. } => check_tcp_readiness(host, *port),
        RuntimeClientProcessReadiness::Http {
            url,
            expected_status,
            ..
        } => check_http_readiness(url, *expected_status),
        RuntimeClientProcessReadiness::Ws { url, .. } => check_ws_readiness(url),
    }
}

pub(super) fn check_codex_app_server_post_start_readiness(
    process_spec: &RuntimeClientProcessSpec,
) -> Result<(), String> {
    if let RuntimeClientProcessReadiness::Ws { url, .. } = &process_spec.readiness {
        let ready_url = codex_app_server_readyz_url(url)?;
        return check_http_readiness_with_timeout(
            &ready_url,
            200,
            CODEX_APP_SERVER_POST_START_READINESS_TIMEOUT,
        );
    }

    check_runtime_client_process_readiness_from_spec(process_spec)
}

pub(super) fn readiness_type(process_spec: &RuntimeClientProcessSpec) -> &'static str {
    match &process_spec.readiness {
        RuntimeClientProcessReadiness::None => "none",
        RuntimeClientProcessReadiness::Tcp { .. } => "tcp",
        RuntimeClientProcessReadiness::Http { .. } => "http",
        RuntimeClientProcessReadiness::Ws { .. } => "ws",
    }
}

pub(super) fn readiness_target(process_spec: &RuntimeClientProcessSpec) -> String {
    match &process_spec.readiness {
        RuntimeClientProcessReadiness::None => "".to_string(),
        RuntimeClientProcessReadiness::Tcp { host, port, .. } => format!("{host}:{port}"),
        RuntimeClientProcessReadiness::Http { url, .. } => url.clone(),
        RuntimeClientProcessReadiness::Ws { url, .. } => url.clone(),
    }
}

pub(super) fn readiness_timeout_ms(process_spec: &RuntimeClientProcessSpec) -> u64 {
    match &process_spec.readiness {
        RuntimeClientProcessReadiness::None => 0,
        RuntimeClientProcessReadiness::Tcp { timeout_ms, .. }
        | RuntimeClientProcessReadiness::Http { timeout_ms, .. }
        | RuntimeClientProcessReadiness::Ws { timeout_ms, .. } => *timeout_ms,
    }
}

/// Stops all previously started processes, reporting every shutdown failure together.
pub(super) fn stop_started_processes(
    processes: &mut [RunningRuntimeClientProcess],
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<(), String> {
    let mut stop_errors = Vec::new();

    for process in processes.iter_mut().rev() {
        if let Err(error) = stop_runtime_client_process(process, clock, sleeper) {
            stop_errors.push(format!("processKey={}: {error}", process.spec.process_key));
        }
    }

    if stop_errors.is_empty() {
        return Ok(());
    }

    Err(stop_errors.join("; "))
}

/// Applies one process stop policy, including optional graceful termination first.
pub(super) fn stop_runtime_client_process(
    process: &mut RunningRuntimeClientProcess,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<(), String> {
    if process_has_exited(process)? {
        process.output_capture.finish_capture_threads();
        return Ok(());
    }

    let deadline_ms = clock.now_ms().saturating_add(process.spec.stop.timeout_ms);
    signal_runtime_client_process(process, process.spec.stop.signal)?;

    if matches!(
        process.spec.stop.signal,
        RuntimeClientProcessStopSignal::Sigterm
    ) {
        let grace_period_ms = process.spec.stop.grace_period_ms.unwrap_or(0);
        if grace_period_ms > 0 {
            if wait_for_runtime_client_process_exit(process, grace_period_ms, clock, sleeper)
                .is_ok()
            {
                process.output_capture.finish_capture_threads();
                return Ok(());
            }

            signal_runtime_client_process(process, RuntimeClientProcessStopSignal::Sigkill)?;
        }
    }

    let remaining_ms = deadline_ms.saturating_sub(clock.now_ms());
    let result = wait_for_runtime_client_process_exit(process, remaining_ms, clock, sleeper);
    if result.is_ok() {
        process.output_capture.finish_capture_threads();
    }
    result
}

pub(super) fn kill_runtime_client_process_platform_scope(
    process: &RunningRuntimeClientProcess,
) -> Result<(), String> {
    let Some(platform_scope) = &process.platform_scope else {
        return Ok(());
    };

    kill_runtime_client_process_platform_scope_by_scope(platform_scope)
}

pub(super) fn kill_runtime_client_process_platform_scope_by_scope(
    platform_scope: &RuntimeClientProcessPlatformScope,
) -> Result<(), String> {
    kill_scope(&platform_scope.scope_paths).map_err(|error| error.to_string())?;
    platform_scope
        .registry
        .remove_scope(&platform_scope.registry_key)?;
    Ok(())
}

/// Checks whether a child process has already exited without blocking.
pub(super) fn process_has_exited(
    process: &mut RunningRuntimeClientProcess,
) -> Result<bool, String> {
    process
        .child
        .lock()
        .expect("runtime client child lock should not be poisoned")
        .try_wait()
        .map(|status| status.is_some())
        .map_err(|error| format!("failed to poll process exit: {error}"))
}

/// Waits for one child process to exit before the given timeout elapses.
pub(super) fn wait_for_runtime_client_process_exit(
    process: &mut RunningRuntimeClientProcess,
    wait_duration_ms: u64,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<(), String> {
    let deadline_ms = clock.now_ms().saturating_add(wait_duration_ms);
    loop {
        match process
            .child
            .lock()
            .expect("runtime client child lock should not be poisoned")
            .try_wait()
            .map_err(|error| format!("failed to poll process exit: {error}"))?
        {
            Some(_) => return Ok(()),
            None if clock.now_ms() >= deadline_ms => {
                return Err("process did not exit before stop timeout".to_string());
            }
            None => sleeper.sleep(DEFAULT_PROCESS_EXIT_POLL_INTERVAL),
        }
    }
}

/// Sends the configured termination signal to one runtime client child process.
pub(super) fn signal_runtime_client_process(
    process: &mut RunningRuntimeClientProcess,
    signal: RuntimeClientProcessStopSignal,
) -> Result<(), String> {
    let pid =
        i32::try_from(process.pid()).map_err(|_| "process pid exceeded i32 range".to_string())?;
    let unix_signal = match signal {
        RuntimeClientProcessStopSignal::Sigterm => Signal::SIGTERM,
        RuntimeClientProcessStopSignal::Sigkill => Signal::SIGKILL,
    };

    match send_signal(Pid::from_raw(pid), unix_signal) {
        Ok(()) => Ok(()),
        Err(Errno::ESRCH) => Ok(()),
        Err(error) => Err(format!(
            "failed to signal process pid={pid} signal={unix_signal}: {error}"
        )),
    }
}

/// Formats an exited child status for readiness or shutdown error reporting.
pub(super) fn describe_process_exit(status: std::process::ExitStatus) -> String {
    match status.code() {
        Some(0) => "process exited".to_string(),
        Some(code) => format!("process exited with code {code}"),
        None => "process exited with signal".to_string(),
    }
}
