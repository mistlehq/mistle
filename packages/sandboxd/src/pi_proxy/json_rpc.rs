//! JSON-RPC request handling for the Pi websocket proxy.
//!
//! This module validates websocket messages, maps supported RPC methods onto
//! session/process operations, and keeps method-specific response formatting out
//! of the socket loop.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::pi_proxy::{PiProxyError, PiProxyState, session};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsonRpcRequest {
    id: Value,
    method: String,
    params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

#[derive(Debug, Serialize)]
struct JsonRpcErrorResponse {
    jsonrpc: &'static str,
    id: Value,
    error: JsonRpcError,
}

#[derive(Debug, Serialize)]
struct JsonRpcSuccessResponse {
    jsonrpc: &'static str,
    id: Value,
    result: Value,
}

pub(super) fn handle_json_rpc_request(state: &Arc<PiProxyState>, payload: &str) -> Vec<String> {
    let request = match serde_json::from_str::<JsonRpcRequest>(payload) {
        Ok(request) => request,
        Err(error) => {
            return vec![render_json_rpc_error(
                Value::Null,
                -32_700,
                format!("Invalid JSON-RPC request: {error}"),
            )];
        }
    };
    let mut captured_events = Vec::new();
    let result = match handle_pi_method(state, &request, &mut captured_events) {
        Ok(result) => JsonRpcSuccessResponse {
            jsonrpc: "2.0",
            id: request.id,
            result,
        },
        Err(error) => {
            return vec![render_json_rpc_error(
                request.id,
                -32_000,
                error.to_string(),
            )];
        }
    };
    let mut responses: Vec<String> = captured_events
        .into_iter()
        .map(render_pi_event_json_rpc_notification)
        .collect();
    match serde_json::to_string(&result) {
        Ok(response) => responses.push(response),
        Err(error) => responses.push(render_json_rpc_error(
            Value::Null,
            -32_000,
            error.to_string(),
        )),
    }
    responses
}

pub(super) fn render_pi_event_json_rpc_notification(event: Value) -> String {
    serde_json::to_string(&json!({
        "jsonrpc": "2.0",
        "method": "pi/event",
        "params": event,
    }))
    .unwrap_or_else(|_| {
        "{\"jsonrpc\":\"2.0\",\"method\":\"pi/event\",\"params\":{\"type\":\"serialization_error\"}}"
            .to_string()
    })
}

fn render_json_rpc_error(id: Value, code: i64, message: String) -> String {
    let response = JsonRpcErrorResponse {
        jsonrpc: "2.0",
        id,
        error: JsonRpcError { code, message },
    };
    serde_json::to_string(&response).unwrap_or_else(|_| {
        "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32000,\"message\":\"failed to serialize error\"}}"
            .to_string()
    })
}

