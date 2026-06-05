//! Bootstrap tunnel connection and writer plumbing for the live session.

use std::collections::{BTreeMap, VecDeque};
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Instant;

use bytes::Bytes;
use futures_util::{Sink, SinkExt, StreamExt};
use http_body_util::{BodyExt, Empty};
use hyper::header::{AUTHORIZATION, CONTENT_LENGTH};
use hyper::{Request, StatusCode};
use hyper_rustls::{HttpsConnector, HttpsConnectorBuilder};
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::TokioExecutor;
use serde::Deserialize;
use serde_json::Value;
use tokio::net::{TcpSocket, TcpStream, lookup_host};
use tokio::sync::mpsc;
use tokio::task::JoinHandle as TokioJoinHandle;
use tokio::time::timeout;
use tokio_tungstenite::client_async_tls_with_config;
use tokio_tungstenite::tungstenite::{Error as WebSocketError, Message, client::IntoClientRequest};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tracing::{field, info, warn};
use url::Url;

use crate::bootstrap_tunnel_diagnostics::record_bootstrap_tunnel_event;
use crate::protocol::session::SessionRuntimeInput;
use crate::protocol::startup::TransparentProxyBypassKind;
use crate::supervision::SupervisedComponent;
use crate::time::{Duration, Sleeper};
use crate::tunnel::telemetry::TelemetryRelayFrame;

use crate::tunnel::session::lifecycle::{
    mark_tunnel_disconnected, update_tunnel_supervision_details,
};
use crate::tunnel::session::state::{TunnelSessionEvent, TunnelSessionRuntime};
use crate::tunnel::session::{
    DEFAULT_BOOTSTRAP_TUNNEL_CONNECT_TIMEOUT, DEFAULT_BOOTSTRAP_TUNNEL_HANDSHAKE_TIMEOUT,
    DEFAULT_BOOTSTRAP_TUNNEL_LOOKUP_TIMEOUT, DEFAULT_TUNNEL_SESSION_POLL_INTERVAL,
    TUNNEL_RECONNECT_BACKOFF_MS, TunnelSessionError,
};

pub(super) type TunnelWebSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;
pub(super) type TunnelExchangeHttpClient = Client<HttpsConnector<HttpConnector>, Empty<Bytes>>;
type TunnelExchangeHttpClientResult = Result<TunnelExchangeHttpClient, TunnelSessionError>;

const GATEWAY_SERVICE_RESTART_CLOSE_CODE: &str = "4001";
const GATEWAY_SERVICE_RESTART_CLOSE_REASON: &str = "service_restart";

struct TunnelExchangeSuccess {
    bootstrap_token: String,
    tunnel_exchange_token: String,
}

enum TunnelExchangeOutcome {
    Success(TunnelExchangeSuccess),
    Retryable(String),
    Terminal(String),
}

pub(in crate::tunnel::session) enum TunnelWriterMessage {
    Text(String),
    Binary(Vec<u8>),
    Pong(Vec<u8>),
    Flush {
        response_sender: std::sync::mpsc::Sender<Result<(), String>>,
    },
    Close,
}

enum BootstrapWriterControlMessage {
    Pong(BootstrapPongControlMessage),
}

struct BootstrapPongControlMessage {
    payload: Vec<u8>,
    ping_received_at: Instant,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TunnelExchangeResponse {
    bootstrap_token: String,
    tunnel_exchange_token: String,
}

pub(super) fn build_tunnel_exchange_http_client() -> TunnelExchangeHttpClientResult {
    let mut http_connector = HttpConnector::new();
    http_connector.enforce_http(false);
    let https_connector = HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|error| TunnelSessionError::ConfigureTunnelSocket(error.to_string()))?
        .https_or_http()
        .enable_http1()
        .wrap_connector(http_connector);
    Ok(Client::builder(TokioExecutor::new()).build(https_connector))
}

pub(in crate::tunnel::session) fn prioritize_ipv4_socket_addresses(
    mut addresses: Vec<SocketAddr>,
) -> Vec<SocketAddr> {
    addresses.sort_by_key(|address| if address.is_ipv4() { 0 } else { 1 });
    addresses
}

