use serde_json::{Map, Value};

use crate::codex_proxy::CodexThreadStatus;
use crate::codex_proxy::session_manager::SessionManagerSessionEnd;
use crate::codex_proxy::session_manager::updates::ThreadStatusUpdateSource;
use crate::codex_proxy::types::{CodexSessionManagerState, ThreadSubscriptionState};
use crate::time::{Clock, SystemClock, format_rfc3339_timestamp};

pub(super) fn emit_session_manager_session_end_log(
    raw_app_server_url: &str,
    manager_state: &CodexSessionManagerState,
    session_end: &SessionManagerSessionEnd,
) {
    let mut attributes = vec![
        ("component", Value::String("CodexProxy".to_string())),
        (
            "rawAppServerUrl",
            Value::String(raw_app_server_url.to_string()),
        ),
        (
            "reason",
            Value::String(session_end.reason.as_str().to_string()),
        ),
        (
            "retainedThreadCount",
            Value::from(manager_state.retained_threads.len() as u64),
        ),
        ("initialized", Value::Bool(manager_state.initialized)),
        (
            "retentionReplayInProgress",
            Value::Bool(manager_state.retention_replay_in_progress),
        ),
    ];
    if let Some(error) = &session_end.error {
        attributes.push(("error", Value::String(error.to_string())));
    }

    emit_session_manager_log(
        session_end.reason.level(),
        "codex_session_manager_session_ended",
        attributes,
    );
}

pub(super) fn emit_replay_resume_status_log(
    event: &str,
    thread_id: &str,
    status: &CodexThreadStatus,
    source: ThreadStatusUpdateSource,
) {
    emit_session_manager_log(
        "info",
        event,
        vec![
            ("component", Value::String("CodexProxy".to_string())),
            ("threadId", Value::String(thread_id.to_string())),
            (
                "status",
                Value::String(thread_status_name(status).to_string()),
            ),
            ("statusSource", Value::String(source.as_str().to_string())),
        ],
    );
}

pub(super) fn emit_auto_release_triggered_log(
    thread_id: &str,
    status: &CodexThreadStatus,
    source: ThreadStatusUpdateSource,
    retention_replay_in_progress: bool,
    subscription_state: &ThreadSubscriptionState,
) {
    emit_session_manager_log(
        "warn",
        "codex_session_manager_auto_release_triggered",
        vec![
            ("component", Value::String("CodexProxy".to_string())),
            ("threadId", Value::String(thread_id.to_string())),
            (
                "status",
                Value::String(thread_status_name(status).to_string()),
            ),
            ("statusSource", Value::String(source.as_str().to_string())),
            (
                "subscriptionState",
                Value::String(thread_subscription_state_name(subscription_state).to_string()),
            ),
            (
                "retentionReplayInProgress",
                Value::Bool(retention_replay_in_progress),
            ),
        ],
    );
}

fn emit_session_manager_log(level: &str, event: &str, attributes: Vec<(&str, Value)>) {
    let Some(line) = serialize_session_manager_log_line(&SystemClock, level, event, &attributes)
    else {
        return;
    };
    eprint!("{line}");
}

fn serialize_session_manager_log_line(
    clock: &dyn Clock,
    level: &str,
    event: &str,
    attributes: &[(&str, Value)],
) -> Option<String> {
    let timestamp = format_rfc3339_timestamp(clock.now_system_time()).ok()?;
    let mut payload = Map::new();
    payload.insert("timestamp".to_string(), Value::String(timestamp));
    payload.insert("level".to_string(), Value::String(level.to_string()));
    payload.insert("event".to_string(), Value::String(event.to_string()));

    for (key, value) in attributes {
        payload.insert((*key).to_string(), value.clone());
    }

    let mut line = serde_json::to_string(&Value::Object(payload)).ok()?;
    line.push('\n');
    Some(line)
}

fn thread_status_name(status: &CodexThreadStatus) -> &'static str {
    match status {
        CodexThreadStatus::NotLoaded => "NotLoaded",
        CodexThreadStatus::Idle => "Idle",
        CodexThreadStatus::SystemError => "SystemError",
        CodexThreadStatus::Active { .. } => "Active",
    }
}

fn thread_subscription_state_name(state: &ThreadSubscriptionState) -> &'static str {
    match state {
        ThreadSubscriptionState::Requested => "Requested",
        ThreadSubscriptionState::Subscribed => "Subscribed",
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use crate::codex_proxy::CodexThreadStatus;
    use crate::codex_proxy::session_manager::logging::{
        serialize_session_manager_log_line, thread_status_name,
    };
    use crate::codex_proxy::session_manager::updates::ThreadStatusUpdateSource;
    use crate::time::testing::MutableClock;

    #[test]
    fn thread_status_update_source_strings_match_log_fields() {
        assert_eq!(ThreadStatusUpdateSource::LiveResume.as_str(), "live_resume");
        assert_eq!(
            ThreadStatusUpdateSource::ReplayResume.as_str(),
            "replay_resume"
        );
        assert_eq!(
            ThreadStatusUpdateSource::StatusChanged.as_str(),
            "status_changed"
        );
    }

    #[test]
    fn serialize_session_manager_log_line_emits_otel_compatible_jsonl() {
        let clock = MutableClock::new(1_650_000_000_000);
        let line = serialize_session_manager_log_line(
            &clock,
            "warn",
            "codex_session_manager_auto_release_triggered",
            &[
                ("component", Value::String("CodexProxy".to_string())),
                ("threadId", Value::String("thr_123".to_string())),
                ("status", Value::String("Idle".to_string())),
            ],
        )
        .expect("log line should serialize");

        let payload: Value = serde_json::from_str(&line).expect("line should parse as JSON");
        assert_eq!(payload["level"], Value::String("warn".to_string()));
        assert_eq!(
            payload["event"],
            Value::String("codex_session_manager_auto_release_triggered".to_string())
        );
        assert_eq!(
            payload["component"],
            Value::String("CodexProxy".to_string())
        );
        assert_eq!(payload["threadId"], Value::String("thr_123".to_string()));
        assert_eq!(payload["status"], Value::String("Idle".to_string()));
        assert_eq!(
            payload["timestamp"],
            Value::String("2022-04-15T05:20:00Z".to_string())
        );
    }

    #[test]
    fn thread_status_name_uses_codex_status_labels() {
        assert_eq!(
            thread_status_name(&CodexThreadStatus::NotLoaded),
            "NotLoaded"
        );
        assert_eq!(thread_status_name(&CodexThreadStatus::Idle), "Idle");
        assert_eq!(
            thread_status_name(&CodexThreadStatus::SystemError),
            "SystemError"
        );
        assert_eq!(
            thread_status_name(&CodexThreadStatus::Active {
                active_flags: Vec::new(),
            }),
            "Active"
        );
    }
}
