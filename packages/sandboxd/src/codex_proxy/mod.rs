//! Codex app-server proxying and keepalive monitoring for `sandboxd`.
//!
//! Codex app-server keeps turn execution in one long-lived daemon process, so
//! process-level supervision alone cannot tell `sandboxd` whether Codex work is
//! still in flight. This module adds the first runtime-specific adapter:
//! - a websocket proxy listener that forwards JSON-RPC traffic to the raw
//!   app-server endpoint
//! - one internal monitor connection that rebuilds active thread state from
//!   `thread/loaded/list` and `thread/read`
//! - incremental keepalive updates driven only by `thread/status/changed`

use std::collections::BTreeSet;
use std::fmt;
use std::io::ErrorKind;
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use serde::Deserialize;
use serde_json::{Value, json};
use tungstenite::error::ProtocolError;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Error as WebSocketError, Message, WebSocket, accept, connect};
use url::Url;

use crate::keepalive::KeepaliveManager;
use crate::time::{Duration, Sleeper};

/// Default public listener URL for the Codex proxy endpoint.
pub const DEFAULT_CODEX_PROXY_LISTEN_URL: &str = "ws://127.0.0.1:4500";
/// Default internal raw Codex app-server URL.
pub const DEFAULT_CODEX_RAW_APP_SERVER_URL: &str = "ws://127.0.0.1:4501";
/// Poll interval while the nonblocking proxy listener has no pending clients.
pub const DEFAULT_CODEX_PROXY_ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(10);
/// Read timeout used while relaying websocket traffic in both directions.
pub const DEFAULT_CODEX_PROXY_SOCKET_POLL_INTERVAL: Duration = Duration::from_millis(10);
/// Delay before the monitor reconnects after a dropped raw app-server connection.
pub const DEFAULT_CODEX_MONITOR_RECONNECT_INTERVAL: Duration = Duration::from_millis(100);

/// Describes why Codex proxy startup, relay, or monitor handling failed.
#[derive(Debug)]
pub enum CodexProxyError {
    ParseListenUrl(String),
    ParseRawUrl(String),
    ListenUrlMustUseWebSocket {
        url: String,
    },
    RawUrlMustUseWebSocket {
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
    ConfigureSocket(std::io::Error),
    AcceptClient(std::io::Error),
    AcceptHandshake(String),
    ConnectRaw(WebSocketError),
    InvalidJson(serde_json::Error),
    MissingResponseId {
        expected_id: u64,
    },
    InvalidThreadLoadedList(String),
    InvalidThreadRead(String),
    ReadSocket(WebSocketError),
    WriteSocket(WebSocketError),
    ListenerPanicked,
    MonitorPanicked,
    SessionPanicked,
}

impl fmt::Display for CodexProxyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ParseListenUrl(error) => {
                write!(f, "failed to parse Codex proxy listen URL: {error}")
            }
            Self::ParseRawUrl(error) => {
                write!(f, "failed to parse raw Codex app-server URL: {error}")
            }
            Self::ListenUrlMustUseWebSocket { url } => {
                write!(f, "Codex proxy listen URL must use ws scheme: {url}")
            }
            Self::RawUrlMustUseWebSocket { url } => {
                write!(f, "raw Codex app-server URL must use ws scheme: {url}")
            }
            Self::ListenUrlMissingHost { url } => {
                write!(f, "Codex proxy listen URL must include a host: {url}")
            }
            Self::ListenUrlMissingPort { url } => {
                write!(f, "Codex proxy listen URL must include a port: {url}")
            }
            Self::BindListener { address, error } => {
                write!(f, "failed to bind Codex proxy listener {address}: {error}")
            }
            Self::ConfigureListener(error) => {
                write!(f, "failed to configure Codex proxy listener: {error}")
            }
            Self::ConfigureSocket(error) => {
                write!(f, "failed to configure Codex proxy socket: {error}")
            }
            Self::AcceptClient(error) => {
                write!(f, "failed to accept Codex proxy client: {error}")
            }
            Self::AcceptHandshake(error) => {
                write!(
                    f,
                    "failed to accept Codex proxy websocket handshake: {error}"
                )
            }
            Self::ConnectRaw(error) => {
                write!(f, "failed to connect to raw Codex app-server: {error}")
            }
            Self::InvalidJson(error) => {
                write!(f, "Codex proxy received invalid JSON-RPC payload: {error}")
            }
            Self::MissingResponseId { expected_id } => {
                write!(f, "Codex monitor did not receive response id {expected_id}")
            }
            Self::InvalidThreadLoadedList(message) => {
                write!(
                    f,
                    "Codex monitor received invalid thread/loaded/list response: {message}"
                )
            }
            Self::InvalidThreadRead(message) => {
                write!(
                    f,
                    "Codex monitor received invalid thread/read response: {message}"
                )
            }
            Self::ReadSocket(error) => write!(f, "failed to read Codex websocket message: {error}"),
            Self::WriteSocket(error) => {
                write!(f, "failed to write Codex websocket message: {error}")
            }
            Self::ListenerPanicked => write!(f, "Codex proxy listener thread panicked"),
            Self::MonitorPanicked => write!(f, "Codex proxy monitor thread panicked"),
            Self::SessionPanicked => write!(f, "Codex proxy session thread panicked"),
        }
    }
}