fn read_param_string(params: &Option<Value>, key: &str) -> Option<String> {
    params
        .as_ref()
        .and_then(|value| value.get(key))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn read_param_usize(params: &Option<Value>, key: &str) -> Option<usize> {
    params
        .as_ref()
        .and_then(|value| value.get(key))
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
}

fn require_param_usize(params: &Option<Value>, key: &str) -> Result<usize, PiProxyError> {
    read_param_usize(params, key)
        .ok_or_else(|| PiProxyError::InvalidRequest(format!("missing required parameter '{key}'")))
}

fn require_param_string(params: &Option<Value>, key: &str) -> Result<String, PiProxyError> {
    read_param_string(params, key)
        .ok_or_else(|| PiProxyError::InvalidRequest(format!("missing required parameter '{key}'")))
}

fn handle_pi_method(
    state: &Arc<PiProxyState>,
    request: &JsonRpcRequest,
    captured_events: &mut Vec<Value>,
) -> Result<Value, PiProxyError> {
    match request.method.as_str() {
        "pi/createConversation" => {
            let cwd = read_param_string(&request.params, "cwd");
            state.ensure_child(cwd.as_deref())?;
            state.send_pi_command_with_captured_events(
                json!({ "type": "new_session" }),
                captured_events,
            )?;
            let state_value = state.send_pi_command_with_captured_events(
                json!({ "type": "get_state" }),
                captured_events,
            )?;
            let session_file = PiProxyState::read_session_file(&state_value)?;
            let provider_conversation_id = state_value["sessionId"].as_str().ok_or_else(|| {
                PiProxyError::InvalidRequest("Pi did not report sessionId".to_string())
            })?;
            Ok(json!({
                "providerConversationId": provider_conversation_id,
                "sessionFile": session_file,
            }))
        }
        "pi/findRecentConversation" => {
            let cwd = read_param_string(&request.params, "cwd");
            let conversation =
                session::find_recent_conversation(&state.config.env, cwd.as_deref())?;
            Ok(match conversation {
                Some(conversation) => json!({
                    "providerConversationId": conversation.id,
                }),
                None => json!({
                    "providerConversationId": Value::Null,
                }),
            })
        }
        "pi/listConversations" => {
            let cwd = read_param_string(&request.params, "cwd");
            let limit = require_param_usize(&request.params, "limit")?;
            session::list_conversations(&state.config.env, cwd.as_deref(), limit)
        }
        "pi/resolveConversation" => {
            let provider_conversation_id =
                require_param_string(&request.params, "providerConversationId")?;
            let conversation =
                session::find_conversation_by_id(&state.config.env, &provider_conversation_id)?;
            Ok(json!({ "sessionFile": conversation.path.to_string_lossy().to_string() }))
        }
        "pi/getState" => {
            let session_file = read_param_string(&request.params, "sessionFile");
            state.ensure_child(None)?;
            if let Some(session_file) = session_file {
                state.switch_session(&session_file, captured_events)?;
            }
            state.send_pi_command_with_captured_events(
                json!({ "type": "get_state" }),
                captured_events,
            )
        }
        "pi/getAvailableModels" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            state.send_pi_command_with_captured_events(
                json!({ "type": "get_available_models" }),
                captured_events,
            )
        }
        "pi/readMetadata" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            let state_value = state.send_pi_command_with_captured_events(
                json!({ "type": "get_state" }),
                captured_events,
            )?;
            Ok(json!({
                "name": state_value.get("sessionName").cloned().unwrap_or(Value::Null),
                "preview": Value::Null
            }))
        }
        "pi/getMessages" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            let messages_value = state.send_pi_command_with_captured_events(
                json!({ "type": "get_messages" }),
                captured_events,
            )?;
            Ok(messages_value)
        }
        "pi/resumeConversation" => {
            let provider_conversation_id =
                require_param_string(&request.params, "providerConversationId")?;
            let conversation =
                session::find_conversation_by_id(&state.config.env, &provider_conversation_id)?;
            let session_file = conversation.path.to_string_lossy().to_string();
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            PiProxyState::mark_active_and_start_activity_monitor(state);
            Ok(json!({ "sessionFile": session_file }))
        }
        "pi/setModel" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            let provider = require_param_string(&request.params, "provider")?;
            let model_id = require_param_string(&request.params, "modelId")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            state.send_pi_command_with_captured_events(
                json!({ "type": "set_model", "provider": provider, "modelId": model_id }),
                captured_events,
            )
        }
        "pi/setThinkingLevel" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            let level = require_param_string(&request.params, "level")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            state.send_pi_command_with_captured_events(
                json!({ "type": "set_thinking_level", "level": level }),
                captured_events,
            )
        }
        "pi/setSessionName" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            let name = require_param_string(&request.params, "name")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            state.send_pi_command_with_captured_events(
                json!({ "type": "set_session_name", "name": name }),
                captured_events,
            )
        }
        "pi/prompt" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            let message = require_param_string(&request.params, "message")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            PiProxyState::mark_active_and_start_activity_monitor(state);
            state.send_pi_command_with_captured_events(
                json!({ "type": "prompt", "message": message }),
                captured_events,
            )
        }
        "pi/steer" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            let message = require_param_string(&request.params, "message")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            PiProxyState::mark_active_and_start_activity_monitor(state);
            state.send_pi_command_with_captured_events(
                json!({ "type": "steer", "message": message }),
                captured_events,
            )
        }
        "pi/followUp" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            let message = require_param_string(&request.params, "message")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            PiProxyState::mark_active_and_start_activity_monitor(state);
            state.send_pi_command_with_captured_events(
                json!({ "type": "follow_up", "message": message }),
                captured_events,
            )
        }
        "pi/abort" => {
            let session_file = require_param_string(&request.params, "sessionFile")?;
            state.ensure_child(None)?;
            state.switch_session(&session_file, captured_events)?;
            state.send_pi_command_with_captured_events(json!({ "type": "abort" }), captured_events)
        }
        other => Err(PiProxyError::InvalidRequest(format!(
            "unsupported Pi proxy method '{other}'"
        ))),
    }
}
