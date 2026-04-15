//! Shared supervision types and in-memory health snapshot state for `sandboxd`.
//!
//! This module defines the common supervision vocabulary that long-lived
//! sandboxd components report through. The first branch only establishes the
//! in-memory model and reporting boundary; later branches add external health
//! exposure, lifecycle event forwarding, and restart behavior.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use crate::time::Clock;

/// Stable identifier for one supervised long-lived sandboxd component.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum SupervisedComponent {
    TunnelSession,
    EgressProxy,
    CodexProxy,
    CodexAppServer,
}

/// Shared component lifecycle state reported by sandboxd supervisors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComponentHealthState {
    /// The supervisor has started the initial startup sequence for this component.
    Starting,
    /// The component is up and its current health probe is passing.
    Healthy,
    /// The component was previously running and the supervisor is now recovering it.
    Restarting,
    /// The component was intentionally stopped or was never started for this lifecycle.
    Stopped,
}

/// Daemon-global initialization phase used by the later health endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxdDaemonPhase {
    Uninitialized,
    Initializing,
    Initialized,
    Failed,
}

/// One point-in-time view of the tracked component health state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxdHealthSnapshot {
    pub observed_at: SystemTime,
    pub components: Vec<ComponentHealthSnapshot>,
}

/// Daemon-global health response envelope used by the later loopback endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxdHealthResponse {
    pub daemon_phase: SandboxdDaemonPhase,
    pub observed_at: SystemTime,
    pub snapshot: Option<SandboxdHealthSnapshot>,
    pub init_error: Option<String>,
}

/// Health snapshot for one supervised component.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComponentHealthSnapshot {
    pub component: SupervisedComponent,
    pub state: ComponentHealthState,
    pub restart_count: u64,
    pub last_started_at: Option<SystemTime>,
    pub last_failed_at: Option<SystemTime>,
    pub last_healthcheck_at: Option<SystemTime>,
    pub last_error: Option<String>,
    pub details: BTreeMap<String, String>,
}

#[derive(Debug)]
struct SupervisorState {
    tracked_components: BTreeMap<SupervisedComponent, ComponentHealthSnapshot>,
    observed_at: SystemTime,
}

/// Shared reporting boundary for supervised sandboxd components.
///
/// The first branch uses this handle only for in-memory snapshot mutation and
/// stable access to the sandbox instance id. Later branches extend it with
/// lifecycle event emission and best-effort forwarding.
#[derive(Clone)]
pub struct SandboxdSupervisorHandle {
    sandbox_instance_id: String,
    clock: Arc<dyn Clock>,
    state: Arc<Mutex<SupervisorState>>,
}

impl fmt::Debug for SandboxdSupervisorHandle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SandboxdSupervisorHandle")
            .field("sandbox_instance_id", &self.sandbox_instance_id)
            .finish_non_exhaustive()
    }
}

impl SandboxdSupervisorHandle {
    /// Creates a new in-memory supervision registry for one sandbox instance.
    pub fn new(
        sandbox_instance_id: impl Into<String>,
        clock: Arc<dyn Clock>,
        tracked_components: BTreeSet<SupervisedComponent>,
    ) -> Self {
        let observed_at = clock.now_system_time();
        let tracked_components = tracked_components
            .into_iter()
            .map(|component| {
                (
                    component,
                    ComponentHealthSnapshot {
                        component,
                        state: ComponentHealthState::Stopped,
                        restart_count: 0,
                        last_started_at: None,
                        last_failed_at: None,
                        last_healthcheck_at: None,
                        last_error: None,
                        details: BTreeMap::new(),
                    },
                )
            })
            .collect();

        Self {
            sandbox_instance_id: sandbox_instance_id.into(),
            clock,
            state: Arc::new(Mutex::new(SupervisorState {
                tracked_components,
                observed_at,
            })),
        }
    }

    /// Returns the stable sandbox instance id associated with this supervisor.
    pub fn sandbox_instance_id(&self) -> &str {
        &self.sandbox_instance_id
    }

    /// Returns whether this supervisor currently tracks the provided component.
    pub fn tracks_component(&self, component: SupervisedComponent) -> bool {
        self.state
            .lock()
            .expect("sandboxd supervisor lock should not be poisoned")
            .tracked_components
            .contains_key(&component)
    }

