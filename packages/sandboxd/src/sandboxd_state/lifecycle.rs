//! Top-level sandbox daemon lifecycle.
//!
//! This module coordinates runtime-plan application, workspace setup, egress and
//! runtime component startup, keepalive wiring, readiness projection, and
//! shutdown for one initialized sandbox daemon.

use std::collections::BTreeMap;
use std::fmt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use crate::codex_proxy::CodexProxyControlHandle;
use crate::command::{CommandOutputSink, CommandOutputStream};
use crate::daemon_liveness::DaemonLivenessMonitor;
use crate::egress_proxy::EgressProxy;
use crate::keepalive::KeepaliveManager;
use crate::process;
use crate::process::{
    CodexAppServerControlHandle, CodexAppServerObservationHandle, OpenCodeServerControlHandle,
};
use crate::protocol::startup::{
    StartupExecutionMode, StartupInput, StartupMode, StartupOperationKind,
};
use crate::runtime;
use crate::runtime::CompiledRuntimePlanImageSource;
use crate::runtime::adapters::{
    RuntimeAdapterLifecycleObserver, RuntimeAdapterRegistry, RuntimeAdapterRegistryError,
    RuntimeAdapters,
};
use crate::runtime::readiness::RuntimeReadinessManager;
use crate::runtime::{RuntimePlanApplyError, RuntimePlanApplyLifecycleStep};
use crate::sandboxd_state::components::{
    collect_tracked_components, determine_runtime_readiness_mode,
};
use crate::sandboxd_state::diagnostics::{
    hidden_timeline_attributes, record_operation_phase_completed,
    record_operation_phase_completed_with_attributes, record_operation_phase_failure,
    record_operation_phase_started, record_operation_phase_started_with_attributes,
    record_runtime_plan_apply_failure, record_runtime_process_failure, record_setup_script_failure,
    runtime_adapter_timeline_attributes, runtime_process_timeline_attributes, timeline_attributes,
};
use crate::sandboxd_state::readiness::{
    spawn_runtime_readiness_projection_thread, sync_runtime_readiness_from_snapshot,
};
use crate::sandboxd_state::runtime_coordination::{
    RuntimeCoordinationHandles, spawn_runtime_coordination_thread,
};
use crate::sandboxd_state::runtime_environment::{
    collect_mistle_context_runtime_environment, collect_runtime_environment,
    merge_managed_runtime_environment,
};
use crate::sandboxd_state::setup_script::run_setup_script_with_output_sink;
use crate::sandboxd_state::snapshot::scrub_snapshot_runtime_artifacts;
use crate::startup_diagnostics::{
    StartupDiagnosticsLogger, StartupTranscriptStream, startup_diagnostics_string,
};
use crate::supervision::{SandboxdHealthSnapshot, SandboxdSupervisorHandle};
use crate::time::{Clock, Sleeper};
use crate::tunnel::session::{
    GatewayEgressTokenProvider, TunnelSession, TunnelSessionError, TunnelSigningRequest,
    TunnelSigningResponse, derive_sandbox_instance_id,
};

pub(crate) const MISTLE_SANDBOX_INSTANCE_ID_ENV_NAME: &str = "MISTLE_SANDBOX_INSTANCE_ID";
pub(crate) const MISTLE_SANDBOX_PROFILE_ID_ENV_NAME: &str = "MISTLE_SANDBOX_PROFILE_ID";
pub(crate) const MISTLE_SANDBOX_PROFILE_VERSION_ENV_NAME: &str = "MISTLE_SANDBOX_PROFILE_VERSION";

/// Describes why the initialized daemon runtime failed to start or stop.
#[derive(Debug)]
pub enum SandboxdStateError {
    ApplyRuntimePlan(String),
    ApplyGitIdentity(String),
    StartEgressProxy(String),
    RunSetupScript(String),
    StartRuntimeProcesses(String),
    StartRuntimeAdapters(String),
    StartTunnelSession(String),
    StopEgressProxy(String),
    StopRuntimeProcesses(String),
    StopRuntimeAdapters(String),
    SigningUnavailable(String),
}

impl fmt::Display for SandboxdStateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ApplyRuntimePlan(error) => write!(f, "failed to apply startup input: {error}"),
            Self::ApplyGitIdentity(error) => {
                write!(
                    f,
                    "failed to apply git identity from startup input: {error}"
                )
            }
            Self::StartEgressProxy(error) => {
                write!(f, "failed to start local egress proxy: {error}")
            }
            Self::RunSetupScript(error) => {
                write!(f, "failed to run setup script: {error}")
            }
            Self::StartRuntimeProcesses(error) => {
                write!(f, "failed to start runtime client processes: {error}")
            }
            Self::StartRuntimeAdapters(error) => {
                write!(f, "failed to start runtime adapters: {error}")
            }
            Self::StartTunnelSession(error) => {
                write!(f, "failed to start bootstrap tunnel session: {error}")
            }
            Self::StopRuntimeProcesses(error) => {
                write!(f, "failed to stop runtime client processes: {error}")
            }
            Self::StopRuntimeAdapters(error) => {
                write!(f, "failed to stop runtime adapters: {error}")
            }
            Self::StopEgressProxy(error) => {
                write!(f, "failed to stop local egress proxy: {error}")
            }
            Self::SigningUnavailable(error) => {
                write!(f, "failed to use bootstrap tunnel signing: {error}")
            }
        }
    }
}

impl std::error::Error for SandboxdStateError {}

pub(crate) const GLOBAL_GIT_CONFIG_ENV_NAME: &str = "GIT_CONFIG_GLOBAL";
pub(crate) const DEFAULT_GLOBAL_GIT_CONFIG_PATH: &str = "/root/.gitconfig";
pub(crate) const SETUP_SCRIPT_WORKING_DIRECTORY: &str = "/root";
pub(crate) const SETUP_SCRIPT_FILE_MODE: u32 = 0o700;

