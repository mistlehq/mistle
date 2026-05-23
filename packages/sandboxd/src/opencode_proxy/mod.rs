//! OpenCode HTTP/SSE proxying for `sandboxd`.
//!
//! Mistle exposes runtime adapters through websocket endpoints. OpenCode's
//! server exposes HTTP routes plus an SSE event stream, so this adapter accepts
//! websocket request envelopes and relays them to the raw OpenCode HTTP server.

mod activity;
mod http;
mod idempotency;
mod readiness;
mod relay;
mod server;
mod sse;

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use tokio::runtime::Builder;
use tungstenite::Error as WebSocketError;
use url::Url;

use crate::idempotency::store::IdempotencyStore;
use crate::keepalive::KeepaliveManager;
use crate::opencode_proxy::http::derive_opencode_raw_server_url_from_readiness_url;
use crate::opencode_proxy::idempotency::SharedIdempotencyStore;
use crate::opencode_proxy::readiness::{
    LocalRuntimeReadinessProjection, spawn_opencode_proxy_runtime_readiness_projection,
    sync_opencode_proxy_runtime_readiness_from_snapshot,
};
use crate::opencode_proxy::server::{
    parse_opencode_proxy_listener_address, run_opencode_proxy_runtime,
};
use crate::runtime::readiness::RuntimeReadinessManager;
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};
use crate::time::SystemClock;

const OPENCODE_PROXY_STARTUP_HEALTHCHECK_TIMEOUT: Duration = Duration::from_secs(5);

/// Default public listener URL for the OpenCode proxy endpoint.
pub const DEFAULT_OPENCODE_PROXY_LISTEN_URL: &str = "ws://127.0.0.1:4510";
/// Default internal OpenCode server origin.
pub const DEFAULT_OPENCODE_RAW_SERVER_URL: &str = "http://127.0.0.1:4511";

/// Describes why OpenCode proxy startup or request handling failed.
#[derive(Debug)]
pub enum OpenCodeProxyError {
    ParseListenUrl(String),
    ParseRawUrl(String),
    ListenUrlMustUseWebSocket {
        url: String,
    },
    RawUrlMustUseHttp {
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
    InvalidRequest(serde_json::Error),
    InvalidHttpMethod(String),
    InvalidHttpTarget(String),
    HttpRequest(String),
    ReadSocket(WebSocketError),
    WriteSocket(WebSocketError),
    RuntimePanicked,
    SessionPanicked,
}

impl fmt::Display for OpenCodeProxyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ParseListenUrl(error) => {
                write!(f, "failed to parse OpenCode proxy listen URL: {error}")
            }
            Self::ParseRawUrl(error) => {
                write!(f, "failed to parse raw OpenCode server URL: {error}")
            }
            Self::ListenUrlMustUseWebSocket { url } => {
                write!(f, "OpenCode proxy listen URL must use ws scheme: {url}")
            }
            Self::RawUrlMustUseHttp { url } => {
                write!(
                    f,
                    "raw OpenCode server URL must use http or https scheme: {url}"
                )
            }
            Self::ListenUrlMissingHost { url } => {
                write!(f, "OpenCode proxy listen URL must include a host: {url}")
            }
            Self::ListenUrlMissingPort { url } => {
                write!(f, "OpenCode proxy listen URL must include a port: {url}")
            }
            Self::BindListener { address, error } => {
                write!(
                    f,
                    "failed to bind OpenCode proxy listener {address}: {error}"
                )
            }
            Self::ConfigureListener(error) => {
                write!(f, "failed to configure OpenCode proxy listener: {error}")
            }
            Self::AcceptClient(error) => {
                write!(f, "failed to accept OpenCode proxy client: {error}")
            }
            Self::AcceptHandshake(error) => {
                write!(
                    f,
                    "failed to accept OpenCode proxy websocket handshake: {error}"
                )
            }
            Self::ConfigureRuntime(error) => {
                write!(f, "failed to configure OpenCode proxy runtime: {error}")
            }
            Self::InvalidRequest(error) => {
                write!(
                    f,
                    "OpenCode proxy received invalid request payload: {error}"
                )
            }
            Self::InvalidHttpMethod(method) => {
                write!(f, "OpenCode proxy received invalid HTTP method: {method}")
            }
            Self::InvalidHttpTarget(target) => {
                write!(f, "OpenCode proxy received invalid HTTP target: {target}")
            }
            Self::HttpRequest(error) => {
                write!(f, "OpenCode proxy HTTP request failed: {error}")
            }
            Self::ReadSocket(error) => {
                write!(f, "failed to read OpenCode websocket message: {error}")
            }
            Self::WriteSocket(error) => {
                write!(f, "failed to write OpenCode websocket message: {error}")
            }
            Self::RuntimePanicked => write!(f, "OpenCode proxy runtime thread panicked"),
            Self::SessionPanicked => write!(f, "OpenCode proxy task panicked"),
        }
    }
}

