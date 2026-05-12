//! OpenCode HTTP/SSE proxying for `sandboxd`.
//!
//! Mistle exposes runtime adapters through websocket endpoints. OpenCode's
//! server exposes HTTP routes plus an SSE event stream, so this adapter accepts
//! websocket request envelopes and relays them to the raw OpenCode HTTP server.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use http_body_util::{BodyExt, Full};
use hyper::header::{CONTENT_TYPE, HeaderName, HeaderValue};
use hyper::{Method, Request, Uri};
use hyper_rustls::{HttpsConnector, HttpsConnectorBuilder};
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::TokioExecutor;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::net::{TcpListener, TcpStream};
use tokio::runtime::Builder;
use tokio::sync::mpsc;
use tokio::task::JoinSet;
use tokio_tungstenite::accept_async;
use tungstenite::{Error as WebSocketError, Message};
use url::Url;

use crate::runtime::readiness::{
    RuntimeReadinessManager, RuntimeReadinessMode, derive_runtime_ready,
};
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};
use crate::time::SystemClock;

const OPENCODE_PROXY_STARTUP_HEALTHCHECK_TIMEOUT: Duration = Duration::from_secs(5);
const OPENCODE_PROXY_HEALTHCHECK_INTERVAL: Duration = Duration::from_millis(50);
const OPENCODE_PROXY_READINESS_PROJECTION_INTERVAL: Duration = Duration::from_millis(100);

type OpenCodeHttpClient = Client<HttpsConnector<HttpConnector>, Full<Bytes>>;

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