/// Owns the initialized sandbox runtime resources for one daemon process.
pub struct SandboxdState {
    execution_mode: StartupExecutionMode,
    egress_proxy: Option<EgressProxy>,
    process_manager: Option<process::RuntimeClientProcessManager>,
    runtime_adapters: RuntimeAdapters,
    codex_app_server_observation_handle: Option<CodexAppServerObservationHandle>,
    codex_app_server_control_handle: Option<CodexAppServerControlHandle>,
    opencode_server_control_handle: Option<OpenCodeServerControlHandle>,
    codex_proxy_control_handle: Option<CodexProxyControlHandle>,
    runtime_coordination_shutdown_requested: Arc<AtomicBool>,
    runtime_coordination_thread: Option<JoinHandle<()>>,
    runtime_readiness_shutdown_requested: Arc<AtomicBool>,
    runtime_readiness_thread: Option<JoinHandle<()>>,
    daemon_liveness_monitor: Option<DaemonLivenessMonitor>,
    supervisor_handle: SandboxdSupervisorHandle,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    agent_endpoint_url: Option<String>,
    runtime_env: BTreeMap<String, String>,
    gateway_egress_token_provider: Option<GatewayEgressTokenProvider>,
    clock: Arc<dyn Clock>,
    sleeper: Arc<dyn Sleeper>,
    tunnel_session: Option<TunnelSession>,
}