pub(super) async fn reconnect_bootstrap_tunnel(
    runtime: &TunnelSessionRuntime,
    tunnel_exchange_client: &TunnelExchangeHttpClient,
    token_exchange_url: &str,
    gateway_ws_url: &str,
    current_tunnel_exchange_token: &mut String,
) -> Result<Option<TunnelWebSocket>, TunnelSessionError> {
    let mut attempt_index = 0_usize;

    loop {
        if runtime.shutdown_requested.load(Ordering::Relaxed) {
            record_bootstrap_tunnel_diagnostic_event(
                "bootstrap_tunnel.reconnect_stopped",
                BTreeMap::from([(
                    "reason".to_string(),
                    Value::String("shutdown_requested".to_string()),
                )]),
            );
            return Ok(None);
        }

        let attempt_number = attempt_index + 1;
        record_bootstrap_tunnel_diagnostic_event(
            "bootstrap_tunnel.reconnect_started",
            BTreeMap::from([(
                "attemptNumber".to_string(),
                Value::from(u64::try_from(attempt_number).unwrap_or(u64::MAX)),
            )]),
        );
        update_tunnel_supervision_details(
            &runtime.supervisor_handle,
            &runtime.gateway_ws_url,
            Some("restart_attempt"),
            Some(attempt_number),
            None,
        );
        runtime
            .supervisor_handle
            .mark_component_starting(SupervisedComponent::TunnelSession);
        match exchange_tunnel_token(
            tunnel_exchange_client,
            token_exchange_url,
            current_tunnel_exchange_token.as_str(),
        )
        .await?
        {
            TunnelExchangeOutcome::Success(exchange) => {
                record_bootstrap_tunnel_diagnostic_event(
                    "bootstrap_tunnel.token_exchange_succeeded",
                    BTreeMap::from([(
                        "attemptNumber".to_string(),
                        Value::from(u64::try_from(attempt_number).unwrap_or(u64::MAX)),
                    )]),
                );
                *current_tunnel_exchange_token = exchange.tunnel_exchange_token;
                let connected_url = resolve_bootstrap_tunnel_url(
                    gateway_ws_url,
                    exchange.bootstrap_token.as_str(),
                )?;
                match connect_bootstrap_websocket(
                    connected_url.as_str(),
                    runtime.transparent_passthrough_socket_mark,
                )
                .await
                {
                    Ok((bootstrap_socket, _)) => {
                        record_bootstrap_tunnel_diagnostic_event(
                            "bootstrap_tunnel.reconnect_succeeded",
                            BTreeMap::from([(
                                "attemptNumber".to_string(),
                                Value::from(u64::try_from(attempt_number).unwrap_or(u64::MAX)),
                            )]),
                        );
                        return Ok(Some(bootstrap_socket));
                    }
                    Err(error) => {
                        record_bootstrap_tunnel_diagnostic_event(
                            "bootstrap_tunnel.reconnect_connect_failed",
                            BTreeMap::from([
                                (
                                    "attemptNumber".to_string(),
                                    Value::from(u64::try_from(attempt_number).unwrap_or(u64::MAX)),
                                ),
                                ("error".to_string(), Value::String(error.to_string())),
                            ]),
                        );
                        update_tunnel_supervision_details(
                            &runtime.supervisor_handle,
                            &runtime.gateway_ws_url,
                            Some("bootstrap_connect_failed"),
                            Some(attempt_number),
                            None,
                        );
                        runtime.supervisor_handle.mark_component_restarting(
                            SupervisedComponent::TunnelSession,
                            error.to_string(),
                        );
                        runtime.supervisor_handle.emit_component_healthcheck_failed(
                            SupervisedComponent::TunnelSession,
                            "bootstrap_connect_failed",
                            error.to_string(),
                            "bootstrap_connection",
                            &[],
                        );
                    }
                }
            }
            TunnelExchangeOutcome::Retryable(error) => {
                record_bootstrap_tunnel_diagnostic_event(
                    "bootstrap_tunnel.token_exchange_failed",
                    BTreeMap::from([
                        (
                            "attemptNumber".to_string(),
                            Value::from(u64::try_from(attempt_number).unwrap_or(u64::MAX)),
                        ),
                        (
                            "outcome".to_string(),
                            Value::String("retryable".to_string()),
                        ),
                        ("error".to_string(), Value::String(error.clone())),
                    ]),
                );
                update_tunnel_supervision_details(
                    &runtime.supervisor_handle,
                    &runtime.gateway_ws_url,
                    Some("token_exchange_failed"),
                    Some(attempt_number),
                    None,
                );
                runtime
                    .supervisor_handle
                    .mark_component_restarting(SupervisedComponent::TunnelSession, error.clone());
                runtime.supervisor_handle.emit_component_healthcheck_failed(
                    SupervisedComponent::TunnelSession,
                    "token_exchange_failed",
                    error,
                    "bootstrap_connection",
                    &[],
                );
            }
            TunnelExchangeOutcome::Terminal(error) => {
                record_bootstrap_tunnel_diagnostic_event(
                    "bootstrap_tunnel.token_exchange_failed",
                    BTreeMap::from([
                        (
                            "attemptNumber".to_string(),
                            Value::from(u64::try_from(attempt_number).unwrap_or(u64::MAX)),
                        ),
                        ("outcome".to_string(), Value::String("terminal".to_string())),
                        ("error".to_string(), Value::String(error.clone())),
                    ]),
                );
                update_tunnel_supervision_details(
                    &runtime.supervisor_handle,
                    &runtime.gateway_ws_url,
                    Some("token_exchange_terminal"),
                    Some(attempt_number),
                    None,
                );
                runtime
                    .supervisor_handle
                    .mark_component_restarting(SupervisedComponent::TunnelSession, error.clone());
                runtime.supervisor_handle.emit_component_healthcheck_failed(
                    SupervisedComponent::TunnelSession,
                    "token_exchange_terminal",
                    error,
                    "bootstrap_connection",
                    &[],
                );
                mark_tunnel_disconnected(runtime);
                return Ok(None);
            }
        }

        mark_tunnel_disconnected(runtime);
        let backoff_ms = reconnect_backoff_ms(attempt_index);
        record_bootstrap_tunnel_diagnostic_event(
            "bootstrap_tunnel.reconnect_scheduled",
            BTreeMap::from([
                (
                    "attemptNumber".to_string(),
                    Value::from(u64::try_from(attempt_number).unwrap_or(u64::MAX)),
                ),
                ("backoffMs".to_string(), Value::from(backoff_ms)),
            ]),
        );
        update_tunnel_supervision_details(
            &runtime.supervisor_handle,
            &runtime.gateway_ws_url,
            Some("retry_after_failure"),
            Some(attempt_number),
            Some(backoff_ms),
        );
        runtime.supervisor_handle.emit_component_restart_scheduled(
            SupervisedComponent::TunnelSession,
            "retry_after_failure",
            backoff_ms,
            &[],
        );
        runtime.sleeper.sleep(Duration::from_millis(backoff_ms));
        attempt_index = attempt_index.saturating_add(1);
    }
}

fn reconnect_backoff_ms(attempt_index: usize) -> u64 {
    *TUNNEL_RECONNECT_BACKOFF_MS
        .get(attempt_index)
        .unwrap_or_else(|| {
            TUNNEL_RECONNECT_BACKOFF_MS
                .last()
                .expect("backoff list should not be empty")
        })
}

async fn exchange_tunnel_token(
    tunnel_exchange_client: &TunnelExchangeHttpClient,
    token_exchange_url: &str,
    tunnel_exchange_token: &str,
) -> Result<TunnelExchangeOutcome, TunnelSessionError> {
    let normalized_token = tunnel_exchange_token.trim();
    if normalized_token.is_empty() {
        return Ok(TunnelExchangeOutcome::Retryable(
            "sandbox tunnel exchange token is required".to_string(),
        ));
    }

    let request = Request::post(token_exchange_url)
        .header(AUTHORIZATION, format!("Bearer {normalized_token}"))
        .header(CONTENT_LENGTH, "0")
        .body(Empty::new())
        .map_err(|error| TunnelSessionError::ConfigureTunnelSocket(error.to_string()))?;

    let response = match tunnel_exchange_client.request(request).await {
        Ok(response) => response,
        Err(error) => {
            return Ok(TunnelExchangeOutcome::Retryable(error.to_string()));
        }
    };
    let status = response.status();
    let response_body = response
        .into_body()
        .collect()
        .await
        .map_err(|error| error.to_string());

    let response_body = match response_body {
        Ok(response_body) => response_body.to_bytes(),
        Err(error) => {
            return Ok(TunnelExchangeOutcome::Retryable(error));
        }
    };

    match status {
        StatusCode::OK => {
            let parsed_response: TunnelExchangeResponse =
                match serde_json::from_slice(&response_body) {
                    Ok(response) => response,
                    Err(error) => {
                        return Ok(TunnelExchangeOutcome::Retryable(error.to_string()));
                    }
                };
            if parsed_response.bootstrap_token.trim().is_empty()
                || parsed_response.tunnel_exchange_token.trim().is_empty()
            {
                return Ok(TunnelExchangeOutcome::Retryable(
                    "tunnel exchange response must include non-empty bootstrapToken and tunnelExchangeToken"
                        .to_string(),
                ));
            }
            Ok(TunnelExchangeOutcome::Success(TunnelExchangeSuccess {
                bootstrap_token: parsed_response.bootstrap_token,
                tunnel_exchange_token: parsed_response.tunnel_exchange_token,
            }))
        }
        StatusCode::UNAUTHORIZED | StatusCode::NOT_FOUND | StatusCode::CONFLICT => {
            Ok(TunnelExchangeOutcome::Terminal(
                read_tunnel_exchange_error_message(status, &response_body),
            ))
        }
        StatusCode::TOO_MANY_REQUESTS => Ok(TunnelExchangeOutcome::Retryable(
            read_tunnel_exchange_error_message(status, &response_body),
        )),
        status if status.is_server_error() => Ok(TunnelExchangeOutcome::Retryable(
            read_tunnel_exchange_error_message(status, &response_body),
        )),
        _ => Ok(TunnelExchangeOutcome::Retryable(
            read_tunnel_exchange_error_message(status, &response_body),
        )),
    }
}

fn read_tunnel_exchange_error_message(status: StatusCode, response_body: &[u8]) -> String {
    match serde_json::from_slice::<Value>(response_body) {
        Ok(Value::Object(fields)) => fields
            .get("error")
            .and_then(Value::as_str)
            .map(std::string::ToString::to_string)
            .unwrap_or_else(|| {
                format!(
                    "token exchange returned unexpected status {}",
                    status.as_u16()
                )
            }),
        Ok(other) => format!(
            "token exchange returned status {} with unexpected JSON body: {other}",
            status.as_u16()
        ),
        Err(_) if response_body.is_empty() => {
            format!(
                "token exchange returned status {} with an empty body",
                status.as_u16()
            )
        }
        Err(_) => format!(
            "token exchange returned status {} with a non-JSON body",
            status.as_u16()
        ),
    }
}

