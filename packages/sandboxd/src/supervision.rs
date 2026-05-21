//! Shared supervision types and in-memory health snapshot state for `sandboxd`.
//!
//! This module defines the common supervision vocabulary that long-lived
//! sandboxd components report through. The first branch only establishes the
//! in-memory model and reporting boundary; later branches add external health
//! exposure, lifecycle event forwarding, and restart behavior.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use serde_json::{Map, Value};

use crate::time::Clock;
use crate::time::format_rfc3339_timestamp;

const MAX_FORWARDED_LIFECYCLE_EVENT_LINES: usize = 128;

/// Stable identifier for one supervised long-lived sandboxd component.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum SupervisedComponent {
    TunnelSession,
    EgressProxy,
    CodexProxy,
    CodexAppServer,
    OpenCodeProxy,
    PiProxy,
    PiRpcProcess,
}

impl SupervisedComponent {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TunnelSession => "TunnelSession",
            Self::EgressProxy => "EgressProxy",
            Self::CodexProxy => "CodexProxy",
            Self::CodexAppServer => "CodexAppServer",
            Self::OpenCodeProxy => "OpenCodeProxy",
            Self::PiProxy => "PiProxy",
            Self::PiRpcProcess => "PiRpcProcess",
        }
    }
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

impl ComponentHealthState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Starting => "Starting",
            Self::Healthy => "Healthy",
            Self::Restarting => "Restarting",
            Self::Stopped => "Stopped",
        }
    }
}

/// Daemon-global initialization phase used by the later health endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxdDaemonPhase {
    Uninitialized,
    Initializing,
    Initialized,
    Failed,
}

impl SandboxdDaemonPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Uninitialized => "Uninitialized",
            Self::Initializing => "Initializing",
            Self::Initialized => "Initialized",
            Self::Failed => "Failed",
        }
    }
}

/// Stable lifecycle event names emitted by the first-tranche supervisor model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleEventName {
    ComponentStarting,
    ComponentStarted,
    ComponentHealthcheckFailed,
    ComponentExited,
    ComponentRestartScheduled,
    ComponentRestartSucceeded,
}

impl LifecycleEventName {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ComponentStarting => "component_starting",
            Self::ComponentStarted => "component_started",
            Self::ComponentHealthcheckFailed => "component_healthcheck_failed",
            Self::ComponentExited => "component_exited",
            Self::ComponentRestartScheduled => "component_restart_scheduled",
            Self::ComponentRestartSucceeded => "component_restart_succeeded",
        }
    }
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
    forwarded_lifecycle_lines: VecDeque<String>,
    observed_at: SystemTime,
}

struct LifecycleEventEmission<'a> {
    observed_at: SystemTime,
    event: LifecycleEventName,
    reason: Option<&'a str>,
    error: Option<&'a str>,
    extra_fields: &'a [(&'a str, Value)],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LifecycleEventLevel {
    Info,
    Warn,
    Error,
}

