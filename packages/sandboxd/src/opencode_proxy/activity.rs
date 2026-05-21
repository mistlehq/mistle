use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use http_body_util::BodyExt;
use serde_json::Value;

use crate::keepalive::KeepaliveManager;
use crate::opencode_proxy::OpenCodeProxyError;
use crate::opencode_proxy::http::{
    OpenCodeHttpClient, issue_opencode_get_request, read_response_body,
};
use crate::opencode_proxy::sse::parse_sse_event;

const OPENCODE_ACTIVITY_MONITOR_RECONNECT_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, PartialEq, Eq)]
enum OpenCodeSessionActivityUpdate {
    Active(String),
    Idle(String),
}

pub(super) async fn run_opencode_activity_monitor(
    raw_server_url: String,
    client: OpenCodeHttpClient,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    shutdown_requested: Arc<AtomicBool>,
) -> Result<(), OpenCodeProxyError> {
    let mut active_sessions = BTreeSet::<String>::new();
    while !shutdown_requested.load(Ordering::Relaxed) {
        let session_result = run_opencode_activity_monitor_session(
            &raw_server_url,
            client.clone(),
            &keepalive_manager,
            &mut active_sessions,
            &shutdown_requested,
        )
        .await;

        set_opencode_platform_activity(&keepalive_manager, false);
        active_sessions.clear();

        if let Err(error) = session_result {
            eprintln!("sandboxd OpenCode activity monitor disconnected: {error}");
        }

        if shutdown_requested.load(Ordering::Relaxed) {
            return Ok(());
        }

        tokio::time::sleep(OPENCODE_ACTIVITY_MONITOR_RECONNECT_INTERVAL).await;
    }

    Ok(())
}

async fn run_opencode_activity_monitor_session(
    raw_server_url: &str,
    client: OpenCodeHttpClient,
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
    active_sessions: &mut BTreeSet<String>,
    shutdown_requested: &Arc<AtomicBool>,
) -> Result<(), OpenCodeProxyError> {
    rebuild_opencode_activity_from_status(raw_server_url, client.clone(), active_sessions).await?;
    set_opencode_platform_activity(keepalive_manager, !active_sessions.is_empty());

    let response = issue_opencode_get_request(raw_server_url, client, "/global/event").await?;
    let mut body = response.into_body();
    let mut buffer = String::new();
    while !shutdown_requested.load(Ordering::Relaxed) {
        let Some(frame) = body.frame().await else {
            return Ok(());
        };
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
            if let Some(update) = parse_opencode_session_activity_sse_event(&event_text)? {
                apply_opencode_session_activity_update(active_sessions, update);
                set_opencode_platform_activity(keepalive_manager, !active_sessions.is_empty());
            }
        }
    }

    Ok(())
}

async fn rebuild_opencode_activity_from_status(
    raw_server_url: &str,
    client: OpenCodeHttpClient,
    active_sessions: &mut BTreeSet<String>,
) -> Result<(), OpenCodeProxyError> {
    let response = issue_opencode_get_request(raw_server_url, client, "/session/status").await?;
    let body = read_response_body(response.into_body()).await?;
    let value: Value = serde_json::from_str(&body).map_err(OpenCodeProxyError::InvalidRequest)?;
    let Some(statuses) = value.as_object() else {
        return Err(OpenCodeProxyError::ConfigureRuntime(
            "OpenCode /session/status response must be a JSON object".to_string(),
        ));
    };

    active_sessions.clear();
    for (session_id, status) in statuses {
        if opencode_status_is_active(status)? {
            active_sessions.insert(session_id.clone());
        }
    }

    Ok(())
}

fn parse_opencode_session_activity_sse_event(
    event_text: &str,
) -> Result<Option<OpenCodeSessionActivityUpdate>, OpenCodeProxyError> {
    let Some(event) = parse_sse_event(event_text) else {
        return Ok(None);
    };
    let value: Value =
        serde_json::from_str(&event.data).map_err(OpenCodeProxyError::InvalidRequest)?;
    let event_payload = value.get("payload").unwrap_or(&value);
    let Some(event_type) = event_payload.get("type").and_then(Value::as_str) else {
        return Ok(None);
    };

    match event_type {
        "session.status" => {
            let session_id = read_required_string(event_payload, &["properties", "sessionID"])?;
            let status = event_payload
                .get("properties")
                .and_then(|properties| properties.get("status"))
                .ok_or_else(|| {
                    OpenCodeProxyError::ConfigureRuntime(
                        "OpenCode session.status event is missing properties.status".to_string(),
                    )
                })?;
            if opencode_status_is_active(status)? {
                Ok(Some(OpenCodeSessionActivityUpdate::Active(session_id)))
            } else {
                Ok(Some(OpenCodeSessionActivityUpdate::Idle(session_id)))
            }
        }
        "session.idle" => {
            let session_id = read_required_string(event_payload, &["properties", "sessionID"])?;
            Ok(Some(OpenCodeSessionActivityUpdate::Idle(session_id)))
        }
        _ => Ok(None),
    }
}

fn apply_opencode_session_activity_update(
    active_sessions: &mut BTreeSet<String>,
    update: OpenCodeSessionActivityUpdate,
) {
    match update {
        OpenCodeSessionActivityUpdate::Active(session_id) => {
            active_sessions.insert(session_id);
        }
        OpenCodeSessionActivityUpdate::Idle(session_id) => {
            active_sessions.remove(&session_id);
        }
    }
}

fn opencode_status_is_active(status: &Value) -> Result<bool, OpenCodeProxyError> {
    let Some(status_type) = status.get("type").and_then(Value::as_str) else {
        return Err(OpenCodeProxyError::ConfigureRuntime(
            "OpenCode session status is missing type".to_string(),
        ));
    };

    match status_type {
        "busy" | "retry" => Ok(true),
        "idle" => Ok(false),
        _ => Err(OpenCodeProxyError::ConfigureRuntime(format!(
            "OpenCode session status type '{status_type}' is not supported"
        ))),
    }
}

fn read_required_string(value: &Value, path: &[&str]) -> Result<String, OpenCodeProxyError> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment).ok_or_else(|| {
            OpenCodeProxyError::ConfigureRuntime(format!(
                "OpenCode event is missing required field '{}'",
                path.join(".")
            ))
        })?;
    }

    current.as_str().map(ToString::to_string).ok_or_else(|| {
        OpenCodeProxyError::ConfigureRuntime(format!(
            "OpenCode event field '{}' must be a string",
            path.join(".")
        ))
    })
}

fn set_opencode_platform_activity(keepalive_manager: &Arc<Mutex<KeepaliveManager>>, active: bool) {
    keepalive_manager
        .lock()
        .expect("OpenCode keepalive manager lock should not be poisoned")
        .set_platform_active(active);
}