impl SandboxdState {
    /// Initializes the sandbox runtime from one accepted startup input.
    pub fn initialize(
        startup_input: &StartupInput,
        global_git_config_path: &Path,
        clock: Arc<dyn Clock>,
        sleeper: Arc<dyn Sleeper>,
        diagnostics_logger: Option<StartupDiagnosticsLogger>,
    ) -> Result<Self, SandboxdStateError> {
        let runtime_plan: runtime::CompiledRuntimePlan =
            serde_json::from_value(startup_input.runtime_plan.clone()).map_err(|error| {
                let error_text = error.to_string();
                record_runtime_plan_apply_failure(
                    &diagnostics_logger,
                    &RuntimePlanApplyError::InvalidRuntimePlan(error),
                );
                SandboxdStateError::ApplyRuntimePlan(error_text)
            })?;
        let uses_pre_materialized_snapshot = startup_input.startup_mode == StartupMode::New
            && startup_input.execution_mode == StartupExecutionMode::Session
            && runtime_plan.image.source == CompiledRuntimePlanImageSource::Snapshot;
        let should_apply_runtime_plan =
            should_apply_runtime_plan_for_startup(uses_pre_materialized_snapshot, startup_input);
        let should_run_setup_script = should_run_setup_script_for_startup(
            should_apply_runtime_plan,
            uses_pre_materialized_snapshot,
            startup_input,
        );
        let sandbox_instance_id = derive_sandbox_instance_id(&startup_input.tunnel_gateway_ws_url)
            .map_err(|error| SandboxdStateError::StartTunnelSession(error.to_string()))?;
        let mistle_context_env =
            collect_mistle_context_runtime_environment(startup_input, &sandbox_instance_id)
                .map_err(SandboxdStateError::StartRuntimeProcesses)?;
        let supervisor_handle = SandboxdSupervisorHandle::new(
            sandbox_instance_id.clone(),
            clock.clone(),
            collect_tracked_components(&runtime_plan),
        );
        let gateway_egress_token_provider = Some(GatewayEgressTokenProvider::new(
            sandbox_instance_id,
            startup_input.acting_user_id.clone(),
        ));
        let execution_mode = startup_input.execution_mode;
        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let mut startup_tunnel_session = Some(start_minimal_tunnel_session(
            StartMinimalTunnelSessionInput {
                startup_input,
                keepalive_manager: keepalive_manager.clone(),
                runtime_readiness_manager: runtime_readiness_manager.clone(),
                clock: clock.clone(),
                sleeper: sleeper.clone(),
                supervisor_handle: supervisor_handle.clone(),
                diagnostics_logger: &diagnostics_logger,
            },
        )?);
        if let (Some(logger), Some(tunnel_session)) = (&diagnostics_logger, &startup_tunnel_session)
        {
            logger.attach_operation_sender(tunnel_session.operation_record_sender());
            record_operation_phase_completed_with_attributes(
                &diagnostics_logger,
                "start_tunnel_session",
                timeline_attributes("tunnel", "Connecting tunnel"),
            );
        }
        record_operation_phase_started_with_attributes(
            &diagnostics_logger,
            "apply_git_identity",
            timeline_attributes("git-identity", "Configuring Git"),
        );
        if !startup_input.is_snapshot()
            && let Err(error) =
                runtime::git_identity::apply_git_identity(startup_input, global_git_config_path)
        {
            let mut attributes = timeline_attributes("git-identity", "Configuring Git");
            attributes.insert(
                "error".to_string(),
                startup_diagnostics_string(error.clone()),
            );
            record_operation_phase_failure(&diagnostics_logger, "apply_git_identity", attributes);
            if let Some(tunnel_session) = startup_tunnel_session.take() {
                close_tunnel_session(
                    tunnel_session,
                    &diagnostics_logger,
                    "stop_tunnel_session_after_git_identity_failure",
                );
            }
            return Err(SandboxdStateError::ApplyGitIdentity(error));
        }
        record_operation_phase_completed_with_attributes(
            &diagnostics_logger,
            "apply_git_identity",
            timeline_attributes("git-identity", "Configuring Git"),
        );

        if let Some(tunnel_session) = &startup_tunnel_session
            && let Some(provider) = &gateway_egress_token_provider
        {
            tunnel_session.attach_gateway_egress_token_provider(provider);
        }

        let mut egress_proxy: Option<EgressProxy>;

        record_operation_phase_started_with_attributes(
            &diagnostics_logger,
            "start_egress_proxy",
            timeline_attributes("egress-proxy", "Starting egress proxy"),
        );
        egress_proxy = match EgressProxy::start(
            &runtime_plan,
            startup_input,
            gateway_egress_token_provider.clone(),
            clock.clone(),
            supervisor_handle.clone(),
        ) {
            Ok(egress_proxy) => egress_proxy,
            Err(error) => {
                let mut attributes = timeline_attributes("egress-proxy", "Starting egress proxy");
                attributes.insert(
                    "error".to_string(),
                    startup_diagnostics_string(error.to_string()),
                );
                record_operation_phase_failure(
                    &diagnostics_logger,
                    "start_egress_proxy",
                    attributes,
                );
                close_tunnel_session_after_failure(
                    &mut startup_tunnel_session,
                    &diagnostics_logger,
                    "stop_tunnel_session_after_egress_proxy_failure",
                );
                return Err(SandboxdStateError::StartEgressProxy(error.to_string()));
            }
        };
        record_operation_phase_completed_with_attributes(
            &diagnostics_logger,
            "start_egress_proxy",
            timeline_attributes("egress-proxy", "Starting egress proxy"),
        );

        let base_runtime_env = match collect_runtime_environment(&runtime_plan) {
            Ok(runtime_env) => runtime_env,
            Err(error) => {
                close_tunnel_session_after_failure(
                    &mut startup_tunnel_session,
                    &diagnostics_logger,
                    "stop_tunnel_session_after_runtime_env_failure",
                );
                close_egress_proxy_after_failure(
                    &mut egress_proxy,
                    &diagnostics_logger,
                    "stop_egress_proxy_after_runtime_env_failure",
                );
                return Err(SandboxdStateError::StartRuntimeProcesses(error));
            }
        };
        let runtime_env: BTreeMap<String, String> = match merge_managed_runtime_environment(
            base_runtime_env,
            &mistle_context_env,
            egress_proxy.as_ref(),
        ) {
            Ok(runtime_env) => runtime_env,
            Err(error) => {
                close_tunnel_session_after_failure(
                    &mut startup_tunnel_session,
                    &diagnostics_logger,
                    "stop_tunnel_session_after_runtime_env_failure",
                );
                close_egress_proxy_after_failure(
                    &mut egress_proxy,
                    &diagnostics_logger,
                    "stop_egress_proxy_after_runtime_env_failure",
                );
                return Err(SandboxdStateError::StartRuntimeProcesses(error));
            }
        };

        let Some(tunnel_session) = startup_tunnel_session.as_ref() else {
            close_egress_proxy_after_failure(
                &mut egress_proxy,
                &diagnostics_logger,
                "stop_egress_proxy_after_missing_tunnel_session",
            );
            return Err(SandboxdStateError::StartTunnelSession(
                "minimal bootstrap tunnel session is not initialized".to_string(),
            ));
        };
        if let Err(error) = attach_runtime_environment_to_tunnel(
            tunnel_session,
            runtime_env.clone(),
            &diagnostics_logger,
        ) {
            close_tunnel_session_after_failure(
                &mut startup_tunnel_session,
                &diagnostics_logger,
                "stop_tunnel_session_after_runtime_environment_failure",
            );
            close_egress_proxy_after_failure(
                &mut egress_proxy,
                &diagnostics_logger,
                "stop_egress_proxy_after_runtime_environment_failure",
            );
            return Err(error);
        }

        if should_apply_runtime_plan {
            let runtime_plan_observer = RuntimePlanTimelineObserver {
                diagnostics_logger: diagnostics_logger.clone(),
            };
            match runtime::apply_compiled_runtime_plan_with_output_sink_and_observer(
                &runtime_plan,
                Some(&runtime_env),
                command_output_sink(&diagnostics_logger, "apply_runtime_plan"),
                Some(&runtime_plan_observer),
            ) {
                Ok(()) => {}
                Err(error) => {
                    record_runtime_plan_apply_failure(&diagnostics_logger, &error);
                    close_tunnel_session_after_failure(
                        &mut startup_tunnel_session,
                        &diagnostics_logger,
                        "stop_tunnel_session_after_runtime_plan_failure",
                    );
                    close_egress_proxy_after_failure(
                        &mut egress_proxy,
                        &diagnostics_logger,
                        "stop_egress_proxy_after_runtime_plan_failure",
                    );
                    return Err(SandboxdStateError::ApplyRuntimePlan(error.to_string()));
                }
            }
        }
        if should_run_setup_script {
            record_operation_phase_started_with_attributes(
                &diagnostics_logger,
                "run_setup_script",
                timeline_attributes("setup-script", "Running setup script"),
            );
            match run_setup_script_with_output_sink(
                &runtime_plan,
                &runtime_env,
                clock.as_ref(),
                sleeper.as_ref(),
                command_output_sink(&diagnostics_logger, "run_setup_script"),
            ) {
                Ok(()) => {
                    record_operation_phase_completed_with_attributes(
                        &diagnostics_logger,
                        "run_setup_script",
                        timeline_attributes("setup-script", "Running setup script"),
                    );
                }
                Err(error) => {
                    record_setup_script_failure(&diagnostics_logger, &error);
                    if let Some(tunnel_session) = startup_tunnel_session.take() {
                        close_tunnel_session(
                            tunnel_session,
                            &diagnostics_logger,
                            "stop_tunnel_session_after_setup_failure",
                        );
                    }
                    if let Some(egress_proxy) = egress_proxy.take() {
                        record_operation_phase_started(
                            &diagnostics_logger,
                            "stop_egress_proxy_after_setup_failure",
                        );
                        match egress_proxy.close() {
                            Ok(()) => record_operation_phase_completed(
                                &diagnostics_logger,
                                "stop_egress_proxy_after_setup_failure",
                            ),
                            Err(close_error) => {
                                record_operation_phase_failure(
                                    &diagnostics_logger,
                                    "stop_egress_proxy_after_setup_failure",
                                    BTreeMap::from([(
                                        "error".to_string(),
                                        startup_diagnostics_string(close_error.to_string()),
                                    )]),
                                );
                            }
                        }
                    }
                    return Err(SandboxdStateError::RunSetupScript(error.message));
                }
            }
        }
        if startup_input.is_snapshot() {
            // Snapshot materialization captures image-layer state only, so snapshot workflows stop
            // here before starting session runtime resources.
            record_operation_phase_started(&diagnostics_logger, "stop_egress_proxy");
            if let Some(egress_proxy) = egress_proxy.take() {
                egress_proxy.close().map_err(|error| {
                    record_operation_phase_failure(
                        &diagnostics_logger,
                        "stop_egress_proxy",
                        BTreeMap::from([(
                            "error".to_string(),
                            startup_diagnostics_string(error.to_string()),
                        )]),
                    );
                    SandboxdStateError::StopEgressProxy(error.to_string())
                })?;
            }
            record_operation_phase_completed(&diagnostics_logger, "stop_egress_proxy");
            close_operation_stream(&diagnostics_logger);
            if let Some(tunnel_session) = startup_tunnel_session.take() {
                close_tunnel_session(
                    tunnel_session,
                    &diagnostics_logger,
                    "stop_snapshot_tunnel_session",
                );
            }

            return Ok(Self {
                execution_mode,
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
                daemon_liveness_monitor: None,
                supervisor_handle,
                keepalive_manager: Arc::new(Mutex::new(KeepaliveManager::default())),
                runtime_readiness_manager: Arc::new(Mutex::new(RuntimeReadinessManager::default())),
                agent_endpoint_url: None,
                runtime_env,
                gateway_egress_token_provider: None,
                clock,
                sleeper,
                tunnel_session: None,
            });
        }
        let process_specs =
            process::flatten_runtime_client_processes(&runtime_plan.runtime_clients, &runtime_env);
        let runtime_process_observer = RuntimeProcessTimelineObserver {
            diagnostics_logger: diagnostics_logger.clone(),
        };
        let process_manager = if process_specs.is_empty() {
            None
        } else {
            Some(
                process::start_runtime_client_process_manager_with_supervisor_and_observer(
                    &process_specs,
                    clock.as_ref(),
                    sleeper.as_ref(),
                    supervisor_handle.clone(),
                    Some(&runtime_process_observer),
                )
                .map_err(|error| {
                    record_runtime_process_failure(&diagnostics_logger, &error);
                    if let Some(tunnel_session) = startup_tunnel_session.take() {
                        close_tunnel_session(
                            tunnel_session,
                            &diagnostics_logger,
                            "stop_tunnel_session_after_runtime_process_failure",
                        );
                    }
                    close_egress_proxy_after_failure(
                        &mut egress_proxy,
                        &diagnostics_logger,
                        "stop_egress_proxy_after_runtime_process_failure",
                    );
                    SandboxdStateError::StartRuntimeProcesses(error.to_string())
                })?,
            )
        };
        let codex_app_server_observation_handle = process_manager
            .as_ref()
            .and_then(process::RuntimeClientProcessManager::codex_app_server_observation_handle)
            .cloned();
        let codex_app_server_control_handle = process_manager
            .as_ref()
            .and_then(process::RuntimeClientProcessManager::codex_app_server_control_handle)
            .cloned();
        let opencode_server_control_handle = process_manager
            .as_ref()
            .and_then(process::RuntimeClientProcessManager::opencode_server_control_handle)
            .cloned();

        let runtime_adapter_observer = RuntimeAdapterTimelineObserver {
            diagnostics_logger: diagnostics_logger.clone(),
        };
        let runtime_adapters = RuntimeAdapterRegistry
            .start_with_supervisor_and_observer(
                startup_input,
                keepalive_manager.clone(),
                runtime_readiness_manager.clone(),
                supervisor_handle.clone(),
                Some(&runtime_adapter_observer),
            )
            .map_err(|error| {
                let mut attributes = runtime_adapter_failure_timeline_attributes(&error);
                attributes.insert(
                    "error".to_string(),
                    startup_diagnostics_string(error.to_string()),
                );
                record_operation_phase_failure(
                    &diagnostics_logger,
                    "start_runtime_adapters",
                    attributes,
                );
                if let Some(tunnel_session) = startup_tunnel_session.take() {
                    close_tunnel_session(
                        tunnel_session,
                        &diagnostics_logger,
                        "stop_tunnel_session_after_runtime_adapter_failure",
                    );
                }
                close_egress_proxy_after_failure(
                    &mut egress_proxy,
                    &diagnostics_logger,
                    "stop_egress_proxy_after_runtime_adapter_failure",
                );
                SandboxdStateError::StartRuntimeAdapters(error.to_string())
            })?;
        let codex_proxy_control_handle = runtime_adapters.codex_proxy_control_handle().cloned();
        let agent_endpoint_url = match runtime_adapters.adapters() {
            [] => None,
            [adapter] => Some(adapter.listen_url().to_string()),
            _ => {
                record_operation_phase_failure(
                    &diagnostics_logger,
                    "attach_runtime_agent_endpoint",
                    BTreeMap::from([(
                        "error".to_string(),
                        startup_diagnostics_string(
                            "sandboxd currently supports exactly one runtime adapter endpoint",
                        ),
                    )]),
                );
                if let Some(tunnel_session) = startup_tunnel_session.take() {
                    close_tunnel_session(
                        tunnel_session,
                        &diagnostics_logger,
                        "stop_tunnel_session_after_runtime_adapter_endpoint_failure",
                    );
                }
                close_egress_proxy_after_failure(
                    &mut egress_proxy,
                    &diagnostics_logger,
                    "stop_egress_proxy_after_runtime_adapter_endpoint_failure",
                );
                return Err(SandboxdStateError::StartTunnelSession(
                    "sandboxd currently supports exactly one runtime adapter endpoint".to_string(),
                ));
            }
        };
        let Some(tunnel_session) = startup_tunnel_session.take() else {
            close_egress_proxy_after_failure(
                &mut egress_proxy,
                &diagnostics_logger,
                "stop_egress_proxy_after_missing_tunnel_session",
            );
            return Err(SandboxdStateError::StartTunnelSession(
                "minimal bootstrap tunnel session is not initialized".to_string(),
            ));
        };
        record_operation_phase_started_with_attributes(
            &diagnostics_logger,
            "attach_runtime_agent_endpoint",
            hidden_timeline_attributes(),
        );
        match tunnel_session.set_agent_endpoint_url(agent_endpoint_url.clone()) {
            Ok(()) => {}
            Err(error) => {
                let mut attributes = hidden_timeline_attributes();
                attributes.insert(
                    "error".to_string(),
                    startup_diagnostics_string(error.to_string()),
                );
                record_operation_phase_failure(
                    &diagnostics_logger,
                    "attach_runtime_agent_endpoint",
                    attributes,
                );
                close_tunnel_session(
                    tunnel_session,
                    &diagnostics_logger,
                    "stop_tunnel_session_after_agent_endpoint_attach_failure",
                );
                close_egress_proxy_after_failure(
                    &mut egress_proxy,
                    &diagnostics_logger,
                    "stop_egress_proxy_after_agent_endpoint_attach_failure",
                );
                return Err(SandboxdStateError::StartTunnelSession(error.to_string()));
            }
        }
        record_operation_phase_completed_with_attributes(
            &diagnostics_logger,
            "attach_runtime_agent_endpoint",
            hidden_timeline_attributes(),
        );
        let runtime_readiness_mode = determine_runtime_readiness_mode(&supervisor_handle);
        sync_runtime_readiness_from_snapshot(
            &supervisor_handle,
            &runtime_readiness_manager,
            runtime_readiness_mode,
        );
        let runtime_readiness_shutdown_requested = Arc::new(AtomicBool::new(false));
        let runtime_readiness_thread = Some(spawn_runtime_readiness_projection_thread(
            supervisor_handle.clone(),
            runtime_readiness_manager.clone(),
            runtime_readiness_mode,
            runtime_readiness_shutdown_requested.clone(),
        ));
        record_operation_phase_started(&diagnostics_logger, "ready");
        close_operation_stream(&diagnostics_logger);
        let tunnel_session = Some(tunnel_session);
        let runtime_coordination_shutdown_requested = Arc::new(AtomicBool::new(false));
        let runtime_coordination_handles = RuntimeCoordinationHandles {
            codex_app_server_control_handle: codex_app_server_control_handle.clone(),
            codex_proxy_control_handle: codex_proxy_control_handle.clone(),
            opencode_server_control_handle: opencode_server_control_handle.clone(),
        };
        let runtime_coordination_thread = runtime_coordination_handles
            .has_runtime_process_control()
            .then(|| {
                spawn_runtime_coordination_thread(
                    runtime_coordination_handles,
                    supervisor_handle.clone(),
                    runtime_coordination_shutdown_requested.clone(),
                )
            });
        let daemon_liveness_monitor = Some(DaemonLivenessMonitor::start(
            supervisor_handle.clone(),
            clock.clone(),
        ));

        Ok(Self {
            execution_mode,
            egress_proxy,
            process_manager,
            runtime_adapters,
            codex_app_server_observation_handle,
            codex_app_server_control_handle,
            opencode_server_control_handle,
            codex_proxy_control_handle,
            runtime_coordination_shutdown_requested,
            runtime_coordination_thread,
            runtime_readiness_shutdown_requested,
            runtime_readiness_thread,
            daemon_liveness_monitor,
            supervisor_handle,
            keepalive_manager,
            runtime_readiness_manager,
            agent_endpoint_url,
            runtime_env,
            gateway_egress_token_provider,
            clock,
            sleeper,
            tunnel_session,
        })
    }

