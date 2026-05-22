//! Raw Codex websocket JSON-RPC framing and notification parsing helpers.
//!
//! Proxy sessions, monitor connections, and retained-thread flows share these
//! helpers so method matching, termination detection, and thread status parsing
//! stay consistent across Codex transport paths.

use std::io::ErrorKind;

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::net::TcpStream;
use tokio::sync::watch;
use tokio_tungstenite::MaybeTlsStream;
use tokio_tungstenite::WebSocketStream;
use tungstenite::error::ProtocolError;
use tungstenite::{Error as WebSocketError, Message};

use crate::codex_proxy::CodexProxyError;

pub type RawCodexSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

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
    pub(crate) fn is_active(&self) -> bool {
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
    use tungstenite::Message;

    use crate::codex_proxy::message::parse_thread_status_changed_message;

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