impl LifecycleEventLevel {
    fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
        }
    }
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
                forwarded_lifecycle_lines: VecDeque::new(),
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
        let Some((is_restart_attempt, snapshot, _previous_state, observed_at)) = self
            .update_component(component, |snapshot, _observed_at| {
                let is_restart_attempt = snapshot.state == ComponentHealthState::Restarting;
                if !is_restart_attempt {
                    snapshot.state = ComponentHealthState::Starting;
                    snapshot.last_error = None;
                }
                is_restart_attempt
            })
        else {
            return;
        };

        let reason = if is_restart_attempt {
            "restart_attempt"
        } else {
            "initial_start"
        };
        self.emit_lifecycle_event_from_snapshot(
            &snapshot,
            LifecycleEventEmission {
                observed_at,
                event: LifecycleEventName::ComponentStarting,
                reason: Some(reason),
                error: None,
                extra_fields: &[],
            },
        );
    }

    /// Marks a tracked component as healthy after its start or recovery succeeded.
    pub fn mark_component_healthy(&self, component: SupervisedComponent) {
        let Some(((), snapshot, previous_state, observed_at)) =
            self.update_component(component, |snapshot, observed_at| {
                snapshot.state = ComponentHealthState::Healthy;
                snapshot.last_started_at = Some(observed_at);
                snapshot.last_healthcheck_at = Some(observed_at);
                snapshot.last_error = None;
            })
        else {
            return;
        };

        match previous_state {
            ComponentHealthState::Starting => self.emit_lifecycle_event_from_snapshot(
                &snapshot,
                LifecycleEventEmission {
                    observed_at,
                    event: LifecycleEventName::ComponentStarted,
                    reason: None,
                    error: None,
                    extra_fields: &[],
                },
            ),
            ComponentHealthState::Restarting => self.emit_lifecycle_event_from_snapshot(
                &snapshot,
                LifecycleEventEmission {
                    observed_at,
                    event: LifecycleEventName::ComponentRestartSucceeded,
                    reason: Some("restart_succeeded"),
                    error: None,
                    extra_fields: &[],
                },
            ),
            ComponentHealthState::Healthy | ComponentHealthState::Stopped => {}
        }
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

    /// Emits one structured lifecycle event for a failed component healthcheck.
    pub fn emit_component_healthcheck_failed(
        &self,
        component: SupervisedComponent,
        reason: impl AsRef<str>,
        error: impl AsRef<str>,
        probe_kind: impl AsRef<str>,
        extra_fields: &[(&str, Value)],
    ) {
        let probe_kind_value = probe_kind.as_ref().to_string();
        let mut event_fields = Vec::with_capacity(extra_fields.len() + 1);
        event_fields.push(("probeKind", Value::String(probe_kind_value)));
        event_fields.extend(
            extra_fields
                .iter()
                .map(|(name, value)| (*name, value.clone())),
        );
        self.emit_component_lifecycle_event(
            LifecycleEventName::ComponentHealthcheckFailed,
            component,
            Some(reason.as_ref()),
            Some(error.as_ref()),
            &event_fields,
        );
    }

    /// Emits one structured lifecycle event for an unexpected component exit.
    pub fn emit_component_exited(
        &self,
        component: SupervisedComponent,
        reason: impl AsRef<str>,
        error: Option<&str>,
        extra_fields: &[(&str, Value)],
    ) {
        self.emit_component_lifecycle_event(
            LifecycleEventName::ComponentExited,
            component,
            Some(reason.as_ref()),
            error,
            extra_fields,
        );
    }

    /// Emits one structured lifecycle event when a retry has been scheduled.
    pub fn emit_component_restart_scheduled(
        &self,
        component: SupervisedComponent,
        reason: impl AsRef<str>,
        backoff_ms: u64,
        extra_fields: &[(&str, Value)],
    ) {
        let mut event_fields = Vec::with_capacity(extra_fields.len() + 1);
        event_fields.push(("backoffMs", Value::from(backoff_ms)));
        event_fields.extend(
            extra_fields
                .iter()
                .map(|(name, value)| (*name, value.clone())),
        );
        self.emit_component_lifecycle_event(
            LifecycleEventName::ComponentRestartScheduled,
            component,
            Some(reason.as_ref()),
            None,
            &event_fields,
        );
    }

    /// Drains the bounded lifecycle-event forwarding queue for best-effort remote publication.
    pub fn drain_forwarded_lifecycle_event_lines(&self) -> Vec<String> {
        let mut state = self
            .state
            .lock()
            .expect("sandboxd supervisor lock should not be poisoned");
        state.forwarded_lifecycle_lines.drain(..).collect()
    }

    fn update_component<T>(
        &self,
        component: SupervisedComponent,
        update: impl FnOnce(&mut ComponentHealthSnapshot, SystemTime) -> T,
    ) -> Option<(T, ComponentHealthSnapshot, ComponentHealthState, SystemTime)> {
        let observed_at = self.clock.now_system_time();
        let mut state = self
            .state
            .lock()
            .expect("sandboxd supervisor lock should not be poisoned");
        let snapshot = state.tracked_components.get_mut(&component)?;

        let previous_state = snapshot.state;
        let update_result = update(snapshot, observed_at);
        let updated_snapshot = snapshot.clone();
        state.observed_at = observed_at;
        Some((update_result, updated_snapshot, previous_state, observed_at))
    }

    fn emit_component_lifecycle_event(
        &self,
        event: LifecycleEventName,
        component: SupervisedComponent,
        reason: Option<&str>,
        error: Option<&str>,
        extra_fields: &[(&str, Value)],
    ) {
        let Some((snapshot, observed_at)) = self.component_event_context(component) else {
            return;
        };
        self.emit_lifecycle_event_from_snapshot(
            &snapshot,
            LifecycleEventEmission {
                observed_at,
                event,
                reason,
                error,
                extra_fields,
            },
        );
    }

    fn component_event_context(
        &self,
        component: SupervisedComponent,
    ) -> Option<(ComponentHealthSnapshot, SystemTime)> {
        let state = self
            .state
            .lock()
            .expect("sandboxd supervisor lock should not be poisoned");
        let snapshot = state.tracked_components.get(&component)?.clone();
        Some((snapshot, state.observed_at))
    }

    fn emit_lifecycle_event_from_snapshot(
        &self,
        snapshot: &ComponentHealthSnapshot,
        emission: LifecycleEventEmission<'_>,
    ) {
        let Ok(line) =
            serialize_lifecycle_event_line(self.sandbox_instance_id(), snapshot, &emission)
        else {
            return;
        };

        eprint!("{line}");

        let mut state = self
            .state
            .lock()
            .expect("sandboxd supervisor lock should not be poisoned");
        if state.forwarded_lifecycle_lines.len() == MAX_FORWARDED_LIFECYCLE_EVENT_LINES {
            let _ = state.forwarded_lifecycle_lines.pop_front();
        }
        state.forwarded_lifecycle_lines.push_back(line);
    }
}