struct LocalRuntimeReadinessProjection {
    runtime_readiness_manager: Arc<std::sync::Mutex<RuntimeReadinessManager>>,
    shutdown_requested: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenCodeProxyRequest {
    id: Value,
    method: String,
    path: String,
    headers: Option<BTreeMap<String, String>>,
    body: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenCodeProxyResponse {
    id: Value,
    #[serde(rename = "type")]
    message_type: OpenCodeProxyResponseType,
    status: u16,
    headers: BTreeMap<String, String>,
    body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenCodeProxySseEvent {
    id: Value,
    #[serde(rename = "type")]
    message_type: OpenCodeProxyResponseType,
    event: Option<String>,
    data: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenCodeProxyComplete {
    id: Value,
    #[serde(rename = "type")]
    message_type: OpenCodeProxyResponseType,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum OpenCodeProxyResponseType {
    Response,
    Sse,
    Complete,
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
    runtime_readiness_manager: Arc<std::sync::Mutex<RuntimeReadinessManager>>,
) -> Result<OpenCodeProxy, OpenCodeProxyError> {
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandboxd-opencode-proxy",
        Arc::new(SystemClock),
        BTreeSet::from([SupervisedComponent::OpenCodeProxy]),
    );

    start_opencode_proxy_with_supervisor(
        proxy_listen_url,
        raw_server_url,
        runtime_readiness_manager,
        supervisor_handle,
    )
}

/// Starts the OpenCode websocket proxy using the shared supervisor boundary.
pub fn start_opencode_proxy_with_supervisor(
    proxy_listen_url: &str,
    raw_server_url: &str,
    runtime_readiness_manager: Arc<std::sync::Mutex<RuntimeReadinessManager>>,
    supervisor_handle: SandboxdSupervisorHandle,
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
        move || {
            let runtime = Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|error| OpenCodeProxyError::ConfigureRuntime(error.to_string()))?;
            runtime.block_on(run_opencode_proxy_runtime(
                listener_address,
                proxy_listen_url,
                raw_server_url,
                shutdown_requested,
                startup_sender,
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

fn sync_opencode_proxy_runtime_readiness_from_snapshot(
    supervisor_handle: &SandboxdSupervisorHandle,
    runtime_readiness_manager: &Arc<std::sync::Mutex<RuntimeReadinessManager>>,
) {
    let ready = derive_runtime_ready(
        &supervisor_handle.snapshot(),
        RuntimeReadinessMode::OpenCodeProxyOnly,
    );
    runtime_readiness_manager
        .lock()
        .expect("runtime readiness manager lock should not be poisoned")
        .set_ready(ready);
}

fn spawn_opencode_proxy_runtime_readiness_projection(
    supervisor_handle: SandboxdSupervisorHandle,
    runtime_readiness_manager: Arc<std::sync::Mutex<RuntimeReadinessManager>>,
    shutdown_requested: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut last_projected_ready = None;

        while !shutdown_requested.load(Ordering::Relaxed) {
            let projected_ready = derive_runtime_ready(
                &supervisor_handle.snapshot(),
                RuntimeReadinessMode::OpenCodeProxyOnly,
            );
            if last_projected_ready != Some(projected_ready) {
                runtime_readiness_manager
                    .lock()
                    .expect("runtime readiness manager lock should not be poisoned")
                    .set_ready(projected_ready);
                last_projected_ready = Some(projected_ready);
            }
            thread::sleep(OPENCODE_PROXY_READINESS_PROJECTION_INTERVAL);
        }
    })
}

async fn run_opencode_proxy_runtime(
    listener_address: SocketAddr,
    listen_url: String,
    raw_server_url: String,
    shutdown_requested: Arc<AtomicBool>,
    startup_result_sender: std::sync::mpsc::Sender<Result<String, OpenCodeProxyError>>,
) -> Result<(), OpenCodeProxyError> {
    let listener = TcpListener::bind(listener_address).await.map_err(|error| {
        OpenCodeProxyError::BindListener {
            address: listener_address.to_string(),
            error,
        }
    })?;
    let local_address = listener
        .local_addr()
        .map_err(OpenCodeProxyError::ConfigureListener)?;
    listener
        .set_ttl(64)
        .map_err(OpenCodeProxyError::ConfigureListener)?;

    let final_listen_url = replace_url_port(&listen_url, local_address.port())?;
    let _ = startup_result_sender.send(Ok(final_listen_url));

    let client = build_opencode_http_client()?;
    let mut session_tasks = JoinSet::<Result<(), OpenCodeProxyError>>::new();
    while !shutdown_requested.load(Ordering::Relaxed) {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted.map_err(OpenCodeProxyError::AcceptClient)?;
                let raw_server_url = raw_server_url.clone();
                let client = client.clone();
                session_tasks.spawn(async move {
                    relay_opencode_proxy_connection(stream, raw_server_url, client).await
                });
            }
            joined = session_tasks.join_next(), if !session_tasks.is_empty() => {
                match joined {
                    Some(Ok(Ok(()))) => {}
                    Some(Ok(Err(error))) => return Err(error),
                    Some(Err(_)) => return Err(OpenCodeProxyError::SessionPanicked),
                    None => {}
                }
            }
            _ = tokio::time::sleep(OPENCODE_PROXY_HEALTHCHECK_INTERVAL) => {}
        }
    }

    session_tasks.abort_all();
    while let Some(joined) = session_tasks.join_next().await {
        if joined.is_err() {
            return Err(OpenCodeProxyError::SessionPanicked);
        }
    }

    Ok(())
}

async fn relay_opencode_proxy_connection(
    stream: TcpStream,
    raw_server_url: String,
    client: OpenCodeHttpClient,
) -> Result<(), OpenCodeProxyError> {
    let websocket = accept_async(stream)
        .await
        .map_err(|error| OpenCodeProxyError::AcceptHandshake(error.to_string()))?;
    let (mut sink, mut source) = websocket.split();
    let (sender, mut receiver) = mpsc::unbounded_channel::<Message>();
    let mut request_tasks = JoinSet::<Result<(), OpenCodeProxyError>>::new();

    loop {
        tokio::select! {
            outgoing = receiver.recv() => {
                let Some(message) = outgoing else {
                    break;
                };
                sink.send(message).await.map_err(OpenCodeProxyError::WriteSocket)?;
            }
            incoming = source.next() => {
                let Some(message) = incoming else {
                    break;
                };
                let message = message.map_err(OpenCodeProxyError::ReadSocket)?;
                if message.is_close() {
                    break;
                }
                if let Some(request) = parse_opencode_proxy_request(message)? {
                    let raw_server_url = raw_server_url.clone();
                    let client = client.clone();
                    let sender = sender.clone();
                    request_tasks.spawn(async move {
                        handle_opencode_proxy_request(request, raw_server_url, client, sender).await
                    });
                }
            }
            joined = request_tasks.join_next(), if !request_tasks.is_empty() => {
                match joined {
                    Some(Ok(Ok(()))) => {}
                    Some(Ok(Err(error))) => return Err(error),
                    Some(Err(_)) => return Err(OpenCodeProxyError::SessionPanicked),
                    None => {}
                }
            }
        }
    }

    request_tasks.abort_all();
    while let Some(joined) = request_tasks.join_next().await {
        if joined.is_err() {
            return Err(OpenCodeProxyError::SessionPanicked);
        }
    }

    Ok(())
}

async fn handle_opencode_proxy_request(
    request: OpenCodeProxyRequest,
    raw_server_url: String,
    client: OpenCodeHttpClient,
    sender: mpsc::UnboundedSender<Message>,
) -> Result<(), OpenCodeProxyError> {
    let target_uri = build_opencode_target_uri(&raw_server_url, &request.path)?;
    let method = Method::from_bytes(request.method.as_bytes())
        .map_err(|_| OpenCodeProxyError::InvalidHttpMethod(request.method.clone()))?;
    let mut request_builder = Request::builder().method(method).uri(target_uri);
    if let Some(headers) = &request.headers {
        for (name, value) in headers {
            let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|error| {
                OpenCodeProxyError::InvalidHttpTarget(format!("invalid header name: {error}"))
            })?;
            let header_value = HeaderValue::from_str(value).map_err(|error| {
                OpenCodeProxyError::InvalidHttpTarget(format!("invalid header value: {error}"))
            })?;
            request_builder = request_builder.header(header_name, header_value);
        }
    }
    let body = if let Some(body) = &request.body {
        request_builder = request_builder.header(CONTENT_TYPE, "application/json");
        serde_json::to_vec(body)
            .map_err(|error| OpenCodeProxyError::ConfigureRuntime(error.to_string()))?
    } else {
        Vec::new()
    };
    let upstream_request = request_builder
        .body(Full::new(Bytes::from(body)))
        .map_err(|error| OpenCodeProxyError::ConfigureRuntime(error.to_string()))?;

    let response = client
        .request(upstream_request)
        .await
        .map_err(|error| OpenCodeProxyError::HttpRequest(error.to_string()))?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|header_value| (name.to_string(), header_value.to_string()))
        })
        .collect::<BTreeMap<_, _>>();
    let is_sse = headers
        .get("content-type")
        .is_some_and(|content_type| content_type.starts_with("text/event-stream"));
    if is_sse {
        relay_sse_response(request.id, response, sender).await?;
        return Ok(());
    }

    let body = read_response_body(response.into_body()).await?;
    send_json_message(
        &sender,
        &OpenCodeProxyResponse {
            id: request.id,
            message_type: OpenCodeProxyResponseType::Response,
            status,
            headers,
            body,
        },
    )
}