impl std::error::Error for CodexProxyError {}

/// Tracks the set of Codex threads whose current `thread.status` is `active`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CodexMonitor {
    active_threads: BTreeSet<String>,
}

impl CodexMonitor {
    /// Returns whether any currently known thread is still active.
    pub fn has_active_threads(&self) -> bool {
        !self.active_threads.is_empty()
    }

    /// Returns the active thread ids in sorted order.
    pub fn active_thread_ids(&self) -> Vec<String> {
        self.active_threads.iter().cloned().collect()
    }

    /// Applies one thread status change and updates coarse platform keepalive.
    pub fn apply_thread_status(
        &mut self,
        thread_id: &str,
        status: &CodexThreadStatus,
        keepalive_manager: &mut KeepaliveManager,
    ) {
        if status.is_active() {
            self.active_threads.insert(thread_id.to_string());
        } else {
            self.active_threads.remove(thread_id);
        }

        keepalive_manager.set_platform_active(self.has_active_threads());
    }

    /// Rebuilds thread activity from one full `thread/loaded/list` + `thread/read` snapshot.
    pub fn rebuild_from_threads(
        &mut self,
        threads: impl IntoIterator<Item = (String, CodexThreadStatus)>,
        keepalive_manager: &mut KeepaliveManager,
    ) {
        self.active_threads.clear();
        for (thread_id, status) in threads {
            if status.is_active() {
                self.active_threads.insert(thread_id);
            }
        }

        keepalive_manager.set_platform_active(self.has_active_threads());
    }

    /// Clears all local thread state after the monitor connection becomes stale.
    pub fn clear(&mut self, keepalive_manager: &mut KeepaliveManager) {
        self.active_threads.clear();
        keepalive_manager.set_platform_active(false);
    }
}

type SessionThread = JoinHandle<Result<(), CodexProxyError>>;
type SessionThreads = Arc<Mutex<Vec<SessionThread>>>;

/// Owns one running Codex proxy listener together with its monitor thread.
pub struct CodexProxy {
    listen_url: String,
    shutdown_requested: Arc<AtomicBool>,
    listener_thread: Option<JoinHandle<Result<(), CodexProxyError>>>,
    monitor_thread: Option<JoinHandle<()>>,
    session_threads: SessionThreads,
}

impl CodexProxy {
    /// Returns the final websocket URL clients should use for the proxy listener.
    pub fn listen_url(&self) -> &str {
        &self.listen_url
    }

    /// Stops the listener and waits for background proxy threads to exit.
    pub fn close(mut self) -> Result<(), CodexProxyError> {
        self.shutdown_requested.store(true, Ordering::Relaxed);

        let listener_thread = self
            .listener_thread
            .take()
            .expect("Codex proxy listener thread should exist");
        match listener_thread.join() {
            Ok(result) => result?,
            Err(_) => return Err(CodexProxyError::ListenerPanicked),
        }

        let monitor_thread = self
            .monitor_thread
            .take()
            .expect("Codex proxy monitor thread should exist");
        if monitor_thread.join().is_err() {
            return Err(CodexProxyError::MonitorPanicked);
        }

        let mut session_threads = self
            .session_threads
            .lock()
            .expect("Codex proxy session thread lock should not be poisoned");
        for session_thread in session_threads.drain(..) {
            match session_thread.join() {
                Ok(result) => result?,
                Err(_) => return Err(CodexProxyError::SessionPanicked),
            }
        }

        Ok(())
    }
}