fn serialize_lifecycle_event_line(
    sandbox_instance_id: &str,
    snapshot: &ComponentHealthSnapshot,
    emission: &LifecycleEventEmission<'_>,
) -> Result<String, time::error::Format> {
    let observed_at_text = format_rfc3339_timestamp(emission.observed_at)?;
    let mut payload = Map::new();
    payload.insert(
        "event".to_string(),
        Value::String(emission.event.as_str().to_string()),
    );
    payload.insert(
        "sandboxInstanceId".to_string(),
        Value::String(sandbox_instance_id.to_string()),
    );
    payload.insert(
        "component".to_string(),
        Value::String(snapshot.component.as_str().to_string()),
    );
    payload.insert(
        "state".to_string(),
        Value::String(snapshot.state.as_str().to_string()),
    );
    payload.insert("observedAt".to_string(), Value::String(observed_at_text));
    payload.insert(
        "restartCount".to_string(),
        Value::from(snapshot.restart_count),
    );

    if let Some(reason) = emission.reason {
        payload.insert("reason".to_string(), Value::String(reason.to_string()));
    }
    if let Some(error) = emission.error {
        payload.insert("error".to_string(), Value::String(error.to_string()));
    }

    for field_name in snapshot_detail_field_names_for_event(snapshot.component, emission.event) {
        let Some(field_value) = snapshot.details.get(*field_name) else {
            continue;
        };
        payload.insert(
            (*field_name).to_string(),
            Value::String(field_value.clone()),
        );
    }
    for (field_name, field_value) in emission.extra_fields {
        payload.insert((*field_name).to_string(), field_value.clone());
    }

    let mut line =
        serde_json::to_string(&Value::Object(payload)).expect("lifecycle event should serialize");
    line.push('\n');
    Ok(line)
}

