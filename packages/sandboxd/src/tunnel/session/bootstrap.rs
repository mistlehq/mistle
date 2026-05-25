//! Bootstrap tunnel connection and writer plumbing for the live session.

use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};

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

use crate::protocol::startup::{StartupInput, TransparentProxyBypassKind};
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
    Pong(Vec<u8>),
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
            return Ok(None);
        }

        let attempt_number = attempt_index + 1;
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
                        return Ok(Some(bootstrap_socket));
                    }
                    Err(error) => {
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
                attempted_connect_errors.push(format!("{address}: {error}"));
                continue;
            }
            Err(_) => {
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
            Ok(Ok(result)) => return Ok(result),
            Ok(Err(error)) => {
                attempted_connect_errors.push(format!("{address}: {error}"));
            }
            Err(_) => {
                attempted_connect_errors.push(format!(
                    "{address}: websocket handshake timed out after {}ms",
                    DEFAULT_BOOTSTRAP_TUNNEL_HANDSHAKE_TIMEOUT.as_millis()
                ));
            }
        }
    }

    Err(TunnelSessionError::ConfigureTunnelSocket(
        if attempted_connect_errors.is_empty() {
            format!("bootstrap websocket connect failed for {connected_url}")
        } else {
            format!(
                "bootstrap websocket failed to connect to any resolved address for {host}:{port}; attempts: {}",
                attempted_connect_errors.join("; ")
            )
        },
    ))
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
    startup_input: &StartupInput,
) -> Option<u32> {
    let transparent_proxy = startup_input.transparent_proxy.as_ref()?;
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
                            info!(
                                event = "bootstrap_tunnel.reader_closed",
                                close_source = "reader",
                                close_kind = "close_frame",
                                close_code = field::display(close_code.as_deref().unwrap_or("")),
                                close_reason = field::display(close_reason.as_deref().unwrap_or("")),
                            );
                            let reason = bootstrap_close_frame_disconnect_reason(close_code, close_reason);
                            let _ = event_sender.send(TunnelSessionEvent::BootstrapClosed { reason });
                            writer_task.abort();
                            return Ok(());
                        }
                        Some(Err(WebSocketError::ConnectionClosed)) => {
                            info!(
                                event = "bootstrap_tunnel.reader_closed",
                                close_source = "reader",
                                close_kind = "connection_closed",
                            );
                            let _ = event_sender.send(TunnelSessionEvent::BootstrapClosed {
                                reason: Some("bootstrap websocket reported connection closed".to_string()),
                            });
                            writer_task.abort();
                            return Ok(());
                        }
                        None => {
                            info!(
                                event = "bootstrap_tunnel.reader_closed",
                                close_source = "reader",
                                close_kind = "stream_ended",
                            );
                            let _ = event_sender.send(TunnelSessionEvent::BootstrapClosed {
                                reason: Some("bootstrap websocket stream ended".to_string()),
                            });
                            writer_task.abort();
                            return Ok(());
                        }
                        Some(Ok(Message::Ping(payload))) => {
                            control_sender
                                .send(BootstrapWriterControlMessage::Pong(payload.to_vec()))
                                .map_err(|_| {
                                    TunnelSessionError::WriteTunnelText(
                                        "bootstrap tunnel writer is closed".to_string(),
                                    )
                                })?;
                        }
                        Some(Ok(message)) => {
                            let _ = event_sender.send(TunnelSessionEvent::BootstrapMessage(message));
                        }
                        Some(Err(error)) => {
                            warn!(
                                event = "bootstrap_tunnel.reader_closed",
                                close_source = "reader",
                                close_kind = "read_error",
                                error = %error,
                            );
                            let _ = event_sender.send(TunnelSessionEvent::BootstrapClosed {
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
    close_reason
        .filter(|reason| !reason.is_empty())
        .or_else(|| close_code.map(|code| format!("bootstrap tunnel close frame code {code}")))
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
        info!(
            event = "bootstrap_tunnel.writer_observed_closed",
            close_source = "writer",
            reason = field::display(reason.as_deref().unwrap_or("")),
        );
        let _ = event_sender.send(TunnelSessionEvent::BootstrapClosed { reason });
    };
    let mut pending_outbound = VecDeque::new();

    loop {
        while let Ok(control) = control_receiver.try_recv() {
            write_bootstrap_control_message(&mut writer, control, &notify_bootstrap_closed).await?;
        }
        while let Ok(message) = receiver.try_recv() {
            match message {
                TunnelWriterMessage::Pong(payload) => {
                    write_bootstrap_pong(&mut writer, payload, &notify_bootstrap_closed).await?;
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
                    write_bootstrap_control_message(&mut writer, control, &notify_bootstrap_closed).await?;
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
    notify_bootstrap_closed: &impl Fn(Option<String>),
) -> Result<(), TunnelSessionError>
where
    W: Sink<Message, Error = WebSocketError> + Unpin,
{
    match message {
        BootstrapWriterControlMessage::Pong(payload) => {
            write_bootstrap_pong(writer, payload, notify_bootstrap_closed).await
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
            write_bootstrap_pong(writer, payload, notify_bootstrap_closed).await?;
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
    notify_bootstrap_closed: &impl Fn(Option<String>),
) -> Result<(), TunnelSessionError>
where
    W: Sink<Message, Error = WebSocketError> + Unpin,
{
    if let Err(error) = writer.send(Message::Pong(payload.into())).await {
        notify_bootstrap_closed(Some(format!(
            "failed to write bootstrap tunnel pong frame: {error}"
        )));
        return Err(TunnelSessionError::WriteTunnelText(error.to_string()));
    }
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
    use serde_json::json;

    use crate::protocol::startup::{
        StartupExecutionMode, StartupInput, StartupMode, StartupOperationKind,
        TransparentProxyBypass, TransparentProxyBypassKind, TransparentProxyConfiguration,
    };
    use crate::tunnel::session::bootstrap::{
        bootstrap_close_frame_disconnect_reason, prioritize_ipv4_socket_addresses,
        resolve_tunnel_exchange_url, startup_transparent_passthrough_socket_mark,
    };

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
    fn derives_transparent_passthrough_socket_mark_for_bootstrap_tunnel() {
        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: StartupOperationKind::Start,
            execution_mode: StartupExecutionMode::Session,
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