    /// Reconnects the bootstrap tunnel for an already-initialized daemon.
    pub fn resume(
        &mut self,
        startup_input: &StartupInput,
        global_git_config_path: &Path,
        diagnostics_logger: Option<StartupDiagnosticsLogger>,
    ) -> Result<(), SandboxdStateError> {
        if self.execution_mode == StartupExecutionMode::Snapshot || startup_input.is_snapshot() {
            return Err(SandboxdStateError::StartTunnelSession(
                "snapshot materialization sandboxes do not support resume".to_string(),
            ));
        }
        if let Some(tunnel_session) = self.tunnel_session.take() {
            tunnel_session.close();
        }
        self.runtime_readiness_manager
            .lock()
            .map_err(|error| {
                SandboxdStateError::StartTunnelSession(format!(
                    "failed to mark runtime not ready before resume: {error}"
                ))
            })?
            .set_ready(false);

        let agent_endpoint_url =
            if let Some(codex_proxy_control_handle) = &self.codex_proxy_control_handle {
                Some(codex_proxy_control_handle.listen_url().to_string())
            } else {
                self.agent_endpoint_url.clone()
            };

        let tunnel_session = start_minimal_tunnel_session(StartMinimalTunnelSessionInput {
            startup_input,
            keepalive_manager: self.keepalive_manager.clone(),
            runtime_readiness_manager: self.runtime_readiness_manager.clone(),
            clock: self.clock.clone(),
            sleeper: self.sleeper.clone(),
            supervisor_handle: self.supervisor_handle.clone(),
            diagnostics_logger: &diagnostics_logger,
        })?;
        if let Some(logger) = &diagnostics_logger {
            logger.attach_operation_sender(tunnel_session.operation_record_sender());
            record_operation_phase_completed_with_attributes(
                &diagnostics_logger,
                "start_tunnel_session",
                timeline_attributes("tunnel", "Connecting tunnel"),
            );
        }
        record_operation_phase_started_with_attributes(
            &diagnostics_logger,
            "apply_git_identity",
            timeline_attributes("git-identity", "Configuring Git"),
        );
        if let Err(error) =
            runtime::git_identity::apply_git_identity(startup_input, global_git_config_path)
        {
            let mut attributes = timeline_attributes("git-identity", "Configuring Git");
            attributes.insert(
                "error".to_string(),
                startup_diagnostics_string(error.clone()),
            );
            record_operation_phase_failure(&diagnostics_logger, "apply_git_identity", attributes);
            close_tunnel_session(
                tunnel_session,
                &diagnostics_logger,
                "stop_tunnel_session_after_git_identity_failure",
            );
            return Err(SandboxdStateError::ApplyGitIdentity(error));
        }
        record_operation_phase_completed_with_attributes(
            &diagnostics_logger,
            "apply_git_identity",
            timeline_attributes("git-identity", "Configuring Git"),
        );
        if let Some(provider) = &self.gateway_egress_token_provider {
            provider
                .set_acting_user_id(startup_input.acting_user_id.clone())
                .map_err(|error| SandboxdStateError::StartTunnelSession(error.to_string()))?;
            tunnel_session.attach_gateway_egress_token_provider(provider);
        }
        if let Err(error) = attach_runtime_environment_to_tunnel(
            &tunnel_session,
            self.runtime_env.clone(),
            &diagnostics_logger,
        ) {
            close_tunnel_session(
                tunnel_session,
                &diagnostics_logger,
                "stop_tunnel_session_after_runtime_environment_failure",
            );
            return Err(error);
        }
        record_operation_phase_started_with_attributes(
            &diagnostics_logger,
            "attach_runtime_agent_endpoint",
            hidden_timeline_attributes(),
        );
        if let Err(error) = tunnel_session.set_agent_endpoint_url(agent_endpoint_url) {
            let mut attributes = hidden_timeline_attributes();
            attributes.insert(
                "error".to_string(),
                startup_diagnostics_string(error.to_string()),
            );
            record_operation_phase_failure(
                &diagnostics_logger,
                "attach_runtime_agent_endpoint",
                attributes,
            );
            close_tunnel_session(
                tunnel_session,
                &diagnostics_logger,
                "stop_tunnel_session_after_agent_endpoint_attach_failure",
            );
            return Err(SandboxdStateError::StartTunnelSession(error.to_string()));
        }
        record_operation_phase_completed_with_attributes(
            &diagnostics_logger,
            "attach_runtime_agent_endpoint",
            hidden_timeline_attributes(),
        );
        record_operation_phase_started(&diagnostics_logger, "ready");
        close_operation_stream(&diagnostics_logger);
        self.tunnel_session = Some(tunnel_session);
        let runtime_readiness_mode = determine_runtime_readiness_mode(&self.supervisor_handle);
        sync_runtime_readiness_from_snapshot(
            &self.supervisor_handle,
            &self.runtime_readiness_manager,
            runtime_readiness_mode,
        );

        Ok(())
    }