pub(super) async fn connect_bootstrap_websocket(
    connected_url: &str,
    transparent_passthrough_socket_mark: Option<u32>,
) -> Result<
    (
        TunnelWebSocket,
        tokio_tungstenite::tungstenite::handshake::client::Response,
    ),
    TunnelSessionError,
> {
    let request = connected_url
        .into_client_request()
        .map_err(|error| TunnelSessionError::ConfigureTunnelSocket(error.to_string()))?;
    let uri = request.uri().clone();
    let host = uri
        .host()
        .ok_or_else(|| {
            TunnelSessionError::ConfigureTunnelSocket(format!(
                "bootstrap websocket URL is missing a host: {connected_url}"
            ))
        })?
        .to_string();
    let port = uri.port_u16().unwrap_or_else(|| match uri.scheme_str() {
        Some("wss") => 443,
        Some("ws") => 80,
        _ => 0,
    });
    if port == 0 {
        return Err(TunnelSessionError::ConfigureTunnelSocket(format!(
            "bootstrap websocket URL must use ws or wss scheme: {connected_url}"
        )));
    }
    let scheme = uri.scheme_str().unwrap_or("");

    record_bootstrap_tunnel_diagnostic_event(
        "bootstrap_tunnel.connect_started",
        BTreeMap::from([
            ("host".to_string(), Value::String(host.clone())),
            ("port".to_string(), Value::from(u64::from(port))),
            ("scheme".to_string(), Value::String(scheme.to_string())),
        ]),
    );

    let resolved_addresses = prioritize_ipv4_socket_addresses(
        timeout(
            DEFAULT_BOOTSTRAP_TUNNEL_LOOKUP_TIMEOUT,
            lookup_host((host.as_str(), port)),
        )
        .await
        .map_err(|_| {
            TunnelSessionError::ConfigureTunnelSocket(format!(
                "bootstrap websocket host lookup timed out after {}ms: {host}:{port}",
                DEFAULT_BOOTSTRAP_TUNNEL_LOOKUP_TIMEOUT.as_millis()
            ))
        })?
        .map_err(|error| TunnelSessionError::ConfigureTunnelSocket(error.to_string()))?
        .collect::<Vec<_>>(),
    );
    if resolved_addresses.is_empty() {
        record_bootstrap_tunnel_diagnostic_event(
            "bootstrap_tunnel.connect_failed",
            BTreeMap::from([
                ("host".to_string(), Value::String(host.clone())),
                ("port".to_string(), Value::from(u64::from(port))),
                (
                    "error".to_string(),
                    Value::String(
                        "bootstrap websocket host lookup returned no addresses".to_string(),
                    ),
                ),
            ]),
        );
        return Err(TunnelSessionError::ConfigureTunnelSocket(format!(
            "bootstrap websocket host lookup returned no addresses: {host}:{port}"
        )));
    }

    let mut attempted_connect_errors = Vec::new();
    for address in resolved_addresses {
        let socket = match timeout(
            DEFAULT_BOOTSTRAP_TUNNEL_CONNECT_TIMEOUT,
            connect_bootstrap_tcp_socket(address, transparent_passthrough_socket_mark),
        )
        .await
        {
            Ok(Ok(socket)) => socket,
            Ok(Err(error)) => {
                record_bootstrap_tunnel_diagnostic_event(
                    "bootstrap_tunnel.connect_tcp_failed",
                    BTreeMap::from([
                        ("address".to_string(), Value::String(address.to_string())),
                        ("error".to_string(), Value::String(error.to_string())),
                    ]),
                );
                attempted_connect_errors.push(format!("{address}: {error}"));
                continue;
            }
            Err(_) => {
                record_bootstrap_tunnel_diagnostic_event(
                    "bootstrap_tunnel.connect_tcp_failed",
                    BTreeMap::from([
                        ("address".to_string(), Value::String(address.to_string())),
                        (
                            "error".to_string(),
                            Value::String(format!(
                                "tcp connect timed out after {}ms",
                                DEFAULT_BOOTSTRAP_TUNNEL_CONNECT_TIMEOUT.as_millis()
                            )),
                        ),
                    ]),
                );
                attempted_connect_errors.push(format!(
                    "{address}: tcp connect timed out after {}ms",
                    DEFAULT_BOOTSTRAP_TUNNEL_CONNECT_TIMEOUT.as_millis()
                ));
                continue;
            }
        };

        match timeout(
            DEFAULT_BOOTSTRAP_TUNNEL_HANDSHAKE_TIMEOUT,
            client_async_tls_with_config(request.clone(), socket, None, None),
        )
        .await
        {
            Ok(Ok(result)) => {
                record_bootstrap_tunnel_diagnostic_event(
                    "bootstrap_tunnel.connect_succeeded",
                    BTreeMap::from([
                        ("address".to_string(), Value::String(address.to_string())),
                        ("host".to_string(), Value::String(host.clone())),
                        ("port".to_string(), Value::from(u64::from(port))),
                    ]),
                );
                return Ok(result);
            }
            Ok(Err(error)) => {
                record_bootstrap_tunnel_diagnostic_event(
                    "bootstrap_tunnel.connect_handshake_failed",
                    BTreeMap::from([
                        ("address".to_string(), Value::String(address.to_string())),
                        ("error".to_string(), Value::String(error.to_string())),
                    ]),
                );
                attempted_connect_errors.push(format!("{address}: {error}"));
            }
            Err(_) => {
                record_bootstrap_tunnel_diagnostic_event(
                    "bootstrap_tunnel.connect_handshake_failed",
                    BTreeMap::from([
                        ("address".to_string(), Value::String(address.to_string())),
                        (
                            "error".to_string(),
                            Value::String(format!(
                                "websocket handshake timed out after {}ms",
                                DEFAULT_BOOTSTRAP_TUNNEL_HANDSHAKE_TIMEOUT.as_millis()
                            )),
                        ),
                    ]),
                );
                attempted_connect_errors.push(format!(
                    "{address}: websocket handshake timed out after {}ms",
                    DEFAULT_BOOTSTRAP_TUNNEL_HANDSHAKE_TIMEOUT.as_millis()
                ));
            }
        }
    }

    let error_message = if attempted_connect_errors.is_empty() {
        "bootstrap websocket connect failed".to_string()
    } else {
        format!(
            "bootstrap websocket failed to connect to any resolved address for {host}:{port}; attempts: {}",
            attempted_connect_errors.join("; ")
        )
    };
    record_bootstrap_tunnel_diagnostic_event(
        "bootstrap_tunnel.connect_failed",
        BTreeMap::from([
            ("host".to_string(), Value::String(host)),
            ("port".to_string(), Value::from(u64::from(port))),
            ("error".to_string(), Value::String(error_message.clone())),
        ]),
    );

    Err(TunnelSessionError::ConfigureTunnelSocket(error_message))
}