fn snapshot_detail_field_names_for_event(
    component: SupervisedComponent,
    event: LifecycleEventName,
) -> &'static [&'static str] {
    match (component, event) {
        (
            SupervisedComponent::TunnelSession,
            LifecycleEventName::ComponentStarting
            | LifecycleEventName::ComponentStarted
            | LifecycleEventName::ComponentHealthcheckFailed
            | LifecycleEventName::ComponentRestartScheduled
            | LifecycleEventName::ComponentRestartSucceeded,
        ) => &["gatewayWsUrl"],
        (SupervisedComponent::TunnelSession, LifecycleEventName::ComponentExited) => &[],
        (
            SupervisedComponent::EgressProxy,
            LifecycleEventName::ComponentStarting
            | LifecycleEventName::ComponentStarted
            | LifecycleEventName::ComponentHealthcheckFailed
            | LifecycleEventName::ComponentExited
            | LifecycleEventName::ComponentRestartScheduled
            | LifecycleEventName::ComponentRestartSucceeded,
        ) => &["listenAddr", "stablePort"],
        (
            SupervisedComponent::CodexProxy,
            LifecycleEventName::ComponentStarting
            | LifecycleEventName::ComponentStarted
            | LifecycleEventName::ComponentHealthcheckFailed
            | LifecycleEventName::ComponentExited
            | LifecycleEventName::ComponentRestartScheduled
            | LifecycleEventName::ComponentRestartSucceeded,
        ) => &["listenAddr", "rawTarget"],
        (
            SupervisedComponent::OpenCodeProxy,
            LifecycleEventName::ComponentStarting
            | LifecycleEventName::ComponentStarted
            | LifecycleEventName::ComponentHealthcheckFailed
            | LifecycleEventName::ComponentExited
            | LifecycleEventName::ComponentRestartScheduled
            | LifecycleEventName::ComponentRestartSucceeded,
        ) => &["listenAddr", "rawTarget"],
        (
            SupervisedComponent::PiProxy,
            LifecycleEventName::ComponentStarting
            | LifecycleEventName::ComponentStarted
            | LifecycleEventName::ComponentHealthcheckFailed
            | LifecycleEventName::ComponentExited
            | LifecycleEventName::ComponentRestartScheduled
            | LifecycleEventName::ComponentRestartSucceeded,
        ) => &["listenAddr"],
        (
            SupervisedComponent::PiRpcProcess,
            LifecycleEventName::ComponentStarting
            | LifecycleEventName::ComponentRestartScheduled
            | LifecycleEventName::ComponentExited,
        ) => &["cliPath"],
        (
            SupervisedComponent::PiRpcProcess,
            LifecycleEventName::ComponentStarted
            | LifecycleEventName::ComponentRestartSucceeded
            | LifecycleEventName::ComponentHealthcheckFailed,
        ) => &["cliPath", "pid"],
        (
            SupervisedComponent::CodexAppServer,
            LifecycleEventName::ComponentStarting | LifecycleEventName::ComponentRestartScheduled,
        ) => &["processKey", "readinessUrl"],
        (
            SupervisedComponent::CodexAppServer,
            LifecycleEventName::ComponentStarted
            | LifecycleEventName::ComponentRestartSucceeded
            | LifecycleEventName::ComponentHealthcheckFailed,
        ) => &["processKey", "readinessUrl", "pid"],
        (SupervisedComponent::CodexAppServer, LifecycleEventName::ComponentExited) => {
            &["processKey", "pid"]
        }
    }
}

