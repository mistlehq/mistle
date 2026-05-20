//! Pi RPC proxying for `sandboxd`.
//!
//! Pi exposes a JSONL RPC protocol over stdio. This proxy owns one Pi child
//! process and exposes a websocket JSON-RPC endpoint compatible with the
//! existing sandbox agent stream transport.

use std::collections::BTreeMap;
use std::fmt;
use std::fs::{File, read_dir};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tungstenite::{Message, accept};
use url::Url;

use crate::keepalive::KeepaliveManager;
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};

const PI_PROXY_ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(100);
const PI_RPC_RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);
const PI_RPC_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const PI_PROXY_CLIENT_READ_TIMEOUT: Duration = Duration::from_millis(100);
const PI_SESSION_DIR_ENV: &str = "PI_CODING_AGENT_SESSION_DIR";

pub const DEFAULT_PI_PROXY_LISTEN_URL: &str = "ws://127.0.0.1:4520";

#[derive(Debug)]
pub enum PiProxyError {
    ParseListenUrl(String),
    ListenUrlMustUseWebSocket {
        url: String,
    },
    ListenUrlMissingHost {
        url: String,
    },
    ListenUrlMissingPort {
        url: String,
    },
    BindListener {
        address: String,
        error: std::io::Error,
    },
    ConfigureListener(std::io::Error),
    AcceptClient(std::io::Error),
    AcceptHandshake(String),
    InvalidRequest(String),
    MissingPiCliPath,
    MissingSessionDir,
    SpawnPi(std::io::Error),
    MissingPiStdin,
    MissingPiStdout,
    MissingSessionFile,
    WritePi(std::io::Error),
    ReadPi(std::io::Error),
    PiResponseTimeout(String),
    RuntimePanicked,
}

impl fmt::Display for PiProxyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ParseListenUrl(error) => {
                write!(f, "failed to parse Pi proxy listen URL: {error}")
            }
            Self::ListenUrlMustUseWebSocket { url } => {
                write!(f, "Pi proxy listen URL must use ws scheme: {url}")
            }
            Self::ListenUrlMissingHost { url } => {
                write!(f, "Pi proxy listen URL must include a host: {url}")
            }
            Self::ListenUrlMissingPort { url } => {
                write!(f, "Pi proxy listen URL must include a port: {url}")
            }
            Self::BindListener { address, error } => {
                write!(f, "failed to bind Pi proxy listener {address}: {error}")
            }
            Self::ConfigureListener(error) => {
                write!(f, "failed to configure Pi proxy listener: {error}")
            }
            Self::AcceptClient(error) => write!(f, "failed to accept Pi proxy client: {error}"),
            Self::AcceptHandshake(error) => {
                write!(f, "failed to accept Pi proxy websocket handshake: {error}")
            }
            Self::InvalidRequest(error) => write!(f, "Pi proxy received invalid request: {error}"),
            Self::MissingPiCliPath => {
                write!(f, "Pi runtime client setup must define MISTLE_PI_CLI_PATH")
            }
            Self::MissingSessionDir => {
                write!(
                    f,
                    "Pi runtime client setup must define PI_CODING_AGENT_SESSION_DIR"
                )
            }
            Self::SpawnPi(error) => write!(f, "failed to spawn Pi RPC process: {error}"),
            Self::MissingPiStdin => write!(f, "spawned Pi RPC process did not expose stdin"),
            Self::MissingPiStdout => write!(f, "spawned Pi RPC process did not expose stdout"),
            Self::MissingSessionFile => write!(f, "Pi did not report sessionFile"),
            Self::WritePi(error) => write!(f, "failed to write Pi RPC command: {error}"),
            Self::ReadPi(error) => write!(f, "failed to read Pi RPC output: {error}"),
            Self::PiResponseTimeout(id) => {
                write!(f, "timed out waiting for Pi RPC response '{id}'")
            }
            Self::RuntimePanicked => write!(f, "Pi proxy runtime thread panicked"),
        }
    }
}

impl std::error::Error for PiProxyError {}

#[derive(Debug, Clone)]
pub struct PiProxyConfig {
    pub pi_cli_path: String,
    pub env: BTreeMap<String, String>,
}

pub struct PiProxy {
    listen_url: String,
    shutdown_requested: Arc<AtomicBool>,
    runtime_thread: Option<JoinHandle<Result<(), PiProxyError>>>,
    state: Arc<PiProxyState>,
    supervisor_handle: SandboxdSupervisorHandle,
}

struct PiProxyState {
    config: PiProxyConfig,
    child: Mutex<Option<PiRpcChild>>,
    command_lock: Mutex<()>,
    event_subscribers: Mutex<Vec<Sender<String>>>,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    active: AtomicBool,
    activity_monitor_running: AtomicBool,
    next_id: AtomicU64,
}

struct PiRpcChild {
    child: Child,
    stdin: ChildStdin,
    receiver: Receiver<PiRpcOutput>,
    reader_thread: JoinHandle<()>,
}

struct PiRecentSessionCandidate {
    modified: std::time::SystemTime,
    path: PathBuf,
}

