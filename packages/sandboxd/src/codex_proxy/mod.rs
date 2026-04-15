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
//! - runtime-readiness projection derived from the shared supervision snapshot

mod proxy_session;
mod session_manager;
mod types;

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::io::ErrorKind;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

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
    BufferedSuccessResponse, CodexSessionManagerCommand, CodexSessionManagerError,
    CodexSessionManagerHealthState, CodexSessionManagerState, PendingClientRequest,
    ProxyClientKind, RetainReason, RetainedThreadState, ThreadSubscriptionState,
};
use crate::keepalive::KeepaliveManager;
use crate::runtime::readiness::{
    RuntimeReadinessManager, RuntimeReadinessMode, derive_runtime_ready,
};
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};
use crate::time::SystemClock;
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
const CODEX_PROXY_HEALTHCHECK_INTERVAL: Duration = Duration::from_millis(250);
const CODEX_PROXY_STARTUP_HEALTHCHECK_TIMEOUT: Duration = Duration::from_secs(5);
const CODEX_PROXY_RESTART_BACKOFF_MS: [u64; 6] = [0, 250, 500, 1000, 2000, 5000];
const CODEX_PROXY_READINESS_PROJECTION_INTERVAL: Duration = Duration::from_millis(100);

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
    shutdown_requested: Arc<AtomicBool>,
    supervisor_thread: Option<JoinHandle<Result<(), CodexProxyError>>>,
    control_handle: CodexProxyControlHandle,
    local_runtime_readiness_projection: Option<LocalRuntimeReadinessProjection>,
    supervisor_handle: SandboxdSupervisorHandle,
}

struct LocalRuntimeReadinessProjection {
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    shutdown_requested: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

#[derive(Clone, Debug)]
pub struct CodexProxyControlHandle {
    listen_url: String,
    supervisor_handle: SandboxdSupervisorHandle,
    supervisor_command_sender: mpsc::Sender<CodexProxySupervisorCommand>,
}

impl CodexProxyControlHandle {
    pub fn listen_url(&self) -> &str {
        &self.listen_url
    }

    pub fn snapshot(&self) -> Option<crate::supervision::ComponentHealthSnapshot> {
        self.supervisor_handle
            .component_snapshot(SupervisedComponent::CodexProxy)
    }

    pub fn request_restart(&self) -> Result<(), String> {
        self.supervisor_command_sender
            .send(CodexProxySupervisorCommand::RestartCurrentRuntime)
            .map_err(|error| format!("failed to request Codex proxy restart: {error}"))
    }
}

struct CodexProxySupervisorConfig {
    listener_address: SocketAddr,
    listen_url: String,
    raw_app_server_url: String,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
}

enum CodexProxySupervisorCommand {
    RestartCurrentRuntime,
}

struct ActiveCodexProxyRuntime {
    listener_address: SocketAddr,
    listen_url: String,
    shutdown_sender: watch::Sender<bool>,
    runtime_thread: Option<JoinHandle<Result<(), CodexProxyError>>>,
    exit_receiver: mpsc::Receiver<Result<(), CodexProxyError>>,
    session_manager_health_receiver: watch::Receiver<CodexSessionManagerHealthState>,
}

struct CodexProxyStartup {
    listen_url: String,
    session_manager_health_receiver: watch::Receiver<CodexSessionManagerHealthState>,
}

impl CodexProxy {
    /// Returns the final websocket URL clients should use for the proxy listener.
    pub fn listen_url(&self) -> &str {
        &self.listen_url
    }

    pub fn control_handle(&self) -> CodexProxyControlHandle {
        self.control_handle.clone()
    }

    #[cfg(test)]
    fn force_current_runtime_shutdown_for_test(&self) {
        let _ = self.control_handle.request_restart();
    }

    /// Stops the listener and waits for background proxy tasks to exit.
    pub fn close(mut self) -> Result<(), CodexProxyError> {
        self.shutdown_requested.store(true, Ordering::Relaxed);
        let close_result = match self.supervisor_thread.take() {
            Some(supervisor_thread) => match supervisor_thread.join() {
                Ok(result) => result,
                Err(_) => Err(CodexProxyError::RuntimePanicked),
            },
            None => Ok(()),
        };
        self.supervisor_handle
            .mark_component_stopped(SupervisedComponent::CodexProxy);
        if let Some(local_runtime_readiness_projection) =
            self.local_runtime_readiness_projection.take()
        {
            sync_codex_proxy_runtime_readiness_from_snapshot(
                &self.supervisor_handle,
                &local_runtime_readiness_projection.runtime_readiness_manager,
            );
            local_runtime_readiness_projection
                .shutdown_requested
                .store(true, Ordering::Relaxed);
            let _ = local_runtime_readiness_projection.thread.join();
        }
        close_result
    }
}

/// Starts the Codex websocket proxy listener and its internal activity session manager.
pub fn start_codex_proxy(
    proxy_listen_url: &str,
    raw_app_server_url: &str,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
) -> Result<CodexProxy, CodexProxyError> {
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandboxd-codex-proxy",
        Arc::new(SystemClock),
        BTreeSet::from([SupervisedComponent::CodexProxy]),
    );

