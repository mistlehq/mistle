use std::collections::BTreeMap;
use std::fmt;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::runtime::{
    RuntimeArtifactCommand, RuntimeClient, RuntimeClientProcessReadiness,
    RuntimeClientProcessStopPolicy, RuntimeClientProcessStopSignal,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeClientProcessSpec {
    pub process_key: String,
    pub command: RuntimeArtifactCommand,
    pub readiness: RuntimeClientProcessReadiness,
    pub stop: RuntimeClientProcessStopPolicy,
}

#[derive(Debug)]
pub struct RuntimeClientProcessManager {
    processes: Vec<RunningRuntimeClientProcess>,
}

#[derive(Debug)]
struct RunningRuntimeClientProcess {
    spec: RuntimeClientProcessSpec,
    child: Child,
}

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

pub fn flatten_runtime_client_processes(
    runtime_clients: &[RuntimeClient],
) -> Vec<RuntimeClientProcessSpec> {
    let mut processes = Vec::new();

    for runtime_client in runtime_clients {
        for process in &runtime_client.processes {
            let merged_env = merge_runtime_client_process_env(
                &runtime_client.setup.env,
                process.command.env.as_ref(),
            );
            processes.push(RuntimeClientProcessSpec {
                process_key: process.process_key.clone(),
                command: RuntimeArtifactCommand {
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

pub fn start_runtime_client_process_manager(
    process_specs: &[RuntimeClientProcessSpec],
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

        if let Err(error) = wait_for_runtime_client_process_readiness(&mut process) {
            let _ = stop_started_processes(&mut started_processes);
            let _ = stop_runtime_client_process(&mut process);
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
    pub fn stop(mut self) -> Result<(), ProcessManagerError> {
        stop_started_processes(&mut self.processes).map_err(ProcessManagerError::StopProcesses)
    }
}

fn merge_runtime_client_process_env(
    runtime_client_env: &BTreeMap<String, String>,
    process_command_env: Option<&BTreeMap<String, String>>,
) -> Option<BTreeMap<String, String>> {
    if runtime_client_env.is_empty()
        && process_command_env.is_none_or(BTreeMap::is_empty)
    {
        return None;
    }

    let mut merged_env = runtime_client_env.clone();
    if let Some(process_command_env) = process_command_env {
        for (key, value) in process_command_env {
            merged_env.insert(key.clone(), value.clone());
        }
    }

    Some(merged_env)
}

fn start_runtime_client_process(
    process_spec: &RuntimeClientProcessSpec,
) -> Result<RunningRuntimeClientProcess, String> {
    let command = process_spec
        .command
        .args
        .first()
        .ok_or_else(|| "process command args must not be empty".to_string())?;
    let mut child_command = Command::new(command);
    child_command.args(&process_spec.command.args[1..]);
    child_command.stdin(Stdio::null());
    child_command.stdout(Stdio::null());
    child_command.stderr(Stdio::null());

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

fn wait_for_runtime_client_process_readiness(
    process: &mut RunningRuntimeClientProcess,
) -> Result<(), String> {
    match &process.spec.readiness {
        RuntimeClientProcessReadiness::None => Ok(()),
        RuntimeClientProcessReadiness::Tcp { timeout_ms, .. }
        | RuntimeClientProcessReadiness::Http { timeout_ms, .. }
        | RuntimeClientProcessReadiness::Ws { timeout_ms, .. } => {
            wait_for_runtime_client_process_check(process, *timeout_ms, |running_process| {
                check_runtime_client_process_readiness(running_process)
            })
        }
    }
}

fn wait_for_runtime_client_process_check<F>(
    process: &mut RunningRuntimeClientProcess,
    timeout_ms: u64,
    mut check: F,
) -> Result<(), String>
where
    F: FnMut(&mut RunningRuntimeClientProcess) -> Result<(), String>,
{
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);

    loop {
        if let Some(status) = process
            .child
            .try_wait()
            .map_err(|error| format!("failed to poll process exit: {error}"))?
        {
            return Err(describe_process_exit(status));
        }

        match check(process) {
            Ok(()) => return Ok(()),
            Err(error) if Instant::now() >= deadline => {
                return Err(format!(
                    "timed out after {timeout_ms}ms waiting for readiness: {error}"
                ));
            }
            Err(_) => {}
        }

        thread::sleep(Duration::from_millis(100));
    }
}

fn check_runtime_client_process_readiness(
    process: &mut RunningRuntimeClientProcess,
) -> Result<(), String> {
    match &process.spec.readiness {
        RuntimeClientProcessReadiness::None => Ok(()),
        RuntimeClientProcessReadiness::Tcp { host, port, .. } => {
            check_tcp_readiness(host, *port)
        }
        RuntimeClientProcessReadiness::Http {
            url,
            expected_status,
            ..
        } => check_http_readiness(url, *expected_status),
        RuntimeClientProcessReadiness::Ws { url, .. } => check_ws_readiness(url),
    }
}

fn stop_started_processes(processes: &mut [RunningRuntimeClientProcess]) -> Result<(), String> {
    let mut stop_errors = Vec::new();

    for process in processes.iter_mut().rev() {
        if let Err(error) = stop_runtime_client_process(process) {
            stop_errors.push(format!("processKey={}: {error}", process.spec.process_key));
        }
    }

    if stop_errors.is_empty() {
        return Ok(());
    }

    Err(stop_errors.join("; "))
}

fn stop_runtime_client_process(process: &mut RunningRuntimeClientProcess) -> Result<(), String> {
    if process_has_exited(process)? {
        return Ok(());
    }

    let deadline = Instant::now() + Duration::from_millis(process.spec.stop.timeout_ms);
    signal_runtime_client_process(process, process.spec.stop.signal)?;

    if matches!(process.spec.stop.signal, RuntimeClientProcessStopSignal::Sigterm) {
        let grace_period_ms = process.spec.stop.grace_period_ms.unwrap_or(0);
        if grace_period_ms > 0 {
            if wait_for_runtime_client_process_exit(process, Duration::from_millis(grace_period_ms)).is_ok() {
                return Ok(());
            }

            signal_runtime_client_process(process, RuntimeClientProcessStopSignal::Sigkill)?;
        }
    }

    let remaining = deadline.saturating_duration_since(Instant::now());
    wait_for_runtime_client_process_exit(process, remaining)
}

fn process_has_exited(process: &mut RunningRuntimeClientProcess) -> Result<bool, String> {
    process
        .child
        .try_wait()
        .map(|status| status.is_some())
        .map_err(|error| format!("failed to poll process exit: {error}"))
}

fn wait_for_runtime_client_process_exit(
    process: &mut RunningRuntimeClientProcess,
    wait_duration: Duration,
) -> Result<(), String> {
    let deadline = Instant::now() + wait_duration;
    loop {
        match process
            .child
            .try_wait()
            .map_err(|error| format!("failed to poll process exit: {error}"))?
        {
            Some(_) => return Ok(()),
            None if Instant::now() >= deadline => {
                return Err("process did not exit before stop timeout".to_string());
            }
            None => thread::sleep(Duration::from_millis(25)),
        }
    }
}

fn signal_runtime_client_process(
    process: &mut RunningRuntimeClientProcess,
    signal: RuntimeClientProcessStopSignal,
) -> Result<(), String> {
    let pid = i32::try_from(process.child.id())
        .map_err(|_| "process pid exceeded i32 range".to_string())?;
    let signal_number = match signal {
        RuntimeClientProcessStopSignal::Sigterm => 15,
        RuntimeClientProcessStopSignal::Sigkill => 9,
    };

    let result = unsafe { kill(pid, signal_number) };
    if result == 0 {
        return Ok(());
    }

    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(3) {
        return Ok(());
    }

    Err(format!(
        "failed to signal process pid={pid} signal={signal_number}: {}",
        error
    ))
}

fn describe_process_exit(status: std::process::ExitStatus) -> String {
    match status.code() {
        Some(0) => "process exited".to_string(),
        Some(code) => format!("process exited with code {code}"),
        None => "process exited with signal".to_string(),
    }
}

fn check_tcp_readiness(host: &str, port: u16) -> Result<(), String> {
    let address = resolve_socket_address(host, port)?;
    TcpStream::connect_timeout(&address, Duration::from_millis(250))
        .map(|_| ())
        .map_err(|error| format!("tcp readiness failed: {error}"))
}

fn check_http_readiness(url: &str, expected_status: u16) -> Result<(), String> {
    let status = readiness_probe_request(url, None)?;
    if status == expected_status {
        return Ok(());
    }

    Err(format!(
        "http readiness returned status {status}, expected {expected_status}"
    ))
}

fn check_ws_readiness(url: &str) -> Result<(), String> {
    let status = readiness_probe_request(url, Some("websocket"))?;
    if status == 101 {
        return Ok(());
    }

    Err(format!(
        "websocket readiness returned status {status}, expected 101"
    ))
}

fn readiness_probe_request(
    url: &str,
    expected_upgrade: Option<&str>,
) -> Result<u16, String> {
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
        "GET {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n",
        parsed_url.path, parsed_url.host
    );
    if let Some(expected_upgrade) = expected_upgrade {
        request.push_str("Connection: Upgrade\r\n");
        request.push_str(&format!("Upgrade: {expected_upgrade}\r\n"));
        request.push_str("Sec-WebSocket-Key: c2FuZGJveGQtcHJvY2Vzcw==\r\n");
        request.push_str("Sec-WebSocket-Version: 13\r\n");
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

fn resolve_socket_address(host: &str, port: u16) -> Result<SocketAddr, String> {
    (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("failed to resolve socket address {host}:{port}: {error}"))?
        .next()
        .ok_or_else(|| format!("failed to resolve socket address {host}:{port}"))
}

struct ParsedReadinessUrl {
    scheme: String,
    host: String,
    port: u16,
    path: String,
}

impl ParsedReadinessUrl {
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

unsafe extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
}