async fn relay_sse_response(
    id: Value,
    response: hyper::Response<hyper::body::Incoming>,
    sender: mpsc::UnboundedSender<Message>,
) -> Result<(), OpenCodeProxyError> {
    let mut buffer = String::new();
    let mut body = response.into_body();
    while let Some(frame) = body.frame().await {
        let frame = frame.map_err(|error| OpenCodeProxyError::HttpRequest(error.to_string()))?;
        let Ok(chunk) = frame.into_data() else {
            continue;
        };
        let chunk_text = std::str::from_utf8(chunk.as_ref())
            .map_err(|error| OpenCodeProxyError::ConfigureRuntime(error.to_string()))?;
        buffer.push_str(chunk_text);
        while let Some(event_end_index) = buffer.find("\n\n") {
            let event_text = buffer[..event_end_index].to_string();
            buffer.drain(..event_end_index + 2);
            if let Some(event) = parse_sse_event(&id, &event_text) {
                send_json_message(&sender, &event)?;
            }
        }
    }
    if !buffer.trim().is_empty()
        && let Some(event) = parse_sse_event(&id, &buffer)
    {
        send_json_message(&sender, &event)?;
    }
    send_json_message(
        &sender,
        &OpenCodeProxyComplete {
            id,
            message_type: OpenCodeProxyResponseType::Complete,
        },
    )
}

fn parse_sse_event(id: &Value, event_text: &str) -> Option<OpenCodeProxySseEvent> {
    let mut event_name = None;
    let mut data_lines = Vec::new();
    for line in event_text.lines() {
        if let Some(value) = line.strip_prefix("event:") {
            event_name = Some(value.trim_start().to_string());
        } else if let Some(value) = line.strip_prefix("data:") {
            data_lines.push(value.trim_start().to_string());
        }
    }
    if data_lines.is_empty() {
        return None;
    }
    Some(OpenCodeProxySseEvent {
        id: id.clone(),
        message_type: OpenCodeProxyResponseType::Sse,
        event: event_name,
        data: data_lines.join("\n"),
    })
}

async fn read_response_body(mut body: hyper::body::Incoming) -> Result<String, OpenCodeProxyError> {
    let mut bytes = Vec::new();
    while let Some(frame) = body.frame().await {
        let frame = frame.map_err(|error| OpenCodeProxyError::HttpRequest(error.to_string()))?;
        if let Ok(chunk) = frame.into_data() {
            bytes.extend_from_slice(chunk.as_ref());
        }
    }

    String::from_utf8(bytes).map_err(|error| OpenCodeProxyError::HttpRequest(error.to_string()))
}

