//! Local egress proxy runtime and forwarding pipeline.
//!
//! This module owns listener runtimes plus HTTP CONNECT, transparent proxy,
//! direct upstream, and direct-gateway forwarding. Route matching, CA, TLS, and
//! logging details stay in sibling modules.

use std::convert::Infallible;
use std::net::{SocketAddr, TcpListener as StdTcpListener};
use std::sync::Arc;
use std::sync::atomic::Ordering;

use futures_util::{SinkExt, StreamExt};
use http_body_util::BodyExt;
use hyper::body::{Body, Incoming};
use hyper::client::conn::http1 as client_http1;
use hyper::header::{HOST, HeaderName, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode, Uri};
use hyper_util::rt::TokioIo;
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncWrite, copy_bidirectional};
use tokio::net::{TcpListener, TcpSocket, TcpStream};
use tokio::runtime::Builder;
use tokio::sync::oneshot;
use tokio_tungstenite::tungstenite::{
    Message,
    client::IntoClientRequest,
    handshake::{client::Request as ClientWebSocketRequest, derive_accept_key},
    protocol::{CloseFrame, Role, frame::coding::CloseCode},
};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, client_async};
use url::Url;

use crate::egress_proxy::body::{
    BoxError, EgressProxyRequestContext, HyperBody, InstrumentedResponseBody, box_body, empty_body,
    text_response,
};
use crate::egress_proxy::gateway::{DirectGatewayEgressClient, EgressProxyForwardingMode};
use crate::egress_proxy::logging::emit_egress_proxy_log;
use crate::egress_proxy::routing::{
    EgressProxyRoute, RequestTarget, RequestTargetOverride, match_state_route,
    resolve_request_target,
};
use crate::egress_proxy::tls::{
    accept_transparent_tls_stream, build_direct_tls_connector, build_tls_acceptor, tls_server_name,
    websocket_target_url,
};
use crate::egress_proxy::transparent::{
    configure_transparent_passthrough_upstream_socket, recover_original_destination,
};
use crate::egress_proxy::{
    DIRECT_GATEWAY_EGRESS_AUTHORIZATION_HEADER_NAME, EgressProxyError, EgressProxyState,
    SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME,
};

const GATEWAY_SERVICE_RESTART_CLOSE_CODE: u16 = 4001;
const GATEWAY_SERVICE_RESTART_CLOSE_REASON: &str = "service_restart";

#[derive(Debug, Eq, PartialEq)]
enum DirectGatewayWebSocketTunnelOutcome {
    Completed,
    GatewayServiceRestart,
}

enum DirectHttpUpstreamStream {
    Plain(TcpStream),
    Tls(Box<tokio_rustls::client::TlsStream<TcpStream>>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TransparentProxyProtocol {
    Empty,
    PlainHttp,
    Tls,
    Unsupported,
}

pub(super) fn run_proxy_server(
    std_listener: StdTcpListener,
    mut shutdown_rx: oneshot::Receiver<()>,
    state: EgressProxyState,
) -> Result<(), EgressProxyError> {
    let runtime = Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to start local egress proxy runtime: {error}"
            ))
        })?;

    runtime.block_on(async move {
        let listener = TcpListener::from_std(std_listener).map_err(|error| {
            EgressProxyError::new(format!("failed to create local egress proxy listener: {error}"))
        })?;

        loop {
            tokio::select! {
                _ = &mut shutdown_rx => return Ok(()),
                accept_result = listener.accept() => {
                    let (stream, _) = accept_result.map_err(|error| {
                        EgressProxyError::new(format!("local egress proxy accept failed: {error}"))
                    })?;
                    let state = state.clone();
                    tokio::spawn(async move {
                        let io = TokioIo::new(stream);
                        let service = service_fn(move |request| handle_proxy_request(request, state.clone(), None));
                        let connection = http1::Builder::new().serve_connection(io, service).with_upgrades();
                        let _ = connection.await;
                    });
                }
            }
        }
    })
}

pub(super) fn run_transparent_proxy_server(
    std_listener: StdTcpListener,
    mut shutdown_rx: oneshot::Receiver<()>,
    state: EgressProxyState,
) -> Result<(), EgressProxyError> {
    let runtime = Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to start transparent egress proxy runtime: {error}"
            ))
        })?;

    runtime.block_on(async move {
        let listener = TcpListener::from_std(std_listener).map_err(|error| {
            EgressProxyError::new(format!(
                "failed to create transparent egress proxy listener: {error}"
            ))
        })?;

        loop {
            tokio::select! {
                _ = &mut shutdown_rx => return Ok(()),
                accept_result = listener.accept() => {
                    let (stream, peer_address) = accept_result.map_err(|error| {
                        EgressProxyError::new(format!("transparent egress proxy accept failed: {error}"))
                    })?;
                    let state = state.clone();
                    tokio::spawn(async move {
                        let log_state = state.clone();
                        if let Err(error) = handle_transparent_proxy_connection(stream, peer_address, state).await {
                            emit_egress_proxy_log(
                                log_state.clock.as_ref(),
                                &log_state.sandbox_instance_id,
                                "egress_proxy_transparent_connection_failed",
                                &[
                                    ("peerAddr", Value::String(peer_address.to_string())),
                                    ("error", Value::String(error.to_string())),
                                ],
                            );
                        }
                    });
                }
            }
        }
    })
}

async fn handle_transparent_proxy_connection(
    stream: TcpStream,
    peer_address: SocketAddr,
    state: EgressProxyState,
) -> Result<(), EgressProxyError> {
    let original_destination = recover_original_destination(&stream)?;
    let authority = original_destination.to_string();
    let protocol = classify_transparent_proxy_stream(&stream).await?;
    let mut fields = vec![
        ("peerAddr", Value::String(peer_address.to_string())),
        (
            "originalDestination",
            Value::String(original_destination.to_string()),
        ),
        (
            "detectedProtocol",
            Value::String(transparent_proxy_protocol_name(protocol).to_string()),
        ),
    ];
    match protocol {
        TransparentProxyProtocol::Empty => {
            emit_egress_proxy_log(
                state.clock.as_ref(),
                &state.sandbox_instance_id,
                "egress_proxy_transparent_connection_empty",
                &fields,
            );
            Ok(())
        }
        TransparentProxyProtocol::PlainHttp => {
            fields.push(("scheme", Value::String("http".to_string())));
            fields.push(("authority", Value::String(authority.clone())));
            emit_egress_proxy_log(
                state.clock.as_ref(),
                &state.sandbox_instance_id,
                "egress_proxy_transparent_connection_started",
                &fields,
            );
            let target_override = RequestTargetOverride {
                scheme: "http",
                default_authority: authority,
            };
            let service = service_fn(move |request| {
                handle_proxy_request(request, state.clone(), Some(target_override.clone()))
            });
            http1::Builder::new()
                .serve_connection(TokioIo::new(stream), service)
                .with_upgrades()
                .await
                .map_err(|error| {
                    EgressProxyError::new(format!(
                        "transparent plaintext HTTP connection failed: {error}"
                    ))
                })
        }
        TransparentProxyProtocol::Tls => {
            fields.push(("scheme", Value::String("https".to_string())));
            fields.push(("authority", Value::String(authority.clone())));
            emit_egress_proxy_log(
                state.clock.as_ref(),
                &state.sandbox_instance_id,
                "egress_proxy_transparent_connection_started",
                &fields,
            );
            let tls_stream =
                accept_transparent_tls_stream(stream, &authority, state.clone()).await?;
            let target_override = RequestTargetOverride {
                scheme: "https",
                default_authority: authority,
            };
            let service = service_fn(move |request| {
                handle_proxy_request(request, state.clone(), Some(target_override.clone()))
            });
            http1::Builder::new()
                .serve_connection(TokioIo::new(tls_stream), service)
                .with_upgrades()
                .await
                .map_err(|error| {
                    EgressProxyError::new(format!(
                        "transparent TLS HTTP connection failed: {error}"
                    ))
                })
        }
        TransparentProxyProtocol::Unsupported => {
            handle_transparent_passthrough_connection(stream, original_destination, state, fields)
                .await
        }
    }
}

