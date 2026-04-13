//! Codex app-server proxying, keepalive monitoring, and readiness tracking for `sandboxd`.
//!
//! Codex app-server keeps turn execution in one long-lived daemon process, so
//! process-level supervision alone cannot tell `sandboxd` whether Codex work is
//! still in flight. This module adds the first runtime-specific adapter:
//! - a websocket proxy listener that forwards JSON-RPC traffic to the raw
//!   app-server endpoint
//! - one internal session-manager connection that rebuilds active thread state from
//!   `thread/loaded/list` and `thread/read`
//! - incremental keepalive updates driven only by `thread/status/changed`
//! - runtime-readiness updates driven by the session manager's real protocol bootstrap

mod proxy_session;
mod session_manager;
mod types;

use std::collections::BTreeSet;
use std::fmt;
use std::io::ErrorKind;
use std::sync::{Arc, Mutex, mpsc};
use std::thread::{self, JoinHandle};

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::net::{TcpListener, TcpStream};
use tokio::runtime::Builder;
use tokio::sync::watch;
use tokio::task::JoinSet;
use tokio_tungstenite::MaybeTlsStream;
use tokio_tungstenite::WebSocketStream;
use tungstenite::error::ProtocolError;
use tungstenite::{Error as WebSocketError, Message};
use url::Url;

use crate::codex_proxy::proxy_session::relay_codex_proxy_connection;
pub use crate::codex_proxy::session_manager::{
    CodexSessionManagerHandle, spawn_codex_session_manager,
};
pub use crate::codex_proxy::types::{
    CodexSessionManagerCommand, CodexSessionManagerError, CodexSessionManagerState, RetainReason,
    BufferedSuccessResponse, PendingClientRequest, ProxyClientKind, RetainedThreadState,
    ThreadSubscriptionState,
};
use crate::keepalive::KeepaliveManager;
use crate::runtime::readiness::RuntimeReadinessManager;
pub type RawCodexSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Default public listener URL for the Codex proxy endpoint.
pub const DEFAULT_CODEX_PROXY_LISTEN_URL: &str = "ws://127.0.0.1:4500";
/// Default internal raw Codex app-server URL.
pub const DEFAULT_CODEX_RAW_APP_SERVER_URL: &str = "ws://127.0.0.1:4501";
/// Delay before the monitor reconnects after a dropped raw app-server connection.
pub const DEFAULT_CODEX_MONITOR_RECONNECT_INTERVAL: std::time::Duration =
    std::time::Duration::from_millis(100);
/// The Codex client identity accepted by ChatGPT-backed OpenAI endpoints.
pub const CODEX_INITIALIZE_CLIENT_NAME: &str = "codex_cli_rs";

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
    AcceptClient(std::io::Error),
    AcceptHandshake(String),
    ConfigureRuntime(String),
    ConnectRaw(WebSocketError),
    InvalidJson(serde_json::Error),
    MissingResponseId {
        expected_id: u64,
    },
    InvalidThreadLoadedList(String),
    InvalidThreadRead(String),
    ReadSocket(WebSocketError),
    WriteSocket(WebSocketError),
    RuntimePanicked,
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
            Self::AcceptClient(error) => {
                write!(f, "failed to accept Codex proxy client: {error}")
            }
            Self::AcceptHandshake(error) => {
                write!(
                    f,
                    "failed to accept Codex proxy websocket handshake: {error}"
                )
            }
            Self::ConfigureRuntime(error) => {
                write!(f, "failed to configure Codex proxy runtime: {error}")
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
            Self::RuntimePanicked => write!(f, "Codex proxy runtime thread panicked"),
            Self::SessionPanicked => write!(f, "Codex proxy task panicked"),
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

/// Owns one running Codex proxy listener together with its internal session manager.
pub struct CodexProxy {
    listen_url: String,
    shutdown_sender: watch::Sender<bool>,
    runtime_thread: Option<JoinHandle<Result<(), CodexProxyError>>>,
}

impl CodexProxy {
    /// Returns the final websocket URL clients should use for the proxy listener.
    pub fn listen_url(&self) -> &str {
        &self.listen_url
    }

    /// Stops the listener and waits for background proxy tasks to exit.
    pub fn close(mut self) -> Result<(), CodexProxyError> {
        let _ = self.shutdown_sender.send(true);
        let runtime_thread = self
            .runtime_thread
            .take()
            .expect("Codex proxy runtime thread should exist");
        match runtime_thread.join() {
            Ok(result) => result,
            Err(_) => Err(CodexProxyError::RuntimePanicked),
        }
    }
}

/// Starts the Codex websocket proxy listener and its internal activity session manager.
pub fn start_codex_proxy(
    proxy_listen_url: &str,
    raw_app_server_url: &str,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
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
    let (shutdown_sender, shutdown_receiver) = watch::channel(false);
    let (startup_result_sender, startup_result_receiver) = mpsc::channel();
    let raw_app_server_url = raw_app_server_url.to_string();
    let listen_url_template = listen_url.clone();
    let runtime_thread = thread::spawn(move || {
        let runtime = Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|error| CodexProxyError::ConfigureRuntime(error.to_string()))?;
        runtime.block_on(async move {
            run_codex_proxy_runtime(
                &listener_address,
                listen_url_template,
                &raw_app_server_url,
                keepalive_manager,
                runtime_readiness_manager,
                shutdown_receiver,
                startup_result_sender,
            )
            .await
        })
    });

    let listen_url = match startup_result_receiver.recv() {
        Ok(Ok(listen_url)) => listen_url,
        Ok(Err(error)) => {
            let _ = runtime_thread.join();
            return Err(error);
        }
        Err(_) => match runtime_thread.join() {
            Ok(Err(error)) => return Err(error),
            Ok(Ok(())) => return Err(CodexProxyError::SessionPanicked),
            Err(_) => return Err(CodexProxyError::RuntimePanicked),
        },
    };

    Ok(CodexProxy {
        listen_url,
        shutdown_sender,
        runtime_thread: Some(runtime_thread),
    })
}

