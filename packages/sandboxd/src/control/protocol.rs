//! JSON protocol exchanged over the daemon-local control socket.
//!
//! The protocol intentionally stays small: helper commands send one request,
//! the daemon handles it synchronously at the socket boundary, and the response
//! carries either success data or a user-facing error string.

use serde::{Deserialize, Serialize};

use crate::protocol::activation::ActivationInput;

/// Enumerates JSON requests accepted by the local control socket.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(super) enum ControlRequest {
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "shutdown")]
    Shutdown,
    #[serde(rename = "activate")]
    Activate {
        activation_input: Box<ActivationInput>,
    },
    #[serde(rename = "refreshEgressRoutes")]
    RefreshEgressRoutes {
        refresh_request: ControlRefreshEgressRoutesRequest,
    },
    #[serde(rename = "sign")]
    Sign { sign_request: ControlSignRequest },
}

/// Carries non-secret route matchers that should be sent through managed gateway egress.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlRefreshEgressRoutesRequest {
    pub routes: Vec<ControlEgressRouteMatcher>,
}

/// Describes one sandbox-local egress matcher without credential material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlEgressRouteMatcher {
    pub egress_rule_id: String,
    pub hosts: Vec<String>,
    pub path_prefixes: Vec<String>,
    pub methods: Option<Vec<String>>,
    pub designer_runtime_mcp: Option<ControlDesignerRuntimeMcpRouteMetadata>,
}

/// Carries trusted route-bound metadata for Designer runtime MCP egress.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlDesignerRuntimeMcpRouteMetadata {
    pub integration_connection_id: String,
    pub provider_tool_ids: Vec<String>,
}

/// Carries one local signer request from the helper alias to the running daemon.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlSignRequest {
    pub key_ref: String,
    pub payload_base64: String,
}

/// Carries one JSON response back to a local control socket client.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ControlResponse {
    pub(super) ok: bool,
    pub(super) error: Option<String>,
    pub(super) signature_base64: Option<String>,
}

impl ControlResponse {
    pub(super) fn ok(signature_base64: Option<String>) -> Self {
        Self {
            ok: true,
            error: None,
            signature_base64,
        }
    }

    pub(super) fn error(error: String) -> Self {
        Self {
            ok: false,
            error: Some(error),
            signature_base64: None,
        }
    }
}