    start_codex_proxy_with_supervisor(
        proxy_listen_url,
        raw_app_server_url,
        keepalive_manager,
        runtime_readiness_manager,
        supervisor_handle,
    )
}

/// Starts the Codex websocket proxy using the shared supervisor boundary.
pub fn start_codex_proxy_with_supervisor(
    proxy_listen_url: &str,
    raw_app_server_url: &str,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    supervisor_handle: SandboxdSupervisorHandle,
) -> Result<CodexProxy, CodexProxyError> {
    let listen_url = Url::parse(proxy_listen_url)
        .map_err(|error| CodexProxyError::ParseListenUrl(error.to_string()))?;
    if listen_url.scheme() != "ws" {
        return Err(CodexProxyError::ListenUrlMustUseWebSocket {
            url: proxy_listen_url.to_string(),
        });
    }
    let listener_address = parse_codex_proxy_listener_address(&listen_url)?;

    let raw_url = Url::parse(raw_app_server_url)
        .map_err(|error| CodexProxyError::ParseRawUrl(error.to_string()))?;
    if raw_url.scheme() != "ws" {
        return Err(CodexProxyError::RawUrlMustUseWebSocket {
            url: raw_app_server_url.to_string(),
        });
    }
    supervisor_handle.replace_component_details(
        SupervisedComponent::CodexProxy,
        BTreeMap::from([
            ("listenAddr".to_string(), proxy_listen_url.to_string()),
            ("rawTarget".to_string(), raw_app_server_url.to_string()),
            (
                "sessionManagerState".to_string(),
                CodexSessionManagerHealthState::Starting.as_str().to_string(),
            ),
            (
                "rawConnectivityState".to_string(),
                CodexSessionManagerHealthState::Starting.as_str().to_string(),
            ),
        ]),
    );
    supervisor_handle.mark_component_starting(SupervisedComponent::CodexProxy);

    let config = CodexProxySupervisorConfig {
        listener_address,
        listen_url: proxy_listen_url.to_string(),
        raw_app_server_url: raw_app_server_url.to_string(),
        keepalive_manager,
    };
    let mut active_runtime = spawn_active_codex_proxy_runtime(&config)?;
    if let Err(error) =
        wait_for_codex_proxy_health(&mut active_runtime, CODEX_PROXY_STARTUP_HEALTHCHECK_TIMEOUT)
    {
        active_runtime.request_shutdown();
        let _ = active_runtime.join();
        record_codex_proxy_start_failure(&supervisor_handle, &error);
        return Err(error);
    }
    update_codex_proxy_connectivity_details(
        &supervisor_handle,
        active_runtime.session_manager_health_state(),
    );
    supervisor_handle.mark_component_healthy(SupervisedComponent::CodexProxy);

    let listen_url = active_runtime.listen_url.clone();
    let (supervisor_command_sender, supervisor_command_receiver) = mpsc::channel();
    let control_handle = CodexProxyControlHandle {
        listen_url: listen_url.clone(),
        supervisor_handle: supervisor_handle.clone(),
        supervisor_command_sender: supervisor_command_sender.clone(),
    };
    let local_runtime_readiness_projection = if !supervisor_handle
        .tracks_component(SupervisedComponent::CodexAppServer)
    {
        sync_codex_proxy_runtime_readiness_from_snapshot(
            &supervisor_handle,
            &runtime_readiness_manager,
        );
        let shutdown_requested = Arc::new(AtomicBool::new(false));
        let thread = spawn_codex_proxy_runtime_readiness_projection(
            supervisor_handle.clone(),
            runtime_readiness_manager.clone(),
            shutdown_requested.clone(),
        );
        Some(LocalRuntimeReadinessProjection {
            runtime_readiness_manager,
            shutdown_requested,
            thread,
        })
    } else {
        None
    };
    let shutdown_requested = Arc::new(AtomicBool::new(false));
    let supervisor_thread = thread::spawn({
        let shutdown_requested = shutdown_requested.clone();
        let supervisor_handle = supervisor_handle.clone();
        move || {
            run_codex_proxy_supervisor(
                config,
                active_runtime,
                shutdown_requested,
                supervisor_handle,
                supervisor_command_receiver,
            )
        }
    });

    Ok(CodexProxy {
        listen_url,
        shutdown_requested,
        supervisor_thread: Some(supervisor_thread),
        control_handle,
        local_runtime_readiness_projection,
        supervisor_handle,
    })
}