async fn connect_bootstrap_tcp_socket(
    address: SocketAddr,
    transparent_passthrough_socket_mark: Option<u32>,
) -> Result<TcpStream, std::io::Error> {
    let socket = match address {
        SocketAddr::V4(_) => TcpSocket::new_v4()?,
        SocketAddr::V6(_) => TcpSocket::new_v6()?,
    };
    if let Some(mark) = transparent_passthrough_socket_mark {
        configure_bootstrap_transparent_passthrough_socket(&socket, mark)?;
    }

    socket.connect(address).await
}

#[cfg(target_os = "linux")]
fn configure_bootstrap_transparent_passthrough_socket(
    socket: &TcpSocket,
    mark: u32,
) -> Result<(), std::io::Error> {
    nix::sys::socket::setsockopt(socket, nix::sys::socket::sockopt::Mark, &mark)
        .map_err(std::io::Error::other)
}

#[cfg(not(target_os = "linux"))]
fn configure_bootstrap_transparent_passthrough_socket(
    _socket: &TcpSocket,
    _mark: u32,
) -> Result<(), std::io::Error> {
    Ok(())
}

pub(super) fn startup_transparent_passthrough_socket_mark(
    session_input: &SessionRuntimeInput,
) -> Option<u32> {
    let transparent_proxy = session_input.transparent_proxy.as_ref()?;
    match transparent_proxy.passthrough_bypass.kind {
        TransparentProxyBypassKind::SocketMark => Some(transparent_proxy.passthrough_bypass.mark),
    }
}

pub(super) fn spawn_bootstrap_socket_task(
    socket: TunnelWebSocket,
    receiver: mpsc::UnboundedReceiver<TunnelWriterMessage>,
    event_sender: mpsc::UnboundedSender<TunnelSessionEvent>,
) -> TokioJoinHandle<Result<(), TunnelSessionError>> {
    tokio::spawn(async move {
        let (writer, mut reader) = socket.split();
        let (control_sender, control_receiver) = mpsc::unbounded_channel();
        let writer_event_sender = event_sender.clone();
        let mut writer_task = tokio::spawn(async move {
            run_bootstrap_writer(writer, receiver, control_receiver, writer_event_sender).await
        });

        loop {
            tokio::select! {
                writer_result = &mut writer_task => {
                    match writer_result {
                        Ok(result) => {
                            match &result {
                                Ok(()) => info!(
                                    event = "bootstrap_tunnel.writer_task_completed",
                                    close_source = "writer_task",
                                    outcome = "completed",
                                ),
                                Err(error) => warn!(
                                    event = "bootstrap_tunnel.writer_task_completed",
                                    close_source = "writer_task",
                                    outcome = "error",
                                    error = %error,
                                ),
                            }
                            return result;
                        }
                        Err(error) => {
                            warn!(
                                event = "bootstrap_tunnel.writer_task_join_failed",
                                close_source = "writer_task",
                                outcome = "join_error",
                                error = %error,
                            );
                            return Err(TunnelSessionError::WriteTunnelText(error.to_string()));
                        }
                    }
                }
                inbound = reader.next() => {
                    match inbound {
                        Some(Ok(Message::Close(frame))) => {
                            let close_code = frame.as_ref().map(|frame| frame.code.to_string());
                            let close_reason = frame.as_ref().map(|frame| frame.reason.to_string());
                            let mut attributes = BTreeMap::new();
                            attributes.insert("closeSource".to_string(), Value::String("reader".to_string()));
                            attributes.insert("closeKind".to_string(), Value::String("close_frame".to_string()));
                            if let Some(close_code) = close_code.as_ref() {
                                attributes.insert("closeCode".to_string(), Value::String(close_code.clone()));
                            }
                            if let Some(close_reason) = close_reason.as_ref() {
                                attributes.insert("closeReason".to_string(), Value::String(close_reason.clone()));
                            }
                            record_bootstrap_tunnel_diagnostic_event(
                                "bootstrap_tunnel.reader_closed",
                                attributes,
                            );
                            let is_gateway_service_restart = is_gateway_service_restart_close_frame(
                                close_code.as_deref(),
                                close_reason.as_deref(),
                            );
                            info!(
                                event = "bootstrap_tunnel.reader_closed",
                                close_source = "reader",
                                close_kind = "close_frame",
                                close_code = field::display(close_code.as_deref().unwrap_or("")),
                                close_reason = field::display(close_reason.as_deref().unwrap_or("")),
                            );
                            let reason = bootstrap_close_frame_disconnect_reason(close_code, close_reason);
                            let _ = event_sender.send(TunnelSessionEvent::BootstrapClosed {
                                is_gateway_service_restart,
                                reason,
                            });
                            writer_task.abort();
                            return Ok(());
                        }
                        Some(Err(WebSocketError::ConnectionClosed)) => {
                            record_bootstrap_tunnel_diagnostic_event(
                                "bootstrap_tunnel.reader_closed",
                                BTreeMap::from([
                                    ("closeSource".to_string(), Value::String("reader".to_string())),
                                    (
                                        "closeKind".to_string(),
                                        Value::String("connection_closed".to_string()),
                                    ),
                                ]),
                            );
                            info!(
                                event = "bootstrap_tunnel.reader_closed",
                                close_source = "reader",
                                close_kind = "connection_closed",
                            );
                            let _ = event_sender.send(TunnelSessionEvent::BootstrapClosed {
                                is_gateway_service_restart: false,
                                reason: Some("bootstrap websocket reported connection closed".to_string()),
                            });
                            writer_task.abort();
                            return Ok(());
                        }
                        None => {
                            record_bootstrap_tunnel_diagnostic_event(
                                "bootstrap_tunnel.reader_closed",
                                BTreeMap::from([
                                    ("closeSource".to_string(), Value::String("reader".to_string())),
                                    ("closeKind".to_string(), Value::String("stream_ended".to_string())),
                                ]),
                            );
                            info!(
                                event = "bootstrap_tunnel.reader_closed",
                                close_source = "reader",
                                close_kind = "stream_ended",
                            );
                            let _ = event_sender.send(TunnelSessionEvent::BootstrapClosed {
                                is_gateway_service_restart: false,
                                reason: Some("bootstrap websocket stream ended".to_string()),
                            });
                            writer_task.abort();
                            return Ok(());
                        }
                        Some(Ok(Message::Ping(payload))) => {
                            let payload_len = payload.len();
                            let ping_received_at = Instant::now();
                            let ping_attributes = bootstrap_ping_payload_attributes(&payload);
                            record_bootstrap_tunnel_diagnostic_event(
                                "bootstrap_tunnel.ping_received",
                                ping_attributes.clone(),
                            );
                            info!(
                                event = "bootstrap_tunnel.ping_received",
                                payload_len,
                            );
                            control_sender
                                .send(BootstrapWriterControlMessage::Pong(
                                    BootstrapPongControlMessage {
                                        payload: payload.to_vec(),
                                        ping_received_at,
                                    },
                                ))
                                .map_err(|_| {
                                    record_bootstrap_tunnel_diagnostic_event(
                                        "bootstrap_tunnel.pong_queue_failed",
                                        ping_attributes.clone(),
                                    );
                                    warn!(
                                        event = "bootstrap_tunnel.pong_queue_failed",
                                        payload_len,
                                    );
                                    TunnelSessionError::WriteTunnelText(
                                        "bootstrap tunnel writer is closed".to_string(),
                                    )
                                })?;
                            record_bootstrap_tunnel_diagnostic_event(
                                "bootstrap_tunnel.pong_queued",
                                ping_attributes,
                            );
                            info!(
                                event = "bootstrap_tunnel.pong_queued",
                                payload_len,
                            );
                        }
                        Some(Ok(message)) => {
                            let _ = event_sender.send(TunnelSessionEvent::BootstrapMessage(message));
                        }
                        Some(Err(error)) => {
                            record_bootstrap_tunnel_diagnostic_event(
                                "bootstrap_tunnel.reader_closed",
                                BTreeMap::from([
                                    ("closeSource".to_string(), Value::String("reader".to_string())),
                                    ("closeKind".to_string(), Value::String("read_error".to_string())),
                                    ("error".to_string(), Value::String(error.to_string())),
                                ]),
                            );
                            warn!(
                                event = "bootstrap_tunnel.reader_closed",
                                close_source = "reader",
                                close_kind = "read_error",
                                error = %error,
                            );
                            let _ = event_sender.send(TunnelSessionEvent::BootstrapClosed {
                                is_gateway_service_restart: false,
                                reason: Some(error.to_string()),
                            });
                            writer_task.abort();
                            return Ok(());
                        }
                    }
                }
            }
        }
    })
}