async fn classify_transparent_proxy_stream(
    stream: &TcpStream,
) -> Result<TransparentProxyProtocol, EgressProxyError> {
    let mut first_byte = [0_u8; 1];
    let byte_count = stream.peek(&mut first_byte).await.map_err(|error| {
        EgressProxyError::new(format!(
            "failed to inspect transparent egress proxy connection: {error}"
        ))
    })?;
    if byte_count == 0 {
        // The supervisor health check opens and closes a TCP connection without
        // sending bytes; treat that as healthy listener traffic, not passthrough.
        return Ok(TransparentProxyProtocol::Empty);
    }
    Ok(classify_transparent_proxy_first_byte(first_byte[0]))
}

pub(super) fn classify_transparent_proxy_first_byte(first_byte: u8) -> TransparentProxyProtocol {
    match first_byte {
        0x16 => TransparentProxyProtocol::Tls,
        b'A' | b'C' | b'D' | b'G' | b'H' | b'O' | b'P' | b'T' => {
            TransparentProxyProtocol::PlainHttp
        }
        _ => TransparentProxyProtocol::Unsupported,
    }
}

fn transparent_proxy_protocol_name(protocol: TransparentProxyProtocol) -> &'static str {
    match protocol {
        TransparentProxyProtocol::Empty => "empty",
        TransparentProxyProtocol::PlainHttp => "http",
        TransparentProxyProtocol::Tls => "tls",
        TransparentProxyProtocol::Unsupported => "unsupported",
    }
}

async fn handle_transparent_passthrough_connection(
    mut downstream: TcpStream,
    original_destination: SocketAddr,
    state: EgressProxyState,
    fields: Vec<(&'static str, Value)>,
) -> Result<(), EgressProxyError> {
    emit_egress_proxy_log(
        state.clock.as_ref(),
        &state.sandbox_instance_id,
        "egress_proxy_transparent_passthrough_started",
        &fields,
    );

    let started_at_ms = state.clock.now_ms();
    let mut upstream = connect_transparent_passthrough_upstream(original_destination).await?;
    let copy_result = copy_bidirectional(&mut downstream, &mut upstream)
        .await
        .map_err(|error| {
            EgressProxyError::new(format!(
                "transparent passthrough copy to '{original_destination}' failed: {error}"
            ))
        })?;

    let ended_at_ms = state.clock.now_ms();
    let duration_ms = ended_at_ms.saturating_sub(started_at_ms);
    let mut completed_fields = fields;
    completed_fields.push(("outcome", Value::String("completed".to_string())));
    completed_fields.push(("requestBytes", Value::from(copy_result.0)));
    completed_fields.push(("responseBytes", Value::from(copy_result.1)));
    completed_fields.push(("durationMs", Value::from(duration_ms)));
    emit_egress_proxy_log(
        state.clock.as_ref(),
        &state.sandbox_instance_id,
        "egress_proxy_transparent_passthrough_completed",
        &completed_fields,
    );

    Ok(())
}

async fn connect_transparent_passthrough_upstream(
    original_destination: SocketAddr,
) -> Result<TcpStream, EgressProxyError> {
    let socket = match original_destination {
        SocketAddr::V4(_) => TcpSocket::new_v4(),
        SocketAddr::V6(_) => TcpSocket::new_v6(),
    }
    .map_err(|error| {
        EgressProxyError::new(format!(
            "failed to create transparent passthrough upstream socket: {error}"
        ))
    })?;

    configure_transparent_passthrough_upstream_socket(&socket)?;
    socket.connect(original_destination).await.map_err(|error| {
        EgressProxyError::new(format!(
            "failed to connect transparent passthrough upstream '{original_destination}': {error}"
        ))
    })
}

async fn handle_proxy_request(
    mut request: Request<Incoming>,
    state: EgressProxyState,
    target_override: Option<RequestTargetOverride>,
) -> Result<Response<HyperBody>, Infallible> {
    if request.method() == Method::CONNECT {
        return Ok(handle_connect_request(request, state));
    }

    if is_websocket_upgrade_request(&request) {
        let downstream_upgrade = hyper::upgrade::on(&mut request);
        return Ok(
            match forward_upgrade_request(request, state, target_override, downstream_upgrade).await
            {
                Ok(response) => response,
                Err(error) => text_response(StatusCode::BAD_GATEWAY, error.to_string()),
            },
        );
    }

    Ok(
        match forward_request(request, state, target_override).await {
            Ok(response) => response,
            Err(error) => text_response(StatusCode::BAD_GATEWAY, error.to_string()),
        },
    )
}

fn is_websocket_upgrade_request(request: &Request<Incoming>) -> bool {
    let has_upgrade_token = request
        .headers()
        .get(hyper::header::CONNECTION)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(',')
                .any(|token| token.trim().eq_ignore_ascii_case("upgrade"))
        });
    let upgrades_to_websocket = request
        .headers()
        .get(hyper::header::UPGRADE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("websocket"));

    has_upgrade_token && upgrades_to_websocket
}

fn handle_connect_request(
    request: Request<Incoming>,
    state: EgressProxyState,
) -> Response<HyperBody> {
    let Some(authority) = request
        .uri()
        .authority()
        .map(|authority| authority.as_str().to_string())
    else {
        return text_response(
            StatusCode::BAD_REQUEST,
            "CONNECT requests must include a target authority",
        );
    };

    tokio::spawn(async move {
        let Ok(upgraded) = hyper::upgrade::on(request).await else {
            return;
        };
        let Ok(tls_acceptor) = build_tls_acceptor(
            &authority,
            state.proxy_ca_certificate_pem.as_str(),
            state.proxy_ca_private_key_pem.as_str(),
            state.clock.as_ref(),
        ) else {
            return;
        };
        let Ok(tls_stream) = tls_acceptor.accept(TokioIo::new(upgraded)).await else {
            return;
        };
        let target_override = RequestTargetOverride {
            scheme: "https",
            default_authority: authority,
        };
        let service = service_fn(move |request| {
            handle_proxy_request(request, state.clone(), Some(target_override.clone()))
        });
        let _ = http1::Builder::new()
            .serve_connection(TokioIo::new(tls_stream), service)
            .with_upgrades()
            .await;
    });

    match Response::builder()
        .status(StatusCode::OK)
        .body(empty_body())
    {
        Ok(response) => response,
        Err(error) => text_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to build CONNECT acknowledgement response: {error}"),
        ),
    }
}