    pub fn request_signing(
        &self,
        request: TunnelSigningRequest,
    ) -> Result<TunnelSigningResponse, SandboxdStateError> {
        let tunnel_session = self.tunnel_session.as_ref().ok_or_else(|| {
            SandboxdStateError::SigningUnavailable(
                "bootstrap tunnel session is not initialized".to_string(),
            )
        })?;

        tunnel_session
            .request_signing(request)
            .map_err(|error: TunnelSessionError| {
                SandboxdStateError::SigningUnavailable(error.to_string())
            })
    }

    /// Stops the initialized runtime resources owned by the daemon.
    pub fn close(mut self) -> Result<(), SandboxdStateError> {
        if let Some(tunnel_session) = self.tunnel_session.take() {
            tunnel_session.close();
        }
        if let Some(daemon_liveness_monitor) = self.daemon_liveness_monitor.take()
            && let Err(error) = daemon_liveness_monitor.close()
        {
            eprintln!("sandboxd failed to close daemon liveness monitor: {error}");
        }
        self.runtime_coordination_shutdown_requested
            .store(true, Ordering::Relaxed);
        if let Some(runtime_coordination_thread) = self.runtime_coordination_thread.take() {
            let _ = runtime_coordination_thread.join();
        }
        self.runtime_readiness_shutdown_requested
            .store(true, Ordering::Relaxed);
        if let Some(runtime_readiness_thread) = self.runtime_readiness_thread.take() {
            let _ = runtime_readiness_thread.join();
        }
        self.runtime_adapters
            .close()
            .map_err(|error| SandboxdStateError::StopRuntimeAdapters(error.to_string()))?;
        self.process_manager
            .take()
            .map(|process_manager| {
                process_manager.stop(&crate::time::SystemClock, &crate::time::ThreadSleeper)
            })
            .transpose()
            .map_err(|error| SandboxdStateError::StopRuntimeProcesses(error.to_string()))?;
        self.egress_proxy
            .take()
            .map(EgressProxy::close)
            .transpose()
            .map_err(|error| SandboxdStateError::StopEgressProxy(error.to_string()))?;
        if self.execution_mode == StartupExecutionMode::Snapshot {
            scrub_snapshot_runtime_artifacts().map_err(SandboxdStateError::StopEgressProxy)?;
        }

        Ok(())
    }

