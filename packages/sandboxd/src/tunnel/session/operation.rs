//! Operation stream protocol handling owned by the live tunnel session.

use serde_json::{Map, Value};
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::supervision::SupervisedComponent;
use crate::time::Clock;
use crate::tunnel::protocol::{PAYLOAD_KIND_RAW_BYTES, StreamSendWindow, encode_stream_data_frame};
use crate::tunnel::session::SANDBOX_OPERATION_STREAM_ID;
use crate::tunnel::session::bootstrap::{
    TunnelWriterMessage, write_tunnel_binary, write_tunnel_flush, write_tunnel_text,
};
use crate::tunnel::session::error::TunnelSessionError;
use crate::tunnel::session::state::TunnelSessionMutableState;

pub(super) const OPERATION_RECORD_CHANNEL_CAPACITY: usize = 1024;
const PENDING_OPERATION_RECORD_CAPACITY: usize = 1024;
pub(super) const SANDBOX_OPERATION_STREAM_FORMAT: &str = "mistle.sandbox-operation.v1+jsonl";

pub enum OperationStreamMessage {
    Record(String),
    Close {
        response_sender: std::sync::mpsc::Sender<Result<(), String>>,
    },
}

pub(super) fn operation_open(operation_id: &str, operation_kind: &str) -> String {
    serde_json::json!({
        "type": "operation.open",
        "streamId": SANDBOX_OPERATION_STREAM_ID,
        "operationId": operation_id,
        "operationKind": operation_kind,
        "format": SANDBOX_OPERATION_STREAM_FORMAT
    })
    .to_string()
}

fn operation_close() -> String {
    serde_json::json!({
        "type": "operation.close",
        "streamId": SANDBOX_OPERATION_STREAM_ID
    })
    .to_string()
}

fn write_operation_record(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    payload: &[u8],
) -> Result<(), TunnelSessionError> {
    let frame =
        encode_stream_data_frame(SANDBOX_OPERATION_STREAM_ID, PAYLOAD_KIND_RAW_BYTES, payload)
            .map_err(|error| TunnelSessionError::ParseDataFrame(error.to_string()))?;
    write_tunnel_binary(tunnel_writer_sender, frame)
}

pub(super) fn close_operation_stream(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
    response_sender: std::sync::mpsc::Sender<Result<(), String>>,
) {
    session_state.operation_stream_close_requested = true;
    session_state.operation_stream_close_response_sender = Some(response_sender);
    flush_pending_operation_records(tunnel_writer_sender, session_state);
    close_operation_stream_if_drained(tunnel_writer_sender, session_state);
}

fn close_operation_stream_if_drained(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
) {
    if !session_state.operation_stream_close_requested
        || !session_state.pending_operation_records.is_empty()
    {
        return;
    }

    let response_sender = session_state.operation_stream_close_response_sender.take();

    if session_state.operation_stream_requested {
        if let Err(error) = write_tunnel_text(tunnel_writer_sender, operation_close()) {
            if let Some(response_sender) = response_sender {
                let _ = response_sender.send(Err(error.to_string()));
            }
            eprintln!("sandboxd failed to close operation stream: {error}");
        } else if let Some(response_sender) = response_sender
            && let Err(error) = write_tunnel_flush(tunnel_writer_sender, response_sender)
        {
            eprintln!("sandboxd failed to wait for operation stream flush: {error}");
        }
    } else if let Some(response_sender) = response_sender {
        let _ = response_sender.send(Ok(()));
    }
    session_state.operation_stream_requested = false;
    session_state.operation_stream_close_requested = false;
    session_state.operation_stream_send_window = None;
}

pub(super) fn handle_operation_control_message(
    payload: &str,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(payload) else {
        return false;
    };
    let Some(message_type) = value.get("type").and_then(Value::as_str) else {
        return false;
    };
    match message_type {
        "operation.open.ok" => {
            if value
                .get("streamId")
                .and_then(Value::as_u64)
                .and_then(|stream_id| u32::try_from(stream_id).ok())
                != Some(SANDBOX_OPERATION_STREAM_ID)
            {
                return true;
            }
            let Some(initial_window_bytes) = value
                .get("initialWindowBytes")
                .and_then(Value::as_u64)
                .and_then(|bytes| usize::try_from(bytes).ok())
            else {
                session_state.operation_stream_send_window = None;
                return true;
            };
            session_state.operation_stream_send_window =
                Some(StreamSendWindow::new(initial_window_bytes));
            flush_pending_operation_records(tunnel_writer_sender, session_state);
            close_operation_stream_if_drained(tunnel_writer_sender, session_state);
            true
        }
        "operation.window" => {
            if value
                .get("streamId")
                .and_then(Value::as_u64)
                .and_then(|stream_id| u32::try_from(stream_id).ok())
                != Some(SANDBOX_OPERATION_STREAM_ID)
            {
                return true;
            }
            if let Some(send_window) = session_state.operation_stream_send_window.as_mut()
                && let Some(bytes) = value
                    .get("bytes")
                    .and_then(Value::as_u64)
                    .and_then(|bytes| usize::try_from(bytes).ok())
            {
                let _ = send_window.add(bytes);
            }
            flush_pending_operation_records(tunnel_writer_sender, session_state);
            close_operation_stream_if_drained(tunnel_writer_sender, session_state);
            true
        }
        "operation.open.error" | "operation.reset" => {
            session_state.operation_stream_requested = false;
            session_state.operation_stream_close_requested = false;
            if let Some(response_sender) =
                session_state.operation_stream_close_response_sender.take()
            {
                let _ = response_sender.send(Err(format!("{message_type} received")));
            }
            session_state.operation_stream_send_window = None;
            session_state.pending_operation_records.clear();
            true
        }
        _ => message_type.starts_with("operation."),
    }
}