fn sync_codex_proxy_runtime_readiness_from_snapshot(
    supervisor_handle: &SandboxdSupervisorHandle,
    runtime_readiness_manager: &Arc<Mutex<RuntimeReadinessManager>>,
) {
    let ready = derive_runtime_ready(
        &supervisor_handle.snapshot(),
        RuntimeReadinessMode::CodexProxyOnly,
    );
    runtime_readiness_manager
        .lock()
        .expect("runtime readiness manager lock should not be poisoned")
        .set_ready(ready);
}

fn spawn_codex_proxy_runtime_readiness_projection(
    supervisor_handle: SandboxdSupervisorHandle,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    shutdown_requested: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut last_projected_ready = None;

        while !shutdown_requested.load(Ordering::Relaxed) {
            let projected_ready = derive_runtime_ready(
                &supervisor_handle.snapshot(),
                RuntimeReadinessMode::CodexProxyOnly,
            );
            if last_projected_ready != Some(projected_ready) {
                runtime_readiness_manager
                    .lock()
                    .expect("runtime readiness manager lock should not be poisoned")
                    .set_ready(projected_ready);
                last_projected_ready = Some(projected_ready);
            }
            thread::sleep(CODEX_PROXY_READINESS_PROJECTION_INTERVAL);
        }
    })
}

impl ActiveCodexProxyRuntime {
    fn request_shutdown(&self) {
        let _ = self.shutdown_sender.send(true);
    }

    fn try_recv_exit(&self) -> Result<Option<Result<(), CodexProxyError>>, TryRecvError> {
        match self.exit_receiver.try_recv() {
            Ok(result) => Ok(Some(result)),
            Err(TryRecvError::Empty) => Ok(None),
            Err(TryRecvError::Disconnected) => Err(TryRecvError::Disconnected),
        }
    }

    fn join(mut self) -> Result<(), CodexProxyError> {
        if let Some(runtime_thread) = self.runtime_thread.take() {
            return match runtime_thread.join() {
                Ok(result) => result,
                Err(_) => Err(CodexProxyError::RuntimePanicked),
            };
        }
        Ok(())
    }

    fn join_after_disconnected_exit_channel(&mut self) -> CodexProxyError {
        match self.runtime_thread.take() {
            Some(runtime_thread) => match runtime_thread.join() {
                Ok(Ok(())) => {
                    CodexProxyError::ConfigureRuntime(
                        "Codex proxy exit channel disconnected unexpectedly".to_string(),
                    )
                }
                Ok(Err(error)) => error,
                Err(_) => CodexProxyError::RuntimePanicked,
            },
            None => CodexProxyError::ConfigureRuntime(
                "Codex proxy exit channel disconnected unexpectedly".to_string(),
            ),
        }
    }

    fn session_manager_health_state(&self) -> CodexSessionManagerHealthState {
        *self.session_manager_health_receiver.borrow()
    }
}

fn parse_codex_proxy_listener_address(listen_url: &Url) -> Result<SocketAddr, CodexProxyError> {
    let listen_host = listen_url
        .host_str()
        .ok_or_else(|| CodexProxyError::ListenUrlMissingHost {
            url: listen_url.to_string(),
        })?;
    let listen_port = listen_url
        .port()
        .ok_or_else(|| CodexProxyError::ListenUrlMissingPort {
            url: listen_url.to_string(),
        })?;
    format!("{listen_host}:{listen_port}")
        .parse()
        .map_err(|_| CodexProxyError::ConfigureRuntime(format!(
            "Codex proxy listen URL must use a concrete socket address: {listen_url}"
        )))
}

fn spawn_active_codex_proxy_runtime(
    config: &CodexProxySupervisorConfig,
) -> Result<ActiveCodexProxyRuntime, CodexProxyError> {
    let (shutdown_sender, shutdown_receiver) = watch::channel(false);
    let (startup_result_sender, startup_result_receiver) = mpsc::channel();
    let (exit_sender, exit_receiver) = mpsc::channel();
    let listener_address = config.listener_address.to_string();
    let listen_url_template = Url::parse(&config.listen_url)
        .map_err(|error| CodexProxyError::ParseListenUrl(error.to_string()))?;
    let raw_app_server_url = config.raw_app_server_url.clone();
    let keepalive_manager = config.keepalive_manager.clone();
    let runtime_thread = thread::spawn(move || {
        let result = Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|error| CodexProxyError::ConfigureRuntime(error.to_string()))
            .and_then(|runtime| {
                runtime.block_on(async move {
                    run_codex_proxy_runtime(
                        &listener_address,
                        listen_url_template,
                        &raw_app_server_url,
                        keepalive_manager,
                        shutdown_receiver,
                        startup_result_sender,
                    )
                    .await
                })
            });
        let _ = exit_sender.send(result.as_ref().map(|_| ()).map_err(clone_codex_proxy_error));
        result
    });

    match startup_result_receiver.recv() {
        Ok(Ok(startup)) => {
            let listener_address =
                parse_codex_proxy_listener_address(&Url::parse(&startup.listen_url).map_err(
                    |error| CodexProxyError::ParseListenUrl(error.to_string()),
                )?)?;
            Ok(ActiveCodexProxyRuntime {
                listener_address,
                listen_url: startup.listen_url,
                shutdown_sender,
                runtime_thread: Some(runtime_thread),
                exit_receiver,
                session_manager_health_receiver: startup.session_manager_health_receiver,
            })
        }
        Ok(Err(error)) => {
            let _ = runtime_thread.join();
            Err(error)
        }
        Err(_) => match runtime_thread.join() {
            Ok(Ok(())) => Err(CodexProxyError::SessionPanicked),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(CodexProxyError::RuntimePanicked),
        },
    }
}