async fn forward_upgrade_request(
    request: Request<Incoming>,
    state: EgressProxyState,
    target_override: Option<RequestTargetOverride>,
    downstream_upgrade: hyper::upgrade::OnUpgrade,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let (parts, _) = request.into_parts();
    let request_method = parts.method.clone();
    let mark_upstream_socket = target_override.is_some();
    let request_target = resolve_request_target(&parts, target_override.as_ref())?;
    let request_path_and_query = request_target
        .uri
        .path_and_query()
        .map_or("/", |path_and_query| path_and_query.as_str())
        .to_string();
    let route = match_state_route(
        &state,
        &request_target.host,
        &request_path_and_query,
        request_method.as_str(),
    )?;
    if route.is_none() {
        return forward_upgrade_request_direct(
            parts,
            state,
            request_target,
            request_path_and_query,
            downstream_upgrade,
            mark_upstream_socket,
        )
        .await;
    }
    match state.forwarding_mode.clone() {
        EgressProxyForwardingMode::DirectGateway { client } => {
            forward_upgrade_request_through_direct_gateway(
                parts,
                state,
                request_target,
                request_path_and_query,
                route,
                client,
                downstream_upgrade,
            )
            .await
        }
    }
}

async fn forward_request(
    request: Request<Incoming>,
    state: EgressProxyState,
    target_override: Option<RequestTargetOverride>,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let (parts, body) = request.into_parts();
    let request_method = parts.method.clone();
    let mark_upstream_socket = target_override.is_some();
    let request_target = resolve_request_target(&parts, target_override.as_ref())?;
    let request_path_and_query = request_target
        .uri
        .path_and_query()
        .map_or("/", |path_and_query| path_and_query.as_str())
        .to_string();
    let route = match_state_route(
        &state,
        &request_target.host,
        &request_path_and_query,
        request_method.as_str(),
    )?;
    let Some(route) = route else {
        return forward_request_direct(
            parts,
            body,
            state,
            request_target,
            request_path_and_query,
            mark_upstream_socket,
        )
        .await;
    };
    match state.forwarding_mode.clone() {
        EgressProxyForwardingMode::DirectGateway { client } => {
            forward_request_through_direct_gateway(
                parts,
                body,
                state,
                request_target,
                request_path_and_query,
                Some(route),
                client,
            )
            .await
        }
    }
}

async fn forward_upgrade_request_direct(
    parts: hyper::http::request::Parts,
    state: EgressProxyState,
    request_target: RequestTarget,
    request_path_and_query: String,
    downstream_upgrade: hyper::upgrade::OnUpgrade,
    mark_upstream_socket: bool,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let request_method = parts.method.clone();
    let request_context = Arc::new(EgressProxyRequestContext {
        sandbox_instance_id: state.sandbox_instance_id.clone(),
        request_id: format!(
            "egp_{}",
            state.next_request_id.fetch_add(1, Ordering::Relaxed)
        ),
        method: request_method.to_string(),
        authority: request_target.authority.clone(),
        host: request_target.host.clone(),
        path_and_query: request_path_and_query,
        route_mode: "direct",
        egress_rule_id: None,
        upstream_url: request_target.uri.to_string(),
        started_at_ms: state.clock.now_ms(),
        clock: state.clock.clone(),
    });
    let mut request_started_fields = request_context.common_fields();
    request_started_fields.push(("upgrade", Value::String("websocket".to_string())));
    emit_egress_proxy_log(
        request_context.clock.as_ref(),
        &request_context.sandbox_instance_id,
        "egress_proxy_upgrade_started",
        &request_started_fields,
    );

    let websocket_accept_key = parts
        .headers
        .get("sec-websocket-key")
        .map(|value| derive_accept_key(value.as_bytes()))
        .ok_or_else(|| {
            EgressProxyError::new("websocket upgrade request is missing Sec-WebSocket-Key")
        })?;
    let upstream_socket =
        match connect_direct_upstream_websocket(&request_target.uri, mark_upstream_socket).await {
            Ok(socket) => socket,
            Err(error) => {
                let mut fields = request_context.common_fields();
                fields.push(("outcome", Value::String("connect_failed".to_string())));
                fields.push(("error", Value::String(error.to_string())));
                emit_egress_proxy_log(
                    request_context.clock.as_ref(),
                    &request_context.sandbox_instance_id,
                    "egress_proxy_upgrade_failed",
                    &fields,
                );
                return Err(error);
            }
        };

    let tunnel_context = request_context.clone();
    tokio::spawn(async move {
        let tunnel_result = tunnel_websocket_upgrade(downstream_upgrade, upstream_socket).await;

        match tunnel_result {
            Ok(DirectGatewayWebSocketTunnelOutcome::Completed) => {
                let mut fields = tunnel_context.common_fields();
                fields.push(("outcome", Value::String("completed".to_string())));
                emit_egress_proxy_log(
                    tunnel_context.clock.as_ref(),
                    &tunnel_context.sandbox_instance_id,
                    "egress_proxy_upgrade_completed",
                    &fields,
                );
            }
            Ok(DirectGatewayWebSocketTunnelOutcome::GatewayServiceRestart) => {
                let mut fields = tunnel_context.common_fields();
                fields.push((
                    "outcome",
                    Value::String("gateway_service_restart".to_string()),
                ));
                emit_egress_proxy_log(
                    tunnel_context.clock.as_ref(),
                    &tunnel_context.sandbox_instance_id,
                    "egress_proxy_upgrade_completed",
                    &fields,
                );
            }
            Err(error) => {
                let mut fields = tunnel_context.common_fields();
                fields.push(("outcome", Value::String("tunnel_failed".to_string())));
                fields.push(("error", Value::String(error.to_string())));
                emit_egress_proxy_log(
                    tunnel_context.clock.as_ref(),
                    &tunnel_context.sandbox_instance_id,
                    "egress_proxy_upgrade_failed",
                    &fields,
                );
            }
        }
    });

    Response::builder()
        .status(StatusCode::SWITCHING_PROTOCOLS)
        .header("connection", "upgrade")
        .header("upgrade", "websocket")
        .header("sec-websocket-accept", websocket_accept_key)
        .header(
            SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME,
            request_context.request_id.as_str(),
        )
        .body(empty_body())
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct websocket upgrade response: {error}"
            ))
        })
}