#[derive(Debug)]
enum PiRpcOutput {
    Line(Value),
    Error(String),
    Eof,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsonRpcRequest {
    id: Value,
    method: String,
    params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

#[derive(Debug, Serialize)]
struct JsonRpcErrorResponse {
    jsonrpc: &'static str,
    id: Value,
    error: JsonRpcError,
}

#[derive(Debug, Serialize)]
struct JsonRpcSuccessResponse {
    jsonrpc: &'static str,
    id: Value,
    result: Value,
}

impl PiProxy {
    pub fn listen_url(&self) -> &str {
        &self.listen_url
    }

    pub fn close(mut self) -> Result<(), PiProxyError> {
        self.shutdown_requested.store(true, Ordering::Relaxed);
        self.state.shutdown_child();
        let close_result = match self.runtime_thread.take() {
            Some(runtime_thread) => match runtime_thread.join() {
                Ok(result) => result,
                Err(_) => Err(PiProxyError::RuntimePanicked),
            },
            None => Ok(()),
        };
        self.supervisor_handle
            .mark_component_stopped(SupervisedComponent::PiProxy);
        close_result
    }
}

impl PiProxyState {
    fn next_pi_request_id(&self) -> String {
        let next = self.next_id.fetch_add(1, Ordering::Relaxed);
        format!("mistle_pi_{next}")
    }

    fn send_pi_command(&self, command: Value) -> Result<Value, PiProxyError> {
        self.send_pi_command_with_events(command, None)
    }

    fn send_pi_command_with_captured_events(
        &self,
        command: Value,
        captured_events: &mut Vec<Value>,
    ) -> Result<Value, PiProxyError> {
        self.send_pi_command_with_events(command, Some(captured_events))
    }

    fn send_pi_command_with_events(
        &self,
        mut command: Value,
        mut captured_events: Option<&mut Vec<Value>>,
    ) -> Result<Value, PiProxyError> {
        let _command_guard = self.command_lock.lock().map_err(|_| {
            PiProxyError::InvalidRequest("Pi command lock was poisoned".to_string())
        })?;
        let id = self.next_pi_request_id();
        command["id"] = Value::String(id.clone());
        let line = format!("{command}\n");
        let deadline = Instant::now() + PI_RPC_RESPONSE_TIMEOUT;
        {
            let mut guard = self.child.lock().map_err(|_| {
                PiProxyError::InvalidRequest("Pi child lock was poisoned".to_string())
            })?;
            let child = guard.as_mut().ok_or_else(|| {
                PiProxyError::InvalidRequest("Pi RPC process is not running".to_string())
            })?;
            child
                .stdin
                .write_all(line.as_bytes())
                .map_err(PiProxyError::WritePi)?;
            child.stdin.flush().map_err(PiProxyError::WritePi)?;
        }

        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(PiProxyError::PiResponseTimeout(id));
            }
            let output = {
                let guard = self.child.lock().map_err(|_| {
                    PiProxyError::InvalidRequest("Pi child lock was poisoned".to_string())
                })?;
                let child = guard.as_ref().ok_or_else(|| {
                    PiProxyError::InvalidRequest("Pi RPC process is not running".to_string())
                })?;
                child.receiver.recv_timeout(remaining)
            };
            match output {
                Ok(PiRpcOutput::Line(value)) => {
                    self.update_activity_from_pi_output(&value);
                    if value["type"] == "response" && value["id"] == id {
                        if value["success"] == true {
                            return Ok(value.get("data").cloned().unwrap_or(Value::Null));
                        }
                        let message = value["error"]
                            .as_str()
                            .unwrap_or("Pi RPC command failed")
                            .to_string();
                        return Err(PiProxyError::InvalidRequest(message));
                    }
                    if let Some(events) = captured_events.as_deref_mut() {
                        events.push(value);
                    } else {
                        self.broadcast_pi_event(value);
                    }
                }
                Ok(PiRpcOutput::Error(error)) => return Err(PiProxyError::InvalidRequest(error)),
                Ok(PiRpcOutput::Eof) => {
                    return Err(PiProxyError::InvalidRequest(
                        "Pi RPC process stdout closed".to_string(),
                    ));
                }
                Err(RecvTimeoutError::Timeout) => return Err(PiProxyError::PiResponseTimeout(id)),
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(PiProxyError::InvalidRequest(
                        "Pi RPC reader disconnected".to_string(),
                    ));
                }
            }
        }
    }

    fn subscribe_pi_events(&self) -> Receiver<String> {
        let (sender, receiver) = mpsc::channel();
        if let Ok(mut subscribers) = self.event_subscribers.lock() {
            subscribers.push(sender);
        }
        receiver
    }

    fn broadcast_pi_event(&self, event: Value) {
        let notification = render_pi_event_json_rpc_notification(event);
        if let Ok(mut subscribers) = self.event_subscribers.lock() {
            subscribers.retain(|sender| sender.send(notification.clone()).is_ok());
        }
    }

    fn ensure_child(&self, cwd: Option<&str>) -> Result<(), PiProxyError> {
        let mut guard = self
            .child
            .lock()
            .map_err(|_| PiProxyError::InvalidRequest("Pi child lock was poisoned".to_string()))?;
        if guard.is_some() {
            return Ok(());
        }

        let mut command = Command::new(&self.config.pi_cli_path);
        command.arg("--mode").arg("rpc");
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }
        command.stdin(Stdio::piped()).stdout(Stdio::piped());
        command.stderr(Stdio::inherit());
        for (key, value) in &self.config.env {
            command.env(key, value);
        }

        let mut child = command.spawn().map_err(PiProxyError::SpawnPi)?;
        let stdin = child.stdin.take().ok_or(PiProxyError::MissingPiStdin)?;
        let stdout = child.stdout.take().ok_or(PiProxyError::MissingPiStdout)?;
        let (sender, receiver) = mpsc::channel();
        let reader_thread = spawn_pi_stdout_reader(stdout, sender);
        *guard = Some(PiRpcChild {
            child,
            stdin,
            receiver,
            reader_thread,
        });
        Ok(())
    }

    fn read_session_file(state_value: &Value) -> Result<&str, PiProxyError> {
        state_value["sessionFile"]
            .as_str()
            .ok_or(PiProxyError::MissingSessionFile)
    }

    fn switch_session(
        &self,
        session_file: &str,
        captured_events: &mut Vec<Value>,
    ) -> Result<(), PiProxyError> {
        self.send_pi_command_with_captured_events(
            json!({ "type": "switch_session", "sessionPath": session_file }),
            captured_events,
        )?;
        Ok(())
    }

    fn session_dir(&self) -> Result<&str, PiProxyError> {
        self.config
            .env
            .get(PI_SESSION_DIR_ENV)
            .map(String::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or(PiProxyError::MissingSessionDir)
    }

    fn find_recent_conversation(&self, cwd: Option<&str>) -> Result<Option<String>, PiProxyError> {
        let session_dir = self.session_dir()?;
        let mut candidates = Vec::new();
        let mut pending_directories = vec![PathBuf::from(session_dir)];

        while let Some(directory) = pending_directories.pop() {
            let entries = match read_dir(&directory) {
                Ok(entries) => entries,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    if directory == Path::new(session_dir) {
                        return Ok(None);
                    }
                    continue;
                }
                Err(error) => return Err(PiProxyError::InvalidRequest(error.to_string())),
            };

            for entry_result in entries {
                let entry = entry_result
                    .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
                let file_type = entry
                    .file_type()
                    .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
                if file_type.is_dir() {
                    pending_directories.push(entry.path());
                    continue;
                }
                if !file_type.is_file() {
                    continue;
                }

                let path = entry.path();
                if path.extension().and_then(|extension| extension.to_str()) != Some("jsonl") {
                    continue;
                }
                if !is_matching_pi_session_file(&path, cwd) {
                    continue;
                }
                let metadata = entry
                    .metadata()
                    .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
                let modified = metadata
                    .modified()
                    .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
                candidates.push(PiRecentSessionCandidate { modified, path });
            }
        }

        candidates.sort_by(|left, right| right.modified.cmp(&left.modified));
        Ok(candidates
            .first()
            .map(|candidate| candidate.path.to_string_lossy().to_string()))
    }

    fn shutdown_child(&self) {
        let child = match self.child.lock() {
            Ok(mut guard) => guard.take(),
            Err(_) => None,
        };
        let Some(mut child) = child else {
            return;
        };
        let _ = child.child.kill();
        let deadline = Instant::now() + PI_RPC_SHUTDOWN_TIMEOUT;
        while Instant::now() < deadline {
            match child.child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => thread::sleep(Duration::from_millis(25)),
                Err(_) => break,
            }
        }
        let _ = child.reader_thread.join();
        self.set_active(false);
    }

    fn update_activity_from_pi_output(&self, value: &Value) {
        if value["type"] == "agent_start" {
            self.set_active(true);
            return;
        }
        if value["type"] == "agent_end" {
            self.set_active(false);
            return;
        }
        if value["type"] == "response"
            && value["command"] == "get_state"
            && value["success"] == true
        {
            let state = &value["data"];
            let active = state["isStreaming"].as_bool().unwrap_or(false)
                || state["isCompacting"].as_bool().unwrap_or(false)
                || state["pendingMessageCount"].as_u64().unwrap_or(0) > 0;
            self.set_active(active);
        }
    }

    fn set_active(&self, active: bool) {
        let previous = self.active.swap(active, Ordering::Relaxed);
        if previous == active {
            return;
        }
        if let Ok(mut keepalive_manager) = self.keepalive_manager.lock() {
            keepalive_manager.set_platform_active(active);
        }
    }

    fn start_activity_monitor(state: Arc<Self>) -> bool {
        if state
            .activity_monitor_running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return false;
        }

        thread::spawn(move || {
            while state.active.load(Ordering::Relaxed) {
                if state
                    .send_pi_command(json!({ "type": "get_state" }))
                    .is_err()
                {
                    state.set_active(false);
                    break;
                }
                thread::sleep(Duration::from_secs(1));
            }
            state
                .activity_monitor_running
                .store(false, Ordering::Release);
            if state.active.load(Ordering::Relaxed) {
                Self::start_activity_monitor(state);
            }
        });
        true
    }

    fn mark_active_and_start_activity_monitor(state: &Arc<Self>) {
        state.set_active(true);
        Self::start_activity_monitor(state.clone());
    }
}

