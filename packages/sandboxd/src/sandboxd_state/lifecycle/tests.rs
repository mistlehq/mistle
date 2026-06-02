use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::net::TcpListener;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::codex_proxy::start_codex_proxy_with_supervisor;
use crate::keepalive::KeepaliveManager;
use crate::process::start_runtime_client_process_manager_with_supervisor;
use crate::protocol::activation::ActivationInput;
use crate::protocol::session::SessionRuntimeInput;
use crate::protocol::startup::{
    GitIdentity, GitSigningConfig, StartupExecutionMode, StartupInput, StartupMode,
};
use crate::runtime::adapters::RuntimeAdapters;
use crate::runtime::readiness::{RuntimeReadinessManager, RuntimeReadinessMode};
use crate::runtime::{
    CompiledRuntimePlan, RuntimeClientProcessReadiness, RuntimeClientProcessStopPolicy,
    RuntimeClientProcessStopSignal, RuntimeExecCommand,
};
use crate::sandboxd_state::lifecycle::{DEFAULT_GLOBAL_GIT_CONFIG_PATH, SandboxdState};
use crate::sandboxd_state::readiness::spawn_runtime_readiness_projection_thread;
use crate::sandboxd_state::runtime_coordination::{
    RuntimeCoordinationHandles, spawn_runtime_coordination_thread,
};
use crate::sandboxd_state::setup_script::run_setup_script_in_directory_with_output_sink;
use crate::startup_diagnostics::{StartupDiagnosticsLogger, StartupOperation};
use crate::supervision::{ComponentHealthState, SandboxdSupervisorHandle, SupervisedComponent};
use crate::test_support::TestEnvVarsGuard;
use crate::time::{SystemClock, ThreadSleeper};
use tungstenite::{Message, WebSocket, accept};