async fn forward_request_direct(
    parts: hyper::http::request::Parts,
    body: Incoming,
    state: EgressProxyState,
    request_target: RequestTarget,
    request_path_and_query: String,
    mark_upstream_socket: bool,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let request_method = parts.method.clone();
    let request_context = Arc::new(EgressProxyRequestContext {
        sandbox_instance_id: state.sandbox_instance_id.clone(),
        request_id: format!(
            "egp_{}",
            state.next_request_id.fetch_add(1, Ordering::Relaxed)
        ),
        method: request_method.to_string(),
        authority: request_target.authority.clone(),
        host: request_target.host.clone(),
        path_and_query: request_path_and_query.clone(),
        route_mode: "direct",
        egress_rule_id: None,
        upstream_url: request_target.uri.to_string(),
        started_at_ms: state.clock.now_ms(),
        clock: state.clock.clone(),
    });
    let mut request_started_fields = request_context.common_fields();
    request_started_fields.push((
        "hasRequestBody",
        Value::Bool(body.size_hint().lower() > 0 || body.size_hint().upper().unwrap_or(1) > 0),
    ));
    emit_egress_proxy_log(
        request_context.clock.as_ref(),
        &request_context.sandbox_instance_id,
        "egress_proxy_request_started",
        &request_started_fields,
    );

    let direct_response =
        match send_direct_upstream_http_request(parts, body, &request_target, mark_upstream_socket)
            .await
        {
            Ok(response) => response,
            Err(error) => {
                let mut fields = request_context.common_fields();
                fields.push(("outcome", Value::String("connect_failed".to_string())));
                fields.push(("error", Value::String(error.to_string())));
                emit_egress_proxy_log(
                    request_context.clock.as_ref(),
                    &request_context.sandbox_instance_id,
                    "egress_proxy_request_failed",
                    &fields,
                );
                return Err(error);
            }
        };

    response_from_direct_upstream_response(direct_response, request_context)
}

async fn forward_upgrade_request_through_direct_gateway(
    parts: hyper::http::request::Parts,
    state: EgressProxyState,
    request_target: RequestTarget,
    request_path_and_query: String,
    route: Option<EgressProxyRoute>,
    client: Arc<DirectGatewayEgressClient>,
    downstream_upgrade: hyper::upgrade::OnUpgrade,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let request_method = parts.method.clone();
    let request_context = Arc::new(EgressProxyRequestContext {
        sandbox_instance_id: state.sandbox_instance_id.clone(),
        request_id: format!(
            "egp_{}",
            state.next_request_id.fetch_add(1, Ordering::Relaxed)
        ),
        method: request_method.to_string(),
        authority: request_target.authority.clone(),
        host: request_target.host.clone(),
        path_and_query: request_path_and_query,
        route_mode: "direct_gateway",
        egress_rule_id: route
            .as_ref()
            .map(|matched_route| matched_route.egress_rule_id.clone()),
        upstream_url: request_target.uri.to_string(),
        started_at_ms: state.clock.now_ms(),
        clock: state.clock.clone(),
    });
    let mut request_started_fields = request_context.common_fields();
    request_started_fields.push(("upgrade", Value::String("websocket".to_string())));
    emit_egress_proxy_log(
        request_context.clock.as_ref(),
        &request_context.sandbox_instance_id,
        "egress_proxy_upgrade_started",
        &request_started_fields,
    );

    let token = client.token().await?;
    let websocket_accept_key = parts
        .headers
        .get("sec-websocket-key")
        .map(|value| derive_accept_key(value.as_bytes()))
        .ok_or_else(|| {
            EgressProxyError::new("websocket upgrade request is missing Sec-WebSocket-Key")
        })?;
    let mut gateway_request = client
        .direct_websocket_url(&request_target.uri)?
        .into_client_request()
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct gateway websocket request: {error}"
            ))
        })?;
    gateway_request.headers_mut().insert(
        HeaderName::from_static(DIRECT_GATEWAY_EGRESS_AUTHORIZATION_HEADER_NAME),
        HeaderValue::from_str(&format!("Bearer {token}")).map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build egress authorization header: {error}"
            ))
        })?,
    );

    let gateway_socket = match connect_direct_gateway_websocket_request(gateway_request).await {
        Ok(socket) => socket,
        Err(error) => {
            let mut fields = request_context.common_fields();
            fields.push(("outcome", Value::String("connect_failed".to_string())));
            fields.push(("error", Value::String(error.to_string())));
            emit_egress_proxy_log(
                request_context.clock.as_ref(),
                &request_context.sandbox_instance_id,
                "egress_proxy_upgrade_failed",
                &fields,
            );
            return Err(EgressProxyError::new(format!(
                "direct gateway websocket egress failed: {error}"
            )));
        }
    };

    let tunnel_context = request_context.clone();
    tokio::spawn(async move {
        let tunnel_result = tunnel_direct_gateway_upgrade(downstream_upgrade, gateway_socket).await;

        match tunnel_result {
            Ok(DirectGatewayWebSocketTunnelOutcome::Completed) => {
                let mut fields = tunnel_context.common_fields();
                fields.push(("outcome", Value::String("completed".to_string())));
                emit_egress_proxy_log(
                    tunnel_context.clock.as_ref(),
                    &tunnel_context.sandbox_instance_id,
                    "egress_proxy_upgrade_completed",
                    &fields,
                );
            }
            Ok(DirectGatewayWebSocketTunnelOutcome::GatewayServiceRestart) => {
                let mut fields = tunnel_context.common_fields();
                fields.push((
                    "outcome",
                    Value::String("gateway_service_restart".to_string()),
                ));
                emit_egress_proxy_log(
                    tunnel_context.clock.as_ref(),
                    &tunnel_context.sandbox_instance_id,
                    "egress_proxy_upgrade_completed",
                    &fields,
                );
            }
            Err(error) => {
                let mut fields = tunnel_context.common_fields();
                fields.push(("outcome", Value::String("tunnel_failed".to_string())));
                fields.push(("error", Value::String(error.to_string())));
                emit_egress_proxy_log(
                    tunnel_context.clock.as_ref(),
                    &tunnel_context.sandbox_instance_id,
                    "egress_proxy_upgrade_failed",
                    &fields,
                );
            }
        }
    });

    Response::builder()
        .status(StatusCode::SWITCHING_PROTOCOLS)
        .header("connection", "upgrade")
        .header("upgrade", "websocket")
        .header("sec-websocket-accept", websocket_accept_key)
        .header(
            SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME,
            request_context.request_id.as_str(),
        )
        .body(empty_body())
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct gateway websocket upgrade response: {error}"
            ))
        })
}

