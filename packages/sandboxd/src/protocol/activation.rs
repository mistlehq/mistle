//! Activation input protocol accepted by `sandboxd activate`.
//!
//! Activation intentionally omits legacy caller-owned startup mode. The daemon
//! decides whether the sandbox needs first-time initialization or resource
//! refresh based on its own state.

use serde::{Deserialize, Serialize};

use crate::protocol::startup::{GitIdentity, StartupOperationKind, TransparentProxyConfiguration};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivationInput {
    pub operation_kind: StartupOperationKind,
    pub bootstrap_token: String,
    pub tunnel_exchange_token: String,
    pub tunnel_gateway_ws_url: String,
    pub runtime_plan: serde_json::Value,
    pub acting_user_id: Option<String>,
    pub git_identity: Option<GitIdentity>,
    #[serde(default)]
    pub transparent_proxy: Option<TransparentProxyConfiguration>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::protocol::activation::ActivationInput;
    use crate::protocol::startup::StartupOperationKind;

    #[test]
    fn deserializes_activation_without_startup_mode() {
        let input: ActivationInput = serde_json::from_value(json!({
            "operationKind": "start",
            "bootstrapToken": "bootstrap-token",
            "tunnelExchangeToken": "exchange-token",
            "tunnelGatewayWsUrl": "ws://127.0.0.1/tunnel",
            "runtimePlan": {
                "version": 1,
                "sandboxProfileId": "profile"
            },
            "actingUserId": "user_123",
            "gitIdentity": null
        }))
        .expect("activation input should deserialize");

        assert_eq!(input.operation_kind, StartupOperationKind::Start);
        assert_eq!(input.tunnel_exchange_token, "exchange-token");
    }

    #[test]
    fn deserializes_all_operation_kinds_without_execution_mode() {
        for operation_kind in ["start", "resume", "setup_check", "snapshot"] {
            let input: ActivationInput = serde_json::from_value(json!({
                "operationKind": operation_kind,
                "bootstrapToken": "bootstrap-token",
                "tunnelExchangeToken": "exchange-token",
                "tunnelGatewayWsUrl": "ws://127.0.0.1/tunnel",
                "runtimePlan": {
                    "version": 1,
                    "sandboxProfileId": "profile"
                },
                "actingUserId": null,
                "gitIdentity": null
            }))
            .expect("activation input should deserialize every operation kind");

            assert_eq!(input.operation_kind.as_str(), operation_kind);
        }
    }

    #[test]
    fn rejects_legacy_startup_mode() {
        let error = serde_json::from_value::<ActivationInput>(json!({
            "startupMode": "new",
            "operationKind": "start",
            "bootstrapToken": "bootstrap-token",
            "tunnelExchangeToken": "exchange-token",
            "tunnelGatewayWsUrl": "ws://127.0.0.1/tunnel",
            "runtimePlan": {
                "version": 1,
                "sandboxProfileId": "profile"
            },
            "actingUserId": null,
            "gitIdentity": null
        }))
        .expect_err("activation input should reject startupMode");

        assert!(error.to_string().contains("unknown field `startupMode`"));
    }

    #[test]
    fn rejects_legacy_execution_mode() {
        let error = serde_json::from_value::<ActivationInput>(json!({
            "operationKind": "snapshot",
            "executionMode": "snapshot",
            "bootstrapToken": "bootstrap-token",
            "tunnelExchangeToken": "exchange-token",
            "tunnelGatewayWsUrl": "ws://127.0.0.1/tunnel",
            "runtimePlan": {
                "version": 1,
                "sandboxProfileId": "profile"
            },
            "actingUserId": null,
            "gitIdentity": null
        }))
        .expect_err("activation input should reject executionMode");

        assert!(error.to_string().contains("unknown field `executionMode`"));
    }
}
