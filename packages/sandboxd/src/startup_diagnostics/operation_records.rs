//! Asynchronous operation-record delivery for startup diagnostics.
//!
//! Initialization paths enqueue lifecycle records here so network delivery can
//! retry briefly without blocking the main startup flow indefinitely.

use std::time::Instant;

use serde_json::{Map, Value, json};
use tokio::sync::mpsc;

use crate::startup_diagnostics::{
    LIFECYCLE_OPERATION_RECORD_SEND_RETRY_INTERVAL, LIFECYCLE_OPERATION_RECORD_SEND_TIMEOUT,
    StartupOperation,
};
use crate::tunnel::session::OperationStreamMessage;

pub(super) fn send_lifecycle_operation_record_with_timeout(
    sender: mpsc::Sender<OperationStreamMessage>,
    mut operation_record: OperationStreamMessage,
) {
    let deadline = Instant::now() + LIFECYCLE_OPERATION_RECORD_SEND_TIMEOUT;
    loop {
        match sender.try_send(operation_record) {
            Ok(()) => return,
            Err(mpsc::error::TrySendError::Closed(_)) => {
                eprintln!("sandboxd dropped lifecycle operation record because stream is closed");
                return;
            }
            Err(mpsc::error::TrySendError::Full(returned_record)) => {
                if Instant::now() >= deadline {
                    eprintln!("sandboxd dropped lifecycle operation record after send timeout");
                    return;
                }
                operation_record = returned_record;
                std::thread::sleep(LIFECYCLE_OPERATION_RECORD_SEND_RETRY_INTERVAL);
            }
        }
    }
}

pub(super) fn operation_record_line(
    operation: StartupOperation,
    observed_at: String,
    event: &str,
    payload: &Value,
) -> Result<Option<String>, String> {
    let record = if event == started_event_name(operation) || event == failed_event_name(operation)
    {
        return Ok(None);
    } else if event == phase_started_event_name(operation) {
        let Some(phase) = payload.get("phase").and_then(Value::as_str) else {
            return Ok(None);
        };
        let Some(phase) = operation_lifecycle_phase(phase) else {
            return Ok(None);
        };
        json!({
            "kind": "lifecycle",
            "observedAt": observed_at,
            "phase": phase,
            "status": "started",
            "source": "sandboxd",
            "message": format!("{phase} started"),
            "attributes": lifecycle_attributes(payload)
        })
    } else if event == phase_completed_event_name(operation) {
        let Some(phase) = payload.get("phase").and_then(Value::as_str) else {
            return Ok(None);
        };
        let Some(phase) = operation_lifecycle_phase(phase) else {
            return Ok(None);
        };
        json!({
            "kind": "lifecycle",
            "observedAt": observed_at,
            "phase": phase,
            "status": "completed",
            "source": "sandboxd",
            "message": format!("{phase} completed"),
            "attributes": lifecycle_attributes(payload)
        })
    } else if event == phase_failed_event_name(operation) {
        let Some(phase) = payload.get("phase").and_then(Value::as_str) else {
            return Ok(None);
        };
        let Some(phase) = operation_lifecycle_phase(phase) else {
            return Ok(None);
        };
        json!({
            "kind": "lifecycle",
            "observedAt": observed_at,
            "phase": phase,
            "status": "failed",
            "source": "sandboxd",
            "message": format!("{phase} failed"),
            "attributes": lifecycle_attributes(payload)
        })
    } else if event == transcript_event_name(operation) {
        json!({
            "kind": "transcript",
            "observedAt": observed_at,
            "phase": payload
                .get("phase")
                .and_then(Value::as_str)
                .and_then(operation_lifecycle_phase),
            "source": "sandboxd",
            "stream": payload.get("stream").and_then(Value::as_str).unwrap_or("system"),
            "payloadBase64": payload
                .get("payloadBase64")
                .and_then(Value::as_str)
                .unwrap_or("")
        })
    } else {
        return Ok(None);
    };

    let mut line = serde_json::to_string(&record)
        .map_err(|error| format!("failed to serialize operation record: {error}"))?;
    line.push('\n');
    Ok(Some(line))
}

pub(super) fn operation_lifecycle_phase(phase: &str) -> Option<&'static str> {
    match phase {
        "apply_git_identity" => Some("git_identity"),
        "attach_runtime_agent_endpoint" => Some("agent_endpoint"),
        "apply_runtime_plan" => Some("runtime_plan"),
        "run_setup_script" => Some("setup_script"),
        "start_egress_proxy" => Some("egress"),
        "start_runtime_adapters" => Some("runtime_adapters"),
        "start_runtime_processes" => Some("runtime_processes"),
        "start_tunnel_session" | "stop_tunnel_session" | "attach_runtime_environment" => {
            Some("operation_stream")
        }
        "wait_storage_attach" => Some("storage_attach"),
        "ready" => Some("ready"),
        phase if phase.starts_with("stop_tunnel_session_") => Some("operation_stream"),
        phase if phase.starts_with("stop_egress_proxy") => Some("teardown"),
        _ => None,
    }
}

pub(super) fn lifecycle_attributes(payload: &Value) -> Value {
    let mut attributes = Map::new();
    if let Some(object) = payload.as_object() {
        for (key, value) in object {
            if matches!(
                key.as_str(),
                "timestamp" | "level" | "event" | "sandboxInstanceId" | "operation"
            ) {
                continue;
            }
            attributes.insert(key.clone(), value.clone());
        }
    }
    Value::Object(attributes)
}

pub(super) fn started_event_name(operation: StartupOperation) -> &'static str {
    match operation {
        StartupOperation::Init => "sandbox_init_started",
        StartupOperation::Resume => "sandbox_resume_started",
    }
}

pub(super) fn phase_failed_event_name(operation: StartupOperation) -> &'static str {
    match operation {
        StartupOperation::Init => "sandbox_init_phase_failed",
        StartupOperation::Resume => "sandbox_resume_phase_failed",
    }
}

pub(super) fn phase_started_event_name(operation: StartupOperation) -> &'static str {
    match operation {
        StartupOperation::Init => "sandbox_init_phase_started",
        StartupOperation::Resume => "sandbox_resume_phase_started",
    }
}

pub(super) fn phase_completed_event_name(operation: StartupOperation) -> &'static str {
    match operation {
        StartupOperation::Init => "sandbox_init_phase_completed",
        StartupOperation::Resume => "sandbox_resume_phase_completed",
    }
}

pub(super) fn failed_event_name(operation: StartupOperation) -> &'static str {
    match operation {
        StartupOperation::Init => "sandbox_init_failed",
        StartupOperation::Resume => "sandbox_resume_failed",
    }
}

pub(super) fn transcript_event_name(operation: StartupOperation) -> &'static str {
    match operation {
        StartupOperation::Init => "sandbox_init_transcript",
        StartupOperation::Resume => "sandbox_resume_transcript",
    }
}