async fn forward_request_through_direct_gateway(
    parts: hyper::http::request::Parts,
    body: Incoming,
    state: EgressProxyState,
    request_target: RequestTarget,
    request_path_and_query: String,
    route: Option<EgressProxyRoute>,
    client: Arc<DirectGatewayEgressClient>,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let request_method = parts.method.clone();
    let request_context = Arc::new(EgressProxyRequestContext {
        sandbox_instance_id: state.sandbox_instance_id.clone(),
        request_id: format!(
            "egp_{}",
            state.next_request_id.fetch_add(1, Ordering::Relaxed)
        ),
        method: request_method.to_string(),
        authority: request_target.authority.clone(),
        host: request_target.host.clone(),
        path_and_query: request_path_and_query.clone(),
        route_mode: "direct_gateway",
        egress_rule_id: route
            .as_ref()
            .map(|matched_route| matched_route.egress_rule_id.clone()),
        upstream_url: request_target.uri.to_string(),
        started_at_ms: state.clock.now_ms(),
        clock: state.clock.clone(),
    });
    let mut request_started_fields = request_context.common_fields();
    request_started_fields.push((
        "hasRequestBody",
        Value::Bool(body.size_hint().lower() > 0 || body.size_hint().upper().unwrap_or(1) > 0),
    ));
    emit_egress_proxy_log(
        request_context.clock.as_ref(),
        &request_context.sandbox_instance_id,
        "egress_proxy_request_started",
        &request_started_fields,
    );

    let token = client.token().await?;
    let direct_uri = client.direct_http_url(&request_target.uri)?;
    let mut request_builder = Request::builder()
        .method(request_method)
        .uri(direct_uri.clone())
        .header(
            DIRECT_GATEWAY_EGRESS_AUTHORIZATION_HEADER_NAME,
            format!("Bearer {token}"),
        );
    for (header_name, header_value) in filter_direct_gateway_request_headers(&parts.headers) {
        request_builder = request_builder.header(header_name, header_value);
    }
    let direct_request = request_builder
        .body(box_body(body.map_err(box_hyper_error)))
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct gateway egress request: {error}"
            ))
        })?;
    let gateway_response = match send_direct_gateway_http_request(direct_request, &direct_uri).await
    {
        Ok(response) => response,
        Err(error) => {
            let mut fields = request_context.common_fields();
            fields.push(("outcome", Value::String("connect_failed".to_string())));
            fields.push(("error", Value::String(error.to_string())));
            emit_egress_proxy_log(
                request_context.clock.as_ref(),
                &request_context.sandbox_instance_id,
                "egress_proxy_request_failed",
                &fields,
            );
            return Err(EgressProxyError::new(format!(
                "direct gateway HTTP egress failed: {error}"
            )));
        }
    };

    response_from_direct_gateway_response(gateway_response, request_context)
}

async fn send_direct_gateway_http_request(
    request: Request<HyperBody>,
    direct_uri: &Uri,
) -> Result<Response<Incoming>, EgressProxyError> {
    let (mut parts, body) = request.into_parts();
    parts.uri = origin_form_uri(direct_uri)?;
    parts
        .headers
        .insert(HOST, direct_gateway_host_header(direct_uri)?);

    match connect_direct_http_upstream(direct_uri, true).await? {
        DirectHttpUpstreamStream::Plain(stream) => {
            send_direct_upstream_http_request_over_io(stream, Request::from_parts(parts, body))
                .await
        }
        DirectHttpUpstreamStream::Tls(stream) => {
            send_direct_upstream_http_request_over_io(*stream, Request::from_parts(parts, body))
                .await
        }
    }
}

async fn tunnel_direct_gateway_upgrade(
    downstream_upgrade: hyper::upgrade::OnUpgrade,
    gateway_socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
) -> Result<DirectGatewayWebSocketTunnelOutcome, EgressProxyError> {
    tunnel_websocket_upgrade(downstream_upgrade, gateway_socket).await
}

async fn tunnel_websocket_upgrade(
    downstream_upgrade: hyper::upgrade::OnUpgrade,
    upstream_socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
) -> Result<DirectGatewayWebSocketTunnelOutcome, EgressProxyError> {
    let downstream = downstream_upgrade.await.map_err(|error| {
        EgressProxyError::new(format!("failed to upgrade downstream websocket: {error}"))
    })?;
    let downstream =
        WebSocketStream::from_raw_socket(TokioIo::new(downstream), Role::Server, None).await;
    let (mut downstream_writer, mut downstream_reader) = downstream.split();
    let (mut upstream_writer, mut upstream_reader) = upstream_socket.split();

    let mut request_task = tokio::spawn(async move {
        while let Some(message) = downstream_reader.next().await {
            let message = message.map_err(|error| {
                EgressProxyError::new(format!(
                    "failed to read downstream websocket message: {error}"
                ))
            })?;
            if matches!(message, Message::Close(_)) {
                upstream_writer.send(message).await.map_err(|error| {
                    EgressProxyError::new(format!(
                        "failed to close upstream websocket request stream: {error}"
                    ))
                })?;
                return Ok::<DirectGatewayWebSocketTunnelOutcome, EgressProxyError>(
                    DirectGatewayWebSocketTunnelOutcome::Completed,
                );
            }
            upstream_writer.send(message).await.map_err(|error| {
                EgressProxyError::new(format!(
                    "failed to write upstream websocket request message: {error}"
                ))
            })?;
        }
        upstream_writer.close().await.map_err(|error| {
            EgressProxyError::new(format!(
                "failed to close upstream websocket request stream: {error}"
            ))
        })?;
        Ok(DirectGatewayWebSocketTunnelOutcome::Completed)
    });

    let mut response_task = tokio::spawn(async move {
        while let Some(message) = upstream_reader.next().await {
            let message = message.map_err(|error| {
                EgressProxyError::new(format!(
                    "failed to read upstream websocket response message: {error}"
                ))
            })?;
            let gateway_service_restart_close = match &message {
                Message::Close(close_frame) => {
                    is_gateway_service_restart_close_frame(close_frame.as_ref())
                }
                _ => false,
            };
            let close_received = matches!(message, Message::Close(_));
            downstream_writer.send(message).await.map_err(|error| {
                EgressProxyError::new(format!(
                    "failed to write downstream websocket response message: {error}"
                ))
            })?;
            if gateway_service_restart_close {
                return Ok::<DirectGatewayWebSocketTunnelOutcome, EgressProxyError>(
                    DirectGatewayWebSocketTunnelOutcome::GatewayServiceRestart,
                );
            }
            if close_received {
                return Ok::<DirectGatewayWebSocketTunnelOutcome, EgressProxyError>(
                    DirectGatewayWebSocketTunnelOutcome::Completed,
                );
            }
        }
        downstream_writer.close().await.map_err(|error| {
            EgressProxyError::new(format!("failed to close downstream websocket: {error}"))
        })?;
        Ok(DirectGatewayWebSocketTunnelOutcome::Completed)
    });

    tokio::select! {
        request_result = &mut request_task => {
            request_result
                .map_err(|error| EgressProxyError::new(format!("direct gateway websocket request task failed: {error}")))??;
            response_task.await
                .map_err(|error| EgressProxyError::new(format!("direct gateway websocket response task failed: {error}")))?
        }
        response_result = &mut response_task => {
            request_task.abort();
            response_result
                .map_err(|error| EgressProxyError::new(format!("direct gateway websocket response task failed: {error}")))?
        }
    }
}