pub(super) fn enqueue_operation_record(
    session_state: &mut TunnelSessionMutableState,
    line: String,
) {
    if session_state.pending_operation_records.len() >= PENDING_OPERATION_RECORD_CAPACITY {
        return;
    }
    session_state.pending_operation_records.push_back(line);
}

pub(super) fn flush_pending_operation_records(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
) {
    let Some(send_window) = session_state.operation_stream_send_window.as_mut() else {
        return;
    };
    while let Some(line) = session_state.pending_operation_records.front() {
        if !send_window.try_consume(line.len()) {
            return;
        }
        if let Some(line) = session_state.pending_operation_records.pop_front()
            && let Err(error) = write_operation_record(tunnel_writer_sender, line.as_bytes())
        {
            eprintln!("sandboxd failed to publish operation record: {error}");
            session_state.operation_stream_send_window = None;
            return;
        }
    }
    close_operation_stream_if_drained(tunnel_writer_sender, session_state);
}

pub(super) fn record_egress_token_event(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
    clock: &dyn Clock,
    sandbox_instance_id: &str,
    event: &str,
    request_id: &str,
    extra_fields: &[(&str, Value)],
) {
    let maybe_error = extra_fields
        .iter()
        .find_map(|(field, value)| (*field == "error").then_some(value))
        .and_then(Value::as_str);
    if let Some(error) = maybe_error {
        warn!(
            event = event,
            request_id = request_id,
            sandbox_instance_id = sandbox_instance_id,
            error = error,
            "gateway egress token request failed"
        );
    } else {
        info!(
            event = event,
            request_id = request_id,
            sandbox_instance_id = sandbox_instance_id,
            "gateway egress token request advanced"
        );
    }

    if !session_state.operation_stream_requested
        && session_state.operation_stream_send_window.is_none()
    {
        return;
    }

    let Ok(observed_at) = crate::time::format_rfc3339_timestamp(clock.now_system_time()) else {
        return;
    };
    if let Ok(Some(line)) = egress_token_operation_record_line(
        observed_at,
        event,
        sandbox_instance_id,
        request_id,
        extra_fields,
    ) {
        enqueue_operation_record(session_state, line + "\n");
        flush_pending_operation_records(tunnel_writer_sender, session_state);
    }
}

fn egress_token_operation_record_line(
    observed_at: String,
    event: &str,
    sandbox_instance_id: &str,
    request_id: &str,
    extra_fields: &[(&str, Value)],
) -> Result<Option<String>, serde_json::Error> {
    let mut attributes = Map::new();
    attributes.insert("event".to_string(), Value::String(event.to_string()));
    attributes.insert(
        "component".to_string(),
        Value::String(SupervisedComponent::TunnelSession.as_str().to_string()),
    );
    attributes.insert(
        "sandboxInstanceId".to_string(),
        Value::String(sandbox_instance_id.to_string()),
    );
    attributes.insert(
        "requestId".to_string(),
        Value::String(request_id.to_string()),
    );
    for (field_name, field_value) in extra_fields {
        attributes.insert((*field_name).to_string(), field_value.clone());
    }

    let Some((status, message)) = (match event {
        "egress_token_request_started" => Some(("started", "Gateway egress token request started")),
        "egress_token_request_completed" => {
            Some(("completed", "Gateway egress token request completed"))
        }
        "egress_token_request_failed" => Some(("failed", "Gateway egress token request failed")),
        _ => None,
    }) else {
        return Ok(None);
    };

    serde_json::to_string(&serde_json::json!({
        "kind": "lifecycle",
        "observedAt": observed_at,
        "phase": "egress",
        "status": status,
        "source": "sandboxd",
        "message": message,
        "attributes": attributes
    }))
    .map(Some)
}
