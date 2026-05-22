//! JSON-RPC parsing helpers used by the Codex websocket relay.
//!
//! The relay needs stable request keys and payload decoding without coupling
//! transport code to every Codex method shape, so this module keeps the generic
//! JSON-RPC pieces small and reusable.

use std::io::ErrorKind;

use serde_json::Value;
use tungstenite::Message;

use crate::codex_proxy::CodexProxyError;

pub(super) fn parse_json_value_from_message(
    message: &Message,
) -> Result<Option<Value>, CodexProxyError> {
    let Message::Text(payload) = message else {
        return Ok(None);
    };
    let value = serde_json::from_str(payload.as_str()).map_err(CodexProxyError::InvalidJson)?;
    Ok(Some(value))
}

pub(super) fn parse_json_rpc_id_from_message(message: &Message) -> Result<Value, CodexProxyError> {
    let Some(value) = parse_json_value_from_message(message)? else {
        return Err(CodexProxyError::InvalidJson(serde_json::Error::io(
            std::io::Error::new(
                ErrorKind::InvalidData,
                "Codex proxy expected a JSON-RPC text message with an id",
            ),
        )));
    };

    value.get("id").cloned().ok_or_else(|| {
        CodexProxyError::InvalidJson(serde_json::Error::io(std::io::Error::new(
            ErrorKind::InvalidData,
            "Codex proxy expected a JSON-RPC message id",
        )))
    })
}

pub(super) fn json_rpc_id_key(request_id: &Value) -> Option<String> {
    match request_id {
        Value::Null => None,
        _ => Some(request_id.to_string()),
    }
}