fn is_gateway_service_restart_close_frame(close_frame: Option<&CloseFrame>) -> bool {
    let Some(close_frame) = close_frame else {
        return false;
    };

    matches!(
        close_frame.code,
        CloseCode::Library(GATEWAY_SERVICE_RESTART_CLOSE_CODE)
    ) && close_frame.reason == GATEWAY_SERVICE_RESTART_CLOSE_REASON
}

async fn send_direct_upstream_http_request(
    parts: hyper::http::request::Parts,
    body: Incoming,
    request_target: &RequestTarget,
    mark_upstream_socket: bool,
) -> Result<Response<Incoming>, EgressProxyError> {
    let mut request_builder = Request::builder()
        .method(parts.method)
        .uri(origin_form_uri(&request_target.uri)?)
        .header(HOST, request_target.authority.as_str());
    for (header_name, header_value) in filter_outbound_request_headers(&parts.headers) {
        request_builder = request_builder.header(header_name, header_value);
    }
    let direct_request = request_builder
        .body(box_body(body.map_err(box_hyper_error)))
        .map_err(|error| {
            EgressProxyError::new(format!("failed to build direct upstream request: {error}"))
        })?;

    match connect_direct_http_upstream(&request_target.uri, mark_upstream_socket).await? {
        DirectHttpUpstreamStream::Plain(stream) => {
            send_direct_upstream_http_request_over_io(stream, direct_request).await
        }
        DirectHttpUpstreamStream::Tls(stream) => {
            send_direct_upstream_http_request_over_io(*stream, direct_request).await
        }
    }
}

async fn send_direct_upstream_http_request_over_io<T>(
    stream: T,
    request: Request<HyperBody>,
) -> Result<Response<Incoming>, EgressProxyError>
where
    T: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut sender, connection) = client_http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|error| {
            EgressProxyError::new(format!("direct upstream HTTP handshake failed: {error}"))
        })?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    sender.send_request(request).await.map_err(|error| {
        EgressProxyError::new(format!("direct upstream HTTP request failed: {error}"))
    })
}

async fn connect_direct_http_upstream(
    uri: &Uri,
    mark_upstream_socket: bool,
) -> Result<DirectHttpUpstreamStream, EgressProxyError> {
    let target_url = Url::parse(&uri.to_string()).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to parse direct upstream HTTP target '{uri}': {error}"
        ))
    })?;
    let host = target_url.host_str().ok_or_else(|| {
        EgressProxyError::new(format!(
            "direct upstream HTTP target '{target_url}' is missing a host"
        ))
    })?;
    let port = target_url.port_or_known_default().ok_or_else(|| {
        EgressProxyError::new(format!(
            "direct upstream HTTP target '{target_url}' is missing a port for scheme '{}'",
            target_url.scheme()
        ))
    })?;
    let tcp_stream = connect_upstream_tcp_stream(host, port, mark_upstream_socket).await?;

    match target_url.scheme() {
        "http" => Ok(DirectHttpUpstreamStream::Plain(tcp_stream)),
        "https" => {
            let server_name = tls_server_name(host, "direct upstream HTTPS target")?;
            let tls_stream = build_direct_tls_connector()?
                .connect(server_name, tcp_stream)
                .await
                .map_err(|error| {
                    EgressProxyError::new(format!(
                        "direct upstream HTTPS handshake to '{host}:{port}' failed: {error}"
                    ))
                })?;
            Ok(DirectHttpUpstreamStream::Tls(Box::new(tls_stream)))
        }
        scheme => Err(EgressProxyError::new(format!(
            "direct upstream HTTP target must use http or https, got '{scheme}'"
        ))),
    }
}

async fn connect_direct_upstream_websocket(
    uri: &Uri,
    mark_upstream_socket: bool,
) -> Result<WebSocketStream<MaybeTlsStream<TcpStream>>, EgressProxyError> {
    let target = websocket_target_url(uri)?;
    let request = target.into_client_request().map_err(|error| {
        EgressProxyError::new(format!(
            "failed to build direct upstream websocket request: {error}"
        ))
    })?;
    connect_direct_websocket_request(
        request,
        mark_upstream_socket,
        "direct upstream websocket target",
    )
    .await
}

async fn connect_direct_gateway_websocket_request(
    request: ClientWebSocketRequest,
) -> Result<WebSocketStream<MaybeTlsStream<TcpStream>>, EgressProxyError> {
    connect_direct_websocket_request(request, true, "direct gateway websocket target").await
}

async fn connect_direct_websocket_request(
    request: ClientWebSocketRequest,
    mark_upstream_socket: bool,
    target_description: &str,
) -> Result<WebSocketStream<MaybeTlsStream<TcpStream>>, EgressProxyError> {
    let target = request.uri().to_string();
    let target_url = Url::parse(&target).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to parse {target_description} '{target}': {error}"
        ))
    })?;
    let host = target_url.host_str().ok_or_else(|| {
        EgressProxyError::new(format!(
            "{target_description} '{target_url}' is missing a host"
        ))
    })?;
    let port = target_url.port_or_known_default().ok_or_else(|| {
        EgressProxyError::new(format!(
            "{target_description} '{target_url}' is missing a port for scheme '{}'",
            target_url.scheme()
        ))
    })?;
    let tcp_stream = connect_upstream_tcp_stream(host, port, mark_upstream_socket).await?;
    let upstream_stream = match target_url.scheme() {
        "ws" => MaybeTlsStream::Plain(tcp_stream),
        "wss" => {
            let server_name = tls_server_name(host, target_description)?;
            let tls_stream = build_direct_tls_connector()?
                .connect(server_name, tcp_stream)
                .await
                .map_err(|error| {
                    EgressProxyError::new(format!(
                        "{target_description} TLS handshake to '{host}:{port}' failed: {error}"
                    ))
                })?;
            MaybeTlsStream::Rustls(tls_stream)
        }
        scheme => {
            return Err(EgressProxyError::new(format!(
                "{target_description} must use ws or wss, got '{scheme}'"
            )));
        }
    };
    client_async(request, upstream_stream)
        .await
        .map(|(socket, _)| socket)
        .map_err(|error| {
            EgressProxyError::new(format!("{target_description} connection failed: {error}"))
        })
}

async fn connect_upstream_tcp_stream(
    host: &str,
    port: u16,
    mark_upstream_socket: bool,
) -> Result<TcpStream, EgressProxyError> {
    let mut last_error: Option<String> = None;
    let socket_addresses = tokio::net::lookup_host((host, port))
        .await
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to resolve direct upstream '{host}:{port}': {error}"
            ))
        })?;

    for socket_address in socket_addresses {
        let socket = match socket_address {
            SocketAddr::V4(_) => TcpSocket::new_v4(),
            SocketAddr::V6(_) => TcpSocket::new_v6(),
        }
        .map_err(|error| {
            EgressProxyError::new(format!("failed to create direct upstream socket: {error}"))
        })?;
        if mark_upstream_socket {
            configure_transparent_passthrough_upstream_socket(&socket)?;
        }
        match socket.connect(socket_address).await {
            Ok(stream) => return Ok(stream),
            Err(error) => {
                last_error = Some(format!("{socket_address}: {error}"));
            }
        }
    }

    Err(EgressProxyError::new(format!(
        "failed to connect direct upstream '{host}:{port}'{}",
        last_error.map_or_else(String::new, |error| format!(": {error}"))
    )))
}

