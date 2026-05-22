//! Serialized keepalive protocol shared with the control/data plane.
//!
//! The daemon emits this shape to describe whether sandbox activity should keep
//! the instance alive and when the next heartbeat is expected.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeepaliveState {
    #[serde(rename = "type")]
    pub message_type: KeepaliveMessageType,
    pub ttl_ms: u64,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum KeepaliveMessageType {
    #[serde(rename = "keepalive.state")]
    State,
}
