//! Runtime-client process supervision for `sandboxd`.
//!
//! This module turns compiled runtime-plan process entries into child
//! processes, waits for their declared readiness checks, and applies the stop
//! policies used during daemon shutdown.

use std::collections::BTreeMap;
use std::fmt;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use nix::errno::Errno;
use nix::sys::signal::{Signal, kill as send_signal};
use nix::unistd::Pid;

use crate::runtime::{
    RuntimeClient, RuntimeClientProcessReadiness, RuntimeClientProcessStopPolicy,
    RuntimeClientProcessStopSignal, RuntimeExecCommand,
};
use crate::time::{Clock, Sleeper};

/// Poll interval for readiness retries while a child process is still starting.
pub const DEFAULT_PROCESS_READINESS_POLL_INTERVAL: Duration = Duration::from_millis(100);
/// Poll interval for exit checks while waiting for a process to stop.
pub const DEFAULT_PROCESS_EXIT_POLL_INTERVAL: Duration = Duration::from_millis(25);

/// Captures one runtime client process after client-level environment merging.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeClientProcessSpec {
    pub process_key: String,
    pub command: RuntimeExecCommand,
    pub readiness: RuntimeClientProcessReadiness,
    pub stop: RuntimeClientProcessStopPolicy,
}

/// Owns the set of runtime client processes started for the current startup input.
#[derive(Debug)]
pub struct RuntimeClientProcessManager {
    processes: Vec<RunningRuntimeClientProcess>,
}

/// Tracks one live child process together with the spec that produced it.
#[derive(Debug)]
struct RunningRuntimeClientProcess {
    spec: RuntimeClientProcessSpec,
    child: Child,
}

/// Describes why runtime client process startup, readiness, or shutdown failed.
#[derive(Debug)]
pub enum ProcessManagerError {
    StartProcess {
        process_index: usize,
        process_key: String,
        error: String,
    },
    ReadinessCheck {
        process_index: usize,
        process_key: String,
        error: String,
    },
    StopProcesses(String),
}

impl fmt::Display for ProcessManagerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::StartProcess {
                process_index,
                process_key,
                error,
            } => write!(
                f,
                "runtime client process[{process_index}] failed to start (processKey={process_key}): {error}"
            ),
            Self::ReadinessCheck {
                process_index,
                process_key,
                error,
            } => write!(
                f,
                "runtime client process[{process_index}] readiness check failed (processKey={process_key}): {error}"
            ),
            Self::StopProcesses(error) => {
                write!(f, "failed to stop runtime client processes: {error}")
            }
        }
    }
}

impl std::error::Error for ProcessManagerError {}

/// Flattens runtime clients into the concrete process specs that need supervision.
pub fn flatten_runtime_client_processes(
    runtime_clients: &[RuntimeClient],
    runtime_env: &BTreeMap<String, String>,
) -> Vec<RuntimeClientProcessSpec> {
    let mut processes = Vec::new();

    for runtime_client in runtime_clients {
        for process in &runtime_client.processes {
            let merged_env = merge_runtime_client_process_env(
                runtime_env,
                &runtime_client.setup.env,
                process.command.env.as_ref(),
            );
            processes.push(RuntimeClientProcessSpec {
                process_key: process.process_key.clone(),
                command: RuntimeExecCommand {
                    args: process.command.args.clone(),
                    env: merged_env,
                    cwd: process.command.cwd.clone(),
                    timeout_ms: process.command.timeout_ms,
                },
                readiness: process.readiness.clone(),
                stop: process.stop.clone(),
            });
        }
    }

    processes
}