/// Starts the Codex websocket proxy listener and its internal activity monitor.
pub fn start_codex_proxy(
    proxy_listen_url: &str,
    raw_app_server_url: &str,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    sleeper: Arc<dyn Sleeper>,
) -> Result<CodexProxy, CodexProxyError> {
    let listen_url = Url::parse(proxy_listen_url)
        .map_err(|error| CodexProxyError::ParseListenUrl(error.to_string()))?;
    if listen_url.scheme() != "ws" {
        return Err(CodexProxyError::ListenUrlMustUseWebSocket {
            url: proxy_listen_url.to_string(),
        });
    }
    let listen_host =
        listen_url
            .host_str()
            .ok_or_else(|| CodexProxyError::ListenUrlMissingHost {
                url: proxy_listen_url.to_string(),
            })?;
    let listen_port = listen_url
        .port()
        .ok_or_else(|| CodexProxyError::ListenUrlMissingPort {
            url: proxy_listen_url.to_string(),
        })?;

    let raw_url = Url::parse(raw_app_server_url)
        .map_err(|error| CodexProxyError::ParseRawUrl(error.to_string()))?;
    if raw_url.scheme() != "ws" {
        return Err(CodexProxyError::RawUrlMustUseWebSocket {
            url: raw_app_server_url.to_string(),
        });
    }

    let listener_address = format!("{listen_host}:{listen_port}");
    let listener =
        TcpListener::bind(&listener_address).map_err(|error| CodexProxyError::BindListener {
            address: listener_address.clone(),
            error,
        })?;
    listener
        .set_nonblocking(true)
        .map_err(CodexProxyError::ConfigureListener)?;
    let local_address = listener
        .local_addr()
        .map_err(CodexProxyError::ConfigureListener)?;

    let mut final_listen_url = listen_url.clone();
    final_listen_url
        .set_host(Some(listen_host))
        .expect("validated websocket listen host should remain valid");
    final_listen_url
        .set_port(Some(local_address.port()))
        .expect("validated websocket listen port should remain valid");

    let shutdown_requested = Arc::new(AtomicBool::new(false));
    let session_threads = Arc::new(Mutex::new(Vec::new()));

    let listener_shutdown = shutdown_requested.clone();
    let listener_raw_url = raw_app_server_url.to_string();
    let listener_session_threads = session_threads.clone();
    let listener_sleeper = sleeper.clone();
    let listener_thread = thread::spawn(move || {
        run_codex_proxy_listener(
            listener,
            &listener_raw_url,
            &listener_shutdown,
            &listener_session_threads,
            listener_sleeper.as_ref(),
        )
    });

    let monitor_shutdown = shutdown_requested.clone();
    let monitor_keepalive = keepalive_manager.clone();
    let monitor_raw_url = raw_app_server_url.to_string();
    let monitor_sleeper = sleeper;
    let monitor_thread = thread::spawn(move || {
        run_codex_monitor_loop(
            &monitor_raw_url,
            &monitor_keepalive,
            &monitor_shutdown,
            monitor_sleeper.as_ref(),
        );
    });

    Ok(CodexProxy {
        listen_url: final_listen_url.to_string(),
        shutdown_requested,
        listener_thread: Some(listener_thread),
        monitor_thread: Some(monitor_thread),
        session_threads,
    })
}

fn run_codex_proxy_listener(
    listener: TcpListener,
    raw_app_server_url: &str,
    shutdown_requested: &Arc<AtomicBool>,
    session_threads: &SessionThreads,
    sleeper: &dyn Sleeper,
) -> Result<(), CodexProxyError> {
    while !shutdown_requested.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _)) => {
                let raw_app_server_url = raw_app_server_url.to_string();
                let session_thread = thread::spawn(move || {
                    let mut client_socket = accept(stream)
                        .map_err(|error| CodexProxyError::AcceptHandshake(error.to_string()))?;
                    relay_codex_proxy_connection(
                        &mut client_socket,
                        &raw_app_server_url,
                        DEFAULT_CODEX_PROXY_SOCKET_POLL_INTERVAL,
                    )
                });
                session_threads
                    .lock()
                    .expect("Codex proxy session thread lock should not be poisoned")
                    .push(session_thread);
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                sleeper.sleep(DEFAULT_CODEX_PROXY_ACCEPT_POLL_INTERVAL);
            }
            Err(error) => return Err(CodexProxyError::AcceptClient(error)),
        }
    }

    Ok(())
}