fn run_codex_proxy_supervisor(
    config: CodexProxySupervisorConfig,
    mut active_runtime: ActiveCodexProxyRuntime,
    shutdown_requested: Arc<AtomicBool>,
    supervisor_handle: SandboxdSupervisorHandle,
    supervisor_command_receiver: mpsc::Receiver<CodexProxySupervisorCommand>,
) -> Result<(), CodexProxyError> {
    let mut restart_attempt_index = 0_usize;
    let mut last_session_manager_health = active_runtime.session_manager_health_state();

    loop {
        if shutdown_requested.load(Ordering::Relaxed) {
            active_runtime.request_shutdown();
            return active_runtime.join();
        }

        match supervisor_command_receiver.try_recv() {
            Ok(CodexProxySupervisorCommand::RestartCurrentRuntime) => {
                active_runtime.request_shutdown();
            }
            Err(TryRecvError::Empty) => {}
            Err(TryRecvError::Disconnected) => {}
        }

        let current_session_manager_health = active_runtime.session_manager_health_state();
        if current_session_manager_health != last_session_manager_health {
            update_codex_proxy_connectivity_details(
                &supervisor_handle,
                current_session_manager_health,
            );
            if last_session_manager_health == CodexSessionManagerHealthState::Connected
                && current_session_manager_health != CodexSessionManagerHealthState::Connected
            {
                supervisor_handle.emit_component_healthcheck_failed(
                    SupervisedComponent::CodexProxy,
                    "raw_app_server_disconnected",
                    "Codex session-manager lost raw app-server connectivity",
                    "raw_app_server_connect",
                    &[],
                );
            }
            last_session_manager_health = current_session_manager_health;
        }

        let exit_result = match active_runtime.try_recv_exit() {
            Ok(Some(exit_result)) => Some(exit_result),
            Ok(None) => None,
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => {
                Some(Err(active_runtime.join_after_disconnected_exit_channel()))
            }
        };
        if let Some(exit_result) = exit_result {
            let exit_error = normalize_codex_proxy_exit_result(exit_result);
            record_codex_proxy_exit_for_restart(&supervisor_handle, &exit_error);
            active_runtime = restart_codex_proxy_after_backoff(
                &config,
                shutdown_requested.as_ref(),
                &supervisor_handle,
                &mut restart_attempt_index,
            )?;
            last_session_manager_health = active_runtime.session_manager_health_state();
            continue;
        }

        if let Err(error) = check_codex_proxy_listener_health(active_runtime.listener_address) {
            record_codex_proxy_listener_healthcheck_failure(&supervisor_handle, &error);
            active_runtime.request_shutdown();
            let _ = active_runtime.join();
            active_runtime = restart_codex_proxy_after_backoff(
                &config,
                shutdown_requested.as_ref(),
                &supervisor_handle,
                &mut restart_attempt_index,
            )?;
            last_session_manager_health = active_runtime.session_manager_health_state();
            continue;
        }

        supervisor_handle.record_component_healthcheck(SupervisedComponent::CodexProxy);
        thread::sleep(CODEX_PROXY_HEALTHCHECK_INTERVAL);
    }
}