pub fn start_pi_proxy_with_supervisor(
    listen_url: &str,
    config: PiProxyConfig,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    supervisor_handle: SandboxdSupervisorHandle,
) -> Result<PiProxy, PiProxyError> {
    if config.pi_cli_path.trim().is_empty() {
        return Err(PiProxyError::MissingPiCliPath);
    }
    if listen_url.trim().is_empty() {
        return Err(PiProxyError::ParseListenUrl(
            "Pi proxy listen URL must not be empty".to_string(),
        ));
    }
    let listen_url = listen_url.to_string();
    let listener_address = parse_pi_proxy_listener_address(&listen_url)?;
    let listener =
        TcpListener::bind(listener_address).map_err(|error| PiProxyError::BindListener {
            address: listener_address.to_string(),
            error,
        })?;
    listener
        .set_nonblocking(true)
        .map_err(PiProxyError::ConfigureListener)?;

    supervisor_handle.mark_component_starting(SupervisedComponent::PiProxy);
    let shutdown_requested = Arc::new(AtomicBool::new(false));
    let state = Arc::new(PiProxyState {
        config,
        child: Mutex::new(None),
        command_lock: Mutex::new(()),
        event_subscribers: Mutex::new(Vec::new()),
        keepalive_manager,
        active: AtomicBool::new(false),
        activity_monitor_running: AtomicBool::new(false),
        next_id: AtomicU64::new(1),
    });
    let runtime_shutdown = shutdown_requested.clone();
    let runtime_state = state.clone();
    let runtime_supervisor = supervisor_handle.clone();
    let runtime_thread = thread::spawn(move || {
        runtime_supervisor.mark_component_healthy(SupervisedComponent::PiProxy);
        run_pi_proxy_listener(listener, runtime_state, runtime_shutdown)
    });

    Ok(PiProxy {
        listen_url,
        shutdown_requested,
        runtime_thread: Some(runtime_thread),
        state,
        supervisor_handle,
    })
}