impl std::error::Error for OpenCodeProxyError {}

/// Owns one running OpenCode websocket proxy listener.
pub struct OpenCodeProxy {
    listen_url: String,
    shutdown_requested: Arc<AtomicBool>,
    runtime_thread: Option<JoinHandle<Result<(), OpenCodeProxyError>>>,
    local_runtime_readiness_projection: LocalRuntimeReadinessProjection,
    supervisor_handle: SandboxdSupervisorHandle,
}

impl OpenCodeProxy {
    /// Returns the final websocket URL clients should use for the proxy listener.
    pub fn listen_url(&self) -> &str {
        &self.listen_url
    }

    /// Stops the listener and waits for background proxy tasks to exit.
    pub fn close(mut self) -> Result<(), OpenCodeProxyError> {
        self.shutdown_requested.store(true, Ordering::Relaxed);
        let close_result = match self.runtime_thread.take() {
            Some(runtime_thread) => match runtime_thread.join() {
                Ok(result) => result,
                Err(_) => Err(OpenCodeProxyError::RuntimePanicked),
            },
            None => Ok(()),
        };
        self.supervisor_handle
            .mark_component_stopped(SupervisedComponent::OpenCodeProxy);
        sync_opencode_proxy_runtime_readiness_from_snapshot(
            &self.supervisor_handle,
            &self
                .local_runtime_readiness_projection
                .runtime_readiness_manager,
        );
        self.local_runtime_readiness_projection
            .shutdown_requested
            .store(true, Ordering::Relaxed);
        let _ = self.local_runtime_readiness_projection.thread.join();
        close_result
    }
}

/// Starts the OpenCode websocket proxy listener.
pub fn start_opencode_proxy(
    proxy_listen_url: &str,
    raw_server_url: &str,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
) -> Result<OpenCodeProxy, OpenCodeProxyError> {
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandboxd-opencode-proxy",
        Arc::new(SystemClock),
        BTreeSet::from([SupervisedComponent::OpenCodeProxy]),
    );

    start_opencode_proxy_inner(
        proxy_listen_url,
        raw_server_url,
        keepalive_manager,
        runtime_readiness_manager,
        supervisor_handle,
        None,
    )
}

pub fn start_opencode_proxy_with_idempotency_store(
    proxy_listen_url: &str,
    raw_server_url: &str,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    idempotency_store: IdempotencyStore,
) -> Result<OpenCodeProxy, OpenCodeProxyError> {
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandboxd-opencode-proxy",
        Arc::new(SystemClock),
        BTreeSet::from([SupervisedComponent::OpenCodeProxy]),
    );

    start_opencode_proxy_inner(
        proxy_listen_url,
        raw_server_url,
        keepalive_manager,
        runtime_readiness_manager,
        supervisor_handle,
        Some(Arc::new(Mutex::new(idempotency_store))),
    )
}

/// Starts the OpenCode websocket proxy using the shared supervisor boundary.
pub fn start_opencode_proxy_with_supervisor(
    proxy_listen_url: &str,
    raw_server_url: &str,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    supervisor_handle: SandboxdSupervisorHandle,
) -> Result<OpenCodeProxy, OpenCodeProxyError> {
    let idempotency_store = IdempotencyStore::load_default()
        .map_err(|error| OpenCodeProxyError::ConfigureRuntime(error.to_string()))?;

    start_opencode_proxy_inner(
        proxy_listen_url,
        raw_server_url,
        keepalive_manager,
        runtime_readiness_manager,
        supervisor_handle,
        Some(Arc::new(Mutex::new(idempotency_store))),
    )
}