fn run_codex_monitor_loop(
    raw_app_server_url: &str,
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
    shutdown_requested: &Arc<AtomicBool>,
    sleeper: &dyn Sleeper,
) {
    let mut monitor = CodexMonitor::default();

    while !shutdown_requested.load(Ordering::Relaxed) {
        let result = run_codex_monitor_session(
            raw_app_server_url,
            &mut monitor,
            keepalive_manager,
            DEFAULT_CODEX_PROXY_SOCKET_POLL_INTERVAL,
        );

        if let Ok(mut keepalive_manager) = keepalive_manager.lock() {
            monitor.clear(&mut keepalive_manager);
        }

        if shutdown_requested.load(Ordering::Relaxed) {
            return;
        }

        if result.is_err() {
            sleeper.sleep(DEFAULT_CODEX_MONITOR_RECONNECT_INTERVAL);
        }
    }
}

/// Connects to the raw Codex app-server, rebuilds active threads, then consumes
/// `thread/status/changed` notifications until the connection closes.
pub fn run_codex_monitor_session(
    raw_app_server_url: &str,
    monitor: &mut CodexMonitor,
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
    socket_poll_interval: Duration,
) -> Result<(), CodexProxyError> {
    let (mut socket, _) = connect(raw_app_server_url).map_err(CodexProxyError::ConnectRaw)?;
    configure_raw_socket_timeout(&mut socket, socket_poll_interval)?;

    send_json_message(
        &mut socket,
        json!({
            "method": "initialize",
            "id": 1,
            "params": {
                "clientInfo": {
                    "name": "mistle_sandboxd",
                    "title": "Mistle sandboxd Codex monitor",
                    "version": "0.0.0"
                }
            }
        }),
    )?;
    let mut pending_updates = Vec::new();
    let _ = wait_for_response(&mut socket, 1, &mut pending_updates)?;
    send_json_message(
        &mut socket,
        json!({
            "method": "initialized",
            "params": {}
        }),
    )?;

    send_json_message(
        &mut socket,
        json!({
            "method": "thread/loaded/list",
            "id": 2,
            "params": {}
        }),
    )?;
    let loaded_response = wait_for_response(&mut socket, 2, &mut pending_updates)?;
    let loaded_thread_ids = parse_thread_loaded_list_response(&loaded_response)?;

    let mut threads = Vec::new();
    let mut next_request_id = 3;
    for thread_id in loaded_thread_ids {
        send_json_message(
            &mut socket,
            json!({
                "method": "thread/read",
                "id": next_request_id,
                "params": {
                    "threadId": thread_id
                }
            }),
        )?;
        let thread_response =
            wait_for_response(&mut socket, next_request_id, &mut pending_updates)?;
        let status = parse_thread_read_response(&thread_response)?;
        let thread_id = thread_response["result"]["thread"]["id"]
            .as_str()
            .ok_or_else(|| {
                CodexProxyError::InvalidThreadRead(
                    "thread/read response is missing thread.id".to_string(),
                )
            })?
            .to_string();
        threads.push((thread_id, status));
        next_request_id += 1;
    }

    {
        let mut keepalive_manager = keepalive_manager
            .lock()
            .expect("Codex keepalive manager lock should not be poisoned");
        monitor.rebuild_from_threads(threads, &mut keepalive_manager);
        for (thread_id, status) in pending_updates.drain(..) {
            monitor.apply_thread_status(&thread_id, &status, &mut keepalive_manager);
        }
    }

    loop {
        match socket.read() {
            Ok(message) => {
                if let Some((thread_id, status)) = parse_thread_status_changed_message(&message)? {
                    let mut keepalive_manager = keepalive_manager
                        .lock()
                        .expect("Codex keepalive manager lock should not be poisoned");
                    monitor.apply_thread_status(&thread_id, &status, &mut keepalive_manager);
                }
            }
            Err(WebSocketError::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) if is_connection_termination_error(&error) => return Ok(()),
            Err(error) => return Err(CodexProxyError::ReadSocket(error)),
        }
    }
}