/// Starts every runtime client process and waits for each declared readiness check.
pub fn start_runtime_client_process_manager(
    process_specs: &[RuntimeClientProcessSpec],
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<RuntimeClientProcessManager, ProcessManagerError> {
    let mut started_processes = Vec::new();

    for (process_index, process_spec) in process_specs.iter().enumerate() {
        let mut process = start_runtime_client_process(process_spec).map_err(|error| {
            ProcessManagerError::StartProcess {
                process_index,
                process_key: process_spec.process_key.clone(),
                error,
            }
        })?;

        if let Err(error) = wait_for_runtime_client_process_readiness(&mut process, clock, sleeper)
        {
            let _ = stop_started_processes(&mut started_processes, clock, sleeper);
            let _ = stop_runtime_client_process(&mut process, clock, sleeper);
            return Err(ProcessManagerError::ReadinessCheck {
                process_index,
                process_key: process_spec.process_key.clone(),
                error,
            });
        }

        started_processes.push(process);
    }

    Ok(RuntimeClientProcessManager {
        processes: started_processes,
    })
}

impl RuntimeClientProcessManager {
    /// Stops all managed processes in reverse start order using their stop policies.
    pub fn stop(
        mut self,
        clock: &dyn Clock,
        sleeper: &dyn Sleeper,
    ) -> Result<(), ProcessManagerError> {
        stop_started_processes(&mut self.processes, clock, sleeper)
            .map_err(ProcessManagerError::StopProcesses)
    }
}

/// Merges client-wide environment variables with any process-local overrides.
fn merge_runtime_client_process_env(
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
fn start_runtime_client_process(
    process_spec: &RuntimeClientProcessSpec,
) -> Result<RunningRuntimeClientProcess, String> {
    let command = process_spec
        .command
        .args
        .first()
        .ok_or_else(|| "process command args must not be empty".to_string())?;
    let mut child_command = Command::new(command);
    child_command
        .args(&process_spec.command.args[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if let Some(cwd) = process_spec.command.cwd.as_deref() {
        child_command.current_dir(cwd);
    }
    if let Some(env) = &process_spec.command.env {
        child_command.envs(env);
    }

    let child = child_command
        .spawn()
        .map_err(|error| format!("failed to start process command: {error}"))?;

    Ok(RunningRuntimeClientProcess {
        spec: process_spec.clone(),
        child,
    })
}

/// Waits until one process either becomes ready, exits early, or times out.
fn wait_for_runtime_client_process_readiness(
    process: &mut RunningRuntimeClientProcess,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<(), String> {
    let timeout_ms = match &process.spec.readiness {
        RuntimeClientProcessReadiness::None => return Ok(()),
        RuntimeClientProcessReadiness::Tcp { timeout_ms, .. }
        | RuntimeClientProcessReadiness::Http { timeout_ms, .. }
        | RuntimeClientProcessReadiness::Ws { timeout_ms, .. } => *timeout_ms,
    };
    let deadline_ms = clock.now_ms().saturating_add(timeout_ms);

    loop {
        if let Some(status) = process
            .child
            .try_wait()
            .map_err(|error| format!("failed to poll process exit: {error}"))?
        {
            return Err(describe_process_exit(status));
        }

        match check_runtime_client_process_readiness(process) {
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

/// Dispatches the concrete readiness check declared for one runtime client process.
fn check_runtime_client_process_readiness(
    process: &mut RunningRuntimeClientProcess,
) -> Result<(), String> {
    match &process.spec.readiness {
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

/// Stops all previously started processes, reporting every shutdown failure together.
fn stop_started_processes(
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
fn stop_runtime_client_process(
    process: &mut RunningRuntimeClientProcess,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<(), String> {
    if process_has_exited(process)? {
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
                return Ok(());
            }

            signal_runtime_client_process(process, RuntimeClientProcessStopSignal::Sigkill)?;
        }
    }

    let remaining_ms = deadline_ms.saturating_sub(clock.now_ms());
    wait_for_runtime_client_process_exit(process, remaining_ms, clock, sleeper)
}

/// Checks whether a child process has already exited without blocking.
fn process_has_exited(process: &mut RunningRuntimeClientProcess) -> Result<bool, String> {
    process
        .child
        .try_wait()
        .map(|status| status.is_some())
        .map_err(|error| format!("failed to poll process exit: {error}"))
}

/// Waits for one child process to exit before the given timeout elapses.
fn wait_for_runtime_client_process_exit(
    process: &mut RunningRuntimeClientProcess,
    wait_duration_ms: u64,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<(), String> {
    let deadline_ms = clock.now_ms().saturating_add(wait_duration_ms);
    loop {
        match process
            .child
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
fn signal_runtime_client_process(
    process: &mut RunningRuntimeClientProcess,
    signal: RuntimeClientProcessStopSignal,
) -> Result<(), String> {
    let pid = i32::try_from(process.child.id())
        .map_err(|_| "process pid exceeded i32 range".to_string())?;
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
fn describe_process_exit(status: std::process::ExitStatus) -> String {
    match status.code() {
        Some(0) => "process exited".to_string(),
        Some(code) => format!("process exited with code {code}"),
        None => "process exited with signal".to_string(),
    }
}

/// Performs a bare TCP connect check against one readiness endpoint.
fn check_tcp_readiness(host: &str, port: u16) -> Result<(), String> {
    let address = resolve_socket_address(host, port)?;
    TcpStream::connect_timeout(&address, Duration::from_millis(250))
        .map(|_| ())
        .map_err(|error| format!("tcp readiness failed: {error}"))
}

/// Performs a minimal HTTP GET readiness probe and verifies the expected status.
fn check_http_readiness(url: &str, expected_status: u16) -> Result<(), String> {
    let status = readiness_probe_request(url, None)?;
    if status == expected_status {
        return Ok(());
    }

    Err(format!(
        "http readiness returned status {status}, expected {expected_status}"
    ))
}

/// Performs a minimal WebSocket handshake against the configured readiness URL.
fn check_ws_readiness(url: &str) -> Result<(), String> {
    let status = readiness_probe_request(url, Some("websocket"))?;
    if status == 101 {
        return Ok(());
    }

    Err(format!(
        "websocket readiness returned status {status}, expected 101"
    ))
}

/// Issues one plain-text readiness probe and returns the response status code.
fn readiness_probe_request(url: &str, expected_upgrade: Option<&str>) -> Result<u16, String> {
    let parsed_url = ParsedReadinessUrl::parse(url)?;
    if parsed_url.scheme == "https" || parsed_url.scheme == "wss" {
        return Err(format!(
            "readiness url scheme '{}' is not supported yet",
            parsed_url.scheme
        ));
    }

    let address = resolve_socket_address(&parsed_url.host, parsed_url.port)?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(250))
        .map_err(|error| format!("readiness request failed: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_millis(250)))
        .map_err(|error| format!("failed to configure readiness request timeout: {error}"))?;
    stream
        .set_write_timeout(Some(Duration::from_millis(250)))
        .map_err(|error| format!("failed to configure readiness request timeout: {error}"))?;

    let mut request = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\n",
        parsed_url.path, parsed_url.host
    );
    if let Some(expected_upgrade) = expected_upgrade {
        request.push_str("Connection: Upgrade\r\n");
        request.push_str(&format!("Upgrade: {expected_upgrade}\r\n"));
        request.push_str("Sec-WebSocket-Key: c2FuZGJveGQtcHJvY2Vzcw==\r\n");
        request.push_str("Sec-WebSocket-Version: 13\r\n");
    } else {
        request.push_str("Connection: close\r\n");
    }
    request.push_str("\r\n");

    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("failed to write readiness request: {error}"))?;

    let mut response_bytes = [0u8; 1024];
    let byte_count = stream
        .read(&mut response_bytes)
        .map_err(|error| format!("failed to read readiness response: {error}"))?;
    let response = std::str::from_utf8(&response_bytes[..byte_count])
        .map_err(|error| format!("readiness response was not valid utf-8: {error}"))?;
    parse_http_status(response)
}

/// Parses the HTTP status code from the first line of a readiness response.
fn parse_http_status(response: &str) -> Result<u16, String> {
    let status_line = response
        .lines()
        .next()
        .ok_or_else(|| "readiness response was empty".to_string())?;
    let mut parts = status_line.split_whitespace();
    let _http_version = parts
        .next()
        .ok_or_else(|| "readiness response status line was incomplete".to_string())?;
    let status = parts
        .next()
        .ok_or_else(|| "readiness response status line was incomplete".to_string())?;
    status
        .parse::<u16>()
        .map_err(|error| format!("readiness response status was invalid: {error}"))
}

/// Resolves one host and port into the first socket address available for probing.
fn resolve_socket_address(host: &str, port: u16) -> Result<SocketAddr, String> {
    (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("failed to resolve socket address {host}:{port}: {error}"))?
        .next()
        .ok_or_else(|| format!("failed to resolve socket address {host}:{port}"))
}

/// Splits a readiness URL into the scheme, host, port, and path to probe.
struct ParsedReadinessUrl {
    scheme: String,
    host: String,
    port: u16,
    path: String,
}

impl ParsedReadinessUrl {
    /// Parses one readiness URL and fills in the default port for its scheme.
    fn parse(url: &str) -> Result<Self, String> {
        let (scheme, rest) = url
            .split_once("://")
            .ok_or_else(|| format!("readiness url '{url}' is missing a scheme"))?;
        let (authority, path) = match rest.split_once('/') {
            Some((authority, path)) => (authority, format!("/{path}")),
            None => (rest, "/".to_string()),
        };
        if authority.is_empty() {
            return Err(format!("readiness url '{url}' is missing a host"));
        }

        let default_port = match scheme {
            "http" | "ws" => 80,
            "https" | "wss" => 443,
            _ => return Err(format!("readiness url scheme '{scheme}' is not supported")),
        };
        let (host, port) = match authority.rsplit_once(':') {
            Some((host, port)) if !host.contains(']') => (
                host.to_string(),
                port.parse::<u16>()
                    .map_err(|error| format!("invalid readiness port in '{url}': {error}"))?,
            ),
            _ => (authority.to_string(), default_port),
        };

        Ok(Self {
            scheme: scheme.to_string(),
            host,
            port,
            path,
        })
    }
}
