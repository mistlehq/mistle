//! Runtime-adapter readiness state for `sandboxd`.
//!
//! Keepalive answers whether the sandbox should stay alive. Runtime readiness
//! answers whether the initialized daemon has finished enough adapter-level
//! bootstrap to serve agent traffic. The live tunnel session publishes this
//! state to the gateway whenever it changes while the bootstrap tunnel is
//! connected.

use serde::Serialize;

use crate::supervision::{ComponentHealthState, SandboxdHealthSnapshot, SupervisedComponent};

/// Explicit readiness derivation policy for the current initialized sandbox runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeReadinessMode {
    NoAgentRuntime,
    CodexProxyOnly,
    Codex,
    OpenCode,
    OpenCodeProxyOnly,
    Pi,
    PiProxyOnly,
}

/// Derives the publishable runtime readiness bit from the supervision snapshot.
pub fn derive_runtime_ready(snapshot: &SandboxdHealthSnapshot, mode: RuntimeReadinessMode) -> bool {
    match mode {
        RuntimeReadinessMode::NoAgentRuntime => true,
        RuntimeReadinessMode::CodexProxyOnly => {
            codex_proxy_is_ready(snapshot) && runtime_agent_endpoint_is_ready(snapshot)
        }
        RuntimeReadinessMode::Codex => {
            codex_proxy_is_ready(snapshot)
                && component_is_healthy(snapshot, SupervisedComponent::CodexAppServer)
                && runtime_agent_endpoint_is_ready(snapshot)
        }
        RuntimeReadinessMode::OpenCodeProxyOnly => {
            component_is_healthy(snapshot, SupervisedComponent::OpenCodeProxy)
                && component_is_ready_when_tracked(
                    snapshot,
                    SupervisedComponent::OpenCodeProxyConnectivity,
                )
                && runtime_agent_endpoint_is_ready(snapshot)
        }
        RuntimeReadinessMode::OpenCode => {
            component_is_healthy(snapshot, SupervisedComponent::OpenCodeProxy)
                && component_is_healthy(snapshot, SupervisedComponent::OpenCodeServer)
                && component_is_ready_when_tracked(
                    snapshot,
                    SupervisedComponent::OpenCodeProxyConnectivity,
                )
                && runtime_agent_endpoint_is_ready(snapshot)
        }
        RuntimeReadinessMode::Pi => {
            component_is_healthy(snapshot, SupervisedComponent::PiProxy)
                && component_is_healthy(snapshot, SupervisedComponent::PiRpcProcess)
                && component_is_ready_when_tracked(
                    snapshot,
                    SupervisedComponent::PiProxyConnectivity,
                )
                && runtime_agent_endpoint_is_ready(snapshot)
        }
        RuntimeReadinessMode::PiProxyOnly => {
            component_is_healthy(snapshot, SupervisedComponent::PiProxy)
                && component_is_ready_when_tracked(
                    snapshot,
                    SupervisedComponent::PiProxyConnectivity,
                )
                && runtime_agent_endpoint_is_ready(snapshot)
        }
    }
}

fn component_is_healthy(snapshot: &SandboxdHealthSnapshot, component: SupervisedComponent) -> bool {
    snapshot
        .components
        .iter()
        .find(|candidate| candidate.component == component)
        .is_some_and(|candidate| candidate.state == ComponentHealthState::Healthy)
}

fn component_is_ready_when_tracked(
    snapshot: &SandboxdHealthSnapshot,
    component: SupervisedComponent,
) -> bool {
    if snapshot
        .components
        .iter()
        .all(|candidate| candidate.component != component)
    {
        return true;
    }

    component_is_healthy(snapshot, component)
}

fn codex_proxy_is_ready(snapshot: &SandboxdHealthSnapshot) -> bool {
    snapshot
        .components
        .iter()
        .find(|candidate| candidate.component == SupervisedComponent::CodexProxy)
        .is_some_and(|candidate| {
            candidate.state == ComponentHealthState::Healthy
                && candidate
                    .details
                    .get("sessionManagerState")
                    .is_some_and(|state| state == "Connected")
                && candidate
                    .details
                    .get("rawConnectivityState")
                    .is_some_and(|state| state == "Connected")
        })
}