/// Relays websocket frames between one Codex client connection and the raw app-server.
pub fn relay_codex_proxy_connection(
    client_socket: &mut WebSocket<TcpStream>,
    raw_app_server_url: &str,
    socket_poll_interval: Duration,
) -> Result<(), CodexProxyError> {
    configure_plain_socket_timeout(client_socket, socket_poll_interval)?;

    let (mut raw_socket, _) = connect(raw_app_server_url).map_err(CodexProxyError::ConnectRaw)?;
    configure_raw_socket_timeout(&mut raw_socket, socket_poll_interval)?;

    loop {
        let mut forwarded_message = false;

        match client_socket.read() {
            Ok(message) => {
                forwarded_message = true;
                if let Message::Close(frame) = message {
                    raw_socket
                        .send(Message::Close(frame))
                        .map_err(CodexProxyError::WriteSocket)?;
                    return Ok(());
                }

                raw_socket
                    .send(message)
                    .map_err(CodexProxyError::WriteSocket)?;
            }
            Err(WebSocketError::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) if is_connection_termination_error(&error) => return Ok(()),
            Err(error) => return Err(CodexProxyError::ReadSocket(error)),
        }

        match raw_socket.read() {
            Ok(message) => {
                forwarded_message = true;
                if let Message::Close(frame) = message {
                    client_socket
                        .send(Message::Close(frame))
                        .map_err(CodexProxyError::WriteSocket)?;
                    return Ok(());
                }

                client_socket
                    .send(message)
                    .map_err(CodexProxyError::WriteSocket)?;
            }
            Err(WebSocketError::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) if is_connection_termination_error(&error) => return Ok(()),
            Err(error) => return Err(CodexProxyError::ReadSocket(error)),
        }

        if !forwarded_message {
            thread::yield_now();
        }
    }
}

fn send_json_message<S>(socket: &mut WebSocket<S>, payload: Value) -> Result<(), CodexProxyError>
where
    S: std::io::Read + std::io::Write,
{
    socket
        .send(Message::Text(payload.to_string().into()))
        .map_err(CodexProxyError::WriteSocket)
}

fn wait_for_response(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    expected_id: u64,
    pending_updates: &mut Vec<(String, CodexThreadStatus)>,
) -> Result<Value, CodexProxyError> {
    loop {
        match socket.read() {
            Ok(message) => {
                if let Some((thread_id, status)) = parse_thread_status_changed_message(&message)? {
                    pending_updates.push((thread_id, status));
                    continue;
                }

                let Message::Text(payload) = message else {
                    continue;
                };
                let value: Value =
                    serde_json::from_str(payload.as_str()).map_err(CodexProxyError::InvalidJson)?;
                if value.get("id") == Some(&json!(expected_id)) {
                    return Ok(value);
                }
            }
            Err(WebSocketError::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) if is_connection_termination_error(&error) => {
                return Err(CodexProxyError::MissingResponseId { expected_id });
            }
            Err(error) => return Err(CodexProxyError::ReadSocket(error)),
        }
    }
}

fn parse_thread_loaded_list_response(response: &Value) -> Result<Vec<String>, CodexProxyError> {
    let loaded_list = response["result"]["data"].as_array().ok_or_else(|| {
        CodexProxyError::InvalidThreadLoadedList(
            "thread/loaded/list response is missing result.data array".to_string(),
        )
    })?;

    let mut thread_ids = Vec::with_capacity(loaded_list.len());
    for thread_id in loaded_list {
        let Some(thread_id) = thread_id.as_str() else {
            return Err(CodexProxyError::InvalidThreadLoadedList(
                "thread/loaded/list response contains a non-string thread id".to_string(),
            ));
        };
        thread_ids.push(thread_id.to_string());
    }

    Ok(thread_ids)
}