fn bootstrap_close_frame_disconnect_reason(
    close_code: Option<String>,
    close_reason: Option<String>,
) -> Option<String> {
    if is_gateway_service_restart_close_frame(close_code.as_deref(), close_reason.as_deref()) {
        return Some(GATEWAY_SERVICE_RESTART_CLOSE_REASON.to_string());
    }

    close_reason
        .filter(|reason| !reason.is_empty())
        .or_else(|| close_code.map(|code| format!("bootstrap tunnel close frame code {code}")))
}

fn is_gateway_service_restart_close_frame(
    close_code: Option<&str>,
    close_reason: Option<&str>,
) -> bool {
    close_code == Some(GATEWAY_SERVICE_RESTART_CLOSE_CODE)
        && close_reason == Some(GATEWAY_SERVICE_RESTART_CLOSE_REASON)
}

pub(in crate::tunnel::session) fn record_bootstrap_tunnel_diagnostic_event(
    event: &str,
    attributes: BTreeMap<String, Value>,
) {
    if let Err(error) = record_bootstrap_tunnel_event(event, attributes) {
        warn!(
            event = "bootstrap_tunnel.diagnostic_record_failed",
            diagnostic_event = event,
            error = %error,
        );
    }
}

fn bootstrap_ping_payload_attributes(payload: &[u8]) -> BTreeMap<String, Value> {
    let mut attributes = BTreeMap::from([("payloadLen".to_string(), usize_value(payload.len()))]);
    if let Ok(parsed) = serde_json::from_slice::<Value>(payload)
        && parsed
            .get("type")
            .and_then(Value::as_str)
            .is_some_and(|message_type| message_type == "mistle.tunnel.health_ping")
    {
        if let Some(ping_seq) = parsed.get("pingSeq").and_then(Value::as_u64) {
            attributes.insert("pingSeq".to_string(), Value::from(ping_seq));
        }
        if let Some(sent_at_ms) = parsed.get("sentAtMs").and_then(Value::as_u64) {
            attributes.insert("gatewaySentAtMs".to_string(), Value::from(sent_at_ms));
        }
    }
    attributes
}

fn bootstrap_pong_diagnostic_attributes(
    payload: &[u8],
    queue_delay_ms: Option<u64>,
    write_duration_ms: Option<u64>,
) -> BTreeMap<String, Value> {
    let mut attributes = bootstrap_payload_diagnostic_attributes(
        payload.len(),
        serde_json::from_slice(payload).ok(),
    );
    if let Some(queue_delay_ms) = queue_delay_ms {
        attributes.insert("queueDelayMs".to_string(), Value::from(queue_delay_ms));
    }
    if let Some(write_duration_ms) = write_duration_ms {
        attributes.insert(
            "writeDurationMs".to_string(),
            Value::from(write_duration_ms),
        );
    }
    attributes
}

fn bootstrap_pong_diagnostic_attributes_from_parts(
    payload_len: usize,
    parsed_payload: Option<Value>,
    ping_received_at: Option<Instant>,
    write_started_at: Instant,
) -> BTreeMap<String, Value> {
    let mut attributes = bootstrap_payload_diagnostic_attributes(payload_len, parsed_payload);
    if let Some(ping_received_at) = ping_received_at {
        attributes.insert(
            "queueDelayMs".to_string(),
            Value::from(
                u64::try_from(
                    write_started_at
                        .duration_since(ping_received_at)
                        .as_millis(),
                )
                .unwrap_or(u64::MAX),
            ),
        );
    }
    attributes.insert(
        "writeDurationMs".to_string(),
        Value::from(u64::try_from(write_started_at.elapsed().as_millis()).unwrap_or(u64::MAX)),
    );
    attributes
}

fn bootstrap_payload_diagnostic_attributes(
    payload_len: usize,
    parsed_payload: Option<Value>,
) -> BTreeMap<String, Value> {
    let mut attributes = BTreeMap::from([("payloadLen".to_string(), usize_value(payload_len))]);
    if let Some(parsed) = parsed_payload
        && parsed
            .get("type")
            .and_then(Value::as_str)
            .is_some_and(|message_type| message_type == "mistle.tunnel.health_ping")
    {
        if let Some(ping_seq) = parsed.get("pingSeq").and_then(Value::as_u64) {
            attributes.insert("pingSeq".to_string(), Value::from(ping_seq));
        }
        if let Some(sent_at_ms) = parsed.get("sentAtMs").and_then(Value::as_u64) {
            attributes.insert("gatewaySentAtMs".to_string(), Value::from(sent_at_ms));
        }
    }
    attributes
}

fn with_pending_outbound_len(
    mut attributes: BTreeMap<String, Value>,
    pending_outbound_len: usize,
) -> BTreeMap<String, Value> {
    attributes.insert(
        "pendingOutboundLen".to_string(),
        usize_value(pending_outbound_len),
    );
    attributes
}

fn usize_value(value: usize) -> Value {
    match u64::try_from(value) {
        Ok(value) => Value::from(value),
        Err(_) => Value::String(value.to_string()),
    }
}

