//! Session-scoped runtime resource input.
//!
//! This is the shared daemon-internal view used by tunnel, runtime-adapter,
//! egress, and Git identity resources. It intentionally contains no startup
//! mode or snapshot execution mode.

use crate::protocol::activation::ActivationInput;
use crate::protocol::startup::{
    GitIdentity, StartupInput, StartupOperationKind, TransparentProxyConfiguration,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionRuntimeInput {
    pub operation_kind: StartupOperationKind,
    pub bootstrap_token: String,
    pub tunnel_exchange_token: String,
    pub tunnel_gateway_ws_url: String,
    pub runtime_plan: serde_json::Value,
    pub acting_user_id: Option<String>,
    pub git_identity: Option<GitIdentity>,
    pub transparent_proxy: Option<TransparentProxyConfiguration>,
}

impl SessionRuntimeInput {
    pub fn from_startup_input(startup_input: &StartupInput) -> Self {
        Self {
            operation_kind: startup_input.operation_kind,
            bootstrap_token: startup_input.bootstrap_token.clone(),
            tunnel_exchange_token: startup_input.tunnel_exchange_token.clone(),
            tunnel_gateway_ws_url: startup_input.tunnel_gateway_ws_url.clone(),
            runtime_plan: startup_input.runtime_plan.clone(),
            acting_user_id: startup_input.acting_user_id.clone(),
            git_identity: startup_input.git_identity.clone(),
            transparent_proxy: startup_input.transparent_proxy.clone(),
        }
    }

    pub fn from_activation_input(activation_input: &ActivationInput) -> Self {
        Self {
            operation_kind: activation_input.operation_kind,
            bootstrap_token: activation_input.bootstrap_token.clone(),
            tunnel_exchange_token: activation_input.tunnel_exchange_token.clone(),
            tunnel_gateway_ws_url: activation_input.tunnel_gateway_ws_url.clone(),
            runtime_plan: activation_input.runtime_plan.clone(),
            acting_user_id: activation_input.acting_user_id.clone(),
            git_identity: activation_input.git_identity.clone(),
            transparent_proxy: activation_input.transparent_proxy.clone(),
        }
    }
}
