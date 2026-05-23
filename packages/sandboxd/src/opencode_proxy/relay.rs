//! Websocket request-envelope relay for the OpenCode HTTP server.
//!
//! Mistle clients speak a websocket protocol, while OpenCode serves HTTP routes
//! and SSE streams. This module translates client envelopes into raw HTTP
//! requests and serializes responses back over the websocket.

use std::collections::BTreeMap;

use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use http_body_util::Full;
use hyper::header::{CONTENT_TYPE, HeaderName, HeaderValue};
use hyper::{Method, Request};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::task::JoinSet;
use tokio_tungstenite::accept_async;
use tungstenite::{Error as WebSocketError, Message};

use crate::opencode_proxy::OpenCodeProxyError;
use crate::opencode_proxy::http::{
    OpenCodeHttpClient, build_opencode_target_uri, read_response_body,
};
use crate::opencode_proxy::idempotency::{
    OpenCodeIdempotencyAction, OpenCodeProxyIdempotency, SharedIdempotencyStore,
    StoredOpenCodeProxyResponse, complete_submit_idempotency, delete_started_submit_idempotency,
    prepare_opencode_idempotency,
};
use crate::opencode_proxy::sse::relay_sse_response;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenCodeProxyRequest {
    id: Value,
    method: String,
    path: String,
    headers: Option<BTreeMap<String, String>>,
    body: Option<Value>,
    idempotency: Option<OpenCodeProxyIdempotency>,
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
#[serde(rename_all = "snake_case")]
pub(super) enum OpenCodeProxyResponseType {
    Response,
    Sse,
    Complete,
}

pub(super) async fn relay_opencode_proxy_connection(
    stream: TcpStream,
    raw_server_url: String,
    client: OpenCodeHttpClient,
    idempotency_store: Option<SharedIdempotencyStore>,
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
                    let idempotency_store = idempotency_store.clone();
                    request_tasks.spawn(async move {
                        handle_opencode_proxy_request(
                            request,
                            raw_server_url,
                            client,
                            sender,
                            idempotency_store,
                        )
                        .await
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
        match joined {
            Ok(Ok(())) => {}
            Ok(Err(error)) => return Err(error),
            Err(error) if error.is_cancelled() => {}
            Err(_) => return Err(OpenCodeProxyError::SessionPanicked),
        }
    }

    Ok(())
}

async fn handle_opencode_proxy_request(
    mut request: OpenCodeProxyRequest,
    raw_server_url: String,
    client: OpenCodeHttpClient,
    sender: mpsc::UnboundedSender<Message>,
    idempotency_store: Option<SharedIdempotencyStore>,
) -> Result<(), OpenCodeProxyError> {
    let idempotency_action = prepare_opencode_idempotency(
        crate::opencode_proxy::idempotency::PrepareSubmitIdempotencyInput {
            body: request.body.as_mut(),
            idempotency: request.idempotency.as_ref(),
            method: &request.method,
            path: &request.path,
            store: idempotency_store.as_ref(),
        },
    );
    let started_idempotency = match idempotency_action {
        OpenCodeIdempotencyAction::Disabled => None,
        OpenCodeIdempotencyAction::Forward(started) => Some(started),
        OpenCodeIdempotencyAction::Replay(response) => {
            send_json_message(
                &sender,
                &OpenCodeProxyResponse {
                    id: request.id,
                    message_type: OpenCodeProxyResponseType::Response,
                    status: response.status,
                    headers: response.headers,
                    body: response.body,
                },
            )?;
            return Ok(());
        }
        OpenCodeIdempotencyAction::Reject { status, message } => {
            send_error_response(&sender, request.id, status, message)?;
            return Ok(());
        }
    };

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

    let response = match client.request(upstream_request).await {
        Ok(response) => response,
        Err(error) => {
            if let (Some(store), Some(started)) =
                (idempotency_store.as_ref(), started_idempotency.as_ref())
                && let Err(delete_error) = delete_started_submit_idempotency(store, started)
            {
                send_error_response(
                    &sender,
                    request.id,
                    500,
                    format!(
                        "OpenCode upstream request failed before a response, and the idempotency record could not be released for retry: {delete_error}"
                    ),
                )?;
                return Ok(());
            }
            send_error_response(
                &sender,
                request.id,
                502,
                format!("OpenCode upstream request failed: {error}"),
            )?;
            return Ok(());
        }
    };
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
        if let (Some(store), Some(started)) = (idempotency_store.as_ref(), started_idempotency) {
            let stored_response = StoredOpenCodeProxyResponse {
                status: 502,
                headers: BTreeMap::from([(CONTENT_TYPE.to_string(), "application/json".to_string())]),
                body: json!({
                    "error": "OpenCode idempotent requests cannot replay text/event-stream responses."
                })
                .to_string(),
            };
            if let Err(error) = complete_submit_idempotency(store, started, stored_response.clone())
            {
                send_error_response(
                    &sender,
                    request.id,
                    500,
                    format!(
                        "OpenCode SSE response could not be persisted for idempotent replay: {error}"
                    ),
                )?;
                return Ok(());
            }
            send_json_message(
                &sender,
                &OpenCodeProxyResponse {
                    id: request.id,
                    message_type: OpenCodeProxyResponseType::Response,
                    status: stored_response.status,
                    headers: stored_response.headers,
                    body: stored_response.body,
                },
            )?;
            return Ok(());
        }
        send_json_message(
            &sender,
            &OpenCodeProxyResponse {
                id: request.id.clone(),
                message_type: OpenCodeProxyResponseType::Response,
                status,
                headers,
                body: String::new(),
            },
        )?;
        relay_sse_response(request.id, response, sender).await?;
        return Ok(());
    }

    let body = match read_response_body(response.into_body()).await {
        Ok(body) => body,
        Err(error) => {
            if let (Some(store), Some(started)) =
                (idempotency_store.as_ref(), started_idempotency.as_ref())
                && let Err(delete_error) = delete_started_submit_idempotency(store, started)
            {
                send_error_response(
                    &sender,
                    request.id,
                    500,
                    format!(
                        "OpenCode upstream response body failed, and the idempotency record could not be released for retry: {delete_error}"
                    ),
                )?;
                return Ok(());
            }
            send_error_response(
                &sender,
                request.id,
                502,
                format!("OpenCode upstream response body failed: {error}"),
            )?;
            return Ok(());
        }
    };
    if let (Some(store), Some(started)) = (idempotency_store.as_ref(), started_idempotency)
        && let Err(error) = complete_submit_idempotency(
            store,
            started,
            StoredOpenCodeProxyResponse {
                status,
                headers: headers.clone(),
                body: body.clone(),
            },
        )
    {
        send_error_response(
            &sender,
            request.id,
            500,
            format!("OpenCode response could not be persisted for idempotent replay: {error}"),
        )?;
        return Ok(());
    }
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

fn send_error_response(
    sender: &mpsc::UnboundedSender<Message>,
    id: Value,
    status: u16,
    message: String,
) -> Result<(), OpenCodeProxyError> {
    send_json_message(
        sender,
        &OpenCodeProxyResponse {
            id,
            message_type: OpenCodeProxyResponseType::Response,
            status,
            headers: BTreeMap::from([(CONTENT_TYPE.to_string(), "application/json".to_string())]),
            body: json!({ "error": message }).to_string(),
        },
    )
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

pub(super) fn send_json_message<T: Serialize>(
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