async fn run_bootstrap_writer<W>(
    mut writer: W,
    mut receiver: mpsc::UnboundedReceiver<TunnelWriterMessage>,
    mut control_receiver: mpsc::UnboundedReceiver<BootstrapWriterControlMessage>,
    event_sender: mpsc::UnboundedSender<TunnelSessionEvent>,
) -> Result<(), TunnelSessionError>
where
    W: Sink<Message, Error = WebSocketError> + Unpin,
{
    let notify_bootstrap_closed = |reason: Option<String>| {
        let mut attributes = BTreeMap::new();
        attributes.insert(
            "closeSource".to_string(),
            Value::String("writer".to_string()),
        );
        if let Some(reason) = reason.as_ref() {
            attributes.insert("reason".to_string(), Value::String(reason.clone()));
        }
        record_bootstrap_tunnel_diagnostic_event(
            "bootstrap_tunnel.writer_observed_closed",
            attributes,
        );
        info!(
            event = "bootstrap_tunnel.writer_observed_closed",
            close_source = "writer",
            reason = field::display(reason.as_deref().unwrap_or("")),
        );
        let _ = event_sender.send(TunnelSessionEvent::BootstrapClosed {
            is_gateway_service_restart: false,
            reason,
        });
    };
    let mut pending_outbound = VecDeque::new();

    loop {
        while let Ok(control) = control_receiver.try_recv() {
            write_bootstrap_control_message(
                &mut writer,
                control,
                pending_outbound.len(),
                &notify_bootstrap_closed,
            )
            .await?;
        }
        while let Ok(message) = receiver.try_recv() {
            match message {
                TunnelWriterMessage::Pong(payload) => {
                    write_bootstrap_pong(&mut writer, payload, None, &notify_bootstrap_closed)
                        .await?;
                }
                TunnelWriterMessage::Close => {
                    write_bootstrap_close(&mut writer, &notify_bootstrap_closed).await?;
                    return Ok(());
                }
                TunnelWriterMessage::Text(_)
                | TunnelWriterMessage::Binary(_)
                | TunnelWriterMessage::Flush { .. } => pending_outbound.push_back(message),
            }
        }
        if let Some(message) = pending_outbound.pop_front() {
            if write_bootstrap_message(&mut writer, message, &notify_bootstrap_closed).await? {
                return Ok(());
            }
            continue;
        }

        tokio::select! {
            biased;
            control = control_receiver.recv() => {
                if let Some(control) = control {
                    write_bootstrap_control_message(
                        &mut writer,
                        control,
                        pending_outbound.len(),
                        &notify_bootstrap_closed,
                    )
                    .await?;
                }
            }
            outbound = receiver.recv() => {
                let Some(message) = outbound else {
                    notify_bootstrap_closed(Some("bootstrap tunnel writer channel closed".to_string()));
                    return Ok(());
                };

                if write_bootstrap_message(&mut writer, message, &notify_bootstrap_closed).await? {
                    return Ok(());
                }
            }
        }
    }
}

async fn write_bootstrap_control_message<W>(
    writer: &mut W,
    message: BootstrapWriterControlMessage,
    pending_outbound_len: usize,
    notify_bootstrap_closed: &impl Fn(Option<String>),
) -> Result<(), TunnelSessionError>
where
    W: Sink<Message, Error = WebSocketError> + Unpin,
{
    match message {
        BootstrapWriterControlMessage::Pong(payload) => {
            let queue_delay_ms =
                u64::try_from(payload.ping_received_at.elapsed().as_millis()).unwrap_or(u64::MAX);
            let diagnostic_attributes = with_pending_outbound_len(
                bootstrap_pong_diagnostic_attributes(&payload.payload, Some(queue_delay_ms), None),
                pending_outbound_len,
            );
            record_bootstrap_tunnel_diagnostic_event(
                "bootstrap_tunnel.pong_write_started",
                diagnostic_attributes,
            );
            info!(
                event = "bootstrap_tunnel.pong_write_started",
                payload_len = payload.payload.len(),
                pending_outbound_len,
            );
            write_bootstrap_pong(
                writer,
                payload.payload,
                Some(payload.ping_received_at),
                notify_bootstrap_closed,
            )
            .await
        }
    }
}

async fn write_bootstrap_message<W>(
    writer: &mut W,
    message: TunnelWriterMessage,
    notify_bootstrap_closed: &impl Fn(Option<String>),
) -> Result<bool, TunnelSessionError>
where
    W: Sink<Message, Error = WebSocketError> + Unpin,
{
    match message {
        TunnelWriterMessage::Text(payload) => {
            if let Err(error) = writer.send(Message::Text(payload.into())).await {
                notify_bootstrap_closed(Some(format!(
                    "failed to write bootstrap tunnel text frame: {error}"
                )));
                return Err(TunnelSessionError::WriteTunnelText(error.to_string()));
            }
            Ok(false)
        }
        TunnelWriterMessage::Binary(payload) => {
            if let Err(error) = writer.send(Message::Binary(payload.into())).await {
                notify_bootstrap_closed(Some(format!(
                    "failed to write bootstrap tunnel binary frame: {error}"
                )));
                return Err(TunnelSessionError::WriteTunnelBinary(error.to_string()));
            }
            Ok(false)
        }
        TunnelWriterMessage::Pong(payload) => {
            write_bootstrap_pong(writer, payload, None, notify_bootstrap_closed).await?;
            Ok(false)
        }
        TunnelWriterMessage::Flush { response_sender } => {
            let _ = response_sender.send(Ok(()));
            Ok(false)
        }
        TunnelWriterMessage::Close => {
            write_bootstrap_close(writer, notify_bootstrap_closed).await?;
            Ok(true)
        }
    }
}

async fn write_bootstrap_pong<W>(
    writer: &mut W,
    payload: Vec<u8>,
    ping_received_at: Option<Instant>,
    notify_bootstrap_closed: &impl Fn(Option<String>),
) -> Result<(), TunnelSessionError>
where
    W: Sink<Message, Error = WebSocketError> + Unpin,
{
    let payload_len = payload.len();
    let parsed_payload = serde_json::from_slice::<Value>(&payload).ok();
    let write_started_at = Instant::now();
    if let Err(error) = writer.send(Message::Pong(payload.into())).await {
        let mut attributes = bootstrap_pong_diagnostic_attributes_from_parts(
            payload_len,
            parsed_payload.clone(),
            ping_received_at,
            write_started_at,
        );
        attributes.insert("error".to_string(), Value::String(error.to_string()));
        record_bootstrap_tunnel_diagnostic_event("bootstrap_tunnel.pong_write_failed", attributes);
        warn!(
            event = "bootstrap_tunnel.pong_write_failed",
            payload_len,
            error = %error,
        );
        notify_bootstrap_closed(Some(format!(
            "failed to write bootstrap tunnel pong frame: {error}"
        )));
        return Err(TunnelSessionError::WriteTunnelText(error.to_string()));
    }
    record_bootstrap_tunnel_diagnostic_event(
        "bootstrap_tunnel.pong_write_completed",
        bootstrap_pong_diagnostic_attributes_from_parts(
            payload_len,
            parsed_payload,
            ping_received_at,
            write_started_at,
        ),
    );
    info!(event = "bootstrap_tunnel.pong_write_completed", payload_len,);
    Ok(())
}

async fn write_bootstrap_close<W>(
    writer: &mut W,
    notify_bootstrap_closed: &impl Fn(Option<String>),
) -> Result<(), TunnelSessionError>
where
    W: Sink<Message, Error = WebSocketError> + Unpin,
{
    if let Err(error) = writer.send(Message::Close(None)).await {
        notify_bootstrap_closed(Some(format!(
            "failed to write bootstrap tunnel close frame: {error}"
        )));
        return Err(TunnelSessionError::WriteTunnelText(error.to_string()));
    }
    notify_bootstrap_closed(None);
    Ok(())
}

pub(super) fn spawn_tunnel_wake_thread(
    shutdown_requested: Arc<AtomicBool>,
    sleeper: Arc<dyn Sleeper>,
    event_sender: mpsc::UnboundedSender<TunnelSessionEvent>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        loop {
            if shutdown_requested.load(Ordering::Relaxed) {
                let _ = event_sender.send(TunnelSessionEvent::Wake);
                return;
            }

            sleeper.sleep(DEFAULT_TUNNEL_SESSION_POLL_INTERVAL);
            if event_sender.send(TunnelSessionEvent::Wake).is_err() {
                return;
            }
        }
    })
}

