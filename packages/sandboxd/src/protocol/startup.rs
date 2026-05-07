use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StartupMode {
    New,
    Existing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StartupExecutionMode {
    #[default]
    Session,
    Snapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitSigningConfig {
    pub format: String,
    pub program: String,
    pub key_ref: String,
    pub organization_id: String,
    pub provider_family: String,
    pub acting_user_id: String,
    pub grant: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitIdentity {
    pub name: String,
    pub email: String,
    pub signing: Option<GitSigningConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransparentProxyBypassKind {
    SocketMark,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransparentProxyBypass {
    pub kind: TransparentProxyBypassKind,
    pub mark: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransparentProxyExclusionKind {
    Cidr,
    Host,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransparentProxyExclusion {
    pub kind: TransparentProxyExclusionKind,
    pub value: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransparentProxyConfiguration {
    pub passthrough_bypass: TransparentProxyBypass,
    pub exclusions: Vec<TransparentProxyExclusion>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartupInput {
    pub startup_mode: StartupMode,
    #[serde(default)]
    pub execution_mode: StartupExecutionMode,
    pub bootstrap_token: String,
    pub tunnel_exchange_token: String,
    pub tunnel_gateway_ws_url: String,
    pub runtime_plan: serde_json::Value,
    pub egress_grant_by_rule_id: BTreeMap<String, String>,
    pub git_identity: Option<GitIdentity>,
    #[serde(default)]
    pub transparent_proxy: Option<TransparentProxyConfiguration>,
}

impl StartupInput {
    pub fn is_snapshot(&self) -> bool {
        matches!(self.execution_mode, StartupExecutionMode::Snapshot)
    }
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

#[cfg(test)]
mod tests {
    use super::{StartupExecutionMode, StartupInput, StartupMode};

    #[test]
    fn defaults_execution_mode_to_session_when_missing() {
        let startup_input: StartupInput = serde_json::from_value(serde_json::json!({
            "startupMode": "new",
            "bootstrapToken": "bootstrap-token",
            "tunnelExchangeToken": "exchange-token",
            "tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox/sbi_123",
            "runtimePlan": {
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": "registry.example.test/base:latest"
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            },
            "egressGrantByRuleId": {}
        }))
        .expect("startup input should deserialize");

        assert_eq!(startup_input.startup_mode, StartupMode::New);
        assert_eq!(startup_input.execution_mode, StartupExecutionMode::Session);
        assert!(!startup_input.is_snapshot());
    }

    #[test]
    fn parses_snapshot_execution_mode() {
        let startup_input: StartupInput = serde_json::from_value(serde_json::json!({
            "startupMode": "new",
            "executionMode": "snapshot",
            "bootstrapToken": "bootstrap-token",
            "tunnelExchangeToken": "exchange-token",
            "tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox/sbi_123",
            "runtimePlan": {
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": "registry.example.test/base:latest"
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            },
            "egressGrantByRuleId": {}
        }))
        .expect("startup input should deserialize");

        assert_eq!(startup_input.execution_mode, StartupExecutionMode::Snapshot);
        assert!(startup_input.is_snapshot());
    }
}