fn restart_codex_proxy_after_backoff(
    config: &CodexProxySupervisorConfig,
    shutdown_requested: &AtomicBool,
    supervisor_handle: &SandboxdSupervisorHandle,
    restart_attempt_index: &mut usize,
) -> Result<ActiveCodexProxyRuntime, CodexProxyError> {
    loop {
        if shutdown_requested.load(Ordering::Relaxed) {
            return Ok(spawn_stopped_codex_proxy_runtime());
        }

        let backoff_ms = codex_proxy_restart_backoff_ms(*restart_attempt_index);
        supervisor_handle.emit_component_restart_scheduled(
            SupervisedComponent::CodexProxy,
            "restart_after_failure",
            backoff_ms,
            &[],
        );
        thread::sleep(Duration::from_millis(backoff_ms));
        if shutdown_requested.load(Ordering::Relaxed) {
            return Ok(spawn_stopped_codex_proxy_runtime());
        }

        supervisor_handle.mark_component_starting(SupervisedComponent::CodexProxy);
        match spawn_active_codex_proxy_runtime(config) {
            Ok(mut active_runtime) => {
                match wait_for_codex_proxy_health(
                    &mut active_runtime,
                    CODEX_PROXY_STARTUP_HEALTHCHECK_TIMEOUT,
                ) {
                    Ok(()) => {
                        update_codex_proxy_connectivity_details(
                            supervisor_handle,
                            active_runtime.session_manager_health_state(),
                        );
                        supervisor_handle.mark_component_healthy(SupervisedComponent::CodexProxy);
                        *restart_attempt_index = restart_attempt_index.saturating_add(1);
                        return Ok(active_runtime);
                    }
                    Err(error) => {
                        active_runtime.request_shutdown();
                        let _ = active_runtime.join();
                        record_codex_proxy_start_failure(supervisor_handle, &error);
                        *restart_attempt_index = restart_attempt_index.saturating_add(1);
                    }
                }
            }
            Err(error) => {
                record_codex_proxy_start_failure(supervisor_handle, &error);
                *restart_attempt_index = restart_attempt_index.saturating_add(1);
            }
        }
    }
}

fn spawn_stopped_codex_proxy_runtime() -> ActiveCodexProxyRuntime {
    let (shutdown_sender, _) = watch::channel(true);
    let (_exit_sender, exit_receiver) = mpsc::channel();
    let (_health_sender, health_receiver) =
        watch::channel(CodexSessionManagerHealthState::Disconnected);
    ActiveCodexProxyRuntime {
        listener_address: SocketAddr::from(([127, 0, 0, 1], 0)),
        listen_url: String::new(),
        shutdown_sender,
        runtime_thread: None,
        exit_receiver,
        session_manager_health_receiver: health_receiver,
    }
}

fn wait_for_codex_proxy_health(
    active_runtime: &mut ActiveCodexProxyRuntime,
    timeout: Duration,
) -> Result<(), CodexProxyError> {
    let deadline = Instant::now() + timeout;
    loop {
        let exit_result = match active_runtime.try_recv_exit() {
            Ok(Some(exit_result)) => Some(exit_result),
            Ok(None) => None,
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => {
                Some(Err(active_runtime.join_after_disconnected_exit_channel()))
            }
        };
        if let Some(exit_result) = exit_result {
            return Err(normalize_codex_proxy_exit_result(exit_result));
        }

        if check_codex_proxy_listener_health(active_runtime.listener_address).is_ok()
            && active_runtime.session_manager_health_state()
                == CodexSessionManagerHealthState::Connected
        {
            return Ok(());
        }

        if Instant::now() >= deadline {
            return Err(CodexProxyError::ConfigureRuntime(format!(
                "Codex proxy healthcheck timed out for {}",
                active_runtime.listener_address
            )));
        }

        thread::sleep(Duration::from_millis(50));
    }
}

fn check_codex_proxy_listener_health(listener_address: SocketAddr) -> Result<(), CodexProxyError> {
    std::net::TcpStream::connect_timeout(&listener_address, Duration::from_millis(200))
        .map(|_| ())
        .map_err(|error| {
            CodexProxyError::ConfigureRuntime(format!(
                "Codex proxy loopback healthcheck failed: {error}"
            ))
        })
}

fn update_codex_proxy_connectivity_details(
    supervisor_handle: &SandboxdSupervisorHandle,
    session_manager_health: CodexSessionManagerHealthState,
) {
    let state = session_manager_health.as_str().to_string();
    supervisor_handle.set_component_detail(
        SupervisedComponent::CodexProxy,
        "sessionManagerState",
        state.clone(),
    );
    supervisor_handle.set_component_detail(
        SupervisedComponent::CodexProxy,
        "rawConnectivityState",
        state,
    );
}

fn record_codex_proxy_start_failure(
    supervisor_handle: &SandboxdSupervisorHandle,
    error: &CodexProxyError,
) {
    let error_text = error.to_string();
    supervisor_handle.mark_component_restarting(
        SupervisedComponent::CodexProxy,
        error_text.clone(),
    );
    supervisor_handle.emit_component_healthcheck_failed(
        SupervisedComponent::CodexProxy,
        "startup_healthcheck_failed",
        error_text,
        "session_manager",
        &[],
    );
}