fn parse_thread_read_response(response: &Value) -> Result<CodexThreadStatus, CodexProxyError> {
    let status = response["result"]["thread"]["status"].clone();
    serde_json::from_value(status).map_err(|error| {
        CodexProxyError::InvalidThreadRead(format!(
            "thread/read response has invalid status: {error}"
        ))
    })
}

fn parse_thread_status_changed_message(
    message: &Message,
) -> Result<Option<(String, CodexThreadStatus)>, CodexProxyError> {
    let Message::Text(payload) = message else {
        return Ok(None);
    };
    let value: Value =
        serde_json::from_str(payload.as_str()).map_err(CodexProxyError::InvalidJson)?;
    let Some(method) = value.get("method").and_then(Value::as_str) else {
        return Ok(None);
    };
    if method != "thread/status/changed" {
        return Ok(None);
    }

    let params: ThreadStatusChangedParams =
        serde_json::from_value(value.get("params").cloned().ok_or_else(|| {
            CodexProxyError::InvalidJson(serde_json::Error::io(std::io::Error::new(
                ErrorKind::InvalidData,
                "thread/status/changed notification is missing params",
            )))
        })?)
        .map_err(CodexProxyError::InvalidJson)?;

    Ok(Some((params.thread_id, params.status)))
}

fn configure_plain_socket_timeout(
    socket: &mut WebSocket<TcpStream>,
    timeout: Duration,
) -> Result<(), CodexProxyError> {
    socket
        .get_mut()
        .set_read_timeout(Some(timeout))
        .map_err(CodexProxyError::ConfigureSocket)?;
    socket
        .get_mut()
        .set_write_timeout(Some(timeout))
        .map_err(CodexProxyError::ConfigureSocket)?;
    Ok(())
}

fn configure_raw_socket_timeout(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    timeout: Duration,
) -> Result<(), CodexProxyError> {
    match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => {
            stream
                .set_read_timeout(Some(timeout))
                .map_err(CodexProxyError::ConfigureSocket)?;
            stream
                .set_write_timeout(Some(timeout))
                .map_err(CodexProxyError::ConfigureSocket)?;
            Ok(())
        }
        _ => Err(CodexProxyError::RawUrlMustUseWebSocket {
            url: "non-plain Codex websocket transport is not supported".to_string(),
        }),
    }
}

fn is_connection_termination_error(error: &WebSocketError) -> bool {
    matches!(
        error,
        WebSocketError::ConnectionClosed
            | WebSocketError::AlreadyClosed
            | WebSocketError::Protocol(ProtocolError::ResetWithoutClosingHandshake)
    )
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CodexThreadStatus {
    NotLoaded,
    Idle,
    SystemError,
    Active {
        #[serde(default)]
        active_flags: Vec<String>,
    },
}

impl CodexThreadStatus {
    fn is_active(&self) -> bool {
        matches!(self, Self::Active { .. })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThreadStatusChangedParams {
    thread_id: String,
    status: CodexThreadStatus,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::codex_proxy::{
        CodexMonitor, CodexThreadStatus, parse_thread_status_changed_message,
    };
    use crate::keepalive::KeepaliveManager;
    use tungstenite::Message;

    #[test]
    fn rebuild_sets_platform_activity_from_active_threads() {
        let mut monitor = CodexMonitor::default();
        let mut keepalive_manager = KeepaliveManager::default();

        monitor.rebuild_from_threads(
            [
                (
                    "thr_active".to_string(),
                    CodexThreadStatus::Active {
                        active_flags: Vec::new(),
                    },
                ),
                ("thr_idle".to_string(), CodexThreadStatus::Idle),
            ],
            &mut keepalive_manager,
        );

        assert_eq!(monitor.active_thread_ids(), vec!["thr_active".to_string()]);
        assert!(keepalive_manager.active());
    }

    #[test]
    fn ignores_non_thread_status_notifications() {
        let message = Message::Text(
            json!({
                "method": "turn/completed",
                "params": {
                    "turn": {
                        "id": "turn_123",
                        "status": "completed"
                    }
                }
            })
            .to_string()
            .into(),
        );

        let parsed = parse_thread_status_changed_message(&message)
            .expect("non-thread notifications should parse cleanly");

        assert!(parsed.is_none());
    }
}
