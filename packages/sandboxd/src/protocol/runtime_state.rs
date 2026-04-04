use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeAttachment {
    pub sandbox_instance_id: String,
    pub owner_lease_id: String,
    pub node_id: String,
    pub session_id: String,
    pub attached_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimePresenceSummary {
    pub active_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeKeepaliveSummary {
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeStateSnapshot {
    pub owner_lease_id: Option<String>,
    pub attachment: Option<RuntimeAttachment>,
    pub presence: RuntimePresenceSummary,
    pub keepalive: RuntimeKeepaliveSummary,
}
