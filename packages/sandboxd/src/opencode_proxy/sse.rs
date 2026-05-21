use http_body_util::BodyExt;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::mpsc;
use tungstenite::Message;

use crate::opencode_proxy::OpenCodeProxyError;
use crate::opencode_proxy::relay::{OpenCodeProxyResponseType, send_json_message};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ParsedSseEvent {
    pub(super) event: Option<String>,
    pub(super) data: String,
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

pub(super) async fn relay_sse_response(
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
            if let Some(event) = parse_sse_event(&event_text) {
                send_proxy_sse_event(&sender, &id, event)?;
            }
        }
    }
    if !buffer.trim().is_empty()
        && let Some(event) = parse_sse_event(&buffer)
    {
        send_proxy_sse_event(&sender, &id, event)?;
    }
    send_json_message(
        &sender,
        &OpenCodeProxyComplete {
            id,
            message_type: OpenCodeProxyResponseType::Complete,
        },
    )
}

pub(super) fn parse_sse_event(event_text: &str) -> Option<ParsedSseEvent> {
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
    Some(ParsedSseEvent {
        event: event_name,
        data: data_lines.join("\n"),
    })
}

fn send_proxy_sse_event(
    sender: &mpsc::UnboundedSender<Message>,
    id: &Value,
    event: ParsedSseEvent,
) -> Result<(), OpenCodeProxyError> {
    send_json_message(
        sender,
        &OpenCodeProxySseEvent {
            id: id.clone(),
            message_type: OpenCodeProxyResponseType::Sse,
            event: event.event,
            data: event.data,
        },
    )
}