    /// Returns the current in-memory health snapshot for this initialized daemon.
    pub fn health_snapshot(&self) -> SandboxdHealthSnapshot {
        self.supervisor_handle.snapshot()
    }

    /// Returns a cloneable handle to the shared supervision state.
    pub fn supervisor_handle(&self) -> SandboxdSupervisorHandle {
        self.supervisor_handle.clone()
    }

    pub fn codex_app_server_observation_handle(&self) -> Option<&CodexAppServerObservationHandle> {
        self.codex_app_server_observation_handle.as_ref()
    }

    pub fn codex_app_server_control_handle(&self) -> Option<&CodexAppServerControlHandle> {
        self.codex_app_server_control_handle.as_ref()
    }

    pub fn opencode_server_control_handle(&self) -> Option<&OpenCodeServerControlHandle> {
        self.opencode_server_control_handle.as_ref()
    }

    #[cfg(any(test, debug_assertions))]
    pub fn force_egress_proxy_shutdown_for_test(&self) -> Result<(), String> {
        let egress_proxy = self
            .egress_proxy
            .as_ref()
            .ok_or_else(|| "egress proxy is not running for this sandbox".to_string())?;
        egress_proxy
            .force_current_server_shutdown_for_test()
            .map_err(|error| error.to_string())
    }
}