fn parse_pi_proxy_listener_address(listen_url: &str) -> Result<SocketAddr, PiProxyError> {
    let url =
        Url::parse(listen_url).map_err(|error| PiProxyError::ParseListenUrl(error.to_string()))?;
    if url.scheme() != "ws" {
        return Err(PiProxyError::ListenUrlMustUseWebSocket {
            url: listen_url.to_string(),
        });
    }
    let host = url
        .host_str()
        .ok_or_else(|| PiProxyError::ListenUrlMissingHost {
            url: listen_url.to_string(),
        })?;
    let port = url
        .port()
        .ok_or_else(|| PiProxyError::ListenUrlMissingPort {
            url: listen_url.to_string(),
        })?;
    let address = format!("{host}:{port}");
    address
        .parse::<SocketAddr>()
        .map_err(|error| PiProxyError::ParseListenUrl(error.to_string()))
}

fn run_pi_proxy_listener(
    listener: TcpListener,
    state: Arc<PiProxyState>,
    shutdown_requested: Arc<AtomicBool>,
) -> Result<(), PiProxyError> {
    while !shutdown_requested.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _address)) => {
                let session_state = state.clone();
                thread::spawn(move || {
                    let _ = handle_pi_proxy_client(stream, session_state);
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(PI_PROXY_ACCEPT_POLL_INTERVAL);
            }
            Err(error) => return Err(PiProxyError::AcceptClient(error)),
        }
    }
    Ok(())
}

fn handle_pi_proxy_client(
    stream: std::net::TcpStream,
    state: Arc<PiProxyState>,
) -> Result<(), PiProxyError> {
    let mut websocket =
        accept(stream).map_err(|error| PiProxyError::AcceptHandshake(error.to_string()))?;
    websocket
        .get_mut()
        .set_read_timeout(Some(PI_PROXY_CLIENT_READ_TIMEOUT))
        .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
    let event_receiver = state.subscribe_pi_events();
    loop {
        send_queued_pi_events(&mut websocket, &event_receiver)?;
        let message = match websocket.read() {
            Ok(message) => message,
            Err(tungstenite::Error::ConnectionClosed) => return Ok(()),
            Err(tungstenite::Error::AlreadyClosed) => return Ok(()),
            Err(tungstenite::Error::Io(error))
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut =>
            {
                continue;
            }
            Err(error) => return Err(PiProxyError::InvalidRequest(error.to_string())),
        };
        match message {
            Message::Text(payload) => {
                for response in handle_json_rpc_request(&state, &payload) {
                    websocket
                        .send(Message::Text(response.into()))
                        .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
                }
            }
            Message::Ping(payload) => {
                websocket
                    .send(Message::Pong(payload))
                    .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
            }
            Message::Close(frame) => {
                websocket
                    .close(frame)
                    .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
                return Ok(());
            }
            Message::Binary(_) | Message::Pong(_) | Message::Frame(_) => {}
        }
    }
}

fn send_queued_pi_events(
    websocket: &mut tungstenite::WebSocket<std::net::TcpStream>,
    event_receiver: &Receiver<String>,
) -> Result<(), PiProxyError> {
    loop {
        match event_receiver.try_recv() {
            Ok(notification) => websocket
                .send(Message::Text(notification.into()))
                .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?,
            Err(TryRecvError::Empty) => return Ok(()),
            Err(TryRecvError::Disconnected) => return Ok(()),
        }
    }
}