fn origin_form_uri(uri: &Uri) -> Result<Uri, EgressProxyError> {
    uri.path_and_query()
        .map_or("/", |path_and_query| path_and_query.as_str())
        .parse()
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct upstream origin-form URI: {error}"
            ))
        })
}

fn direct_gateway_host_header(uri: &Uri) -> Result<HeaderValue, EgressProxyError> {
    let authority = uri.authority().ok_or_else(|| {
        EgressProxyError::new(format!(
            "direct gateway egress URL '{uri}' is missing an authority"
        ))
    })?;
    HeaderValue::from_str(authority.as_str()).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to build direct gateway host header for '{authority}': {error}"
        ))
    })
}

fn response_from_direct_upstream_response(
    upstream_response: Response<Incoming>,
    request_context: Arc<EgressProxyRequestContext>,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let status = upstream_response.status();
    let mut response_headers_fields = request_context.common_fields();
    response_headers_fields.push(("upstreamStatus", Value::from(u64::from(status.as_u16()))));
    emit_egress_proxy_log(
        request_context.clock.as_ref(),
        &request_context.sandbox_instance_id,
        "egress_proxy_upstream_headers_received",
        &response_headers_fields,
    );

    let (parts, body) = upstream_response.into_parts();
    let mut response_builder = Response::builder().status(parts.status);
    for (header_name, header_value) in filter_outbound_response_headers(&parts.headers) {
        response_builder = response_builder.header(header_name, header_value);
    }
    response_builder = response_builder.header(
        SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME,
        request_context.request_id.as_str(),
    );

    response_builder
        .body(box_body(InstrumentedResponseBody {
            inner: box_body(body.map_err(box_hyper_error)),
            context: request_context,
            upstream_status: status,
            upstream_trace_id: None,
            chunk_count: 0,
            forwarded_bytes: 0,
            first_chunk_at_ms: None,
            ended: false,
        }))
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct upstream egress response: {error}"
            ))
        })
}

fn response_from_direct_gateway_response(
    gateway_response: Response<Incoming>,
    request_context: Arc<EgressProxyRequestContext>,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let status = gateway_response.status();
    let mut response_headers_fields = request_context.common_fields();
    response_headers_fields.push(("upstreamStatus", Value::from(u64::from(status.as_u16()))));
    emit_egress_proxy_log(
        request_context.clock.as_ref(),
        &request_context.sandbox_instance_id,
        "egress_proxy_upstream_headers_received",
        &response_headers_fields,
    );

    let (parts, body) = gateway_response.into_parts();
    let mut response_builder = Response::builder().status(parts.status);
    for (header_name, header_value) in filter_outbound_response_headers(&parts.headers) {
        response_builder = response_builder.header(header_name, header_value);
    }
    response_builder = response_builder.header(
        SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME,
        request_context.request_id.as_str(),
    );

    response_builder
        .body(box_body(InstrumentedResponseBody {
            inner: box_body(body.map_err(box_hyper_error)),
            context: request_context,
            upstream_status: status,
            upstream_trace_id: None,
            chunk_count: 0,
            forwarded_bytes: 0,
            first_chunk_at_ms: None,
            ended: false,
        }))
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct gateway egress response: {error}"
            ))
        })
}

fn box_hyper_error(error: hyper::Error) -> BoxError {
    Box::new(error)
}

fn filter_outbound_request_headers(
    headers: &hyper::HeaderMap<HeaderValue>,
) -> Vec<(HeaderName, HeaderValue)> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            let blocked = matches!(
                name.as_str().to_ascii_lowercase().as_str(),
                "connection"
                    | "proxy-connection"
                    | "proxy-authenticate"
                    | "proxy-authorization"
                    | "keep-alive"
                    | "te"
                    | "trailer"
                    | "transfer-encoding"
                    | "upgrade"
                    | "host"
            );
            if blocked {
                return None;
            }
            Some((name.clone(), value.clone()))
        })
        .collect()
}

pub(super) fn filter_direct_gateway_request_headers(
    headers: &hyper::HeaderMap<HeaderValue>,
) -> Vec<(HeaderName, HeaderValue)> {
    filter_outbound_request_headers(headers)
        .into_iter()
        .filter(|(name, _)| {
            !name
                .as_str()
                .eq_ignore_ascii_case(DIRECT_GATEWAY_EGRESS_AUTHORIZATION_HEADER_NAME)
        })
        .collect()
}