fn record_codex_proxy_listener_healthcheck_failure(
    supervisor_handle: &SandboxdSupervisorHandle,
    error: &CodexProxyError,
) {
    let error_text = error.to_string();
    supervisor_handle.mark_component_restarting(
        SupervisedComponent::CodexProxy,
        error_text.clone(),
    );
    supervisor_handle.emit_component_healthcheck_failed(
        SupervisedComponent::CodexProxy,
        "loopback_listener_failed",
        error_text,
        "listener_accept",
        &[],
    );
}

fn record_codex_proxy_exit_for_restart(
    supervisor_handle: &SandboxdSupervisorHandle,
    error: &CodexProxyError,
) {
    let error_text = error.to_string();
    let (reason, extra_fields) = match error {
        CodexProxyError::RuntimePanicked => (
            "panic",
            vec![
                ("exitKind", Value::String("panic".to_string())),
                (
                    "panicBoundary",
                    Value::String("runtime_thread".to_string()),
                ),
            ],
        ),
        _ => (
            "runtime_thread_returned",
            vec![(
                "exitKind",
                Value::String("runtime_thread_returned".to_string()),
            )],
        ),
    };
    supervisor_handle.mark_component_restarting(
        SupervisedComponent::CodexProxy,
        error_text.clone(),
    );
    supervisor_handle.emit_component_exited(
        SupervisedComponent::CodexProxy,
        reason,
        Some(&error_text),
        &extra_fields,
    );
}

fn normalize_codex_proxy_exit_result(
    exit_result: Result<(), CodexProxyError>,
) -> CodexProxyError {
    match exit_result {
        Ok(()) => CodexProxyError::ConfigureRuntime(
            "Codex proxy runtime exited unexpectedly".to_string(),
        ),
        Err(error) => error,
    }
}

fn clone_codex_proxy_error(error: &CodexProxyError) -> CodexProxyError {
    match error {
        CodexProxyError::ParseListenUrl(message) => CodexProxyError::ParseListenUrl(message.clone()),
        CodexProxyError::ParseRawUrl(message) => CodexProxyError::ParseRawUrl(message.clone()),
        CodexProxyError::ListenUrlMustUseWebSocket { url } => {
            CodexProxyError::ListenUrlMustUseWebSocket { url: url.clone() }
        }
        CodexProxyError::RawUrlMustUseWebSocket { url } => {
            CodexProxyError::RawUrlMustUseWebSocket { url: url.clone() }
        }
        CodexProxyError::ListenUrlMissingHost { url } => {
            CodexProxyError::ListenUrlMissingHost { url: url.clone() }
        }
        CodexProxyError::ListenUrlMissingPort { url } => {
            CodexProxyError::ListenUrlMissingPort { url: url.clone() }
        }
        CodexProxyError::BindListener { address, error } => CodexProxyError::BindListener {
            address: address.clone(),
            error: std::io::Error::new(error.kind(), error.to_string()),
        },
        CodexProxyError::ConfigureListener(error) => {
            CodexProxyError::ConfigureListener(std::io::Error::new(error.kind(), error.to_string()))
        }
        CodexProxyError::AcceptClient(error) => {
            CodexProxyError::AcceptClient(std::io::Error::new(error.kind(), error.to_string()))
        }
        CodexProxyError::AcceptHandshake(message) => {
            CodexProxyError::AcceptHandshake(message.clone())
        }
        CodexProxyError::ConfigureRuntime(message) => {
            CodexProxyError::ConfigureRuntime(message.clone())
        }
        CodexProxyError::ConnectRaw(error) => CodexProxyError::ConnectRaw(clone_websocket_error(error)),
        CodexProxyError::InvalidJson(error) => {
            CodexProxyError::InvalidJson(serde_json::Error::io(std::io::Error::other(error.to_string())))
        }
        CodexProxyError::MissingResponseId { expected_id } => {
            CodexProxyError::MissingResponseId {
                expected_id: *expected_id,
            }
        }
        CodexProxyError::InvalidThreadLoadedList(message) => {
            CodexProxyError::InvalidThreadLoadedList(message.clone())
        }
        CodexProxyError::InvalidThreadRead(message) => {
            CodexProxyError::InvalidThreadRead(message.clone())
        }
        CodexProxyError::ReadSocket(error) => CodexProxyError::ReadSocket(clone_websocket_error(error)),
        CodexProxyError::WriteSocket(error) => {
            CodexProxyError::WriteSocket(clone_websocket_error(error))
        }
        CodexProxyError::RuntimePanicked => CodexProxyError::RuntimePanicked,
        CodexProxyError::SessionPanicked => CodexProxyError::SessionPanicked,
    }
}

fn clone_websocket_error(error: &WebSocketError) -> WebSocketError {
    WebSocketError::Io(std::io::Error::other(error.to_string()))
}