fn handle_json_rpc_request(state: &Arc<PiProxyState>, payload: &str) -> Vec<String> {
    let request = match serde_json::from_str::<JsonRpcRequest>(payload) {
        Ok(request) => request,
        Err(error) => {
            return vec![render_json_rpc_error(
                Value::Null,
                -32_700,
                format!("Invalid JSON-RPC request: {error}"),
            )];
        }
    };
    let mut captured_events = Vec::new();
    let result = match handle_pi_method(state, &request, &mut captured_events) {
        Ok(result) => JsonRpcSuccessResponse {
            jsonrpc: "2.0",
            id: request.id,
            result,
        },
        Err(error) => {
            return vec![render_json_rpc_error(
                request.id,
                -32_000,
                error.to_string(),
            )];
        }
    };
    let mut responses: Vec<String> = captured_events
        .into_iter()
        .map(render_pi_event_json_rpc_notification)
        .collect();
    match serde_json::to_string(&result) {
        Ok(response) => responses.push(response),
        Err(error) => responses.push(render_json_rpc_error(
            Value::Null,
            -32_000,
            error.to_string(),
        )),
    }
    responses
}

fn render_pi_event_json_rpc_notification(event: Value) -> String {
    serde_json::to_string(&json!({
        "jsonrpc": "2.0",
        "method": "pi/event",
        "params": event,
    }))
    .unwrap_or_else(|_| {
        "{\"jsonrpc\":\"2.0\",\"method\":\"pi/event\",\"params\":{\"type\":\"serialization_error\"}}"
            .to_string()
    })
}

fn render_json_rpc_error(id: Value, code: i64, message: String) -> String {
    let response = JsonRpcErrorResponse {
        jsonrpc: "2.0",
        id,
        error: JsonRpcError { code, message },
    };
    serde_json::to_string(&response).unwrap_or_else(|_| {
        "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32000,\"message\":\"failed to serialize error\"}}"
            .to_string()
    })
}

fn read_param_string(params: &Option<Value>, key: &str) -> Option<String> {
    params
        .as_ref()
        .and_then(|value| value.get(key))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn is_matching_pi_session_file(path: &Path, cwd: Option<&str>) -> bool {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut buffer = [0_u8; 8192];
    let bytes_read = match file.read(&mut buffer) {
        Ok(bytes_read) => bytes_read,
        Err(_) => return false,
    };
    if bytes_read == 0 {
        return false;
    }
    let first_line = String::from_utf8_lossy(&buffer[..bytes_read])
        .lines()
        .next()
        .unwrap_or("")
        .to_string();
    let header = match serde_json::from_str::<Value>(&first_line) {
        Ok(header) => header,
        Err(_) => return false,
    };
    if header["type"].as_str() != Some("session") || header["id"].as_str().is_none() {
        return false;
    }
    match cwd {
        Some(expected_cwd) => header["cwd"].as_str() == Some(expected_cwd),
        None => true,
    }
}

fn require_param_string(params: &Option<Value>, key: &str) -> Result<String, PiProxyError> {
    read_param_string(params, key)
        .ok_or_else(|| PiProxyError::InvalidRequest(format!("missing required parameter '{key}'")))
}

fn handle_pi_method(
    state: &Arc<PiProxyState>,
    request: &JsonRpcRequest,
    captured_events: &mut Vec<Value>,
) -> Result<Value, PiProxyError> {
    match request.method.as_str() {
        "pi/createConversation" => {
            let cwd = read_param_string(&request.params, "cwd");
            state.ensure_child(cwd.as_deref())?;
            state.send_pi_command_with_captured_events(
                json!({ "type": "new_session" }),
                captured_events,
            )?;
            let state_value = state.send_pi_command_with_captured_events(
                json!({ "type": "get_state" }),
                captured_events,
            )?;
            let session_file = PiProxyState::read_session_file(&state_value)?;
            Ok(json!({ "providerConversationId": session_file }))
        }
        "pi/findRecentConversation" => {
            let cwd = read_param_string(&request.params, "cwd");
            let provider_conversation_id = state.find_recent_conversation(cwd.as_deref())?;
            Ok(json!({ "providerConversationId": provider_conversation_id }))
        }
        "pi/getState" => {
            let session_file = read_param_string(&request.params, "sessionFile");
            state.ensure_child(None)?;
            if let Some(session_file) = session_file {
                state.switch_session(&session_file, captured_events)?;
            }
            state.send_pi_command_with_captured_events(
                json!({ "type": "get_state" }),
                captured_events,
            )
        }
        "pi/getAvailableModels" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            state.send_pi_command_with_captured_events(
                json!({ "type": "get_available_models" }),
                captured_events,
            )
        }
        "pi/readMetadata" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            let state_value = state.send_pi_command_with_captured_events(
                json!({ "type": "get_state" }),
                captured_events,
            )?;
            Ok(json!({
                "name": state_value.get("sessionName").cloned().unwrap_or(Value::Null),
                "preview": Value::Null
            }))
        }
        "pi/getMessages" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            let messages_value = state.send_pi_command_with_captured_events(
                json!({ "type": "get_messages" }),
                captured_events,
            )?;
            Ok(messages_value)
        }
        "pi/resumeConversation" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            PiProxyState::mark_active_and_start_activity_monitor(state);
            Ok(Value::Null)
        }
        "pi/setModel" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            let provider = require_param_string(&request.params, "provider")?;
            let model_id = require_param_string(&request.params, "modelId")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            state.send_pi_command_with_captured_events(
                json!({ "type": "set_model", "provider": provider, "modelId": model_id }),
                captured_events,
            )
        }
        "pi/setSessionName" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            let name = require_param_string(&request.params, "name")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            state.send_pi_command_with_captured_events(
                json!({ "type": "set_session_name", "name": name }),
                captured_events,
            )
        }
        "pi/prompt" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            let message = require_param_string(&request.params, "message")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            PiProxyState::mark_active_and_start_activity_monitor(state);
            state.send_pi_command_with_captured_events(
                json!({ "type": "prompt", "message": message }),
                captured_events,
            )
        }
        "pi/steer" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            let message = require_param_string(&request.params, "message")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            PiProxyState::mark_active_and_start_activity_monitor(state);
            state.send_pi_command_with_captured_events(
                json!({ "type": "steer", "message": message }),
                captured_events,
            )
        }
        "pi/followUp" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            let message = require_param_string(&request.params, "message")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            PiProxyState::mark_active_and_start_activity_monitor(state);
            state.send_pi_command_with_captured_events(
                json!({ "type": "follow_up", "message": message }),
                captured_events,
            )
        }
        "pi/abort" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            state.send_pi_command_with_captured_events(json!({ "type": "abort" }), captured_events)
        }
        other => Err(PiProxyError::InvalidRequest(format!(
            "unsupported Pi proxy method '{other}'"
        ))),
    }
}

