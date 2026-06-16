//! Claude Code runtime-server process health projection.

use std::collections::BTreeMap;

use crate::process::{RuntimeClientProcessSpec, readiness_target};

pub(super) fn is_claude_code_server_process(process_spec: &RuntimeClientProcessSpec) -> bool {
    process_spec.process_key == "claude-code-runtime-server"
}

pub(super) fn claude_code_server_details_with_status(
    process_spec: &RuntimeClientProcessSpec,
    pid: Option<u32>,
    process_state: &str,
    readiness_state: &str,
) -> BTreeMap<String, String> {
    let mut details = BTreeMap::from([
        ("processKey".to_string(), process_spec.process_key.clone()),
        ("readinessUrl".to_string(), readiness_target(process_spec)),
        ("processState".to_string(), process_state.to_string()),
        ("readinessState".to_string(), readiness_state.to_string()),
    ]);
    if let Some(pid) = pid {
        details.insert("pid".to_string(), pid.to_string());
    }
    details
}