fn parse_opencode_proxy_request(
    message: Message,
) -> Result<Option<OpenCodeProxyRequest>, OpenCodeProxyError> {
    match message {
        Message::Text(payload) => {
            let request = serde_json::from_str(payload.as_str())
                .map_err(OpenCodeProxyError::InvalidRequest)?;
            Ok(Some(request))
        }
        Message::Ping(_) | Message::Pong(_) => Ok(None),
        Message::Binary(_) | Message::Frame(_) => Ok(None),
        Message::Close(_) => Ok(None),
    }
}

fn send_json_message<T: Serialize>(
    sender: &mpsc::UnboundedSender<Message>,
    payload: &T,
) -> Result<(), OpenCodeProxyError> {
    let payload = serde_json::to_string(payload)
        .map_err(|error| OpenCodeProxyError::ConfigureRuntime(error.to_string()))?;
    sender.send(Message::Text(payload.into())).map_err(|error| {
        OpenCodeProxyError::WriteSocket(WebSocketError::Io(std::io::Error::new(
            std::io::ErrorKind::BrokenPipe,
            error.to_string(),
        )))
    })
}

fn parse_opencode_proxy_listener_address(url: &Url) -> Result<SocketAddr, OpenCodeProxyError> {
    let Some(host) = url.host_str() else {
        return Err(OpenCodeProxyError::ListenUrlMissingHost {
            url: url.to_string(),
        });
    };
    let Some(port) = url.port() else {
        return Err(OpenCodeProxyError::ListenUrlMissingPort {
            url: url.to_string(),
        });
    };
    format!("{host}:{port}")
        .parse()
        .map_err(|error: std::net::AddrParseError| {
            OpenCodeProxyError::ConfigureRuntime(error.to_string())
        })
}

fn replace_url_port(url: &str, port: u16) -> Result<String, OpenCodeProxyError> {
    let mut parsed_url =
        Url::parse(url).map_err(|error| OpenCodeProxyError::ParseListenUrl(error.to_string()))?;
    parsed_url.set_port(Some(port)).map_err(|_| {
        OpenCodeProxyError::ConfigureRuntime("failed to set listener port".to_string())
    })?;
    Ok(parsed_url.to_string())
}

fn build_opencode_target_uri(raw_server_url: &str, path: &str) -> Result<Uri, OpenCodeProxyError> {
    if !path.starts_with('/') {
        return Err(OpenCodeProxyError::InvalidHttpTarget(path.to_string()));
    }
    let base = Url::parse(raw_server_url)
        .map_err(|error| OpenCodeProxyError::ParseRawUrl(error.to_string()))?;
    let target = base
        .join(path)
        .map_err(|error| OpenCodeProxyError::InvalidHttpTarget(error.to_string()))?;
    target
        .to_string()
        .parse::<Uri>()
        .map_err(|error| OpenCodeProxyError::InvalidHttpTarget(error.to_string()))
}

fn build_opencode_http_client() -> Result<OpenCodeHttpClient, OpenCodeProxyError> {
    let mut http_connector = HttpConnector::new();
    http_connector.enforce_http(false);
    let https_connector = HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|error| OpenCodeProxyError::ConfigureRuntime(error.to_string()))?
        .https_or_http()
        .enable_http1()
        .wrap_connector(http_connector);
    Ok(Client::builder(TokioExecutor::new()).build(https_connector))
}

/// Derives the raw OpenCode server origin from the compiled process health URL.
pub fn derive_opencode_raw_server_url(readiness_url: &str) -> Result<String, OpenCodeProxyError> {
    let mut parsed_url = Url::parse(readiness_url)
        .map_err(|error| OpenCodeProxyError::ParseRawUrl(error.to_string()))?;
    if parsed_url.scheme() != "http" && parsed_url.scheme() != "https" {
        return Err(OpenCodeProxyError::RawUrlMustUseHttp {
            url: readiness_url.to_string(),
        });
    }
    if parsed_url.path() != "/global/health" {
        return Err(OpenCodeProxyError::ConfigureRuntime(format!(
            "OpenCode process readiness URL must target /global/health: {readiness_url}"
        )));
    }
    parsed_url.set_path("");
    parsed_url.set_query(None);
    parsed_url.set_fragment(None);
    Ok(parsed_url.to_string().trim_end_matches('/').to_string())
}