fn spawn_pi_stdout_reader(
    stdout: std::process::ChildStdout,
    sender: Sender<PiRpcOutput>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line_result in reader.lines() {
            match line_result {
                Ok(line) => match serde_json::from_str::<Value>(&line) {
                    Ok(value) => {
                        let _ = sender.send(PiRpcOutput::Line(value));
                    }
                    Err(error) => {
                        let _ = sender.send(PiRpcOutput::Error(error.to_string()));
                    }
                },
                Err(error) => {
                    let _ = sender.send(PiRpcOutput::Error(error.to_string()));
                    return;
                }
            }
        }
        let _ = sender.send(PiRpcOutput::Eof);
    })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::Duration;

    use serde_json::{Value, json};
    use tempfile::tempdir;

    use crate::keepalive::KeepaliveManager;
    use crate::pi_proxy::{PiProxyConfig, PiProxyState, handle_json_rpc_request};

    #[test]
    fn fans_out_pi_events_before_json_rpc_response_and_settles_activity() {
        let simulated_pi = SimulatedPiRpcProcess::start();
        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: simulated_pi.path(),
                env: BTreeMap::new(),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager: keepalive_manager.clone(),
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(false),
            next_id: AtomicU64::new(1),
        });

        let create_responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "create",
                "method": "pi/createConversation",
                "params": { "cwd": simulated_pi.cwd() }
            })
            .to_string(),
        );
        let create_response = parse_json_rpc_message(
            create_responses
                .last()
                .expect("create conversation should produce a response"),
        );
        assert_eq!(
            create_response["result"]["providerConversationId"],
            json!(simulated_pi.session_file())
        );

        let event_receiver = state.subscribe_pi_events();
        let prompt_responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "prompt",
                "method": "pi/prompt",
                "params": {
                    "sessionFile": simulated_pi.session_file(),
                    "message": "hello"
                }
            })
            .to_string(),
        );

        assert!(
            keepalive_manager
                .lock()
                .expect("keepalive lock should not be poisoned")
                .active(),
            "prompt activity should keep the sandbox alive after the client response"
        );

        let pi_event = parse_json_rpc_message(
            prompt_responses
                .first()
                .expect("prompt should fan out Pi events before its response"),
        );
        assert_eq!(pi_event["method"], json!("pi/event"));
        assert_eq!(pi_event["params"]["type"], json!("agent_start"));

        let prompt_response = parse_json_rpc_message(
            prompt_responses
                .last()
                .expect("prompt should produce a JSON-RPC response"),
        );
        assert_eq!(prompt_response["id"], json!("prompt"));
        assert_eq!(prompt_response["result"], json!({ "accepted": true }));

        thread::sleep(Duration::from_millis(1_300));
        assert!(
            !keepalive_manager
                .lock()
                .expect("keepalive lock should not be poisoned")
                .active(),
            "activity monitor should observe agent_end/get_state and settle after client work returns"
        );
        let broadcast_event = parse_json_rpc_message(
            &event_receiver
                .try_recv()
                .expect("activity monitor should broadcast Pi completion events"),
        );
        assert_eq!(broadcast_event["method"], json!("pi/event"));
        assert_eq!(broadcast_event["params"]["type"], json!("agent_end"));

        state.shutdown_child();
    }

    #[test]
    fn resume_active_pi_conversation_starts_activity_monitor() {
        let simulated_pi = SimulatedPiRpcProcess::start_active_session();
        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: simulated_pi.path(),
                env: BTreeMap::new(),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager: keepalive_manager.clone(),
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(false),
            next_id: AtomicU64::new(1),
        });

        let event_receiver = state.subscribe_pi_events();
        let resume_responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "resume",
                "method": "pi/resumeConversation",
                "params": {
                    "sessionFile": simulated_pi.session_file()
                }
            })
            .to_string(),
        );

        let resume_response = parse_json_rpc_message(
            resume_responses
                .last()
                .expect("resume conversation should produce a response"),
        );
        assert_eq!(resume_response["id"], json!("resume"));
        assert_eq!(resume_response["result"], Value::Null);
        assert!(
            keepalive_manager
                .lock()
                .expect("keepalive lock should not be poisoned")
                .active(),
            "resuming active Pi work should keep the sandbox alive"
        );

        thread::sleep(Duration::from_millis(1_300));
        let broadcast_event = parse_json_rpc_message(
            &event_receiver
                .try_recv()
                .expect("activity monitor should drain and broadcast resumed Pi events"),
        );
        assert_eq!(broadcast_event["method"], json!("pi/event"));
        assert_eq!(broadcast_event["params"]["type"], json!("agent_end"));
        assert!(
            !keepalive_manager
                .lock()
                .expect("keepalive lock should not be poisoned")
                .active(),
            "activity monitor should settle after resumed Pi work ends"
        );

        state.shutdown_child();
    }

    #[test]
    fn activity_monitor_has_single_owner() {
        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: "/bin/false".to_string(),
                env: BTreeMap::new(),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager,
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(true),
            next_id: AtomicU64::new(1),
        });

        state.set_active(true);

        assert!(
            !PiProxyState::start_activity_monitor(state.clone()),
            "a running activity monitor should own Pi activity polling"
        );

        state.set_active(false);
        state
            .activity_monitor_running
            .store(false, Ordering::Release);
    }

    #[test]
    fn resume_pi_conversation_switches_without_initial_state() {
        let simulated_pi = SimulatedPiRpcProcess::start_without_initial_session();
        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: simulated_pi.path(),
                env: BTreeMap::new(),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager,
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(false),
            next_id: AtomicU64::new(1),
        });

        let resume_responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "resume",
                "method": "pi/resumeConversation",
                "params": {
                    "sessionFile": simulated_pi.session_file()
                }
            })
            .to_string(),
        );

        let resume_response = parse_json_rpc_message(
            resume_responses
                .last()
                .expect("resume conversation should produce a response"),
        );
        assert_eq!(resume_response["id"], json!("resume"));
        assert_eq!(resume_response["result"], Value::Null);

        state.shutdown_child();
    }

    #[test]
    fn forwards_pi_model_catalog_and_selection_for_session() {
        let simulated_pi = SimulatedPiRpcProcess::start_without_initial_session();
        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: simulated_pi.path(),
                env: BTreeMap::new(),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager,
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(false),
            next_id: AtomicU64::new(1),
        });

        let catalog_responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "models",
                "method": "pi/getAvailableModels",
                "params": {
                    "sessionFile": simulated_pi.session_file()
                }
            })
            .to_string(),
        );
        let catalog_response = parse_json_rpc_message(
            catalog_responses
                .last()
                .expect("model catalog request should produce a response"),
        );
        assert_eq!(
            catalog_response["result"]["models"][0]["id"],
            json!("gpt-5")
        );

        let set_model_responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "set-model",
                "method": "pi/setModel",
                "params": {
                    "sessionFile": simulated_pi.session_file(),
                    "provider": "openai",
                    "modelId": "gpt-5"
                }
            })
            .to_string(),
        );
        let set_model_response = parse_json_rpc_message(
            set_model_responses
                .last()
                .expect("set model request should produce a response"),
        );
        assert_eq!(set_model_response["result"]["provider"], json!("openai"));
        assert_eq!(set_model_response["result"]["id"], json!("gpt-5"));

        state.shutdown_child();
    }

    #[test]
    fn finds_recent_pi_conversation_from_configured_session_dir() {
        let directory = tempdir().expect("temporary directory should be created");
        let session_dir = directory.path().join("sessions");
        let project_session_dir = session_dir.join("--workspace-project--");
        let other_session_dir = session_dir.join("--workspace-other--");
        fs::create_dir_all(&project_session_dir).expect("project session directory should exist");
        fs::create_dir_all(&other_session_dir).expect("other session directory should exist");
        let old_session = project_session_dir.join("old.jsonl");
        let recent_session = project_session_dir.join("recent.jsonl");
        let other_cwd_session = other_session_dir.join("other.jsonl");
        write_session_file(&old_session, "old", "/workspace/project");
        thread::sleep(Duration::from_millis(10));
        write_session_file(&recent_session, "recent", "/workspace/project");
        thread::sleep(Duration::from_millis(10));
        write_session_file(&other_cwd_session, "other", "/workspace/other");
        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: "/bin/false".to_string(),
                env: BTreeMap::from([(
                    "PI_CODING_AGENT_SESSION_DIR".to_string(),
                    session_dir
                        .to_str()
                        .expect("session dir should be UTF-8")
                        .to_string(),
                )]),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager,
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(false),
            next_id: AtomicU64::new(1),
        });

        let responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "recent",
                "method": "pi/findRecentConversation",
                "params": { "cwd": "/workspace/project" }
            })
            .to_string(),
        );

        let response = parse_json_rpc_message(
            responses
                .last()
                .expect("recent conversation lookup should produce a response"),
        );
        assert_eq!(
            response["result"]["providerConversationId"],
            json!(
                recent_session
                    .to_str()
                    .expect("recent session path should be UTF-8")
            )
        );
    }

    fn parse_json_rpc_message(message: &str) -> Value {
        serde_json::from_str(message).expect("JSON-RPC message should be valid JSON")
    }

    fn write_session_file(path: &std::path::Path, id: &str, cwd: &str) {
        fs::write(
            path,
            format!(
                "{}\n",
                json!({
                    "type": "session",
                    "version": 1,
                    "id": id,
                    "timestamp": "2026-05-19T00:00:00.000Z",
                    "cwd": cwd
                })
            ),
        )
        .expect("session file should be written");
    }

    struct SimulatedPiRpcProcess {
        _directory: tempfile::TempDir,
        script_path: String,
        cwd: String,
        session_file: String,
    }

    impl SimulatedPiRpcProcess {
        fn start() -> Self {
            Self::start_with_session_state(false, true)
        }

        fn start_active_session() -> Self {
            Self::start_with_session_state(true, true)
        }

        fn start_without_initial_session() -> Self {
            Self::start_with_session_state(false, false)
        }

        fn start_with_session_state(active_session: bool, has_initial_session: bool) -> Self {
            let directory = tempdir().expect("temporary directory should be created");
            let script_path = directory.path().join("simulated-pi-rpc");
            let cwd = directory.path().join("workspace");
            fs::create_dir(&cwd).expect("workspace directory should be created");
            let session_file = directory.path().join("session.json");
            let active_marker = directory.path().join("active");
            let no_initial_session_marker = directory.path().join("no-initial-session");
            if active_session {
                fs::write(&active_marker, "").expect("active marker should be written");
            }
            if !has_initial_session {
                fs::write(&no_initial_session_marker, "")
                    .expect("no initial session marker should be written");
            }
            let script = format!(
                r#"#!/bin/sh
active_marker="{}"
no_initial_session_marker="{}"
while IFS= read -r line; do
  id="$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
  case "$line" in
    *'"type":"new_session"'*)
      printf '{{"type":"response","command":"new_session","id":"%s","success":true,"data":{{}}}}\n' "$id"
      ;;
    *'"type":"get_state"'*)
      if [ -f "$no_initial_session_marker" ]; then
        printf '{{"type":"response","command":"get_state","id":"%s","success":false,"error":"no active session"}}\n' "$id"
      elif [ -f "$active_marker" ]; then
        rm "$active_marker"
        printf '{{"type":"response","command":"get_state","id":"%s","success":true,"data":{{"sessionFile":"{}","sessionName":"Simulated session","isStreaming":true,"isCompacting":false,"pendingMessageCount":0}}}}\n' "$id"
        sleep 0.1
        printf '{{"type":"agent_end"}}\n'
      else
        printf '{{"type":"response","command":"get_state","id":"%s","success":true,"data":{{"sessionFile":"{}","sessionName":"Simulated session","isStreaming":false,"isCompacting":false,"pendingMessageCount":0}}}}\n' "$id"
      fi
      ;;
    *'"type":"switch_session"'*)
      rm -f "$no_initial_session_marker"
      printf '{{"type":"response","command":"switch_session","id":"%s","success":true,"data":{{}}}}\n' "$id"
      ;;
    *'"type":"get_available_models"'*)
      printf '{{"type":"response","command":"get_available_models","id":"%s","success":true,"data":{{"models":[{{"provider":"openai","id":"gpt-5","name":"GPT-5","input":["text","image"]}}]}}}}\n' "$id"
      ;;
    *'"type":"set_model"'*)
      case "$line" in
        *'"provider":"openai"'*)
          case "$line" in
            *'"modelId":"gpt-5"'*)
              printf '{{"type":"response","command":"set_model","id":"%s","success":true,"data":{{"provider":"openai","id":"gpt-5","name":"GPT-5","input":["text","image"]}}}}\n' "$id"
              ;;
            *)
              printf '{{"type":"response","command":"set_model","id":"%s","success":false,"error":"unexpected model selection"}}\n' "$id"
              ;;
          esac
          ;;
        *)
          printf '{{"type":"response","command":"set_model","id":"%s","success":false,"error":"unexpected model selection"}}\n' "$id"
          ;;
      esac
      ;;
    *'"type":"prompt"'*)
      printf '{{"type":"agent_start"}}\n'
      printf '{{"type":"response","command":"prompt","id":"%s","success":true,"data":{{"accepted":true}}}}\n' "$id"
      sleep 0.1
      printf '{{"type":"agent_end"}}\n'
      ;;
    *)
      printf '{{"type":"response","command":"unknown","id":"%s","success":false,"error":"unsupported command"}}\n' "$id"
      ;;
  esac
done
"#,
                active_marker.display(),
                no_initial_session_marker.display(),
                session_file.display(),
                session_file.display()
            );
            fs::write(&script_path, script).expect("simulated Pi RPC script should be written");
            let mut permissions = fs::metadata(&script_path)
                .expect("simulated Pi RPC script metadata should be readable")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&script_path, permissions)
                .expect("simulated Pi RPC script should be executable");

            Self {
                _directory: directory,
                script_path: script_path
                    .to_str()
                    .expect("script path should be UTF-8")
                    .to_string(),
                cwd: cwd.to_str().expect("cwd path should be UTF-8").to_string(),
                session_file: session_file
                    .to_str()
                    .expect("session path should be UTF-8")
                    .to_string(),
            }
        }

        fn path(&self) -> String {
            self.script_path.clone()
        }

        fn cwd(&self) -> &str {
            &self.cwd
        }

        fn session_file(&self) -> &str {
            &self.session_file
        }
    }
}