    /// Returns a point-in-time snapshot of all tracked component states.
    pub fn snapshot(&self) -> SandboxdHealthSnapshot {
        let state = self
            .state
            .lock()
            .expect("sandboxd supervisor lock should not be poisoned");

        SandboxdHealthSnapshot {
            observed_at: state.observed_at,
            components: state.tracked_components.values().cloned().collect(),
        }
    }

    /// Returns the latest snapshot for one tracked component, if present.
    pub fn component_snapshot(
        &self,
        component: SupervisedComponent,
    ) -> Option<ComponentHealthSnapshot> {
        self.state
            .lock()
            .expect("sandboxd supervisor lock should not be poisoned")
            .tracked_components
            .get(&component)
            .cloned()
    }

    /// Marks the initial startup sequence for a tracked component as active.
    pub fn mark_component_starting(&self, component: SupervisedComponent) {
        self.update_component(component, |snapshot, _observed_at| {
            snapshot.state = ComponentHealthState::Starting;
            snapshot.last_error = None;
        });
    }

    /// Marks a tracked component as healthy after its start or recovery succeeded.
    pub fn mark_component_healthy(&self, component: SupervisedComponent) {
        self.update_component(component, |snapshot, observed_at| {
            snapshot.state = ComponentHealthState::Healthy;
            snapshot.last_started_at = Some(observed_at);
            snapshot.last_healthcheck_at = Some(observed_at);
            snapshot.last_error = None;
        });
    }

    /// Marks a tracked component as intentionally stopped.
    pub fn mark_component_stopped(&self, component: SupervisedComponent) {
        self.update_component(component, |snapshot, _observed_at| {
            snapshot.state = ComponentHealthState::Stopped;
            snapshot.last_error = None;
        });
    }

    /// Marks a tracked component as restarting after a failure.
    pub fn mark_component_restarting(
        &self,
        component: SupervisedComponent,
        error: impl Into<String>,
    ) {
        self.update_component(component, |snapshot, observed_at| {
            snapshot.state = ComponentHealthState::Restarting;
            snapshot.restart_count = snapshot.restart_count.saturating_add(1);
            snapshot.last_failed_at = Some(observed_at);
            snapshot.last_error = Some(error.into());
        });
    }

    /// Records one successful healthcheck observation without changing component state.
    pub fn record_component_healthcheck(&self, component: SupervisedComponent) {
        self.update_component(component, |snapshot, observed_at| {
            snapshot.last_healthcheck_at = Some(observed_at);
        });
    }

    /// Replaces the component-specific details map for one tracked component.
    pub fn replace_component_details(
        &self,
        component: SupervisedComponent,
        details: BTreeMap<String, String>,
    ) {
        self.update_component(component, |snapshot, _observed_at| {
            snapshot.details = details;
        });
    }

    /// Sets or replaces one component-specific detail key.
    pub fn set_component_detail(
        &self,
        component: SupervisedComponent,
        key: impl Into<String>,
        value: impl Into<String>,
    ) {
        self.update_component(component, |snapshot, _observed_at| {
            snapshot.details.insert(key.into(), value.into());
        });
    }

    /// Clears all component-specific detail keys for one tracked component.
    pub fn clear_component_details(&self, component: SupervisedComponent) {
        self.update_component(component, |snapshot, _observed_at| {
            snapshot.details.clear();
        });
    }