fn start_opencode_proxy_inner(
    proxy_listen_url: &str,
    raw_server_url: &str,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    supervisor_handle: SandboxdSupervisorHandle,
    idempotency_store: Option<SharedIdempotencyStore>,
) -> Result<OpenCodeProxy, OpenCodeProxyError> {
    let listen_url = Url::parse(proxy_listen_url)
        .map_err(|error| OpenCodeProxyError::ParseListenUrl(error.to_string()))?;
    if listen_url.scheme() != "ws" {
        return Err(OpenCodeProxyError::ListenUrlMustUseWebSocket {
            url: proxy_listen_url.to_string(),
        });
    }
    let listener_address = parse_opencode_proxy_listener_address(&listen_url)?;

    let raw_url = Url::parse(raw_server_url)
        .map_err(|error| OpenCodeProxyError::ParseRawUrl(error.to_string()))?;
    if raw_url.scheme() != "http" && raw_url.scheme() != "https" {
        return Err(OpenCodeProxyError::RawUrlMustUseHttp {
            url: raw_server_url.to_string(),
        });
    }

    supervisor_handle.replace_component_details(
        SupervisedComponent::OpenCodeProxy,
        BTreeMap::from([
            ("listenAddr".to_string(), proxy_listen_url.to_string()),
            ("rawTarget".to_string(), raw_server_url.to_string()),
        ]),
    );
    supervisor_handle.mark_component_starting(SupervisedComponent::OpenCodeProxy);

    let (startup_sender, startup_receiver) = std::sync::mpsc::channel();
    let shutdown_requested = Arc::new(AtomicBool::new(false));
    let runtime_thread = thread::spawn({
        let shutdown_requested = shutdown_requested.clone();
        let raw_server_url = raw_server_url.to_string();
        let proxy_listen_url = proxy_listen_url.to_string();
        let idempotency_store = idempotency_store.clone();
        move || {
            let runtime = Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|error| OpenCodeProxyError::ConfigureRuntime(error.to_string()))?;
            runtime.block_on(run_opencode_proxy_runtime(
                listener_address,
                proxy_listen_url,
                raw_server_url,
                keepalive_manager,
                shutdown_requested,
                startup_sender,
                idempotency_store,
            ))
        }
    });

    let listen_url = match startup_receiver.recv_timeout(OPENCODE_PROXY_STARTUP_HEALTHCHECK_TIMEOUT)
    {
        Ok(Ok(listen_url)) => listen_url,
        Ok(Err(error)) => {
            let _ = runtime_thread.join();
            supervisor_handle
                .mark_component_restarting(SupervisedComponent::OpenCodeProxy, error.to_string());
            return Err(error);
        }
        Err(error) => {
            supervisor_handle.mark_component_restarting(
                SupervisedComponent::OpenCodeProxy,
                format!("OpenCode proxy startup timed out: {error}"),
            );
            return Err(OpenCodeProxyError::ConfigureRuntime(format!(
                "OpenCode proxy startup timed out: {error}"
            )));
        }
    };

    supervisor_handle.mark_component_healthy(SupervisedComponent::OpenCodeProxy);
    sync_opencode_proxy_runtime_readiness_from_snapshot(
        &supervisor_handle,
        &runtime_readiness_manager,
    );
    let readiness_shutdown_requested = Arc::new(AtomicBool::new(false));
    let readiness_thread = spawn_opencode_proxy_runtime_readiness_projection(
        supervisor_handle.clone(),
        runtime_readiness_manager.clone(),
        readiness_shutdown_requested.clone(),
    );

    Ok(OpenCodeProxy {
        listen_url,
        shutdown_requested,
        runtime_thread: Some(runtime_thread),
        local_runtime_readiness_projection: LocalRuntimeReadinessProjection {
            runtime_readiness_manager,
            shutdown_requested: readiness_shutdown_requested,
            thread: readiness_thread,
        },
        supervisor_handle,
    })
}

/// Derives the raw OpenCode server origin from the compiled process health URL.
pub fn derive_opencode_raw_server_url(readiness_url: &str) -> Result<String, OpenCodeProxyError> {
    derive_opencode_raw_server_url_from_readiness_url(readiness_url)
}
