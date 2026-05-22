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
use crate::opencode_proxy::sse::relay_sse_response;

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

    let response = match client.request(upstream_request).await {
        Ok(response) => response,
        Err(error) => {
            send_json_message(
                &sender,
                &OpenCodeProxyResponse {
                    id: request.id,
                    message_type: OpenCodeProxyResponseType::Response,
                    status: 502,
                    headers: BTreeMap::from([(
                        CONTENT_TYPE.to_string(),
                        "application/json".to_string(),
                    )]),
                    body: json!({
                        "error": format!("OpenCode upstream request failed: {error}")
                    })
                    .to_string(),
                },
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