async fn run_codex_proxy_runtime(
    listener_address: &str,
    listen_url_template: Url,
    raw_app_server_url: &str,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    mut shutdown_receiver: watch::Receiver<bool>,
    startup_result_sender: mpsc::Sender<Result<String, CodexProxyError>>,
) -> Result<(), CodexProxyError> {
    let listener = TcpListener::bind(listener_address).await.map_err(|error| {
        CodexProxyError::BindListener {
            address: listener_address.to_string(),
            error,
        }
    })?;
    let local_address = listener
        .local_addr()
        .map_err(CodexProxyError::ConfigureListener)?;

    let mut final_listen_url = listen_url_template;
    final_listen_url
        .set_port(Some(local_address.port()))
        .expect("validated websocket listen port should remain valid");

    let (session_manager_handle, mut session_manager_task) =
        session_manager::spawn_codex_session_manager(
            raw_app_server_url.to_string(),
            keepalive_manager,
            runtime_readiness_manager,
            shutdown_receiver.clone(),
        );
    let _ = startup_result_sender.send(Ok(final_listen_url.to_string()));

    let mut session_tasks = JoinSet::<Result<(), CodexProxyError>>::new();

    loop {
        tokio::select! {
            _ = shutdown_receiver.changed() => break,
            manager_result = &mut session_manager_task => {
                match manager_result {
                    Ok(Ok(())) => return Ok(()),
                    Ok(Err(error)) => return Err(error),
                    Err(_) => return Err(CodexProxyError::SessionPanicked),
                }
            }
            Some(session_result) = session_tasks.join_next(), if !session_tasks.is_empty() => {
                match session_result {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => return Err(error),
                    Err(_) => return Err(CodexProxyError::SessionPanicked),
                }
            }
            accept_result = listener.accept() => {
                let (stream, _) = accept_result.map_err(CodexProxyError::AcceptClient)?;
                let task_raw_url = raw_app_server_url.to_string();
                let task_handle = session_manager_handle.clone();
                let task_shutdown = shutdown_receiver.clone();
                session_tasks.spawn(async move {
                    relay_codex_proxy_connection(
                        stream,
                        &task_raw_url,
                        task_handle,
                        task_shutdown,
                    )
                    .await
                });
            }
        }
    }

    session_tasks.abort_all();
    while let Some(session_result) = session_tasks.join_next().await {
        match session_result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => return Err(error),
            Err(join_error) if join_error.is_cancelled() => {}
            Err(_) => return Err(CodexProxyError::SessionPanicked),
        }
    }

    match session_manager_task.await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => Err(error),
        Err(_) => Err(CodexProxyError::SessionPanicked),
    }
}

pub(crate) async fn send_json_message(
    socket: &mut RawCodexSocket,
    payload: Value,
) -> Result<(), CodexProxyError> {
    socket
        .send(Message::Text(payload.to_string().into()))
        .await
        .map_err(CodexProxyError::WriteSocket)
}

pub(crate) async fn wait_for_response(
    socket: &mut RawCodexSocket,
    expected_id: u64,
    pending_updates: &mut Vec<(String, CodexThreadStatus)>,
    shutdown_receiver: &mut watch::Receiver<bool>,
) -> Result<Value, CodexProxyError> {
    loop {
        tokio::select! {
            _ = shutdown_receiver.changed() => {
                return Err(CodexProxyError::MissingResponseId { expected_id });
            }
            message = socket.next() => {
                let Some(message) = message else {
                    return Err(CodexProxyError::MissingResponseId { expected_id });
                };
                let message = message.map_err(CodexProxyError::ReadSocket)?;
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
        }
    }
}

pub(crate) fn parse_thread_loaded_list_response(
    response: &Value,
) -> Result<Vec<String>, CodexProxyError> {
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

pub(crate) fn parse_thread_read_response(
    response: &Value,
) -> Result<CodexThreadStatus, CodexProxyError> {
    let status = response["result"]["thread"]["status"].clone();
    serde_json::from_value(status).map_err(|error| {
        CodexProxyError::InvalidThreadRead(format!(
            "thread/read response has invalid status: {error}"
        ))
    })
}

pub(crate) fn parse_thread_status_changed_message(
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

pub(crate) fn is_connection_termination_error(error: &WebSocketError) -> bool {
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
