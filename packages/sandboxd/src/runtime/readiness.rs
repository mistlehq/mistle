//! Runtime-adapter readiness state for `sandboxd`.
//!
//! Keepalive answers whether the sandbox should stay alive. Runtime readiness
//! answers whether the initialized daemon has finished enough adapter-level
//! bootstrap to serve agent traffic. The live tunnel session publishes this
//! state to the gateway whenever it changes while the bootstrap tunnel is
//! connected.

use serde::Serialize;

/// Wire shape for one runtime-readiness control message sent to the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReadyState {
    #[serde(rename = "type")]
    pub message_type: RuntimeReadyMessageType,
    pub ready: bool,
}

/// Stable control-message type used for runtime-readiness publication.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum RuntimeReadyMessageType {
    #[serde(rename = "runtime.ready")]
    State,
}

/// Tracks current runtime readiness together with publication state.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RuntimeReadinessManager {
    ready: bool,
    tunnel_connected: bool,
    last_published_ready: Option<bool>,
}

impl RuntimeReadinessManager {
    /// Marks the bootstrap tunnel as connected and schedules an immediate publish.
    pub fn on_tunnel_connected(&mut self) {
        self.tunnel_connected = true;
        self.last_published_ready = None;
    }

    /// Marks the bootstrap tunnel as disconnected and suppresses output.
    pub fn on_tunnel_disconnected(&mut self) {
        self.tunnel_connected = false;
    }

    /// Replaces the current runtime readiness bit.
    pub fn set_ready(&mut self, ready: bool) {
        self.ready = ready;
    }

    /// Returns the current readiness bit without mutating publication state.
    pub fn ready(&self) -> bool {
        self.ready
    }

    /// Returns the next publishable runtime-readiness message, if any.
    pub fn take_publishable_state(&mut self) -> Option<RuntimeReadyState> {
        if !self.tunnel_connected || self.last_published_ready == Some(self.ready) {
            return None;
        }

        self.last_published_ready = Some(self.ready);
        Some(RuntimeReadyState {
            message_type: RuntimeReadyMessageType::State,
            ready: self.ready,
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::runtime::readiness::{RuntimeReadinessManager, RuntimeReadyMessageType};

    #[test]
    fn publishes_immediately_when_tunnel_connects() {
        let mut manager = RuntimeReadinessManager::default();
        manager.on_tunnel_connected();

        let state = manager
            .take_publishable_state()
            .expect("tunnel connect should trigger an immediate runtime-ready publish");
        assert_eq!(state.message_type, RuntimeReadyMessageType::State);
        assert!(!state.ready);
    }

    #[test]
    fn publishes_when_readiness_changes() {
        let mut manager = RuntimeReadinessManager::default();
        manager.on_tunnel_connected();
        let _ = manager.take_publishable_state();

        manager.set_ready(true);

        let state = manager
            .take_publishable_state()
            .expect("readiness change should trigger a publish");
        assert!(state.ready);
    }

    #[test]
    fn does_not_publish_while_disconnected() {
        let mut manager = RuntimeReadinessManager::default();
        manager.set_ready(true);

        assert!(
            manager.take_publishable_state().is_none(),
            "disconnected tunnels should not publish runtime readiness"
        );
    }
}