pub fn encode_forwarded_lifecycle_event_log_line(raw_line: &str) -> Result<String, String> {
    let parsed_value: Value = serde_json::from_str(raw_line)
        .map_err(|error| format!("invalid lifecycle event json: {error}"))?;
    let parsed_object = parsed_value
        .as_object()
        .ok_or_else(|| "lifecycle event line must be a json object".to_string())?;
    let observed_at = parsed_object
        .get("observedAt")
        .and_then(Value::as_str)
        .ok_or_else(|| "lifecycle event line is missing observedAt".to_string())?;
    let event_name = parsed_object
        .get("event")
        .and_then(Value::as_str)
        .ok_or_else(|| "lifecycle event line is missing event".to_string())?;

    let level = match event_name {
        "component_starting" | "component_started" | "component_restart_succeeded" => {
            LifecycleEventLevel::Info
        }
        "component_healthcheck_failed" | "component_restart_scheduled" => LifecycleEventLevel::Warn,
        "component_exited" => LifecycleEventLevel::Error,
        other => {
            return Err(format!(
                "unsupported lifecycle event '{other}' cannot be forwarded"
            ));
        }
    };

    let mut payload = Map::new();
    payload.insert(
        "timestamp".to_string(),
        Value::String(observed_at.to_string()),
    );
    payload.insert(
        "level".to_string(),
        Value::String(level.as_str().to_string()),
    );
    payload.insert("event".to_string(), Value::String(event_name.to_string()));
    for (field_name, field_value) in parsed_object {
        if field_name == "event" {
            continue;
        }
        payload.insert(field_name.clone(), field_value.clone());
    }

    let mut line =
        serde_json::to_string(&Value::Object(payload)).map_err(|error| error.to_string())?;
    line.push('\n');
    Ok(line)
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use serde_json::Value;

    use crate::supervision::{
        ComponentHealthState, MAX_FORWARDED_LIFECYCLE_EVENT_LINES, SandboxdSupervisorHandle,
        SupervisedComponent,
    };
    use crate::time::Clock;
    use crate::time::testing::MutableClock;
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
        assert_eq!(snapshot.last_failed_at, Some(clock.now_system_time()));
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

    #[test]
    fn emits_lifecycle_lines_and_drains_the_forwarding_queue() {
        let clock = Arc::new(MutableClock::new(500));
        let handle = SandboxdSupervisorHandle::new(
            "sandbox-123",
            clock.clone(),
            BTreeSet::from([SupervisedComponent::EgressProxy]),
        );
        handle.replace_component_details(
            SupervisedComponent::EgressProxy,
            BTreeMap::from([
                ("listenAddr".to_string(), "127.0.0.1:38513".to_string()),
                ("stablePort".to_string(), "38513".to_string()),
            ]),
        );

        handle.mark_component_starting(SupervisedComponent::EgressProxy);
        clock.advance_ms(10);
        handle.mark_component_healthy(SupervisedComponent::EgressProxy);
        clock.advance_ms(10);
        handle
            .mark_component_restarting(SupervisedComponent::EgressProxy, "loopback connect failed");
        handle.emit_component_healthcheck_failed(
            SupervisedComponent::EgressProxy,
            "loopback_connect_failed",
            "loopback connect failed",
            "loopback_tcp",
            &[],
        );
        handle.emit_component_restart_scheduled(
            SupervisedComponent::EgressProxy,
            "retry_after_failure",
            250,
            &[],
        );
        clock.advance_ms(10);
        handle.mark_component_starting(SupervisedComponent::EgressProxy);
        clock.advance_ms(10);
        handle.mark_component_healthy(SupervisedComponent::EgressProxy);

        let lines = handle.drain_forwarded_lifecycle_event_lines();
        assert_eq!(lines.len(), 6);

        let events = lines
            .iter()
            .map(|line| serde_json::from_str::<Value>(line).expect("event line should be json"))
            .map(|value| {
                value["event"]
                    .as_str()
                    .expect("event should be present")
                    .to_string()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            events,
            vec![
                "component_starting".to_string(),
                "component_started".to_string(),
                "component_healthcheck_failed".to_string(),
                "component_restart_scheduled".to_string(),
                "component_starting".to_string(),
                // The next line is emitted when the component returns from Restarting -> Healthy.
                "component_restart_succeeded".to_string(),
            ]
        );
    }

    #[test]
    fn drops_oldest_forwarded_lifecycle_lines_when_the_queue_is_full() {
        let clock = Arc::new(MutableClock::new(1_000));
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

        for event_index in 0..(MAX_FORWARDED_LIFECYCLE_EVENT_LINES + 3) {
            handle.emit_component_exited(
                SupervisedComponent::CodexProxy,
                "runtime_thread_returned",
                Some("session manager ended"),
                &[
                    (
                        "sequence",
                        Value::from(u64::try_from(event_index).expect("sequence should fit")),
                    ),
                    (
                        "exitKind",
                        Value::String("runtime_thread_returned".to_string()),
                    ),
                ],
            );
        }

        let lines = handle.drain_forwarded_lifecycle_event_lines();
        assert_eq!(lines.len(), MAX_FORWARDED_LIFECYCLE_EVENT_LINES);
        let first_line: Value =
            serde_json::from_str(lines.first().expect("queue should contain entries"))
                .expect("line should decode");
        assert_eq!(
            first_line["sequence"],
            Value::from(u64::try_from(3).expect("sequence should fit"))
        );
    }
}