#[derive(Clone)]
struct RuntimePlanTimelineObserver {
    diagnostics_logger: Option<StartupDiagnosticsLogger>,
}

impl runtime::RuntimePlanApplyObserver for RuntimePlanTimelineObserver {
    fn record_step_started(&self, step: RuntimePlanApplyLifecycleStep) {
        let (key, label) = runtime_plan_timeline_step(step);
        record_operation_phase_started_with_attributes(
            &self.diagnostics_logger,
            "apply_runtime_plan",
            timeline_attributes(key, label),
        );
    }

    fn record_step_completed(&self, step: RuntimePlanApplyLifecycleStep) {
        let (key, label) = runtime_plan_timeline_step(step);
        record_operation_phase_completed_with_attributes(
            &self.diagnostics_logger,
            "apply_runtime_plan",
            timeline_attributes(key, label),
        );
    }
}

#[derive(Clone)]
struct RuntimeProcessTimelineObserver {
    diagnostics_logger: Option<StartupDiagnosticsLogger>,
}

impl process::RuntimeClientProcessObserver for RuntimeProcessTimelineObserver {
    fn record_process_started(&self, process_spec: &process::RuntimeClientProcessSpec) {
        record_operation_phase_started_with_attributes(
            &self.diagnostics_logger,
            "start_runtime_processes",
            runtime_process_timeline_attributes(&process_spec.process_key),
        );
    }

    fn record_process_completed(&self, process_spec: &process::RuntimeClientProcessSpec) {
        record_operation_phase_completed_with_attributes(
            &self.diagnostics_logger,
            "start_runtime_processes",
            runtime_process_timeline_attributes(&process_spec.process_key),
        );
    }
}

#[derive(Clone)]
struct RuntimeAdapterTimelineObserver {
    diagnostics_logger: Option<StartupDiagnosticsLogger>,
}

impl RuntimeAdapterLifecycleObserver for RuntimeAdapterTimelineObserver {
    fn record_adapter_started(&self, runtime_id: &str) {
        record_operation_phase_started_with_attributes(
            &self.diagnostics_logger,
            "start_runtime_adapters",
            runtime_adapter_timeline_attributes(runtime_id),
        );
    }

    fn record_adapter_completed(&self, runtime_id: &str) {
        record_operation_phase_completed_with_attributes(
            &self.diagnostics_logger,
            "start_runtime_adapters",
            runtime_adapter_timeline_attributes(runtime_id),
        );
    }
}

fn runtime_plan_timeline_step(step: RuntimePlanApplyLifecycleStep) -> (&'static str, &'static str) {
    match step {
        RuntimePlanApplyLifecycleStep::RuntimeArtifacts => {
            ("runtime-artifacts", "Installing runtime artifacts")
        }
        RuntimePlanApplyLifecycleStep::WorkspaceSources => ("workspace", "Preparing workspace"),
        RuntimePlanApplyLifecycleStep::RuntimeFiles => ("runtime-files", "Writing runtime files"),
    }
}

fn runtime_adapter_failure_timeline_attributes(
    error: &RuntimeAdapterRegistryError,
) -> BTreeMap<String, serde_json::Value> {
    match error {
        RuntimeAdapterRegistryError::UnsupportedRuntimeId { runtime_id }
        | RuntimeAdapterRegistryError::DuplicateRuntimeId { runtime_id }
        | RuntimeAdapterRegistryError::MissingRuntimeClient { runtime_id, .. }
        | RuntimeAdapterRegistryError::MissingRuntimeEndpoint { runtime_id, .. }
        | RuntimeAdapterRegistryError::MissingRuntimeProcess { runtime_id, .. }
        | RuntimeAdapterRegistryError::UnsupportedConnectionMode { runtime_id, .. }
        | RuntimeAdapterRegistryError::RawAppServerReadinessMustUseWebSocket {
            runtime_id, ..
        }
        | RuntimeAdapterRegistryError::RawOpenCodeServerReadinessMustUseHttp {
            runtime_id, ..
        } => runtime_adapter_timeline_attributes(runtime_id),
        RuntimeAdapterRegistryError::StartCodexProxy(_) => {
            runtime_adapter_timeline_attributes("codex")
        }
        RuntimeAdapterRegistryError::StartOpenCodeProxy(_) => {
            runtime_adapter_timeline_attributes("opencode")
        }
        RuntimeAdapterRegistryError::StartPiProxy(_) => runtime_adapter_timeline_attributes("pi"),
        RuntimeAdapterRegistryError::InvalidRuntimePlan(_) => {
            timeline_attributes("runtime-adapters", "Starting runtime adapter")
        }
    }
}

