use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::keepalive::KeepaliveManager;
use crate::protocol::activation::ActivationInput;
use crate::protocol::session::SessionRuntimeInput;
use crate::protocol::startup::ActivationOperationKind;
use crate::runtime::adapters::RuntimeAdapters;
use crate::runtime::readiness::RuntimeReadinessManager;
use crate::sandboxd_state::lifecycle::{SandboxdExecutionMode, SandboxdState};
use crate::supervision::SandboxdSupervisorHandle;
use crate::time::SystemClock;
use crate::time::testing::ManualSleeper;

#[test]
fn activation_policy_applies_runtime_plan_for_base_images() {
    for operation_kind in [
        ActivationOperationKind::Start,
        ActivationOperationKind::Resume,
        ActivationOperationKind::SetupCheck,
        ActivationOperationKind::Snapshot,
    ] {
        assert!(super::should_apply_runtime_plan_for_activation(
            false,
            operation_kind,
        ));
    }
}

#[test]
fn activation_policy_only_applies_pre_materialized_snapshot_for_snapshot_preparation() {
    assert!(super::should_apply_runtime_plan_for_activation(
        true,
        ActivationOperationKind::Snapshot,
    ));
    assert!(!super::should_apply_runtime_plan_for_activation(
        true,
        ActivationOperationKind::Start,
    ));
    assert!(!super::should_apply_runtime_plan_for_activation(
        true,
        ActivationOperationKind::Resume,
    ));
    assert!(super::should_apply_runtime_plan_for_activation(
        true,
        ActivationOperationKind::SetupCheck,
    ));
}

#[test]
fn setup_script_policy_follows_runtime_plan_application() {
    assert!(super::should_run_setup_script_for_activation(true));
    assert!(!super::should_run_setup_script_for_activation(false));
}

#[test]
fn initialized_live_session_rejects_snapshot_activation() {
    let mut state = minimal_initialized_state(SandboxdExecutionMode::Session);
    let accepted_session_input = SessionRuntimeInput::from_activation_input(&activation_input(
        ActivationOperationKind::Start,
    ));
    let error = state
        .activate_initialized(
            &activation_input(ActivationOperationKind::Snapshot),
            &accepted_session_input,
            std::path::Path::new("/tmp/test-gitconfig"),
            None,
        )
        .expect_err("snapshot activation should be rejected for initialized live sessions");

    assert!(error.to_string().contains(
        "snapshot materialization activation is only supported before sandboxd is initialized"
    ));
}

#[test]
fn initialized_snapshot_state_rejects_activation_refresh() {
    let mut state = minimal_initialized_state(SandboxdExecutionMode::Snapshot);
    let accepted_session_input = SessionRuntimeInput::from_activation_input(&activation_input(
        ActivationOperationKind::Start,
    ));
    let error = state
        .activate_initialized(
            &activation_input(ActivationOperationKind::Start),
            &accepted_session_input,
            std::path::Path::new("/tmp/test-gitconfig"),
            None,
        )
        .expect_err("snapshot state should reject activation refresh");

    assert!(
        error
            .to_string()
            .contains("snapshot materialization sandboxes do not support activation")
    );
}

#[test]
fn initialized_live_session_rejects_runtime_plan_changes() {
    let mut state = minimal_initialized_state(SandboxdExecutionMode::Session);
    let accepted_activation_input = activation_input(ActivationOperationKind::Start);
    let accepted_session_input =
        SessionRuntimeInput::from_activation_input(&accepted_activation_input);
    let mut candidate_activation_input = accepted_activation_input;
    candidate_activation_input.runtime_plan["sandboxProfileId"] =
        serde_json::json!("sbp_replacement");

    let error = state
        .activate_initialized(
            &candidate_activation_input,
            &accepted_session_input,
            std::path::Path::new("/tmp/test-gitconfig"),
            None,
        )
        .expect_err("initialized activation should reject runtime plan changes");

    assert!(
        error
            .to_string()
            .contains("initialized activation cannot change runtime plan")
    );
}

fn activation_input(operation_kind: ActivationOperationKind) -> ActivationInput {
    ActivationInput {
        operation_kind,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: "ws://127.0.0.1:1/bootstrap?sandbox_instance_id=sbi_test"
            .to_string(),
        acting_user_id: None,
        runtime_plan: serde_json::json!({
            "sandboxProfileId": "sbp_test",
            "version": 1,
            "image": {
                "source": "base",
                "imageRef": "registry.example.test/base:latest"
            },
            "egressRoutes": [],
            "artifacts": [],
            "runtimeClients": [],
            "workspaceSources": [],
            "agentRuntimes": []
        }),
        git_identity: None,
        transparent_proxy: None,
    }
}

fn minimal_initialized_state(execution_mode: SandboxdExecutionMode) -> SandboxdState {
    let clock = Arc::new(SystemClock);
    SandboxdState {
        egress_proxy: None,
        process_manager: None,
        runtime_adapters: RuntimeAdapters::default(),
        codex_app_server_observation_handle: None,
        codex_app_server_control_handle: None,
        opencode_server_control_handle: None,
        codex_proxy_control_handle: None,
        runtime_coordination_shutdown_requested: Arc::new(AtomicBool::new(false)),
        runtime_coordination_thread: None,
        runtime_readiness_shutdown_requested: Arc::new(AtomicBool::new(false)),
        runtime_readiness_thread: None,
        runtime_agent_probe_handle: None,
        daemon_liveness_monitor: None,
        supervisor_handle: SandboxdSupervisorHandle::new(
            "sbi_test".to_string(),
            clock.clone(),
            BTreeSet::new(),
        ),
        keepalive_manager: Arc::new(Mutex::new(KeepaliveManager::default())),
        runtime_readiness_manager: Arc::new(Mutex::new(RuntimeReadinessManager::default())),
        agent_endpoint_url: None,
        runtime_env: BTreeMap::new(),
        gateway_egress_token_provider: None,
        clock,
        sleeper: Arc::new(ManualSleeper::default()),
        tunnel_session: None,
        execution_mode,
    }
}