pub(super) fn resolve_bootstrap_tunnel_url(
    gateway_ws_url: &str,
    bootstrap_token: &str,
) -> Result<String, TunnelSessionError> {
    let normalized_token = bootstrap_token.trim();
    if normalized_token.is_empty() {
        return Err(TunnelSessionError::InvalidGatewayUrl(
            "sandbox tunnel bootstrap token is required".to_string(),
        ));
    }

    let mut parsed_url = Url::parse(gateway_ws_url)
        .map_err(|error| TunnelSessionError::InvalidGatewayUrl(error.to_string()))?;
    match parsed_url.scheme() {
        "ws" | "wss" => {}
        _ => {
            return Err(TunnelSessionError::InvalidGatewayUrl(
                "sandbox tunnel gateway ws url must use ws or wss scheme".to_string(),
            ));
        }
    }

    parsed_url
        .query_pairs_mut()
        .append_pair("bootstrap_token", normalized_token);
    Ok(parsed_url.to_string())
}

pub(super) fn resolve_tunnel_exchange_url(
    gateway_ws_url: &str,
) -> Result<String, TunnelSessionError> {
    let mut parsed_url = Url::parse(gateway_ws_url)
        .map_err(|error| TunnelSessionError::InvalidGatewayUrl(error.to_string()))?;
    match parsed_url.scheme() {
        "ws" => parsed_url
            .set_scheme("http")
            .expect("ws -> http scheme rewrite should succeed"),
        "wss" => parsed_url
            .set_scheme("https")
            .expect("wss -> https scheme rewrite should succeed"),
        _ => {
            return Err(TunnelSessionError::InvalidGatewayUrl(
                "sandbox tunnel gateway ws url must use ws or wss scheme".to_string(),
            ));
        }
    }
    let mut path = parsed_url.path().trim_end_matches('/').to_string();
    path.push_str("/token-exchange");
    parsed_url.set_path(&path);
    Ok(parsed_url.to_string())
}

pub(in crate::tunnel::session) fn send_telemetry_frames(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    frames: Vec<TelemetryRelayFrame>,
) -> Result<(), TunnelSessionError> {
    for frame in frames {
        match frame {
            TelemetryRelayFrame::Text(payload) => write_tunnel_text(tunnel_writer_sender, payload)?,
            TelemetryRelayFrame::Binary(payload) => {
                write_tunnel_binary(tunnel_writer_sender, payload)?
            }
        }
    }

    Ok(())
}

pub(in crate::tunnel::session) fn write_tunnel_text(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    payload: String,
) -> Result<(), TunnelSessionError> {
    tunnel_writer_sender
        .send(TunnelWriterMessage::Text(payload))
        .map_err(|_| {
            TunnelSessionError::WriteTunnelText("bootstrap tunnel writer is closed".to_string())
        })
}

pub(in crate::tunnel::session) fn write_tunnel_binary(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    payload: Vec<u8>,
) -> Result<(), TunnelSessionError> {
    tunnel_writer_sender
        .send(TunnelWriterMessage::Binary(payload))
        .map_err(|_| {
            TunnelSessionError::WriteTunnelBinary("bootstrap tunnel writer is closed".to_string())
        })
}

pub(in crate::tunnel::session) fn write_tunnel_pong(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    payload: Vec<u8>,
) -> Result<(), TunnelSessionError> {
    tunnel_writer_sender
        .send(TunnelWriterMessage::Pong(payload))
        .map_err(|_| {
            TunnelSessionError::WriteTunnelText("bootstrap tunnel writer is closed".to_string())
        })
}

pub(in crate::tunnel::session) fn write_tunnel_flush(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    response_sender: std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), TunnelSessionError> {
    match tunnel_writer_sender.send(TunnelWriterMessage::Flush { response_sender }) {
        Ok(()) => Ok(()),
        Err(error) => {
            let error_message = "bootstrap tunnel writer is closed".to_string();
            match error.0 {
                TunnelWriterMessage::Flush { response_sender } => {
                    let _ = response_sender.send(Err(error_message.clone()));
                }
                TunnelWriterMessage::Text(_)
                | TunnelWriterMessage::Binary(_)
                | TunnelWriterMessage::Pong(_)
                | TunnelWriterMessage::Close => {}
            }
            Err(TunnelSessionError::WriteTunnelText(error_message))
        }
    }
}