#[derive(Clone)]
struct StartupCommandOutputSink {
    logger: StartupDiagnosticsLogger,
    phase: &'static str,
}

impl CommandOutputSink for StartupCommandOutputSink {
    fn record_output(&self, stream: CommandOutputStream, bytes: &[u8]) {
        let transcript_stream = match stream {
            CommandOutputStream::Stdout => StartupTranscriptStream::Stdout,
            CommandOutputStream::Stderr => StartupTranscriptStream::Stderr,
        };
        if let Err(error) =
            self.logger
                .record_transcript(Some(self.phase), transcript_stream, bytes)
        {
            eprintln!("sandboxd failed to record startup diagnostics transcript: {error}");
        }
    }
}

fn command_output_sink(
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
    phase: &'static str,
) -> Option<Arc<dyn CommandOutputSink>> {
    diagnostics_logger.clone().map(|logger| {
        Arc::new(StartupCommandOutputSink { logger, phase }) as Arc<dyn CommandOutputSink>
    })
}

fn is_snapshot_preparation_operation(operation_kind: StartupOperationKind) -> bool {
    matches!(
        operation_kind,
        StartupOperationKind::SetupCheck | StartupOperationKind::Snapshot
    )
}

fn should_run_setup_script_for_startup(
    should_apply_runtime_plan: bool,
    uses_pre_materialized_snapshot: bool,
    startup_input: &StartupInput,
) -> bool {
    should_apply_runtime_plan
        && (!uses_pre_materialized_snapshot
            || is_snapshot_preparation_operation(startup_input.operation_kind))
}

fn should_apply_runtime_plan_for_startup(
    uses_pre_materialized_snapshot: bool,
    startup_input: &StartupInput,
) -> bool {
    startup_input.startup_mode == StartupMode::New
        && (!uses_pre_materialized_snapshot
            || is_snapshot_preparation_operation(startup_input.operation_kind))
}

struct StartMinimalTunnelSessionInput<'a> {
    startup_input: &'a StartupInput,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    clock: Arc<dyn Clock>,
    sleeper: Arc<dyn Sleeper>,
    supervisor_handle: SandboxdSupervisorHandle,
    diagnostics_logger: &'a Option<StartupDiagnosticsLogger>,
}

fn start_minimal_tunnel_session(
    input: StartMinimalTunnelSessionInput<'_>,
) -> Result<TunnelSession, SandboxdStateError> {
    record_operation_phase_started_with_attributes(
        input.diagnostics_logger,
        "start_tunnel_session",
        timeline_attributes("tunnel", "Connecting tunnel"),
    );
    let tunnel_session = TunnelSession::start_minimal_with_supervisor(
        input.startup_input,
        input.keepalive_manager,
        input.runtime_readiness_manager,
        input.clock,
        input.sleeper,
        input.supervisor_handle,
    )
    .map_err(|error| {
        let mut attributes = timeline_attributes("tunnel", "Connecting tunnel");
        attributes.insert(
            "error".to_string(),
            startup_diagnostics_string(error.to_string()),
        );
        record_operation_phase_failure(
            input.diagnostics_logger,
            "start_tunnel_session",
            attributes,
        );
        SandboxdStateError::StartTunnelSession(error.to_string())
    })?;
    record_operation_phase_completed_with_attributes(
        input.diagnostics_logger,
        "start_tunnel_session",
        timeline_attributes("tunnel", "Connecting tunnel"),
    );

    Ok(tunnel_session)
}

fn attach_runtime_environment_to_tunnel(
    tunnel_session: &TunnelSession,
    runtime_env: BTreeMap<String, String>,
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
) -> Result<(), SandboxdStateError> {
    record_operation_phase_started(diagnostics_logger, "attach_runtime_environment");
    tunnel_session
        .set_runtime_environment(runtime_env)
        .map_err(|error| {
            record_operation_phase_failure(
                diagnostics_logger,
                "attach_runtime_environment",
                BTreeMap::from([(
                    "error".to_string(),
                    startup_diagnostics_string(error.to_string()),
                )]),
            );
            SandboxdStateError::StartTunnelSession(error.to_string())
        })?;
    record_operation_phase_completed(diagnostics_logger, "attach_runtime_environment");

    Ok(())
}

fn close_tunnel_session(
    tunnel_session: TunnelSession,
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
    phase: &str,
) {
    record_operation_phase_started(diagnostics_logger, phase);
    close_operation_stream(diagnostics_logger);
    tunnel_session.close();
    record_operation_phase_completed(diagnostics_logger, phase);
}

fn close_operation_stream(diagnostics_logger: &Option<StartupDiagnosticsLogger>) {
    if let Some(logger) = diagnostics_logger {
        logger.close_operation_stream();
    }
}

fn close_tunnel_session_after_failure(
    tunnel_session: &mut Option<TunnelSession>,
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
    phase: &str,
) {
    let Some(tunnel_session) = tunnel_session.take() else {
        return;
    };
    close_tunnel_session(tunnel_session, diagnostics_logger, phase);
}

fn close_egress_proxy_after_failure(
    egress_proxy: &mut Option<EgressProxy>,
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
    phase: &str,
) {
    let Some(egress_proxy) = egress_proxy.take() else {
        return;
    };
    record_operation_phase_started(diagnostics_logger, phase);
    match egress_proxy.close() {
        Ok(()) => record_operation_phase_completed(diagnostics_logger, phase),
        Err(close_error) => record_operation_phase_failure(
            diagnostics_logger,
            phase,
            BTreeMap::from([(
                "error".to_string(),
                startup_diagnostics_string(close_error.to_string()),
            )]),
        ),
    }
}

#[cfg(test)]
mod tests;
