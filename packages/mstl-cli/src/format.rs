use mstl_core::client::{SandboxInstanceAgentRuntimeId, SandboxInstanceStartedBy};

pub(crate) fn format_started_by(started_by: &SandboxInstanceStartedBy) -> String {
    match started_by {
        SandboxInstanceStartedBy::User { id, name }
        | SandboxInstanceStartedBy::ApiKey { id, name }
        | SandboxInstanceStartedBy::System { id, name } => match name {
            Some(name) => format!("{name} ({id})"),
            None => id.clone(),
        },
    }
}

pub(crate) fn format_agent_runtime_id(
    agent_runtime_id: &Option<SandboxInstanceAgentRuntimeId>,
) -> &'static str {
    match agent_runtime_id {
        Some(SandboxInstanceAgentRuntimeId::Codex) => "codex",
        Some(SandboxInstanceAgentRuntimeId::Opencode) => "opencode",
        None => "-",
    }
}

pub(crate) fn format_bool(value: bool) -> &'static str {
    if value { "yes" } else { "no" }
}

pub(crate) fn format_optional_value(value: Option<&str>) -> &str {
    match value {
        Some(value) => value,
        None => "-",
    }
}