pub(in crate::tunnel::session) fn write_tunnel_close(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
) -> Result<(), TunnelSessionError> {
    let _ = tunnel_writer_sender.send(TunnelWriterMessage::Close);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use futures_util::StreamExt;
    use serde_json::json;
    use tokio_tungstenite::WebSocketStream;
    use tokio_tungstenite::tungstenite::{Message, protocol::Role};

    use crate::protocol::session::SessionRuntimeInput;
    use crate::protocol::startup::{
        ActivationOperationKind, TransparentProxyBypass, TransparentProxyBypassKind,
        TransparentProxyConfiguration,
    };
    use crate::tunnel::session::bootstrap::{
        BootstrapPongControlMessage, BootstrapWriterControlMessage,
        GATEWAY_SERVICE_RESTART_CLOSE_CODE, GATEWAY_SERVICE_RESTART_CLOSE_REASON,
        bootstrap_close_frame_disconnect_reason, bootstrap_ping_payload_attributes,
        bootstrap_pong_diagnostic_attributes, is_gateway_service_restart_close_frame,
        prioritize_ipv4_socket_addresses, record_bootstrap_tunnel_diagnostic_event,
        resolve_tunnel_exchange_url, startup_transparent_passthrough_socket_mark, usize_value,
        write_bootstrap_control_message,
    };

    #[test]
    fn records_shared_bootstrap_tunnel_diagnostic_events_to_operation_log() {
        let temp_dir = tempfile::tempdir().expect("tempdir should be created");
        let _guard = crate::test_support::TestEnvVarsGuard::set([(
            "MISTLE_SANDBOXD_OPERATION_LOG_DIR",
            temp_dir
                .path()
                .to_str()
                .expect("temp dir path should be utf8 for environment variable")
                .to_string(),
        )]);

        record_bootstrap_tunnel_diagnostic_event(
            "bootstrap_tunnel.shutdown_requested",
            std::collections::BTreeMap::from([(
                "closeSource".to_string(),
                json!("tunnel_session_handle"),
            )]),
        );

        let log_text = std::fs::read_to_string(temp_dir.path().join("bootstrap-tunnel.log"))
            .expect("bootstrap tunnel diagnostic log should be readable");
        assert!(log_text.contains(r#""event":"bootstrap_tunnel.shutdown_requested""#));
        assert!(log_text.contains(r#""closeSource":"tunnel_session_handle""#));
    }

    #[test]
    fn extracts_gateway_health_ping_payload_fields_for_bootstrap_diagnostics() {
        let payload =
            br#"{"type":"mistle.tunnel.health_ping","pingSeq":7,"sentAtMs":1780590000000}"#;

        assert_eq!(
            bootstrap_ping_payload_attributes(payload),
            std::collections::BTreeMap::from([
                ("gatewaySentAtMs".to_string(), json!(1780590000000_u64)),
                ("payloadLen".to_string(), usize_value(payload.len())),
                ("pingSeq".to_string(), json!(7_u64)),
            ])
        );
        assert_eq!(
            bootstrap_pong_diagnostic_attributes(payload, Some(12), Some(3)),
            std::collections::BTreeMap::from([
                ("gatewaySentAtMs".to_string(), json!(1780590000000_u64)),
                ("payloadLen".to_string(), usize_value(payload.len())),
                ("pingSeq".to_string(), json!(7_u64)),
                ("queueDelayMs".to_string(), json!(12_u64)),
                ("writeDurationMs".to_string(), json!(3_u64)),
            ])
        );
    }

    #[test]
    fn keeps_bootstrap_ping_payload_diagnostics_compatible_with_unknown_payloads() {
        let payload = b"legacy-ping";

        assert_eq!(
            bootstrap_ping_payload_attributes(payload),
            std::collections::BTreeMap::from([(
                "payloadLen".to_string(),
                usize_value(payload.len())
            )])
        );
        assert_eq!(
            bootstrap_pong_diagnostic_attributes(payload, Some(5), None),
            std::collections::BTreeMap::from([
                ("payloadLen".to_string(), usize_value(payload.len())),
                ("queueDelayMs".to_string(), json!(5_u64)),
            ])
        );
    }

    #[tokio::test]
    async fn records_bootstrap_pong_writer_diagnostics_for_control_messages() {
        let temp_dir = tempfile::tempdir().expect("tempdir should be created");
        let _guard = crate::test_support::TestEnvVarsGuard::set([(
            "MISTLE_SANDBOXD_OPERATION_LOG_DIR",
            temp_dir
                .path()
                .to_str()
                .expect("temp dir path should be utf8 for environment variable")
                .to_string(),
        )]);
        let (client_stream, server_stream) = tokio::io::duplex(1024);
        let mut writer = WebSocketStream::from_raw_socket(server_stream, Role::Server, None).await;
        let mut reader = WebSocketStream::from_raw_socket(client_stream, Role::Client, None).await;
        let payload =
            br#"{"type":"mistle.tunnel.health_ping","pingSeq":9,"sentAtMs":1780590000001}"#
                .to_vec();

        write_bootstrap_control_message(
            &mut writer,
            BootstrapWriterControlMessage::Pong(BootstrapPongControlMessage {
                payload: payload.clone(),
                ping_received_at: Instant::now() - Duration::from_millis(7),
            }),
            4,
            &|reason| {
                panic!("bootstrap writer should stay open, received reason {reason:?}");
            },
        )
        .await
        .expect("control pong should be written");

        let Some(Ok(Message::Pong(written_payload))) = reader.next().await else {
            panic!("peer should receive pong frame");
        };
        assert_eq!(written_payload.as_ref(), payload.as_slice());

        let log_text = std::fs::read_to_string(temp_dir.path().join("bootstrap-tunnel.log"))
            .expect("bootstrap tunnel diagnostic log should be readable");
        let records: Vec<serde_json::Value> = log_text
            .lines()
            .map(|line| serde_json::from_str(line).expect("diagnostic line should be json"))
            .collect();

        let started = records
            .iter()
            .find(|record| record["event"] == "bootstrap_tunnel.pong_write_started")
            .expect("pong write start record should be present");
        assert_eq!(started["payloadLen"], json!(payload.len()));
        assert_eq!(started["pingSeq"], json!(9_u64));
        assert_eq!(started["gatewaySentAtMs"], json!(1780590000001_u64));
        assert_eq!(started["pendingOutboundLen"], json!(4));
        assert!(
            started["queueDelayMs"].as_u64().is_some(),
            "pong write start record should include queue delay"
        );

        let completed = records
            .iter()
            .find(|record| record["event"] == "bootstrap_tunnel.pong_write_completed")
            .expect("pong write completion record should be present");
        assert_eq!(completed["payloadLen"], json!(payload.len()));
        assert_eq!(completed["pingSeq"], json!(9_u64));
        assert_eq!(completed["gatewaySentAtMs"], json!(1780590000001_u64));
        assert!(
            completed["queueDelayMs"].as_u64().is_some(),
            "pong write completion record should include queue delay"
        );
        assert!(
            completed["writeDurationMs"].as_u64().is_some(),
            "pong write completion record should include write duration"
        );
    }

    #[test]
    fn prioritize_ipv4_socket_addresses_sorts_ipv4_before_ipv6() {
        let addresses = vec![
            "[2606:4700:3031::ac43:8542]:443"
                .parse()
                .expect("ipv6 address should parse"),
            "104.21.133.66:443"
                .parse()
                .expect("ipv4 address should parse"),
            "[2606:4700:3032::6815:8542]:443"
                .parse()
                .expect("second ipv6 address should parse"),
            "172.67.133.66:443"
                .parse()
                .expect("second ipv4 address should parse"),
        ];

        let prioritized = prioritize_ipv4_socket_addresses(addresses);

        assert!(prioritized[0].is_ipv4(), "first address should prefer ipv4");
        assert!(
            prioritized[1].is_ipv4(),
            "second address should prefer ipv4"
        );
        assert!(
            prioritized[2].is_ipv6(),
            "third address should fall back to ipv6"
        );
        assert!(
            prioritized[3].is_ipv6(),
            "fourth address should fall back to ipv6"
        );
    }

    #[test]
    fn tunnel_exchange_url_preserves_gateway_query_parameters() {
        let exchange_url = resolve_tunnel_exchange_url(
            "ws://127.0.0.1:5202/tunnel/sandbox/sbi_123?x-mistle-test-environment-id=test_env_123",
        )
        .expect("tunnel exchange URL should be derivable");

        assert_eq!(
            exchange_url,
            "http://127.0.0.1:5202/tunnel/sandbox/sbi_123/token-exchange?x-mistle-test-environment-id=test_env_123"
        );
    }

    #[test]
    fn bootstrap_close_frame_disconnect_reason_falls_back_to_code_for_blank_reason() {
        assert_eq!(
            bootstrap_close_frame_disconnect_reason(Some("1000".to_string()), Some(String::new())),
            Some("bootstrap tunnel close frame code 1000".to_string())
        );
    }

    #[test]
    fn bootstrap_close_frame_disconnect_reason_prefers_non_empty_reason() {
        assert_eq!(
            bootstrap_close_frame_disconnect_reason(
                Some("1000".to_string()),
                Some("provider timeout".to_string()),
            ),
            Some("provider timeout".to_string())
        );
    }

    #[test]
    fn bootstrap_close_frame_disconnect_reason_preserves_gateway_service_restart_reason() {
        assert!(
            is_gateway_service_restart_close_frame(
                Some(GATEWAY_SERVICE_RESTART_CLOSE_CODE),
                Some(GATEWAY_SERVICE_RESTART_CLOSE_REASON),
            ),
            "gateway service restart close code and reason should be classified explicitly"
        );
        assert_eq!(
            bootstrap_close_frame_disconnect_reason(
                Some(GATEWAY_SERVICE_RESTART_CLOSE_CODE.to_string()),
                Some(GATEWAY_SERVICE_RESTART_CLOSE_REASON.to_string()),
            ),
            Some(GATEWAY_SERVICE_RESTART_CLOSE_REASON.to_string())
        );
    }

    #[test]
    fn derives_transparent_passthrough_socket_mark_for_bootstrap_tunnel() {
        let startup_input = SessionRuntimeInput {
            operation_kind: ActivationOperationKind::Start,
            bootstrap_token: "bootstrap-token".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token".to_string(),
            tunnel_gateway_ws_url: "wss://gateway.example.test/tunnel/sandbox/sbi_123".to_string(),
            acting_user_id: None,
            runtime_plan: json!({}),
            git_identity: None,
            transparent_proxy: Some(TransparentProxyConfiguration {
                passthrough_bypass: TransparentProxyBypass {
                    kind: TransparentProxyBypassKind::SocketMark,
                    mark: 38_514,
                },
                exclusions: Vec::new(),
            }),
        };

        assert_eq!(
            startup_transparent_passthrough_socket_mark(&startup_input),
            Some(38_514)
        );
    }
}
