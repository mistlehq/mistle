use serde::{Deserialize, Serialize};

use crate::protocol::startup::StartupInput;

/// Enumerates JSON requests accepted by the local control socket.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(super) enum ControlRequest {
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "init")]
    Init {
        startup_input: StartupInput,
        #[serde(default = "default_wait_for_completion")]
        wait_for_completion: bool,
        #[serde(default)]
        wait_for_storage_attach: bool,
    },
    #[serde(rename = "resume")]
    Resume { startup_input: StartupInput },
    #[serde(rename = "waitInit")]
    WaitInit,
    #[serde(rename = "sign")]
    Sign { sign_request: ControlSignRequest },
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

fn default_wait_for_completion() -> bool {
    true
}