    fn update_component(
        &self,
        component: SupervisedComponent,
        update: impl FnOnce(&mut ComponentHealthSnapshot, SystemTime),
    ) {
        let observed_at = self.clock.now_system_time();
        let mut state = self
            .state
            .lock()
            .expect("sandboxd supervisor lock should not be poisoned");
        let Some(snapshot) = state.tracked_components.get_mut(&component) else {
            return;
        };

        update(snapshot, observed_at);
        state.observed_at = observed_at;
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use crate::supervision::{
        ComponentHealthState, SandboxdSupervisorHandle, SupervisedComponent,
    };
    use crate::time::testing::MutableClock;
    use crate::time::Clock;
    use std::sync::Arc;

    #[test]
    fn tracks_state_transitions_for_one_component() {
        let clock = Arc::new(MutableClock::new(10));
        let handle = SandboxdSupervisorHandle::new(
            "sandbox-123",
            clock.clone(),
            BTreeSet::from([SupervisedComponent::EgressProxy]),
        );

        let initial_snapshot = handle
            .component_snapshot(SupervisedComponent::EgressProxy)
            .expect("egress proxy should be tracked");
        assert_eq!(initial_snapshot.state, ComponentHealthState::Stopped);

        clock.advance_ms(5);
        handle.mark_component_starting(SupervisedComponent::EgressProxy);
        let starting_snapshot = handle
            .component_snapshot(SupervisedComponent::EgressProxy)
            .expect("egress proxy should remain tracked");
        assert_eq!(starting_snapshot.state, ComponentHealthState::Starting);
        assert_eq!(starting_snapshot.last_started_at, None);

        clock.advance_ms(7);
        handle.mark_component_healthy(SupervisedComponent::EgressProxy);
        let healthy_snapshot = handle
            .component_snapshot(SupervisedComponent::EgressProxy)
            .expect("egress proxy should remain tracked");
        assert_eq!(healthy_snapshot.state, ComponentHealthState::Healthy);
        assert_eq!(
            healthy_snapshot.last_started_at,
            Some(clock.now_system_time())
        );
        assert_eq!(
            healthy_snapshot.last_healthcheck_at,
            Some(clock.now_system_time())
        );
        assert_eq!(healthy_snapshot.restart_count, 0);
    }

    #[test]
    fn ignores_updates_for_untracked_components() {
        let clock = Arc::new(MutableClock::new(1));
        let handle = SandboxdSupervisorHandle::new(
            "sandbox-123",
            clock,
            BTreeSet::from([SupervisedComponent::TunnelSession]),
        );

        handle.mark_component_healthy(SupervisedComponent::CodexProxy);

        assert!(
            handle
                .component_snapshot(SupervisedComponent::CodexProxy)
                .is_none(),
            "untracked components should not be added implicitly"
        );
    }

    #[test]
    fn records_restart_failures_for_tracked_components() {
        let clock = Arc::new(MutableClock::new(100));
        let handle = SandboxdSupervisorHandle::new(
            "sandbox-123",
            clock.clone(),
            BTreeSet::from([SupervisedComponent::CodexProxy]),
        );

        handle.mark_component_starting(SupervisedComponent::CodexProxy);
        handle.mark_component_healthy(SupervisedComponent::CodexProxy);
        clock.advance_ms(50);
        handle.mark_component_restarting(
            SupervisedComponent::CodexProxy,
            "listener socket stopped accepting connections",
        );

        let snapshot = handle
            .component_snapshot(SupervisedComponent::CodexProxy)
            .expect("codex proxy should be tracked");
        assert_eq!(snapshot.state, ComponentHealthState::Restarting);
        assert_eq!(snapshot.restart_count, 1);
        assert_eq!(
            snapshot.last_failed_at,
            Some(clock.now_system_time())
        );
        assert_eq!(
            snapshot.last_error.as_deref(),
            Some("listener socket stopped accepting connections")
        );
    }

    #[test]
    fn stores_component_specific_details_through_the_supervisor_handle() {
        let clock = Arc::new(MutableClock::new(25));
        let handle = SandboxdSupervisorHandle::new(
            "sandbox-123",
            clock,
            BTreeSet::from([SupervisedComponent::CodexProxy]),
        );

        handle.set_component_detail(
            SupervisedComponent::CodexProxy,
            "listenAddr",
            "ws://127.0.0.1:4500",
        );
        handle.set_component_detail(
            SupervisedComponent::CodexProxy,
            "rawTarget",
            "ws://127.0.0.1:4501",
        );

        let snapshot = handle
            .component_snapshot(SupervisedComponent::CodexProxy)
            .expect("codex proxy should be tracked");
        assert_eq!(
            snapshot.details,
            BTreeMap::from([
                ("listenAddr".to_string(), "ws://127.0.0.1:4500".to_string()),
                ("rawTarget".to_string(), "ws://127.0.0.1:4501".to_string()),
            ])
        );
    }
}