#[test]
fn run_setup_script_writes_stdout_and_stderr_transcript_records() {
    let log_dir = std::env::temp_dir().join(format!(
        "mistle-setup-script-transcript-log-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    ));
    let _ = fs::remove_dir_all(&log_dir);
    fs::create_dir_all(&log_dir).expect("startup diagnostics log dir should be creatable");
    let _env_guard = TestEnvVarsGuard::set([(
        "MISTLE_SANDBOXD_OPERATION_LOG_DIR",
        log_dir.to_string_lossy().to_string(),
    )]);
    let bootstrap_url = "ws://127.0.0.1:4000/tunnel/sandbox/sbi_setup_transcript";
    let diagnostics_logger =
        StartupDiagnosticsLogger::initialize(StartupOperation::Init, bootstrap_url)
            .expect("startup diagnostics logger should initialize");
    let runtime_plan = CompiledRuntimePlan {
        image: test_runtime_plan_image(crate::runtime::CompiledRuntimePlanImageSource::Base),
        setup_script: Some(
            "printf setup-script-stdout; printf setup-script-stderr >&2".to_string(),
        ),
        egress_routes: Vec::new(),
        artifacts: Vec::new(),
        workspace_sources: Vec::new(),
        skills: None,
        runtime_clients: Vec::new(),
        agent_runtimes: Vec::new(),
    };

    run_setup_script_in_directory_with_output_sink(
        &runtime_plan,
        &BTreeMap::new(),
        std::env::temp_dir()
            .to_str()
            .expect("temporary directory should be valid unicode"),
        &SystemClock,
        &ThreadSleeper,
        super::command_output_sink(&Some(diagnostics_logger), "run_setup_script"),
    )
    .expect("setup script should run successfully");

    let init_log = fs::read_to_string(log_dir.join("init.log"))
        .expect("startup diagnostics init log should be readable");
    let transcript_records = parse_startup_diagnostic_records(&init_log)
        .into_iter()
        .filter(|event| event["event"] == "sandbox_init_transcript")
        .collect::<Vec<_>>();
    assert!(
        transcript_records.iter().any(|event| {
            event["phase"] == "run_setup_script"
                && event["stream"] == "stdout"
                && event["message"]
                    .as_str()
                    .is_some_and(|message| message.contains("setup-script-stdout"))
        }),
        "setup script stdout should be captured in init transcript: {transcript_records:?}"
    );
    assert!(
        transcript_records.iter().any(|event| {
            event["phase"] == "run_setup_script"
                && event["stream"] == "stderr"
                && event["message"]
                    .as_str()
                    .is_some_and(|message| message.contains("setup-script-stderr"))
        }),
        "setup script stderr should be captured in init transcript: {transcript_records:?}"
    );

    let _ = fs::remove_dir_all(log_dir);
}

#[test]
fn snapshot_materialization_initialization_applies_runtime_plan_and_skips_session_runtime_resources()
 {
    let (bootstrap_url, gateway_thread) = start_snapshot_bootstrap_gateway();
    let output_path = std::env::temp_dir().join(format!(
        "mistle-snapshot-materialization-artifact-output-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    ));
    let state = SandboxdState::initialize(
            &build_startup_input(
                StartupMode::New,
                StartupExecutionMode::Snapshot,
                &bootstrap_url,
                serde_json::json!({
                    "sandboxProfileId": "sbp_test_001",
                    "version": 1,
                    "image": {
                        "source": "base",
                        "imageRef": "registry.example.test/base:latest"
                    },
                    "egressRoutes": [],
                    "artifacts": [
                        {
                            "artifactKey": "artifact_1",
                            "name": "artifact one",
                            "lifecycle": {
                                "install": [
                                    {
                                        "op": "exec",
                                        "command": {
                                            "args": [
                                                "sh",
                                                "-c",
                                                format!("printf snapshot-artifact > {}", output_path.display())
                                            ]
                                        }
                                    }
                                ]
                            }
                        }
                    ],
                    "workspaceSources": [],
                    "runtimeClients": [
                        {
                            "clientId": "snapshot-client",
                            "setup": {
                                "env": {},
                                "files": []
                            },
                            "processes": [
                                {
                                    "processKey": "should-not-start",
                                    "command": {
                                        "args": ["/definitely/missing-binary"]
                                    },
                                    "readiness": {
                                        "type": "none"
                                    },
                                    "stop": {
                                        "signal": "sigterm",
                                        "timeoutMs": 10000,
                                        "gracePeriodMs": 2000
                                    }
                                }
                            ],
                            "endpoints": [
                                {
                                    "endpointKey": "app-server",
                                    "processKey": "should-not-start",
                                    "transport": {
                                        "type": "ws",
                                        "url": "ws://127.0.0.1:4500/codex"
                                    },
                                    "connectionMode": "dedicated"
                                }
                            ]
                        }
                    ],
                    "agentRuntimes": [
                        {
                            "runtimeId": "codex",
                            "runtimeKey": "should-not-start",
                            "clientId": "snapshot-client",
                            "endpointKey": "app-server",
                            "ptyLaunch": {}
                        }
                    ]
                }),
                None,
            ),
            Path::new(DEFAULT_GLOBAL_GIT_CONFIG_PATH),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
            None,
        )
        .expect("snapshot materialization init should succeed after static runtime-plan setup");
    gateway_thread
        .join()
        .expect("snapshot gateway thread should exit after tunnel shutdown");

    assert_eq!(state.execution_mode, StartupExecutionMode::Snapshot);
    assert!(state.process_manager.is_none());
    assert!(state.runtime_adapters.adapters().is_empty());
    assert!(state.tunnel_session.is_none());

    let output = std::fs::read_to_string(&output_path)
        .expect("runtime-plan artifact install should write its output file");
    assert_eq!(output, "snapshot-artifact");

    let _ = std::fs::remove_file(output_path);
}

#[test]
fn snapshot_materialization_gateway_egress_uses_common_minimal_bootstrap_tunnel_for_setup() {
    let log_dir = std::env::temp_dir().join(format!(
        "mistle-snapshot-materialization-gateway-log-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    ));
    let _ = fs::remove_dir_all(&log_dir);
    fs::create_dir_all(&log_dir).expect("startup diagnostics log dir should be creatable");
    let _env_guard = TestEnvVarsGuard::set([(
        "MISTLE_SANDBOXD_OPERATION_LOG_DIR",
        log_dir.to_string_lossy().to_string(),
    )]);
    let output_path = std::env::temp_dir().join(format!(
        "mistle-snapshot-materialization-gateway-output-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    ));
    let (bootstrap_url, gateway_thread) = start_snapshot_bootstrap_gateway();

    let state = SandboxdState::initialize(
            &build_startup_input(
                StartupMode::New,
                StartupExecutionMode::Snapshot,
                &bootstrap_url,
                serde_json::json!({
                    "sandboxProfileId": "sbp_test_001",
                    "version": 1,
                    "image": {
                        "source": "base",
                        "imageRef": "registry.example.test/base:latest"
                    },
                    "egressRoutes": [],
                    "artifacts": [
                        {
                            "artifactKey": "artifact_1",
                            "name": "artifact one",
                            "lifecycle": {
                                "install": [
                                    {
                                        "op": "exec",
                                        "command": {
                                            "args": [
                                                "sh",
                                                "-c",
                                                format!(
                                                    "printf runtime-plan-stdout; printf runtime-plan-stderr >&2; printf snapshot-gateway > {}",
                                                    output_path.display()
                                                )
                                            ]
                                        }
                                    }
                                ]
                            }
                        }
                    ],
                    "workspaceSources": [],
                    "runtimeClients": [],
                    "agentRuntimes": []
                }),
                None,
            ),
            Path::new(DEFAULT_GLOBAL_GIT_CONFIG_PATH),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
            Some(
                StartupDiagnosticsLogger::initialize(StartupOperation::Init, &bootstrap_url)
                    .expect("startup diagnostics logger should initialize"),
            ),
        )
        .expect("snapshot materialization init should use temporary gateway tunnel for setup");

    gateway_thread
        .join()
        .expect("snapshot gateway thread should exit after tunnel shutdown");
    assert_eq!(state.execution_mode, StartupExecutionMode::Snapshot);
    assert!(state.process_manager.is_none());
    assert!(state.runtime_adapters.adapters().is_empty());
    assert!(state.tunnel_session.is_none());
    assert!(state.egress_proxy.is_none());
    let tunnel_snapshot = state
        .supervisor_handle
        .component_snapshot(SupervisedComponent::TunnelSession)
        .expect("tunnel session should be tracked");
    assert_eq!(tunnel_snapshot.state, ComponentHealthState::Stopped);

    let output = std::fs::read_to_string(&output_path)
        .expect("runtime-plan artifact install should write its output file");
    assert_eq!(output, "snapshot-gateway");

    let init_log = fs::read_to_string(log_dir.join("init.log"))
        .expect("startup diagnostics init log should be readable");
    let phases = init_log
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|event| event["event"] == "sandbox_init_phase_started")
        .filter_map(|event| event["phase"].as_str().map(ToOwned::to_owned))
        .collect::<Vec<_>>();
    let start_tunnel_index = phases
        .iter()
        .position(|phase| phase == "start_tunnel_session")
        .expect("common tunnel phase should be recorded");
    assert!(
        !phases
            .iter()
            .any(|phase| phase == "start_snapshot_tunnel_session"),
        "snapshot initialization must not use a snapshot-only tunnel phase; phases: {phases:?}"
    );
    let apply_runtime_plan_index = phases
        .iter()
        .position(|phase| phase == "apply_runtime_plan")
        .expect("runtime plan phase should be recorded");
    assert!(
        start_tunnel_index < apply_runtime_plan_index,
        "common gateway tunnel must start before runtime plan materialization; phases: {phases:?}"
    );
    let transcript_records = parse_startup_diagnostic_records(&init_log)
        .into_iter()
        .filter(|event| event["event"] == "sandbox_init_transcript")
        .collect::<Vec<_>>();
    assert!(
        transcript_records.iter().any(|event| {
            event["phase"] == "apply_runtime_plan"
                && event["stream"] == "stdout"
                && event["message"]
                    .as_str()
                    .is_some_and(|message| message.contains("runtime-plan-stdout"))
        }),
        "runtime plan stdout should be captured in init transcript: {transcript_records:?}"
    );
    assert!(
        transcript_records.iter().any(|event| {
            event["phase"] == "apply_runtime_plan"
                && event["stream"] == "stderr"
                && event["message"]
                    .as_str()
                    .is_some_and(|message| message.contains("runtime-plan-stderr"))
        }),
        "runtime plan stderr should be captured in init transcript: {transcript_records:?}"
    );

    let _ = std::fs::remove_file(output_path);
    let _ = fs::remove_dir_all(log_dir);
}

#[test]
fn session_start_from_snapshot_skips_setup_script() {
    let output_path = std::env::temp_dir().join(format!(
        "mistle-session-start-from-snapshot-setup-output-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    ));
    let _ = fs::remove_file(&output_path);
    let (bootstrap_url, gateway_thread) = start_snapshot_bootstrap_gateway();
    let git_config_path = std::env::temp_dir().join(format!(
        "mistle-session-start-from-snapshot-git-config-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    ));

    let state = SandboxdState::initialize(
        &build_startup_input(
            StartupMode::New,
            StartupExecutionMode::Session,
            &bootstrap_url,
            serde_json::json!({
                "sandboxProfileId": "sbp_test_001",
                "version": 1,
                "image": {
                    "source": "snapshot",
                    "imageRef": "registry.example.test/snapshot:latest"
                },
                "setupScript": format!("printf unexpected > {}", output_path.display()),
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            None,
        ),
        git_config_path.as_path(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
        None,
    )
    .expect("session start from snapshot should initialize");

    assert!(
        !output_path.exists(),
        "normal session starts from snapshots must not rerun setup scripts"
    );

    state
        .close()
        .expect("session start from snapshot state should close cleanly");
    gateway_thread
        .join()
        .expect("session gateway thread should exit after tunnel shutdown");
    let _ = fs::remove_file(git_config_path);
}

#[test]
fn snapshot_preparation_operations_run_setup_script_from_snapshot() {
    let start_input = build_startup_input(
        StartupMode::New,
        StartupExecutionMode::Session,
        "ws://127.0.0.1:1/tunnel/sandbox/sbi_test",
        minimal_runtime_plan_json(),
        None,
    );
    let setup_check_input = build_startup_input_with_operation_kind(
        StartupMode::New,
        StartupExecutionMode::Session,
        crate::protocol::startup::StartupOperationKind::SetupCheck,
        "ws://127.0.0.1:1/tunnel/sandbox/sbi_test",
        minimal_runtime_plan_json(),
        None,
    );
    let snapshot_input = build_startup_input_with_operation_kind(
        StartupMode::New,
        StartupExecutionMode::Session,
        crate::protocol::startup::StartupOperationKind::Snapshot,
        "ws://127.0.0.1:1/tunnel/sandbox/sbi_test",
        minimal_runtime_plan_json(),
        None,
    );

    assert!(!super::should_run_setup_script_for_startup(
        false,
        true,
        &start_input
    ));
    assert!(super::should_run_setup_script_for_startup(
        true,
        true,
        &setup_check_input
    ));
    assert!(super::should_apply_runtime_plan_for_startup(
        true,
        &setup_check_input
    ));
    assert!(super::should_run_setup_script_for_startup(
        true,
        true,
        &snapshot_input
    ));
    assert!(super::should_apply_runtime_plan_for_startup(
        true,
        &snapshot_input
    ));
    assert!(super::should_run_setup_script_for_startup(
        true,
        false,
        &start_input
    ));
    assert!(!super::should_apply_runtime_plan_for_startup(
        false,
        &build_startup_input(
            StartupMode::Existing,
            StartupExecutionMode::Session,
            "ws://127.0.0.1:1/tunnel/sandbox/sbi_test",
            minimal_runtime_plan_json(),
            None,
        ),
    ));
    assert!(!super::should_run_setup_script_for_startup(
        false,
        false,
        &build_startup_input(
            StartupMode::Existing,
            StartupExecutionMode::Session,
            "ws://127.0.0.1:1/tunnel/sandbox/sbi_test",
            minimal_runtime_plan_json(),
            None,
        ),
    ));
}

#[test]
fn activation_start_from_snapshot_skips_materialization_setup() {
    assert!(!super::should_apply_runtime_plan_for_activation(
        true,
        crate::protocol::startup::StartupOperationKind::Start
    ));
    assert!(!super::should_run_setup_script_for_activation(false));
    assert!(super::should_apply_runtime_plan_for_activation(
        false,
        crate::protocol::startup::StartupOperationKind::Start
    ));
    assert!(super::should_run_setup_script_for_activation(true));
    assert!(super::should_apply_runtime_plan_for_activation(
        true,
        crate::protocol::startup::StartupOperationKind::SetupCheck
    ));
}

#[test]
fn restore_accepted_git_identity_after_activation_failure_reapplies_previous_config() {
    let git_config_path = std::env::temp_dir().join(format!(
        "mistle-activation-git-rollback-config-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    ));
    let accepted_startup_input = build_startup_input(
        StartupMode::New,
        StartupExecutionMode::Session,
        "ws://127.0.0.1:5003/tunnel/sandbox",
        minimal_runtime_plan_json(),
        Some(GitIdentity {
            name: "Accepted User".to_string(),
            email: "accepted@example.com".to_string(),
            signing: Some(GitSigningConfig {
                format: "ssh".to_string(),
                program: "/opt/mistle/bin/mistle-ssh-sign".to_string(),
                key_ref: "key::accepted".to_string(),
                organization_id: "org_accepted".to_string(),
                provider_family: "github".to_string(),
                integration_connection_id: Some("icn_accepted".to_string()),
                acting_user_id: "usr_accepted".to_string(),
                grant: "accepted-grant".to_string(),
            }),
        }),
    );
    let rejected_startup_input = build_startup_input(
        StartupMode::New,
        StartupExecutionMode::Session,
        "ws://127.0.0.1:5003/tunnel/sandbox",
        minimal_runtime_plan_json(),
        Some(GitIdentity {
            name: "Rejected User".to_string(),
            email: "rejected@example.com".to_string(),
            signing: None,
        }),
    );
    let accepted_session_input = SessionRuntimeInput::from_startup_input(&accepted_startup_input);
    let rejected_session_input = SessionRuntimeInput::from_startup_input(&rejected_startup_input);

    crate::runtime::git_identity::apply_git_identity(&rejected_session_input, &git_config_path)
        .expect("rejected candidate Git identity should apply before rollback");
    super::restore_accepted_git_identity_after_activation_failure(
        &accepted_session_input,
        &git_config_path,
        "test failure",
    )
    .expect("accepted Git identity should be restored");

    let git_config_contents =
        fs::read_to_string(&git_config_path).expect("Git config should be readable");
    assert!(git_config_contents.contains("name = Accepted User"));
    assert!(git_config_contents.contains("email = accepted@example.com"));
    assert!(git_config_contents.contains("signingkey = key::accepted"));
    assert!(!git_config_contents.contains("Rejected User"));
    assert!(!git_config_contents.contains("rejected@example.com"));

    let _ = fs::remove_file(git_config_path);
}

#[test]
fn restore_accepted_git_identity_after_activation_failure_clears_rejected_identity() {
    let git_config_path = std::env::temp_dir().join(format!(
        "mistle-activation-git-clear-rollback-config-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    ));
    let accepted_startup_input = build_startup_input(
        StartupMode::New,
        StartupExecutionMode::Session,
        "ws://127.0.0.1:5003/tunnel/sandbox",
        minimal_runtime_plan_json(),
        None,
    );
    let rejected_startup_input = build_startup_input(
        StartupMode::New,
        StartupExecutionMode::Session,
        "ws://127.0.0.1:5003/tunnel/sandbox",
        minimal_runtime_plan_json(),
        Some(GitIdentity {
            name: "Rejected User".to_string(),
            email: "rejected@example.com".to_string(),
            signing: None,
        }),
    );
    let accepted_session_input = SessionRuntimeInput::from_startup_input(&accepted_startup_input);
    let rejected_session_input = SessionRuntimeInput::from_startup_input(&rejected_startup_input);

    crate::runtime::git_identity::apply_git_identity(&rejected_session_input, &git_config_path)
        .expect("rejected candidate Git identity should apply before rollback");
    super::restore_accepted_git_identity_after_activation_failure(
        &accepted_session_input,
        &git_config_path,
        "test failure",
    )
    .expect("accepted absent Git identity should be restored");

    let git_config_contents =
        fs::read_to_string(&git_config_path).expect("Git config should be readable");
    assert!(!git_config_contents.contains("Rejected User"));
    assert!(!git_config_contents.contains("rejected@example.com"));

    let _ = fs::remove_file(git_config_path);
}

#[test]
fn session_initialization_uses_common_minimal_bootstrap_tunnel_phase() {
    let log_dir = std::env::temp_dir().join(format!(
        "mistle-session-initialization-gateway-log-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    ));
    let _ = fs::remove_dir_all(&log_dir);
    fs::create_dir_all(&log_dir).expect("startup diagnostics log dir should be creatable");
    let _env_guard = TestEnvVarsGuard::set([(
        "MISTLE_SANDBOXD_OPERATION_LOG_DIR",
        log_dir.to_string_lossy().to_string(),
    )]);
    let (bootstrap_url, gateway_thread) = start_snapshot_bootstrap_gateway();
    let git_config_path = std::env::temp_dir().join(format!(
        "mistle-session-initialization-git-config-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    ));

    let state = SandboxdState::initialize(
        &build_startup_input(
            StartupMode::New,
            StartupExecutionMode::Session,
            &bootstrap_url,
            minimal_runtime_plan_json(),
            None,
        ),
        git_config_path.as_path(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
        Some(
            StartupDiagnosticsLogger::initialize(StartupOperation::Init, &bootstrap_url)
                .expect("startup diagnostics logger should initialize"),
        ),
    )
    .expect("session initialization should use common gateway tunnel");

    assert_eq!(state.execution_mode, StartupExecutionMode::Session);
    assert!(state.tunnel_session.is_some());

    let init_log = fs::read_to_string(log_dir.join("init.log"))
        .expect("startup diagnostics init log should be readable");
    let phases = init_log
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|event| event["event"] == "sandbox_init_phase_started")
        .filter_map(|event| event["phase"].as_str().map(ToOwned::to_owned))
        .collect::<Vec<_>>();
    assert!(
        phases.iter().any(|phase| phase == "start_tunnel_session"),
        "session initialization should use the common tunnel phase; phases: {phases:?}"
    );
    let start_tunnel_index = phases
        .iter()
        .position(|phase| phase == "start_tunnel_session")
        .expect("session tunnel phase should be recorded");
    let attach_runtime_environment_index = phases
        .iter()
        .position(|phase| phase == "attach_runtime_environment")
        .expect("runtime environment attach phase should be recorded");
    assert!(
        start_tunnel_index < attach_runtime_environment_index,
        "common gateway tunnel must start before runtime environment attach; phases: {phases:?}"
    );
    assert!(
        phases
            .iter()
            .any(|phase| phase == "attach_runtime_environment"),
        "session initialization should attach runtime env after minimal tunnel start; phases: {phases:?}"
    );
    assert!(
        !phases
            .iter()
            .any(|phase| phase == "start_snapshot_tunnel_session"),
        "session initialization must not use a snapshot-only tunnel phase; phases: {phases:?}"
    );

    state.close().expect("session state should close cleanly");
    gateway_thread
        .join()
        .expect("session gateway thread should exit after tunnel shutdown");
    let _ = fs::remove_file(git_config_path);
    let _ = fs::remove_dir_all(log_dir);
}

#[test]
fn resume_reopens_minimal_bootstrap_tunnel_with_initial_runtime_not_ready() {
    let log_dir = std::env::temp_dir().join(format!(
        "mistle-sandboxd-resume-gateway-log-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    ));
    let _ = fs::remove_dir_all(&log_dir);
    fs::create_dir_all(&log_dir).expect("startup diagnostics log dir should be creatable");
    let _env_guard = TestEnvVarsGuard::set([(
        "MISTLE_SANDBOXD_OPERATION_LOG_DIR",
        log_dir.to_string_lossy().to_string(),
    )]);
    let (bootstrap_url, gateway_thread) =
        start_bootstrap_gateway_with_connections(2, RuntimeReadyExpectation::RequiredFalse);
    let git_config_path = std::env::temp_dir().join(format!(
        "mistle-sandboxd-resume-git-config-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    ));
    let accepted_startup_input = build_startup_input(
        StartupMode::New,
        StartupExecutionMode::Session,
        &bootstrap_url,
        minimal_runtime_plan_json(),
        None,
    );
    let mut state = SandboxdState::initialize(
        &accepted_startup_input,
        git_config_path.as_path(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
        Some(
            StartupDiagnosticsLogger::initialize(StartupOperation::Init, &bootstrap_url)
                .expect("startup diagnostics logger should initialize"),
        ),
    )
    .expect("session initialization should succeed");
    wait_for_runtime_ready_value(
        &state.runtime_readiness_manager,
        true,
        Duration::from_secs(5),
    );

    state
        .resume(
            &build_startup_input(
                StartupMode::Existing,
                StartupExecutionMode::Session,
                &bootstrap_url,
                minimal_runtime_plan_json(),
                None,
            ),
            &SessionRuntimeInput::from_startup_input(&accepted_startup_input),
            git_config_path.as_path(),
            Some(
                StartupDiagnosticsLogger::initialize(StartupOperation::Resume, &bootstrap_url)
                    .expect("resume diagnostics logger should initialize"),
            ),
        )
        .expect("session resume should reopen the bootstrap tunnel");

    let resume_log = fs::read_to_string(log_dir.join("resume.log"))
        .expect("resume diagnostics log should be readable");
    let phases = resume_log
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|event| event["event"] == "sandbox_resume_phase_started")
        .filter_map(|event| event["phase"].as_str().map(ToOwned::to_owned))
        .collect::<Vec<_>>();
    let start_tunnel_index = phases
        .iter()
        .position(|phase| phase == "start_tunnel_session")
        .expect("resume tunnel phase should be recorded");
    let apply_git_identity_index = phases
        .iter()
        .position(|phase| phase == "apply_git_identity")
        .expect("resume git identity phase should be recorded");
    assert!(
        start_tunnel_index < apply_git_identity_index,
        "resume minimal gateway tunnel must start before git identity; phases: {phases:?}"
    );

    state.close().expect("session state should close cleanly");
    gateway_thread
        .join()
        .expect("resume gateway thread should exit after tunnel shutdown");
    let _ = fs::remove_file(git_config_path);
    let _ = fs::remove_dir_all(log_dir);
}

#[test]
fn failed_initialized_activation_restores_detached_gateway_egress_token_provider() {
    let (bootstrap_url, gateway_thread) = start_egress_token_bootstrap_gateway();
    let git_config_path = std::env::temp_dir().join(format!(
        "mistle-activation-egress-provider-rollback-git-config-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    ));
    let accepted_startup_input = build_startup_input(
        StartupMode::New,
        StartupExecutionMode::Session,
        &bootstrap_url,
        minimal_runtime_plan_json(),
        None,
    );
    let accepted_session_input = SessionRuntimeInput::from_startup_input(&accepted_startup_input);
    let mut state = SandboxdState::initialize(
        &accepted_startup_input,
        git_config_path.as_path(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
        None,
    )
    .expect("accepted session initialization should succeed");
    let token_provider = state
        .gateway_egress_token_provider
        .as_ref()
        .expect("initialized session should have gateway egress token provider")
        .clone();
    let rejected_activation_input = build_activation_input(
        "ws://127.0.0.1:1/tunnel/sandbox/sbi_rejected_activation",
        minimal_runtime_plan_json(),
        None,
    );

    let error = state
        .activate_initialized(
            &rejected_activation_input,
            &accepted_session_input,
            git_config_path.as_path(),
            None,
        )
        .expect_err("activation with unreachable candidate gateway should fail");

    assert!(
        error
            .to_string()
            .contains("failed to start bootstrap tunnel session")
    );
    let token = token_provider
        .token()
        .expect("rejected activation should restore provider attachment to accepted tunnel");
    assert_eq!(token.token, "accepted-egress-jwt");

    state
        .close()
        .expect("accepted session state should close cleanly");
    gateway_thread
        .join()
        .expect("egress token gateway thread should exit after tunnel shutdown");
    let _ = fs::remove_file(git_config_path);
}

#[test]
fn initialized_activation_rejects_adding_egress_routes_when_no_proxy_is_running() {
    let (bootstrap_url, gateway_thread) = start_snapshot_bootstrap_gateway();
    let git_config_path = std::env::temp_dir().join(format!(
        "mistle-activation-egress-route-drift-git-config-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    ));
    let accepted_startup_input = build_startup_input(
        StartupMode::New,
        StartupExecutionMode::Session,
        &bootstrap_url,
        minimal_runtime_plan_json(),
        None,
    );
    let accepted_session_input = SessionRuntimeInput::from_startup_input(&accepted_startup_input);
    let mut state = SandboxdState::initialize(
        &accepted_startup_input,
        git_config_path.as_path(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
        None,
    )
    .expect("accepted session initialization should succeed");
    assert!(
        state.egress_proxy.is_none(),
        "accepted fixture should start without an egress proxy"
    );

    let mut candidate_runtime_plan = minimal_runtime_plan_json();
    candidate_runtime_plan["egressRoutes"] = serde_json::json!([
        {
            "egressRuleId": "egress-rule-1",
            "bindingId": "binding-1",
            "familyId": "family-1",
            "variantId": "variant-1",
            "match": {
                "hosts": ["api.example.test"],
                "pathPrefixes": ["/"],
                "methods": ["GET"]
            },
            "upstream": {
                "baseUrl": "https://api.example.test"
            },
            "authInjection": {
                "type": "bearer",
                "target": null,
                "username": null,
                "service": null,
                "region": null
            },
            "additionalHeaders": null,
            "additionalCredentialHeaders": null,
            "credentialResolver": {
                "kind": "integration_connection",
                "connectionId": "connection-1",
                "grant": "grant-token"
            }
        }
    ]);
    let rejected_activation_input =
        build_activation_input(&bootstrap_url, candidate_runtime_plan, None);

    let error = state
        .activate_initialized(
            &rejected_activation_input,
            &accepted_session_input,
            git_config_path.as_path(),
            None,
        )
        .expect_err("activation should reject adding egress routes without proxy reconfiguration");

    assert!(
        error
            .to_string()
            .contains("initialized activation cannot change egress proxy input")
    );
    assert!(state.egress_proxy.is_none());

    state
        .close()
        .expect("accepted session state should close cleanly");
    gateway_thread
        .join()
        .expect("gateway thread should exit after tunnel shutdown");
    let _ = fs::remove_file(git_config_path);
}

#[test]
fn snapshot_materialization_state_rejects_resume() {
    let (bootstrap_url, gateway_thread) = start_snapshot_bootstrap_gateway();
    let accepted_startup_input = build_startup_input(
        StartupMode::New,
        StartupExecutionMode::Snapshot,
        &bootstrap_url,
        minimal_runtime_plan_json(),
        None,
    );
    let mut state = SandboxdState::initialize(
        &accepted_startup_input,
        Path::new(DEFAULT_GLOBAL_GIT_CONFIG_PATH),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
        None,
    )
    .expect("snapshot materialization init should succeed");
    gateway_thread
        .join()
        .expect("snapshot gateway thread should exit after tunnel shutdown");

    let error = state
        .resume(
            &build_startup_input(
                StartupMode::Existing,
                StartupExecutionMode::Session,
                "ws://127.0.0.1:9/bootstrap",
                minimal_runtime_plan_json(),
                None,
            ),
            &SessionRuntimeInput::from_startup_input(&accepted_startup_input),
            Path::new(DEFAULT_GLOBAL_GIT_CONFIG_PATH),
            None,
        )
        .expect_err("snapshot materialization state should reject resume");

    assert_eq!(
        error.to_string(),
        "failed to start bootstrap tunnel session: snapshot materialization sandboxes do not support resume"
    );
}

fn start_snapshot_bootstrap_gateway() -> (String, thread::JoinHandle<()>) {
    start_bootstrap_gateway_with_connections(1, RuntimeReadyExpectation::OptionalFalseBeforeClose)
}

fn start_egress_token_bootstrap_gateway() -> (String, thread::JoinHandle<()>) {
    let bootstrap_listener =
        TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
    let bootstrap_url = format!(
        "ws://127.0.0.1:{}/tunnel/sandbox/sbi_egress_token",
        bootstrap_listener
            .local_addr()
            .expect("bootstrap listener should expose an address")
            .port()
    );
    let gateway_thread = thread::spawn(move || {
        let (stream, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the bootstrap tunnel");
        let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

        let telemetry_open = read_websocket_json_text_message(&mut websocket);
        assert_eq!(telemetry_open["type"], "telemetry.open");
        loop {
            match websocket
                .read()
                .expect("websocket message should be readable")
            {
                Message::Text(payload) => {
                    let message: serde_json::Value = serde_json::from_str(&payload)
                        .expect("websocket text payload should be json");
                    if message["type"] != "egress.token.request" {
                        continue;
                    }
                    assert_eq!(
                        message,
                        serde_json::json!({
                            "type": "egress.token.request",
                            "requestId": "egress_token_req_1"
                        })
                    );
                    websocket
                        .send(Message::Text(
                            serde_json::json!({
                                "type": "egress.token.response",
                                "requestId": "egress_token_req_1",
                                "token": "accepted-egress-jwt",
                                "expiresAt": "2100-01-01T00:00:00Z",
                                "ttlMs": 300000
                            })
                            .to_string()
                            .into(),
                        ))
                        .expect("gateway should return an egress token");
                }
                Message::Ping(payload) => websocket
                    .send(Message::Pong(payload))
                    .expect("pong should be sent"),
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    (bootstrap_url, gateway_thread)
}

fn start_bootstrap_gateway_with_connections(
    connection_count: usize,
    runtime_ready_expectation: RuntimeReadyExpectation,
) -> (String, thread::JoinHandle<()>) {
    let bootstrap_listener =
        TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
    let bootstrap_url = format!(
        "ws://127.0.0.1:{}/tunnel/sandbox/sbi_snapshot_tunnel",
        bootstrap_listener
            .local_addr()
            .expect("bootstrap listener should expose an address")
            .port()
    );
    let gateway_thread = thread::spawn(move || {
        for _ in 0..connection_count {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let telemetry_open = read_websocket_json_text_message(&mut websocket);
            assert_eq!(telemetry_open["type"], "telemetry.open");

            let mut saw_runtime_ready = false;
            loop {
                match websocket.read() {
                    Ok(Message::Close(_)) => break,
                    Ok(Message::Text(payload)) => {
                        let Ok(message) = serde_json::from_str::<serde_json::Value>(&payload)
                        else {
                            continue;
                        };
                        if message["type"] == "runtime.ready" {
                            if !saw_runtime_ready {
                                assert_eq!(
                                    message["ready"], false,
                                    "the first runtime.ready publish after bootstrap attachment must be false"
                                );
                            }
                            saw_runtime_ready = true;
                        }
                    }
                    Ok(_) => {}
                    Err(_) => break,
                }
            }
            if runtime_ready_expectation == RuntimeReadyExpectation::RequiredFalse {
                assert!(
                    saw_runtime_ready,
                    "gateway should observe a runtime.ready publish before tunnel shutdown"
                );
            }
        }
    });

    (bootstrap_url, gateway_thread)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RuntimeReadyExpectation {
    RequiredFalse,
    OptionalFalseBeforeClose,
}

fn read_websocket_json_text_message<S>(socket: &mut WebSocket<S>) -> serde_json::Value
where
    S: std::io::Read + std::io::Write,
{
    loop {
        match socket.read().expect("websocket message should be readable") {
            Message::Text(payload) => {
                return serde_json::from_str(&payload)
                    .expect("websocket text payload should be json");
            }
            Message::Ping(payload) => socket
                .send(Message::Pong(payload))
                .expect("pong should be sent"),
            Message::Close(frame) => {
                panic!("websocket closed before json message: {frame:?}");
            }
            _ => {}
        }
    }
}

fn minimal_runtime_plan_json() -> serde_json::Value {
    serde_json::json!({
        "sandboxProfileId": "sbp_test_001",
        "version": 1,
        "image": {
            "source": "base",
            "imageRef": "registry.example.test/base:latest"
        },
        "egressRoutes": [],
        "artifacts": [],
        "workspaceSources": [],
        "runtimeClients": [],
        "agentRuntimes": []
    })
}

fn parse_startup_diagnostic_records(log_text: &str) -> Vec<serde_json::Value> {
    log_text
        .lines()
        .map(|line| {
            serde_json::from_str::<serde_json::Value>(line)
                .expect("startup diagnostic line should be valid json")
        })
        .collect()
}

fn test_runtime_plan_image(
    source: crate::runtime::CompiledRuntimePlanImageSource,
) -> crate::runtime::CompiledRuntimePlanImage {
    crate::runtime::CompiledRuntimePlanImage {
        source,
        image_ref: "registry.example.test/base:latest".to_string(),
    }
}

fn build_startup_input(
    startup_mode: StartupMode,
    execution_mode: StartupExecutionMode,
    tunnel_gateway_ws_url: &str,
    runtime_plan: serde_json::Value,
    git_identity: Option<GitIdentity>,
) -> StartupInput {
    build_startup_input_with_operation_kind(
        startup_mode,
        execution_mode,
        crate::protocol::startup::StartupOperationKind::Start,
        tunnel_gateway_ws_url,
        runtime_plan,
        git_identity,
    )
}

fn build_startup_input_with_operation_kind(
    startup_mode: StartupMode,
    execution_mode: StartupExecutionMode,
    operation_kind: crate::protocol::startup::StartupOperationKind,
    tunnel_gateway_ws_url: &str,
    runtime_plan: serde_json::Value,
    git_identity: Option<GitIdentity>,
) -> StartupInput {
    StartupInput {
        startup_mode,
        operation_kind,
        execution_mode,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: tunnel_gateway_ws_url.to_string(),
        acting_user_id: None,
        runtime_plan,
        git_identity,
        transparent_proxy: None,
    }
}

fn build_activation_input(
    tunnel_gateway_ws_url: &str,
    runtime_plan: serde_json::Value,
    git_identity: Option<GitIdentity>,
) -> ActivationInput {
    ActivationInput {
        operation_kind: crate::protocol::startup::StartupOperationKind::Start,
        bootstrap_token: "activation-bootstrap-token-value".to_string(),
        tunnel_exchange_token: "activation-tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: tunnel_gateway_ws_url.to_string(),
        acting_user_id: None,
        runtime_plan,
        git_identity,
        transparent_proxy: None,
    }
}

#[test]
fn coordinated_codex_recovery_restarts_the_raw_app_server_and_recovers_the_proxy() {
    let raw_port = reserve_test_port();
    let proxy_port = reserve_test_port();
    let marker_path = std::env::temp_dir().join(format!(
        "mistle-codex-exit-once-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    ));
    let process_spec = crate::process::RuntimeClientProcessSpec {
        process_key: "codex-app-server".to_string(),
        command: RuntimeExecCommand {
            args: vec![
                "node".to_string(),
                "-e".to_string(),
                codex_raw_app_server_script().to_string(),
                raw_port.to_string(),
                "exit_once".to_string(),
                "250".to_string(),
                marker_path.display().to_string(),
            ],
            env: Some(BTreeMap::new()),
            cwd: None,
            timeout_ms: None,
        },
        readiness: RuntimeClientProcessReadiness::Ws {
            url: format!("ws://127.0.0.1:{raw_port}/health"),
            timeout_ms: 5_000,
        },
        stop: RuntimeClientProcessStopPolicy {
            signal: RuntimeClientProcessStopSignal::Sigkill,
            timeout_ms: 1_000,
            grace_period_ms: None,
        },
    };
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandbox-123",
        Arc::new(SystemClock),
        BTreeSet::from([
            SupervisedComponent::CodexAppServer,
            SupervisedComponent::CodexProxy,
        ]),
    );
    let process_manager = start_runtime_client_process_manager_with_supervisor(
        std::slice::from_ref(&process_spec),
        &SystemClock,
        &ThreadSleeper,
        supervisor_handle.clone(),
    )
    .expect("process manager should start");
    let codex_app_server_control_handle = process_manager
        .codex_app_server_control_handle()
        .expect("Codex app-server control handle should exist")
        .clone();
    let codex_proxy = start_codex_proxy_with_supervisor(
        &format!("ws://127.0.0.1:{proxy_port}"),
        &format!("ws://127.0.0.1:{raw_port}/raw"),
        Arc::new(Mutex::new(KeepaliveManager::default())),
        Arc::new(Mutex::new(RuntimeReadinessManager::default())),
        supervisor_handle.clone(),
    )
    .expect("Codex proxy should start");
    let shutdown_requested = Arc::new(AtomicBool::new(false));
    let coordination_thread = spawn_runtime_coordination_thread(
        RuntimeCoordinationHandles {
            codex_app_server_control_handle: Some(codex_app_server_control_handle),
            codex_proxy_control_handle: Some(codex_proxy.control_handle()),
            opencode_server_control_handle: None,
        },
        supervisor_handle.clone(),
        shutdown_requested.clone(),
    );

    wait_for_component_state(
        &supervisor_handle,
        SupervisedComponent::CodexAppServer,
        ComponentHealthState::Healthy,
        1,
        Duration::from_secs(10),
    );
    wait_for_codex_proxy_connected(&supervisor_handle, Duration::from_secs(10));

    let codex_app_server_snapshot = supervisor_handle
        .component_snapshot(SupervisedComponent::CodexAppServer)
        .expect("Codex app-server should be tracked");
    assert_eq!(
        codex_app_server_snapshot.state,
        ComponentHealthState::Healthy
    );
    assert_eq!(
        codex_app_server_snapshot.details.get("livenessState"),
        Some(&"Alive".to_string())
    );

    shutdown_requested.store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = coordination_thread.join();
    codex_proxy
        .close()
        .expect("Codex proxy close should succeed");
    process_manager
        .stop(&SystemClock, &ThreadSleeper)
        .expect("process manager stop should succeed");
    let _ = std::fs::remove_file(marker_path);
}

#[test]
fn runtime_readiness_projection_tracks_codex_component_health() {
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandbox-123",
        Arc::new(SystemClock),
        BTreeSet::from([
            SupervisedComponent::CodexProxy,
            SupervisedComponent::CodexAppServer,
        ]),
    );
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let shutdown_requested = Arc::new(AtomicBool::new(false));
    let projection_thread = spawn_runtime_readiness_projection_thread(
        supervisor_handle.clone(),
        runtime_readiness_manager.clone(),
        RuntimeReadinessMode::Codex,
        shutdown_requested.clone(),
    );

    wait_for_runtime_ready_value(&runtime_readiness_manager, false, Duration::from_secs(5));

    supervisor_handle.mark_component_starting(SupervisedComponent::CodexProxy);
    supervisor_handle.replace_component_details(
        SupervisedComponent::CodexProxy,
        BTreeMap::from([
            ("sessionManagerState".to_string(), "Connected".to_string()),
            ("rawConnectivityState".to_string(), "Connected".to_string()),
        ]),
    );
    supervisor_handle.mark_component_healthy(SupervisedComponent::CodexProxy);
    supervisor_handle.mark_component_starting(SupervisedComponent::CodexAppServer);
    supervisor_handle.mark_component_healthy(SupervisedComponent::CodexAppServer);
    wait_for_runtime_ready_value(&runtime_readiness_manager, true, Duration::from_secs(5));

    supervisor_handle.mark_component_restarting(SupervisedComponent::CodexProxy, "proxy restart");
    wait_for_runtime_ready_value(&runtime_readiness_manager, false, Duration::from_secs(5));

    shutdown_requested.store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = projection_thread.join();
}

#[test]
fn activation_failure_restore_derives_runtime_readiness_from_restored_health_snapshot() {
    let (bootstrap_url, gateway_thread) = start_bootstrap_gateway_with_connections(
        1,
        RuntimeReadyExpectation::OptionalFalseBeforeClose,
    );
    let session_input = SessionRuntimeInput::from_startup_input(&build_startup_input(
        StartupMode::New,
        StartupExecutionMode::Session,
        &bootstrap_url,
        minimal_runtime_plan_json(),
        None,
    ));
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandbox-123",
        Arc::new(SystemClock),
        BTreeSet::from([
            SupervisedComponent::TunnelSession,
            SupervisedComponent::CodexProxy,
            SupervisedComponent::CodexAppServer,
            SupervisedComponent::RuntimeAgentEndpoint,
        ]),
    );
    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let previous_tunnel_session =
        super::start_minimal_tunnel_session(super::StartMinimalTunnelSessionInput {
            session_input: &session_input,
            keepalive_manager: keepalive_manager.clone(),
            runtime_readiness_manager: runtime_readiness_manager.clone(),
            clock: Arc::new(SystemClock),
            sleeper: Arc::new(ThreadSleeper),
            supervisor_handle: supervisor_handle.clone(),
            diagnostics_logger: &None,
        })
        .expect("previous tunnel session should start");
    let previous_tunnel_health_snapshot = supervisor_handle
        .component_snapshot(SupervisedComponent::TunnelSession)
        .expect("tunnel health should be tracked before failed activation");
    supervisor_handle.replace_component_details(
        SupervisedComponent::CodexProxy,
        BTreeMap::from([
            ("sessionManagerState".to_string(), "Connected".to_string()),
            ("rawConnectivityState".to_string(), "Connected".to_string()),
        ]),
    );
    supervisor_handle.mark_component_healthy(SupervisedComponent::CodexProxy);
    supervisor_handle.mark_component_healthy(SupervisedComponent::CodexAppServer);
    supervisor_handle.mark_component_healthy(SupervisedComponent::RuntimeAgentEndpoint);
    {
        let mut runtime_readiness = runtime_readiness_manager
            .lock()
            .expect("runtime readiness lock should not be poisoned");
        runtime_readiness.set_ready(true);
        runtime_readiness.on_tunnel_connected();
    }
    supervisor_handle.mark_component_restarting(
        SupervisedComponent::CodexAppServer,
        "app server became unhealthy during failed activation",
    );
    supervisor_handle.mark_component_restarting(
        SupervisedComponent::TunnelSession,
        "candidate activation failed after replacing tunnel health",
    );

    let mut state = SandboxdState {
        execution_mode: StartupExecutionMode::Session,
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
        supervisor_handle: supervisor_handle.clone(),
        keepalive_manager,
        runtime_readiness_manager: runtime_readiness_manager.clone(),
        agent_endpoint_url: None,
        runtime_env: BTreeMap::new(),
        gateway_egress_token_provider: None,
        clock: Arc::new(SystemClock),
        sleeper: Arc::new(ThreadSleeper),
        tunnel_session: None,
    };

    state.restore_previous_tunnel_session_after_activation_failure(
        Some(previous_tunnel_session),
        Some(previous_tunnel_health_snapshot.clone()),
    );

    assert_eq!(
        supervisor_handle.component_snapshot(SupervisedComponent::TunnelSession),
        Some(previous_tunnel_health_snapshot),
        "rollback should restore the accepted tunnel health snapshot"
    );
    assert!(
        !runtime_readiness_manager
            .lock()
            .expect("runtime readiness lock should not be poisoned")
            .ready(),
        "rollback must derive runtime readiness from current component health"
    );

    state.close().expect("test state should close cleanly");
    gateway_thread
        .join()
        .expect("gateway thread should exit after tunnel shutdown");
}

fn reserve_test_port() -> u16 {
    let listener =
        TcpListener::bind(("127.0.0.1", 0)).expect("test listener should bind to loopback");
    let address = listener
        .local_addr()
        .expect("test listener should expose its bound address");
    drop(listener);
    address.port()
}

fn wait_for_component_state(
    supervisor_handle: &SandboxdSupervisorHandle,
    component: SupervisedComponent,
    expected_state: ComponentHealthState,
    expected_restart_count: u64,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    loop {
        let snapshot = supervisor_handle
            .component_snapshot(component)
            .expect("component should be tracked");
        if snapshot.state == expected_state && snapshot.restart_count >= expected_restart_count {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "expected {component:?} to reach state {expected_state:?} with restart_count >= {expected_restart_count}, got {snapshot:?}"
        );
        thread::sleep(Duration::from_millis(25));
    }
}

fn wait_for_codex_proxy_connected(supervisor_handle: &SandboxdSupervisorHandle, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    loop {
        let snapshot = supervisor_handle
            .component_snapshot(SupervisedComponent::CodexProxy)
            .expect("Codex proxy should be tracked");
        let raw_connected = snapshot
            .details
            .get("rawConnectivityState")
            .is_some_and(|state| state == "Connected");
        let session_manager_connected = snapshot
            .details
            .get("sessionManagerState")
            .is_some_and(|state| state == "Connected");
        if snapshot.state == ComponentHealthState::Healthy
            && raw_connected
            && session_manager_connected
        {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "expected Codex proxy to reconnect cleanly, got {snapshot:?}"
        );
        thread::sleep(Duration::from_millis(25));
    }
}

fn wait_for_runtime_ready_value(
    runtime_readiness_manager: &Arc<Mutex<RuntimeReadinessManager>>,
    expected_ready: bool,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    loop {
        let ready = runtime_readiness_manager
            .lock()
            .expect("runtime readiness manager lock should not be poisoned")
            .ready();
        if ready == expected_ready {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "expected runtime readiness to become {expected_ready}, got {ready}"
        );
        thread::sleep(Duration::from_millis(25));
    }
}

fn codex_raw_app_server_script() -> &'static str {
    r#"
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');

const [portArg, mode, delayArg, markerPath] = process.argv.slice(1);
const port = Number(portArg);
const delayMs = Number(delayArg);
const keepAlive = setInterval(() => {}, 1000);

function websocketFrame(payload) {
  const body = Buffer.from(payload, 'utf8');
  const header = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([header, body]);
}
function tryReadFrame(buffer) {
  if (buffer.length < 2) {
    return null;
  }
  const secondByte = buffer[1];
  const masked = (secondByte & 0x80) !== 0;
  let length = secondByte & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) {
      return null;
    }
    length = buffer.readUInt16BE(2);
    offset = 4;
  }
  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + length) {
    return null;
  }
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  offset += maskLength;
  const payload = buffer.subarray(offset, offset + length);
  const unmasked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    unmasked[index] = masked ? payload[index] ^ mask[index % 4] : payload[index];
  }
  return {
    text: unmasked.toString('utf8'),
    consumed: offset + length,
  };
}

const server = net.createServer((socket) => {
  let handshake = Buffer.alloc(0);
  let websocketReady = false;
  let frameBuffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    if (!websocketReady) {
      handshake = Buffer.concat([handshake, chunk]);
      const headerEnd = handshake.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        return;
      }
      const headerText = handshake.subarray(0, headerEnd).toString('utf8');
      const [requestLine, ...headerLines] = headerText.split('\r\n');
      const [, path] = requestLine.split(' ');
      const headers = new Map();
      for (const line of headerLines) {
        const separator = line.indexOf(':');
        if (separator === -1) {
          continue;
        }
        headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
      }
      const key = headers.get('sec-websocket-key');
      const accept = crypto
        .createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Connection: Upgrade\r\n' +
        'Upgrade: websocket\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        '\r\n',
      );
      if (path === '/health') {
        socket.end();
        return;
      }
      websocketReady = true;
      frameBuffer = handshake.subarray(headerEnd + 4);
      handshake = Buffer.alloc(0);
    } else {
      frameBuffer = Buffer.concat([frameBuffer, chunk]);
    }

    while (true) {
      const frame = tryReadFrame(frameBuffer);
      if (!frame) {
        break;
      }
      frameBuffer = frameBuffer.subarray(frame.consumed);
      const message = JSON.parse(frame.text);
      if (message.method === 'initialize') {
        socket.write(websocketFrame(JSON.stringify({ id: message.id, result: {} })));
        continue;
      }
      if (message.method === 'thread/loaded/list') {
        socket.write(websocketFrame(JSON.stringify({ id: message.id, result: { data: [] } })));
        continue;
      }
      if (message.method === 'thread/read') {
        socket.write(
          websocketFrame(
            JSON.stringify({
              id: message.id,
              result: {
                thread: {
                  id: message.params.threadId,
                  status: { type: 'idle' },
                },
              },
            }),
          ),
        );
      }
    }
  });
});

server.listen(port, '127.0.0.1', () => {
  if (mode === 'exit_once' && !fs.existsSync(markerPath)) {
    setTimeout(() => {
      fs.writeFileSync(markerPath, 'done');
      server.close(() => {
        clearInterval(keepAlive);
        process.exit(0);
      });
    }, delayMs);
  }
});
"#
}