fn runtime_agent_endpoint_is_ready(snapshot: &SandboxdHealthSnapshot) -> bool {
    if snapshot
        .components
        .iter()
        .all(|candidate| candidate.component != SupervisedComponent::RuntimeAgentEndpoint)
    {
        return true;
    }

    component_is_healthy(snapshot, SupervisedComponent::RuntimeAgentEndpoint)
}

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

    /// Returns the initial readiness message for a newly connected tunnel.
    pub fn take_initial_publishable_state(&mut self) -> Option<RuntimeReadyState> {
        if !self.tunnel_connected {
            return None;
        }

        self.last_published_ready = Some(self.ready);
        Some(RuntimeReadyState {
            message_type: RuntimeReadyMessageType::State,
            ready: self.ready,
        })
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
    use std::collections::BTreeMap;
    use std::time::SystemTime;

    use crate::runtime::readiness::{
        RuntimeReadinessManager, RuntimeReadinessMode, RuntimeReadyMessageType,
        derive_runtime_ready,
    };
    use crate::supervision::{
        ComponentHealthSnapshot, ComponentHealthState, SandboxdHealthSnapshot, SupervisedComponent,
    };

    #[test]
    fn publishes_immediately_when_tunnel_connects() {
        let mut manager = RuntimeReadinessManager::default();
        manager.on_tunnel_connected();

        let state = manager
            .take_initial_publishable_state()
            .expect("tunnel connect should trigger an immediate runtime-ready publish");
        assert_eq!(state.message_type, RuntimeReadyMessageType::State);
        assert!(!state.ready);
    }

    #[test]
    fn publishes_initial_state_for_each_connected_tunnel() {
        let mut manager = RuntimeReadinessManager::default();
        manager.set_ready(true);
        manager.on_tunnel_connected();
        let first_state = manager
            .take_initial_publishable_state()
            .expect("first tunnel should publish initial readiness");
        assert!(first_state.ready);

        let second_state = manager
            .take_initial_publishable_state()
            .expect("second tunnel should publish initial readiness even when ready is unchanged");
        assert!(second_state.ready);
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

    #[test]
    fn derives_no_agent_runtime_as_ready() {
        let snapshot = SandboxdHealthSnapshot {
            observed_at: SystemTime::UNIX_EPOCH,
            components: vec![],
        };

        assert!(derive_runtime_ready(
            &snapshot,
            RuntimeReadinessMode::NoAgentRuntime,
        ));
    }

    #[test]
    fn derives_codex_runtime_as_ready_only_when_proxy_and_app_server_are_healthy() {
        let snapshot = SandboxdHealthSnapshot {
            observed_at: SystemTime::UNIX_EPOCH,
            components: vec![
                codex_proxy_snapshot(ComponentHealthState::Healthy, "Connected"),
                component_snapshot(
                    SupervisedComponent::CodexAppServer,
                    ComponentHealthState::Healthy,
                ),
                component_snapshot(
                    SupervisedComponent::RuntimeAgentEndpoint,
                    ComponentHealthState::Healthy,
                ),
            ],
        };

        assert!(derive_runtime_ready(&snapshot, RuntimeReadinessMode::Codex));
    }

    #[test]
    fn derives_codex_runtime_as_not_ready_when_a_required_component_is_not_healthy() {
        let snapshot = SandboxdHealthSnapshot {
            observed_at: SystemTime::UNIX_EPOCH,
            components: vec![
                codex_proxy_snapshot(ComponentHealthState::Restarting, "Disconnected"),
                component_snapshot(
                    SupervisedComponent::CodexAppServer,
                    ComponentHealthState::Healthy,
                ),
                component_snapshot(
                    SupervisedComponent::RuntimeAgentEndpoint,
                    ComponentHealthState::Healthy,
                ),
            ],
        };

        assert!(!derive_runtime_ready(
            &snapshot,
            RuntimeReadinessMode::Codex
        ));
    }

    #[test]
    fn derives_proxy_only_runtime_as_ready_when_codex_proxy_is_healthy() {
        let snapshot = SandboxdHealthSnapshot {
            observed_at: SystemTime::UNIX_EPOCH,
            components: vec![
                codex_proxy_snapshot(ComponentHealthState::Healthy, "Connected"),
                component_snapshot(
                    SupervisedComponent::RuntimeAgentEndpoint,
                    ComponentHealthState::Healthy,
                ),
            ],
        };

        assert!(derive_runtime_ready(
            &snapshot,
            RuntimeReadinessMode::CodexProxyOnly,
        ));
    }

    #[test]
    fn derives_proxy_only_runtime_as_not_ready_when_proxy_connectivity_is_not_connected() {
        let snapshot = SandboxdHealthSnapshot {
            observed_at: SystemTime::UNIX_EPOCH,
            components: vec![
                codex_proxy_snapshot(ComponentHealthState::Healthy, "Disconnected"),
                component_snapshot(
                    SupervisedComponent::RuntimeAgentEndpoint,
                    ComponentHealthState::Healthy,
                ),
            ],
        };

        assert!(!derive_runtime_ready(
            &snapshot,
            RuntimeReadinessMode::CodexProxyOnly,
        ));
    }

    #[test]
    fn derives_opencode_runtime_as_ready_only_when_proxy_and_server_are_healthy() {
        let snapshot = SandboxdHealthSnapshot {
            observed_at: SystemTime::UNIX_EPOCH,
            components: vec![
                component_snapshot(
                    SupervisedComponent::OpenCodeProxy,
                    ComponentHealthState::Healthy,
                ),
                component_snapshot(
                    SupervisedComponent::OpenCodeServer,
                    ComponentHealthState::Healthy,
                ),
                component_snapshot(
                    SupervisedComponent::OpenCodeProxyConnectivity,
                    ComponentHealthState::Healthy,
                ),
                component_snapshot(
                    SupervisedComponent::RuntimeAgentEndpoint,
                    ComponentHealthState::Healthy,
                ),
            ],
        };

        assert!(derive_runtime_ready(
            &snapshot,
            RuntimeReadinessMode::OpenCode
        ));
    }

    #[test]
    fn derives_opencode_runtime_as_not_ready_when_server_is_not_healthy() {
        let snapshot = SandboxdHealthSnapshot {
            observed_at: SystemTime::UNIX_EPOCH,
            components: vec![
                component_snapshot(
                    SupervisedComponent::OpenCodeProxy,
                    ComponentHealthState::Healthy,
                ),
                component_snapshot(
                    SupervisedComponent::OpenCodeServer,
                    ComponentHealthState::Restarting,
                ),
                component_snapshot(
                    SupervisedComponent::OpenCodeProxyConnectivity,
                    ComponentHealthState::Healthy,
                ),
                component_snapshot(
                    SupervisedComponent::RuntimeAgentEndpoint,
                    ComponentHealthState::Healthy,
                ),
            ],
        };

        assert!(!derive_runtime_ready(
            &snapshot,
            RuntimeReadinessMode::OpenCode
        ));
    }

    #[test]
    fn derives_opencode_proxy_only_runtime_as_ready_when_connectivity_probe_is_not_tracked() {
        let snapshot = SandboxdHealthSnapshot {
            observed_at: SystemTime::UNIX_EPOCH,
            components: vec![component_snapshot(
                SupervisedComponent::OpenCodeProxy,
                ComponentHealthState::Healthy,
            )],
        };

        assert!(derive_runtime_ready(
            &snapshot,
            RuntimeReadinessMode::OpenCodeProxyOnly,
        ));
    }

    #[test]
    fn derives_pi_runtime_as_ready_only_when_proxy_and_rpc_process_are_healthy() {
        let snapshot = SandboxdHealthSnapshot {
            observed_at: SystemTime::UNIX_EPOCH,
            components: vec![
                component_snapshot(SupervisedComponent::PiProxy, ComponentHealthState::Healthy),
                component_snapshot(
                    SupervisedComponent::PiRpcProcess,
                    ComponentHealthState::Healthy,
                ),
                component_snapshot(
                    SupervisedComponent::PiProxyConnectivity,
                    ComponentHealthState::Healthy,
                ),
                component_snapshot(
                    SupervisedComponent::RuntimeAgentEndpoint,
                    ComponentHealthState::Healthy,
                ),
            ],
        };

        assert!(derive_runtime_ready(&snapshot, RuntimeReadinessMode::Pi));
    }

    #[test]
    fn derives_pi_runtime_as_not_ready_when_rpc_process_is_not_healthy() {
        let snapshot = SandboxdHealthSnapshot {
            observed_at: SystemTime::UNIX_EPOCH,
            components: vec![
                component_snapshot(SupervisedComponent::PiProxy, ComponentHealthState::Healthy),
                component_snapshot(
                    SupervisedComponent::PiRpcProcess,
                    ComponentHealthState::Restarting,
                ),
                component_snapshot(
                    SupervisedComponent::PiProxyConnectivity,
                    ComponentHealthState::Healthy,
                ),
                component_snapshot(
                    SupervisedComponent::RuntimeAgentEndpoint,
                    ComponentHealthState::Healthy,
                ),
            ],
        };

        assert!(!derive_runtime_ready(&snapshot, RuntimeReadinessMode::Pi));
    }

    #[test]
    fn derives_pi_proxy_only_runtime_as_ready_when_connectivity_probe_is_not_tracked() {
        let snapshot = SandboxdHealthSnapshot {
            observed_at: SystemTime::UNIX_EPOCH,
            components: vec![component_snapshot(
                SupervisedComponent::PiProxy,
                ComponentHealthState::Healthy,
            )],
        };

        assert!(derive_runtime_ready(
            &snapshot,
            RuntimeReadinessMode::PiProxyOnly,
        ));
    }

    #[test]
    fn derives_runtime_as_not_ready_when_agent_endpoint_probe_is_not_healthy() {
        let snapshot = SandboxdHealthSnapshot {
            observed_at: SystemTime::UNIX_EPOCH,
            components: vec![
                codex_proxy_snapshot(ComponentHealthState::Healthy, "Connected"),
                component_snapshot(
                    SupervisedComponent::RuntimeAgentEndpoint,
                    ComponentHealthState::Restarting,
                ),
            ],
        };

        assert!(!derive_runtime_ready(
            &snapshot,
            RuntimeReadinessMode::CodexProxyOnly,
        ));
    }

    #[test]
    fn derives_opencode_runtime_as_not_ready_when_proxy_connectivity_probe_is_not_healthy() {
        let snapshot = SandboxdHealthSnapshot {
            observed_at: SystemTime::UNIX_EPOCH,
            components: vec![
                component_snapshot(
                    SupervisedComponent::OpenCodeProxy,
                    ComponentHealthState::Healthy,
                ),
                component_snapshot(
                    SupervisedComponent::OpenCodeServer,
                    ComponentHealthState::Healthy,
                ),
                component_snapshot(
                    SupervisedComponent::OpenCodeProxyConnectivity,
                    ComponentHealthState::Restarting,
                ),
                component_snapshot(
                    SupervisedComponent::RuntimeAgentEndpoint,
                    ComponentHealthState::Healthy,
                ),
            ],
        };

        assert!(!derive_runtime_ready(
            &snapshot,
            RuntimeReadinessMode::OpenCode,
        ));
    }

    #[test]
    fn derives_pi_runtime_as_not_ready_when_proxy_connectivity_probe_is_not_healthy() {
        let snapshot = SandboxdHealthSnapshot {
            observed_at: SystemTime::UNIX_EPOCH,
            components: vec![
                component_snapshot(SupervisedComponent::PiProxy, ComponentHealthState::Healthy),
                component_snapshot(
                    SupervisedComponent::PiRpcProcess,
                    ComponentHealthState::Healthy,
                ),
                component_snapshot(
                    SupervisedComponent::PiProxyConnectivity,
                    ComponentHealthState::Restarting,
                ),
                component_snapshot(
                    SupervisedComponent::RuntimeAgentEndpoint,
                    ComponentHealthState::Healthy,
                ),
            ],
        };

        assert!(!derive_runtime_ready(&snapshot, RuntimeReadinessMode::Pi));
    }

    fn component_snapshot(
        component: SupervisedComponent,
        state: ComponentHealthState,
    ) -> ComponentHealthSnapshot {
        ComponentHealthSnapshot {
            component,
            state,
            restart_count: 0,
            last_started_at: None,
            last_failed_at: None,
            last_healthcheck_at: None,
            last_error: None,
            details: BTreeMap::new(),
        }
    }

    fn codex_proxy_snapshot(
        state: ComponentHealthState,
        connectivity_state: &str,
    ) -> ComponentHealthSnapshot {
        let mut snapshot = component_snapshot(SupervisedComponent::CodexProxy, state);
        snapshot.details.insert(
            "sessionManagerState".to_string(),
            connectivity_state.to_string(),
        );
        snapshot.details.insert(
            "rawConnectivityState".to_string(),
            connectivity_state.to_string(),
        );
        snapshot
    }
}