fn codex_proxy_restart_backoff_ms(attempt_index: usize) -> u64 {
    *CODEX_PROXY_RESTART_BACKOFF_MS
        .get(attempt_index)
        .unwrap_or_else(|| {
            CODEX_PROXY_RESTART_BACKOFF_MS
                .last()
                .expect("Codex proxy backoff list should not be empty")
        })
}

async fn run_codex_proxy_runtime(
    listener_address: &str,
    listen_url_template: Url,
    raw_app_server_url: &str,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    mut shutdown_receiver: watch::Receiver<bool>,
    startup_result_sender: mpsc::Sender<Result<CodexProxyStartup, CodexProxyError>>,
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

    let (session_manager_handle, mut session_manager_task, session_manager_health_receiver) =
        session_manager::spawn_codex_session_manager(
            raw_app_server_url.to_string(),
            keepalive_manager,
            shutdown_receiver.clone(),
        );
    let _ = startup_result_sender.send(Ok(CodexProxyStartup {
        listen_url: final_listen_url.to_string(),
        session_manager_health_receiver,
    }));

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
                    // One client relay failure should not take down the shared proxy runtime.
                    Ok(Err(_error)) => {}
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
            Ok(Err(_error)) => {}
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
    use std::collections::BTreeSet;
    use std::net::{SocketAddr, TcpListener as StdTcpListener};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    use futures_util::{SinkExt, StreamExt};
    use serde_json::json;
    use tokio::net::{TcpListener, TcpStream};
    use tokio::runtime::Builder;
    use tokio::sync::oneshot;
    use tokio::task::JoinSet;
    use tokio_tungstenite::accept_async;
    use crate::keepalive::KeepaliveManager;
    use crate::runtime::readiness::RuntimeReadinessManager;
    use crate::supervision::{
        ComponentHealthState, SandboxdSupervisorHandle, SupervisedComponent,
    };
    use crate::time::SystemClock;
    use tungstenite::Message;

    use crate::codex_proxy::{
        CodexMonitor, CodexThreadStatus, parse_thread_status_changed_message,
        start_codex_proxy_with_supervisor,
    };

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

    #[test]
    fn restarts_the_codex_proxy_after_the_runtime_exits() {
        let raw_server_address = reserve_test_listener_address();
        let raw_server = start_test_raw_codex_server(raw_server_address);
        let proxy_listener_address = reserve_test_listener_address();
        let supervisor_handle = SandboxdSupervisorHandle::new(
            "sandbox-123",
            Arc::new(SystemClock),
            BTreeSet::from([SupervisedComponent::CodexProxy]),
        );
        let listen_url = format!("ws://{proxy_listener_address}");
        let raw_url = format!("ws://{raw_server_address}");

        let proxy = start_codex_proxy_with_supervisor(
            &listen_url,
            &raw_url,
            Arc::new(Mutex::new(KeepaliveManager::default())),
            Arc::new(Mutex::new(RuntimeReadinessManager::default())),
            supervisor_handle.clone(),
        )
        .expect("Codex proxy should start");

        let stable_listen_url = proxy.listen_url().to_string();
        assert_eq!(proxy.control_handle().listen_url(), stable_listen_url);
        wait_for_codex_proxy_snapshot(
            &supervisor_handle,
            ComponentHealthState::Healthy,
            0,
            Duration::from_secs(5),
        );

        proxy.force_current_runtime_shutdown_for_test();
        wait_for_codex_proxy_snapshot(
            &supervisor_handle,
            ComponentHealthState::Healthy,
            1,
            Duration::from_secs(5),
        );

        let snapshot = supervisor_handle
            .component_snapshot(SupervisedComponent::CodexProxy)
            .expect("Codex proxy should be tracked");
        assert_eq!(snapshot.details.get("listenAddr"), Some(&listen_url));
        assert_eq!(snapshot.details.get("rawTarget"), Some(&raw_url));
        assert_eq!(
            snapshot.details.get("sessionManagerState"),
            Some(&"Connected".to_string())
        );
        assert_eq!(
            snapshot.details.get("rawConnectivityState"),
            Some(&"Connected".to_string())
        );
        assert_eq!(proxy.listen_url(), stable_listen_url);

        proxy.close().expect("Codex proxy close should succeed");
        raw_server.close();
    }

    struct TestRawCodexServer {
        shutdown_sender: Option<oneshot::Sender<()>>,
        thread: Option<thread::JoinHandle<()>>,
    }

    impl TestRawCodexServer {
        fn close(mut self) {
            if let Some(shutdown_sender) = self.shutdown_sender.take() {
                let _ = shutdown_sender.send(());
            }
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    fn start_test_raw_codex_server(listener_address: SocketAddr) -> TestRawCodexServer {
        let (shutdown_sender, shutdown_receiver) = oneshot::channel();
        let thread = thread::spawn(move || {
            let runtime = Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .expect("test raw Codex server runtime should build");
            runtime.block_on(async move {
                run_test_raw_codex_server(listener_address, shutdown_receiver).await;
            });
        });
        wait_for_tcp_server(listener_address, Duration::from_secs(5));
        TestRawCodexServer {
            shutdown_sender: Some(shutdown_sender),
            thread: Some(thread),
        }
    }

    async fn run_test_raw_codex_server(
        listener_address: SocketAddr,
        mut shutdown_receiver: oneshot::Receiver<()>,
    ) {
        let listener = TcpListener::bind(listener_address)
            .await
            .expect("test raw Codex listener should bind");
        let mut connection_tasks = JoinSet::<()>::new();

        loop {
            tokio::select! {
                _ = &mut shutdown_receiver => break,
                accept_result = listener.accept() => {
                    let Ok((stream, _)) = accept_result else {
                        continue;
                    };
                    connection_tasks.spawn(async move {
                        let _ = handle_test_raw_codex_connection(stream).await;
                    });
                }
            }
        }

        connection_tasks.abort_all();
        while let Some(join_result) = connection_tasks.join_next().await {
            let _ = join_result;
        }
    }

    async fn handle_test_raw_codex_connection(stream: TcpStream) -> Result<(), String> {
        let mut socket = accept_async(stream)
            .await
            .map_err(|error| error.to_string())?;

        while let Some(message_result) = socket.next().await {
            let message = match message_result {
                Ok(message) => message,
                Err(_) => return Ok(()),
            };

            match message {
                Message::Text(payload) => {
                    let value: serde_json::Value =
                        serde_json::from_str(payload.as_str()).map_err(|error| error.to_string())?;
                    let Some(method) = value.get("method").and_then(serde_json::Value::as_str) else {
                        continue;
                    };

                    match method {
                        "initialize" => {
                            socket
                                .send(Message::Text(
                                    json!({
                                        "id": value["id"].clone(),
                                        "result": {
                                            "serverInfo": {
                                                "name": "test-codex"
                                            }
                                        }
                                    })
                                    .to_string()
                                    .into(),
                                ))
                                .await
                                .map_err(|error| error.to_string())?;
                        }
                        "initialized" => {}
                        "thread/loaded/list" => {
                            socket
                                .send(Message::Text(
                                    json!({
                                        "id": value["id"].clone(),
                                        "result": {
                                            "data": []
                                        }
                                    })
                                    .to_string()
                                    .into(),
                                ))
                                .await
                                .map_err(|error| error.to_string())?;
                        }
                        "thread/read" => {
                            let thread_id = value["params"]["threadId"]
                                .as_str()
                                .unwrap_or("thr_test");
                            socket
                                .send(Message::Text(
                                    json!({
                                        "id": value["id"].clone(),
                                        "result": {
                                            "thread": {
                                                "id": thread_id,
                                                "status": {
                                                    "type": "idle"
                                                }
                                            }
                                        }
                                    })
                                    .to_string()
                                    .into(),
                                ))
                                .await
                                .map_err(|error| error.to_string())?;
                        }
                        _ => {}
                    }
                }
                Message::Close(frame) => {
                    let _ = socket.send(Message::Close(frame)).await;
                    return Ok(());
                }
                _ => {}
            }
        }

        Ok(())
    }

    fn reserve_test_listener_address() -> SocketAddr {
        let listener = StdTcpListener::bind(("127.0.0.1", 0))
            .expect("test listener should bind to an ephemeral loopback port");
        let listener_address = listener
            .local_addr()
            .expect("test listener should expose its bound address");
        drop(listener);
        listener_address
    }

    fn wait_for_tcp_server(listener_address: SocketAddr, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        loop {
            if std::net::TcpStream::connect_timeout(&listener_address, Duration::from_millis(50))
                .is_ok()
            {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "expected TCP server at {listener_address} to become reachable"
            );
            thread::sleep(Duration::from_millis(25));
        }
    }

    fn wait_for_codex_proxy_snapshot(
        supervisor_handle: &SandboxdSupervisorHandle,
        expected_state: ComponentHealthState,
        expected_restart_count: u64,
        timeout: Duration,
    ) {
        let deadline = Instant::now() + timeout;
        loop {
            let snapshot = supervisor_handle
                .component_snapshot(SupervisedComponent::CodexProxy)
                .expect("Codex proxy should be tracked");
            if snapshot.state == expected_state && snapshot.restart_count >= expected_restart_count {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "expected Codex proxy snapshot to reach state {expected_state:?} with restart_count >= {expected_restart_count}, got {snapshot:?}"
            );
            thread::sleep(Duration::from_millis(25));
        }
    }
}