fn filter_outbound_response_headers(
    headers: &hyper::HeaderMap<HeaderValue>,
) -> Vec<(HeaderName, HeaderValue)> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            let blocked = matches!(
                name.as_str().to_ascii_lowercase().as_str(),
                "connection"
                    | "proxy-connection"
                    | "proxy-authenticate"
                    | "proxy-authorization"
                    | "keep-alive"
                    | "te"
                    | "trailer"
                    | "transfer-encoding"
                    | "upgrade"
            );
            if blocked {
                return None;
            }
            Some((name.clone(), value.clone()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener as StdTcpListener;
    use std::sync::{Mutex, mpsc};
    use std::thread;
    use std::time::Duration;

    use tokio::time::timeout;
    use tokio_tungstenite::tungstenite::handshake::derive_accept_key;
    use tokio_tungstenite::{connect_async, tungstenite::Message as TestWebSocketMessage};

    use super::*;

    #[tokio::test]
    async fn direct_gateway_websocket_connector_preserves_egress_token_header() {
        let listener = StdTcpListener::bind(("127.0.0.1", 0))
            .expect("test gateway should bind to an ephemeral loopback port");
        let gateway_address = listener
            .local_addr()
            .expect("test gateway should expose its bound address");
        let (request_sender, request_receiver) = mpsc::channel();
        let server_thread = thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("test gateway should accept one request");
            let request_text = read_test_http_headers_from_stream(&mut stream);
            let websocket_key = request_text
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    if name.eq_ignore_ascii_case("sec-websocket-key") {
                        Some(value.trim().to_string())
                    } else {
                        None
                    }
                })
                .expect("websocket request should include Sec-WebSocket-Key");
            let accept_key = derive_accept_key(websocket_key.as_bytes());
            request_sender
                .send(request_text)
                .expect("test gateway request should be recorded");
            write!(
                stream,
                "HTTP/1.1 101 Switching Protocols\r\nconnection: upgrade\r\nupgrade: websocket\r\nsec-websocket-accept: {accept_key}\r\n\r\n"
            )
            .expect("test gateway should write handshake response");
        });
        let mut gateway_request = format!(
            "ws://{gateway_address}/_mistle/egress/ws?target=wss%3A%2F%2Fchatgpt.com%2Fbackend-api%2Fcodex%2Fresponses"
        )
        .into_client_request()
        .expect("gateway websocket request should build");
        gateway_request.headers_mut().insert(
            HeaderName::from_static(DIRECT_GATEWAY_EGRESS_AUTHORIZATION_HEADER_NAME),
            HeaderValue::from_static("Bearer gateway-token"),
        );

        let socket = connect_direct_gateway_websocket_request(gateway_request)
            .await
            .expect("direct gateway websocket should connect");
        drop(socket);
        let request_text = request_receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("test gateway should receive the websocket request");

        assert!(
            request_text.starts_with("GET /_mistle/egress/ws?target=wss%3A%2F%2Fchatgpt.com%2Fbackend-api%2Fcodex%2Fresponses HTTP/1.1\r\n"),
            "gateway should receive encoded target path: {request_text}"
        );
        assert!(
            request_text.lines().any(|line| {
                line == format!(
                    "{DIRECT_GATEWAY_EGRESS_AUTHORIZATION_HEADER_NAME}: Bearer gateway-token"
                )
            }),
            "gateway should receive the egress token header: {request_text}"
        );

        server_thread
            .join()
            .expect("test gateway server thread should join");
    }

    #[test]
    fn direct_gateway_websocket_close_classifier_requires_service_restart_code_and_reason() {
        assert!(is_gateway_service_restart_close_frame(Some(&CloseFrame {
            code: CloseCode::Library(4001),
            reason: "service_restart".into(),
        })));

        assert!(!is_gateway_service_restart_close_frame(Some(&CloseFrame {
            code: CloseCode::Library(4001),
            reason: "ordinary_close".into(),
        })));

        assert!(!is_gateway_service_restart_close_frame(Some(&CloseFrame {
            code: CloseCode::Normal,
            reason: "service_restart".into(),
        })));

        assert!(!is_gateway_service_restart_close_frame(None));
    }

    #[tokio::test]
    async fn direct_gateway_websocket_service_restart_close_is_forwarded_to_downstream() {
        let gateway_listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("test gateway listener should bind");
        let gateway_address = gateway_listener
            .local_addr()
            .expect("test gateway listener should expose its address");
        let gateway_client_stream = TcpStream::connect(gateway_address)
            .await
            .expect("test should connect gateway client stream");
        let (gateway_server_stream, _) = gateway_listener
            .accept()
            .await
            .expect("test gateway should accept client stream");
        let gateway_client_socket = WebSocketStream::from_raw_socket(
            MaybeTlsStream::Plain(gateway_client_stream),
            Role::Client,
            None,
        )
        .await;
        let mut gateway_server_socket =
            WebSocketStream::from_raw_socket(gateway_server_stream, Role::Server, None).await;

        let downstream_listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("downstream proxy listener should bind");
        let downstream_address = downstream_listener
            .local_addr()
            .expect("downstream proxy listener should expose its address");
        let gateway_socket = Arc::new(Mutex::new(Some(gateway_client_socket)));
        let (tunnel_result_sender, tunnel_result_receiver) = oneshot::channel();
        let tunnel_result_sender = Arc::new(Mutex::new(Some(tunnel_result_sender)));
        let gateway_socket_for_service = gateway_socket.clone();
        let tunnel_result_sender_for_service = tunnel_result_sender.clone();

        let downstream_server = tokio::spawn(async move {
            let (stream, _) = downstream_listener
                .accept()
                .await
                .expect("downstream proxy should accept websocket client");
            http1::Builder::new()
                .serve_connection(
                    TokioIo::new(stream),
                    service_fn(move |mut request| {
                        let gateway_socket_for_request = gateway_socket_for_service.clone();
                        let tunnel_result_sender_for_request =
                            tunnel_result_sender_for_service.clone();
                        async move {
                            let websocket_accept_key = request
                                .headers()
                                .get("sec-websocket-key")
                                .map(|value| derive_accept_key(value.as_bytes()))
                                .expect("downstream websocket request should include key");
                            let downstream_upgrade = hyper::upgrade::on(&mut request);
                            let gateway_socket = gateway_socket_for_request
                                .lock()
                                .expect("gateway socket mutex should not be poisoned")
                                .take()
                                .expect("gateway socket should be available");
                            let tunnel_result_sender = tunnel_result_sender_for_request
                                .lock()
                                .expect("tunnel result sender mutex should not be poisoned")
                                .take()
                                .expect("tunnel result sender should be available");
                            tokio::spawn(async move {
                                let tunnel_result = tunnel_direct_gateway_upgrade(
                                    downstream_upgrade,
                                    gateway_socket,
                                )
                                .await
                                .map_err(|error| error.to_string());
                                let _ = tunnel_result_sender.send(tunnel_result);
                            });

                            Response::builder()
                                .status(StatusCode::SWITCHING_PROTOCOLS)
                                .header("connection", "upgrade")
                                .header("upgrade", "websocket")
                                .header("sec-websocket-accept", websocket_accept_key)
                                .body(empty_body())
                                .map_err(|error| {
                                    EgressProxyError::new(format!(
                                        "failed to build downstream websocket response: {error}"
                                    ))
                                })
                        }
                    }),
                )
                .with_upgrades()
                .await
                .expect("downstream proxy websocket server should complete");
        });

        let downstream_url = format!("ws://{downstream_address}/socket");
        let (mut downstream_socket, _) = connect_async(downstream_url)
            .await
            .expect("downstream websocket client should connect");
        gateway_server_socket
            .send(TestWebSocketMessage::Close(Some(CloseFrame {
                code: CloseCode::Library(4001),
                reason: "service_restart".into(),
            })))
            .await
            .expect("gateway should send service restart close");

        let downstream_message = timeout(Duration::from_secs(5), downstream_socket.next())
            .await
            .expect("downstream client should receive a websocket close")
            .expect("downstream websocket stream should produce close")
            .expect("downstream websocket close should be valid");
        let TestWebSocketMessage::Close(Some(close_frame)) = downstream_message else {
            panic!("expected downstream service_restart close frame, got {downstream_message:?}");
        };
        assert_eq!(close_frame.code, CloseCode::Library(4001));
        assert_eq!(close_frame.reason, "service_restart");

        let tunnel_result = timeout(Duration::from_secs(5), tunnel_result_receiver)
            .await
            .expect("tunnel should finish after service restart close")
            .expect("tunnel result sender should complete");
        assert_eq!(
            tunnel_result,
            Ok(DirectGatewayWebSocketTunnelOutcome::GatewayServiceRestart)
        );

        downstream_server
            .await
            .expect("downstream websocket server task should join");
    }

    fn read_test_http_headers_from_stream(stream: &mut std::net::TcpStream) -> String {
        let mut request_bytes = Vec::new();
        let mut buffer = [0_u8; 1024];
        loop {
            let read_count = stream
                .read(&mut buffer)
                .expect("test server should read request bytes");
            if read_count == 0 {
                break;
            }
            request_bytes.extend_from_slice(&buffer[..read_count]);
            if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        String::from_utf8(request_bytes).expect("test request should be UTF-8")
    }
}
