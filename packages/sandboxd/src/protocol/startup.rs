use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StartupMode {
    New,
    Existing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartupInput {
    pub startup_mode: StartupMode,
    pub bootstrap_token: String,
    pub tunnel_exchange_token: String,
    pub tunnel_gateway_ws_url: String,
    pub runtime_plan: serde_json::Value,
    pub egress_grant_by_rule_id: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartupInitOkResponse {
    pub ok: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartupInitErrorResponse {
    pub ok: bool,
    pub error: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StartupInitResponse {
    Ok(StartupInitOkResponse),
    Error(StartupInitErrorResponse),
}
