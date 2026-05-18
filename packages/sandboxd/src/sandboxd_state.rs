//! Live initialized runtime state owned by the running `sandboxd` daemon.
//!
//! Once the daemon accepts `init`, it needs to own the runtime resources for
//! that sandbox session in one place: runtime-plan materialization, runtime
//! client processes, runtime-specific adapters, and the live bootstrap tunnel
//! session that publishes keepalive and serves tunnel streams.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use crate::codex_proxy::CodexProxyControlHandle;
use crate::command::{
    CommandFailure, CommandOutputSink, CommandOutputStream, CommandSpec,
    DEFAULT_COMMAND_POLL_INTERVAL, run_command_with_details_and_output_sink,
};
use crate::egress_proxy::EgressProxy;
use crate::keepalive::KeepaliveManager;
use crate::process;
use crate::process::{CodexAppServerControlHandle, CodexAppServerObservationHandle};
use crate::protocol::startup::{
    StartupExecutionMode, StartupInput, StartupMode, StartupOperationKind,
};
use crate::pty::{DEFAULT_PTY_SHELL, DEFAULT_PTY_TERM};
use crate::runtime;
use crate::runtime::CompiledRuntimePlanImageSource;
use crate::runtime::RuntimePlanApplyError;
use crate::runtime::adapters::{RuntimeAdapterRegistry, RuntimeAdapters};
use crate::runtime::readiness::{
    RuntimeReadinessManager, RuntimeReadinessMode, derive_runtime_ready,
};
use crate::startup_diagnostics::{
    StartupDiagnosticsLogger, StartupTranscriptStream, startup_diagnostics_string,
    startup_diagnostics_u64,
};
use crate::supervision::{SandboxdHealthSnapshot, SandboxdSupervisorHandle, SupervisedComponent};
use crate::time::{Clock, Sleeper};
use crate::tunnel::session::{
    GatewayEgressTokenProvider, TunnelSession, TunnelSessionError, TunnelSigningRequest,
    TunnelSigningResponse, derive_sandbox_instance_id,
};

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
const SETUP_SCRIPT_WORKING_DIRECTORY: &str = "/root";
const SETUP_SCRIPT_FILE_MODE: u32 = 0o700;
const SNAPSHOT_RUNTIME_ARTIFACTS_DIRECTORY: &str = "/run/mistle";
const SNAPSHOT_TRUST_STORE_CERT_PATH: &str =
    "/usr/local/share/ca-certificates/mistle-egress-proxy-ca.crt";
const STORAGE_ATTACH_SIGNAL_PATH: &str = "/run/mistle/storage-attached";
const STORAGE_ATTACH_SIGNAL_POLL_INTERVAL: std::time::Duration =
    std::time::Duration::from_millis(100);

/// Owns the initialized sandbox runtime resources for one daemon process.
pub struct SandboxdState {
    execution_mode: StartupExecutionMode,
    egress_proxy: Option<EgressProxy>,
    process_manager: Option<process::RuntimeClientProcessManager>,
    runtime_adapters: RuntimeAdapters,
    codex_app_server_observation_handle: Option<CodexAppServerObservationHandle>,
    codex_app_server_control_handle: Option<CodexAppServerControlHandle>,
    codex_proxy_control_handle: Option<CodexProxyControlHandle>,
    codex_coordination_shutdown_requested: Arc<AtomicBool>,
    codex_coordination_thread: Option<JoinHandle<()>>,
    runtime_readiness_shutdown_requested: Arc<AtomicBool>,
    runtime_readiness_thread: Option<JoinHandle<()>>,
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
        wait_for_storage_attach: bool,
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
        let supervisor_handle = SandboxdSupervisorHandle::new(
            sandbox_instance_id.clone(),
            clock.clone(),
            collect_tracked_components(&runtime_plan),
        );
        let gateway_egress_token_provider =
            Some(GatewayEgressTokenProvider::new(sandbox_instance_id));
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
            record_operation_phase_started(&diagnostics_logger, "sandboxd");
            record_operation_phase_completed(&diagnostics_logger, "start_tunnel_session");
        }
        if wait_for_storage_attach {
            wait_for_storage_attach_signal(clock.as_ref(), sleeper.as_ref(), &diagnostics_logger);
        }
        record_operation_phase_started(&diagnostics_logger, "apply_git_identity");
        if !startup_input.is_snapshot()
            && let Err(error) =
                runtime::git_identity::apply_git_identity(startup_input, global_git_config_path)
        {
            record_operation_phase_failure(
                &diagnostics_logger,
                "apply_git_identity",
                BTreeMap::from([(
                    "error".to_string(),
                    startup_diagnostics_string(error.clone()),
                )]),
            );
            if let Some(tunnel_session) = startup_tunnel_session.take() {
                close_tunnel_session(
                    tunnel_session,
                    &diagnostics_logger,
                    "stop_tunnel_session_after_git_identity_failure",
                );
            }
            return Err(SandboxdStateError::ApplyGitIdentity(error));
        }
        record_operation_phase_completed(&diagnostics_logger, "apply_git_identity");

        if let Some(tunnel_session) = &startup_tunnel_session
            && let Some(provider) = &gateway_egress_token_provider
        {
            tunnel_session.attach_gateway_egress_token_provider(provider);
        }

        let mut egress_proxy: Option<EgressProxy>;

        record_operation_phase_started(&diagnostics_logger, "start_egress_proxy");
        egress_proxy = match EgressProxy::start(
            &runtime_plan,
            startup_input,
            gateway_egress_token_provider.clone(),
            clock.clone(),
            supervisor_handle.clone(),
        ) {
            Ok(egress_proxy) => egress_proxy,
            Err(error) => {
                record_operation_phase_failure(
                    &diagnostics_logger,
                    "start_egress_proxy",
                    BTreeMap::from([(
                        "error".to_string(),
                        startup_diagnostics_string(error.to_string()),
                    )]),
                );
                close_tunnel_session_after_failure(
                    &mut startup_tunnel_session,
                    &diagnostics_logger,
                    "stop_tunnel_session_after_egress_proxy_failure",
                );
                return Err(SandboxdStateError::StartEgressProxy(error.to_string()));
            }
        };
        record_operation_phase_completed(&diagnostics_logger, "start_egress_proxy");

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
        let runtime_env: BTreeMap<String, String> =
            match merge_managed_runtime_environment(base_runtime_env, egress_proxy.as_ref()) {
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
            record_operation_phase_started(&diagnostics_logger, "apply_runtime_plan");
            match runtime::apply_compiled_runtime_plan_with_output_sink(
                &runtime_plan,
                Some(&runtime_env),
                command_output_sink(&diagnostics_logger, "apply_runtime_plan"),
            ) {
                Ok(()) => {
                    record_operation_phase_completed(&diagnostics_logger, "apply_runtime_plan")
                }
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
            record_operation_phase_started(&diagnostics_logger, "run_setup_script");
            match run_setup_script_with_output_sink(
                &runtime_plan,
                &runtime_env,
                clock.as_ref(),
                sleeper.as_ref(),
                command_output_sink(&diagnostics_logger, "run_setup_script"),
            ) {
                Ok(()) => {
                    record_operation_phase_completed(&diagnostics_logger, "run_setup_script");
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
            // Snapshot materialization captures image-layer state only. Later session launches may
            // mount persistent storage at paths like /root and /etc/codex, which would shadow any
            // image contents there, so snapshot workflows must stop here and run on ephemeral
            // sandboxes without session runtime resources or persistent mounts.
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
                codex_proxy_control_handle: None,
                codex_coordination_shutdown_requested: Arc::new(AtomicBool::new(false)),
                codex_coordination_thread: None,
                runtime_readiness_shutdown_requested: Arc::new(AtomicBool::new(false)),
                runtime_readiness_thread: None,
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
        record_operation_phase_started(&diagnostics_logger, "start_runtime_processes");
        let process_manager = if process_specs.is_empty() {
            None
        } else {
            Some(
                process::start_runtime_client_process_manager_with_supervisor(
                    &process_specs,
                    clock.as_ref(),
                    sleeper.as_ref(),
                    supervisor_handle.clone(),
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
        record_operation_phase_completed(&diagnostics_logger, "start_runtime_processes");
        let codex_app_server_observation_handle = process_manager
            .as_ref()
            .and_then(process::RuntimeClientProcessManager::codex_app_server_observation_handle)
            .cloned();
        let codex_app_server_control_handle = process_manager
            .as_ref()
            .and_then(process::RuntimeClientProcessManager::codex_app_server_control_handle)
            .cloned();

        record_operation_phase_started(&diagnostics_logger, "start_runtime_adapters");
        let runtime_adapters = RuntimeAdapterRegistry
            .start_with_supervisor(
                startup_input,
                keepalive_manager.clone(),
                runtime_readiness_manager.clone(),
                supervisor_handle.clone(),
            )
            .map_err(|error| {
                record_operation_phase_failure(
                    &diagnostics_logger,
                    "start_runtime_adapters",
                    BTreeMap::from([(
                        "error".to_string(),
                        startup_diagnostics_string(error.to_string()),
                    )]),
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
        record_operation_phase_completed(&diagnostics_logger, "start_runtime_adapters");
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
        record_operation_phase_started(&diagnostics_logger, "attach_runtime_agent_endpoint");
        match tunnel_session.set_agent_endpoint_url(agent_endpoint_url.clone()) {
            Ok(()) => {}
            Err(error) => {
                record_operation_phase_failure(
                    &diagnostics_logger,
                    "attach_runtime_agent_endpoint",
                    BTreeMap::from([(
                        "error".to_string(),
                        startup_diagnostics_string(error.to_string()),
                    )]),
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
        record_operation_phase_completed(&diagnostics_logger, "attach_runtime_agent_endpoint");
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
        let codex_coordination_shutdown_requested = Arc::new(AtomicBool::new(false));
        let codex_coordination_thread = match (
            codex_app_server_control_handle.clone(),
            codex_proxy_control_handle.clone(),
        ) {
            (Some(codex_app_server_control_handle), Some(codex_proxy_control_handle)) => {
                Some(spawn_codex_coordination_thread(
                    codex_app_server_control_handle,
                    codex_proxy_control_handle,
                    supervisor_handle.clone(),
                    codex_coordination_shutdown_requested.clone(),
                ))
            }
            _ => None,
        };

        Ok(Self {
            execution_mode,
            egress_proxy,
            process_manager,
            runtime_adapters,
            codex_app_server_observation_handle,
            codex_app_server_control_handle,
            codex_proxy_control_handle,
            codex_coordination_shutdown_requested,
            codex_coordination_thread,
            runtime_readiness_shutdown_requested,
            runtime_readiness_thread,
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
            .expect("runtime readiness manager lock should not be poisoned")
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
            record_operation_phase_started(&diagnostics_logger, "sandboxd");
            record_operation_phase_completed(&diagnostics_logger, "start_tunnel_session");
        }
        record_operation_phase_started(&diagnostics_logger, "apply_git_identity");
        if let Err(error) =
            runtime::git_identity::apply_git_identity(startup_input, global_git_config_path)
        {
            record_operation_phase_failure(
                &diagnostics_logger,
                "apply_git_identity",
                BTreeMap::from([(
                    "error".to_string(),
                    startup_diagnostics_string(error.clone()),
                )]),
            );
            close_tunnel_session(
                tunnel_session,
                &diagnostics_logger,
                "stop_tunnel_session_after_git_identity_failure",
            );
            return Err(SandboxdStateError::ApplyGitIdentity(error));
        }
        record_operation_phase_completed(&diagnostics_logger, "apply_git_identity");
        if let Some(provider) = &self.gateway_egress_token_provider {
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
        record_operation_phase_started(&diagnostics_logger, "attach_runtime_agent_endpoint");
        if let Err(error) = tunnel_session.set_agent_endpoint_url(agent_endpoint_url) {
            record_operation_phase_failure(
                &diagnostics_logger,
                "attach_runtime_agent_endpoint",
                BTreeMap::from([(
                    "error".to_string(),
                    startup_diagnostics_string(error.to_string()),
                )]),
            );
            close_tunnel_session(
                tunnel_session,
                &diagnostics_logger,
                "stop_tunnel_session_after_agent_endpoint_attach_failure",
            );
            return Err(SandboxdStateError::StartTunnelSession(error.to_string()));
        }
        record_operation_phase_completed(&diagnostics_logger, "attach_runtime_agent_endpoint");
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
        self.codex_coordination_shutdown_requested
            .store(true, Ordering::Relaxed);
        if let Some(codex_coordination_thread) = self.codex_coordination_thread.take() {
            let _ = codex_coordination_thread.join();
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

fn wait_for_storage_attach_signal(
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
) {
    record_operation_phase_started(diagnostics_logger, "wait_storage_attach");
    let started_at_ms = clock.now_ms();
    while !Path::new(STORAGE_ATTACH_SIGNAL_PATH).exists() {
        sleeper.sleep(STORAGE_ATTACH_SIGNAL_POLL_INTERVAL);
    }
    record_operation_phase_completed_with_attributes(
        diagnostics_logger,
        "wait_storage_attach",
        BTreeMap::from([(
            "durationMs".to_string(),
            startup_diagnostics_u64(clock.now_ms().saturating_sub(started_at_ms)),
        )]),
    );
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

fn record_operation_phase_failure(
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
    phase: &str,
    attributes: BTreeMap<String, serde_json::Value>,
) {
    if let Some(logger) = diagnostics_logger {
        let transcript_message = attributes
            .get("error")
            .and_then(serde_json::Value::as_str)
            .map_or_else(
                || format!("{phase} failed"),
                |error| format!("{phase} failed: {error}"),
            );
        if let Err(error) = logger.record_phase_failed(phase, attributes) {
            eprintln!("sandboxd failed to record startup diagnostics phase failure: {error}");
        }
        if let Err(error) = logger.record_transcript(
            Some(phase),
            StartupTranscriptStream::System,
            transcript_message.as_bytes(),
        ) {
            eprintln!("sandboxd failed to record startup diagnostics transcript: {error}");
        }
    }
}

fn record_operation_phase_started(
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
    phase: &str,
) {
    if let Some(logger) = diagnostics_logger {
        if let Err(error) = logger.record_phase_started(phase) {
            eprintln!("sandboxd failed to record startup diagnostics phase start: {error}");
        }
        if let Err(error) = logger.record_transcript(
            Some(phase),
            StartupTranscriptStream::System,
            format!("{phase} started").as_bytes(),
        ) {
            eprintln!("sandboxd failed to record startup diagnostics transcript: {error}");
        }
    }
}

fn record_operation_phase_completed(
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
    phase: &str,
) {
    record_operation_phase_completed_with_attributes(diagnostics_logger, phase, BTreeMap::new());
}

fn record_operation_phase_completed_with_attributes(
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
    phase: &str,
    attributes: BTreeMap<String, serde_json::Value>,
) {
    if let Some(logger) = diagnostics_logger {
        if let Err(error) = logger.record_phase_completed_with_attributes(phase, attributes) {
            eprintln!("sandboxd failed to record startup diagnostics phase completion: {error}");
        }
        if let Err(error) = logger.record_transcript(
            Some(phase),
            StartupTranscriptStream::System,
            format!("{phase} completed").as_bytes(),
        ) {
            eprintln!("sandboxd failed to record startup diagnostics transcript: {error}");
        }
    }
}

fn record_runtime_plan_apply_failure(
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
    error: &RuntimePlanApplyError,
) {
    let attributes = match error {
        RuntimePlanApplyError::InvalidRuntimePlan(error) => BTreeMap::from([
            (
                "failureKind".to_string(),
                startup_diagnostics_string("invalid_runtime_plan"),
            ),
            (
                "error".to_string(),
                startup_diagnostics_string(error.to_string()),
            ),
        ]),
        RuntimePlanApplyError::ArtifactInstall {
            artifact_key,
            install_index,
            op,
            error,
            ..
        } => BTreeMap::from([
            (
                "failureKind".to_string(),
                startup_diagnostics_string("artifact_install_failed"),
            ),
            (
                "artifactKey".to_string(),
                startup_diagnostics_string(artifact_key.clone()),
            ),
            (
                "installIndex".to_string(),
                startup_diagnostics_u64(*install_index as u64),
            ),
            ("installOp".to_string(), startup_diagnostics_string(*op)),
            (
                "error".to_string(),
                startup_diagnostics_string(error.clone()),
            ),
        ]),
        RuntimePlanApplyError::WorkspaceSource {
            source_kind,
            path,
            origin_url,
            clone_url,
            error,
            ..
        } => {
            let mut map = BTreeMap::from([
                (
                    "failureKind".to_string(),
                    startup_diagnostics_string("workspace_source_failed"),
                ),
                (
                    "sourceKind".to_string(),
                    startup_diagnostics_string(*source_kind),
                ),
                ("path".to_string(), startup_diagnostics_string(path.clone())),
                (
                    "originUrl".to_string(),
                    startup_diagnostics_string(origin_url.clone()),
                ),
                (
                    "error".to_string(),
                    startup_diagnostics_string(error.clone()),
                ),
            ]);
            if let Some(clone_url) = clone_url {
                map.insert(
                    "cloneUrl".to_string(),
                    startup_diagnostics_string(clone_url.clone()),
                );
            }
            map
        }
        RuntimePlanApplyError::RuntimeFile {
            client_id,
            file_id,
            path,
            error,
            ..
        } => BTreeMap::from([
            (
                "failureKind".to_string(),
                startup_diagnostics_string("runtime_file_failed"),
            ),
            (
                "clientId".to_string(),
                startup_diagnostics_string(client_id.clone()),
            ),
            (
                "fileId".to_string(),
                startup_diagnostics_string(file_id.clone()),
            ),
            ("path".to_string(), startup_diagnostics_string(path.clone())),
            (
                "error".to_string(),
                startup_diagnostics_string(error.clone()),
            ),
        ]),
    };

    record_operation_phase_failure(diagnostics_logger, "apply_runtime_plan", attributes);
}

fn record_runtime_process_failure(
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
    error: &process::ProcessManagerError,
) {
    let attributes = match error {
        process::ProcessManagerError::StartProcess {
            process_key,
            process_index,
            error,
            output_tails,
        } => {
            let mut map = BTreeMap::from([
                (
                    "failureKind".to_string(),
                    startup_diagnostics_string("runtime_process_spawn_failed"),
                ),
                (
                    "processKey".to_string(),
                    startup_diagnostics_string(process_key.clone()),
                ),
                (
                    "processIndex".to_string(),
                    startup_diagnostics_u64(*process_index as u64),
                ),
                (
                    "error".to_string(),
                    startup_diagnostics_string(error.clone()),
                ),
                (
                    "stdoutCaptured".to_string(),
                    serde_json::Value::Bool(output_tails.stdout_captured),
                ),
                (
                    "stderrCaptured".to_string(),
                    serde_json::Value::Bool(output_tails.stderr_captured),
                ),
            ]);
            if let Some(stdout_tail) = &output_tails.stdout_tail {
                map.insert(
                    "stdoutTail".to_string(),
                    startup_diagnostics_string(stdout_tail.clone()),
                );
            }
            if let Some(stderr_tail) = &output_tails.stderr_tail {
                map.insert(
                    "stderrTail".to_string(),
                    startup_diagnostics_string(stderr_tail.clone()),
                );
            }
            map
        }
        process::ProcessManagerError::ReadinessCheck {
            process_key,
            process_index,
            error,
            details,
        } => {
            let mut map = BTreeMap::from([
                (
                    "failureKind".to_string(),
                    startup_diagnostics_string("runtime_process_readiness_failed"),
                ),
                (
                    "processKey".to_string(),
                    startup_diagnostics_string(process_key.clone()),
                ),
                (
                    "processIndex".to_string(),
                    startup_diagnostics_u64(*process_index as u64),
                ),
                (
                    "readinessType".to_string(),
                    startup_diagnostics_string(details.readiness_type.clone()),
                ),
                (
                    "readinessTarget".to_string(),
                    startup_diagnostics_string(details.readiness_target.clone()),
                ),
                (
                    "timeoutMs".to_string(),
                    startup_diagnostics_u64(details.timeout_ms),
                ),
                (
                    "error".to_string(),
                    startup_diagnostics_string(error.clone()),
                ),
                (
                    "stdoutCaptured".to_string(),
                    serde_json::Value::Bool(details.output_tails.stdout_captured),
                ),
                (
                    "stderrCaptured".to_string(),
                    serde_json::Value::Bool(details.output_tails.stderr_captured),
                ),
            ]);
            if let Some(stdout_tail) = &details.output_tails.stdout_tail {
                map.insert(
                    "stdoutTail".to_string(),
                    startup_diagnostics_string(stdout_tail.clone()),
                );
            }
            if let Some(stderr_tail) = &details.output_tails.stderr_tail {
                map.insert(
                    "stderrTail".to_string(),
                    startup_diagnostics_string(stderr_tail.clone()),
                );
            }
            map
        }
        process::ProcessManagerError::StopProcesses(error) => BTreeMap::from([(
            "error".to_string(),
            startup_diagnostics_string(error.clone()),
        )]),
    };

    record_operation_phase_failure(diagnostics_logger, "start_runtime_processes", attributes);
}

fn record_setup_script_failure(
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
    error: &CommandFailure,
) {
    let mut attributes = BTreeMap::from([
        (
            "failureKind".to_string(),
            startup_diagnostics_string("setup_script_failed"),
        ),
        (
            "error".to_string(),
            startup_diagnostics_string(error.message.clone()),
        ),
        (
            "stdoutCaptured".to_string(),
            serde_json::Value::Bool(error.output_tails.stdout_captured),
        ),
        (
            "stderrCaptured".to_string(),
            serde_json::Value::Bool(error.output_tails.stderr_captured),
        ),
    ]);
    if let Some(exit_code) = error.exit_code {
        attributes.insert(
            "exitCode".to_string(),
            startup_diagnostics_u64(exit_code as u64),
        );
    }
    if let Some(stdout_tail) = &error.output_tails.stdout_tail {
        attributes.insert(
            "stdoutTail".to_string(),
            startup_diagnostics_string(stdout_tail.clone()),
        );
    }
    if let Some(stderr_tail) = &error.output_tails.stderr_tail {
        attributes.insert(
            "stderrTail".to_string(),
            startup_diagnostics_string(stderr_tail.clone()),
        );
    }
    if error.timed_out {
        attributes.insert("timedOut".to_string(), serde_json::Value::Bool(true));
    }

    record_operation_phase_failure(diagnostics_logger, "run_setup_script", attributes);
}

const CODEX_COORDINATION_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(250);
const CODEX_PROXY_RECOVERY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const RUNTIME_READINESS_PROJECTION_POLL_INTERVAL: std::time::Duration =
    std::time::Duration::from_millis(100);

fn determine_runtime_readiness_mode(
    supervisor_handle: &SandboxdSupervisorHandle,
) -> RuntimeReadinessMode {
    if supervisor_handle.tracks_component(SupervisedComponent::CodexAppServer) {
        RuntimeReadinessMode::Codex
    } else if supervisor_handle.tracks_component(SupervisedComponent::CodexProxy) {
        RuntimeReadinessMode::CodexProxyOnly
    } else if supervisor_handle.tracks_component(SupervisedComponent::OpenCodeProxy) {
        RuntimeReadinessMode::OpenCodeProxyOnly
    } else {
        RuntimeReadinessMode::NoAgentRuntime
    }
}

fn sync_runtime_readiness_from_snapshot(
    supervisor_handle: &SandboxdSupervisorHandle,
    runtime_readiness_manager: &Arc<Mutex<RuntimeReadinessManager>>,
    runtime_readiness_mode: RuntimeReadinessMode,
) {
    let ready = derive_runtime_ready(&supervisor_handle.snapshot(), runtime_readiness_mode);
    runtime_readiness_manager
        .lock()
        .expect("runtime readiness manager lock should not be poisoned")
        .set_ready(ready);
}

fn spawn_runtime_readiness_projection_thread(
    supervisor_handle: SandboxdSupervisorHandle,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    runtime_readiness_mode: RuntimeReadinessMode,
    shutdown_requested: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        run_runtime_readiness_projection_loop(
            supervisor_handle,
            runtime_readiness_manager,
            runtime_readiness_mode,
            shutdown_requested,
        );
    })
}

fn run_runtime_readiness_projection_loop(
    supervisor_handle: SandboxdSupervisorHandle,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    runtime_readiness_mode: RuntimeReadinessMode,
    shutdown_requested: Arc<AtomicBool>,
) {
    let mut last_projected_ready = None;

    while !shutdown_requested.load(Ordering::Relaxed) {
        let projected_ready =
            derive_runtime_ready(&supervisor_handle.snapshot(), runtime_readiness_mode);
        if last_projected_ready != Some(projected_ready) {
            runtime_readiness_manager
                .lock()
                .expect("runtime readiness manager lock should not be poisoned")
                .set_ready(projected_ready);
            last_projected_ready = Some(projected_ready);
        }
        thread::sleep(RUNTIME_READINESS_PROJECTION_POLL_INTERVAL);
    }
}

fn spawn_codex_coordination_thread(
    codex_app_server_control_handle: CodexAppServerControlHandle,
    codex_proxy_control_handle: CodexProxyControlHandle,
    supervisor_handle: SandboxdSupervisorHandle,
    shutdown_requested: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        run_codex_coordination_loop(
            codex_app_server_control_handle,
            codex_proxy_control_handle,
            supervisor_handle,
            shutdown_requested,
        );
    })
}

fn run_codex_coordination_loop(
    codex_app_server_control_handle: CodexAppServerControlHandle,
    codex_proxy_control_handle: CodexProxyControlHandle,
    supervisor_handle: SandboxdSupervisorHandle,
    shutdown_requested: Arc<AtomicBool>,
) {
    while !shutdown_requested.load(Ordering::Relaxed) {
        let codex_app_server_snapshot =
            supervisor_handle.component_snapshot(SupervisedComponent::CodexAppServer);
        let Some(codex_app_server_snapshot) = codex_app_server_snapshot else {
            break;
        };
        if codex_app_server_snapshot.state != crate::supervision::ComponentHealthState::Restarting {
            thread::sleep(CODEX_COORDINATION_POLL_INTERVAL);
            continue;
        }

        let restart_reason = if codex_app_server_snapshot
            .details
            .get("livenessState")
            .is_some_and(|liveness_state| liveness_state == "Exited")
        {
            "coordinated_restart_after_exit"
        } else {
            "coordinated_restart_after_readiness_failure"
        };
        supervisor_handle.emit_component_restart_scheduled(
            SupervisedComponent::CodexAppServer,
            restart_reason,
            0,
            &[],
        );

        if codex_app_server_control_handle
            .restart(&crate::time::SystemClock, &crate::time::ThreadSleeper)
            .is_ok()
            && !wait_for_codex_proxy_recovery(
                &codex_proxy_control_handle,
                CODEX_PROXY_RECOVERY_TIMEOUT,
                shutdown_requested.as_ref(),
            )
        {
            let _ = codex_proxy_control_handle.request_restart();
            let _ = wait_for_codex_proxy_recovery(
                &codex_proxy_control_handle,
                CODEX_PROXY_RECOVERY_TIMEOUT,
                shutdown_requested.as_ref(),
            );
        }
        thread::sleep(CODEX_COORDINATION_POLL_INTERVAL);
    }
}

fn wait_for_codex_proxy_recovery(
    codex_proxy_control_handle: &CodexProxyControlHandle,
    timeout: std::time::Duration,
    shutdown_requested: &AtomicBool,
) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if shutdown_requested.load(Ordering::Relaxed) {
            return false;
        }
        if let Some(snapshot) = codex_proxy_control_handle.snapshot() {
            let raw_connectivity_connected = snapshot
                .details
                .get("rawConnectivityState")
                .is_some_and(|state| state == "Connected");
            let session_manager_connected = snapshot
                .details
                .get("sessionManagerState")
                .is_some_and(|state| state == "Connected");
            if snapshot.state == crate::supervision::ComponentHealthState::Healthy
                && raw_connectivity_connected
                && session_manager_connected
            {
                return true;
            }
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        thread::sleep(CODEX_COORDINATION_POLL_INTERVAL);
    }
}

fn collect_tracked_components(
    runtime_plan: &runtime::CompiledRuntimePlan,
) -> BTreeSet<SupervisedComponent> {
    let mut tracked_components = BTreeSet::from([SupervisedComponent::TunnelSession]);

    if !runtime_plan.egress_routes.is_empty() {
        tracked_components.insert(SupervisedComponent::EgressProxy);
    }

    if runtime_plan
        .agent_runtimes
        .iter()
        .any(|agent_runtime| agent_runtime.runtime_id == "codex")
    {
        tracked_components.insert(SupervisedComponent::CodexProxy);
        tracked_components.insert(SupervisedComponent::CodexAppServer);
    }

    if runtime_plan
        .agent_runtimes
        .iter()
        .any(|agent_runtime| agent_runtime.runtime_id == "opencode")
    {
        tracked_components.insert(SupervisedComponent::OpenCodeProxy);
    }

    tracked_components
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
    record_operation_phase_started(input.diagnostics_logger, "start_tunnel_session");
    let tunnel_session = TunnelSession::start_minimal_with_supervisor(
        input.startup_input,
        input.keepalive_manager,
        input.runtime_readiness_manager,
        input.clock,
        input.sleeper,
        input.supervisor_handle,
    )
    .map_err(|error| {
        record_operation_phase_failure(
            input.diagnostics_logger,
            "start_tunnel_session",
            BTreeMap::from([(
                "error".to_string(),
                startup_diagnostics_string(error.to_string()),
            )]),
        );
        SandboxdStateError::StartTunnelSession(error.to_string())
    })?;
    record_operation_phase_completed(input.diagnostics_logger, "start_tunnel_session");

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

fn collect_runtime_environment(
    runtime_plan: &runtime::CompiledRuntimePlan,
) -> Result<BTreeMap<String, String>, String> {
    let mut runtime_env = BTreeMap::new();

    for artifact in &runtime_plan.artifacts {
        let Some(artifact_env) = &artifact.env else {
            continue;
        };

        for (name, value) in artifact_env {
            match runtime_env.get(name) {
                Some(existing_value) if existing_value != value => {
                    return Err(format!(
                        "runtime plan artifacts define conflicting values for env '{name}'"
                    ));
                }
                Some(_) => {}
                None => {
                    runtime_env.insert(name.clone(), value.clone());
                }
            }
        }
    }

    Ok(runtime_env)
}

fn merge_managed_runtime_environment(
    mut runtime_env: BTreeMap<String, String>,
    egress_proxy: Option<&EgressProxy>,
) -> Result<BTreeMap<String, String>, String> {
    insert_managed_runtime_environment(
        &mut runtime_env,
        GLOBAL_GIT_CONFIG_ENV_NAME,
        DEFAULT_GLOBAL_GIT_CONFIG_PATH,
    )?;

    if let Some(egress_proxy) = egress_proxy {
        for (name, value) in egress_proxy.runtime_env() {
            insert_managed_runtime_environment(&mut runtime_env, name, value)?;
        }
    }

    Ok(runtime_env)
}

fn insert_managed_runtime_environment(
    runtime_env: &mut BTreeMap<String, String>,
    name: &str,
    value: &str,
) -> Result<(), String> {
    match runtime_env.get(name) {
        Some(existing_value) if existing_value != value => {
            return Err(format!(
                "runtime plan artifacts define managed env '{name}', which sandboxd reserves"
            ));
        }
        Some(_) => {}
        None => {
            runtime_env.insert(name.to_string(), value.to_string());
        }
    }

    Ok(())
}

fn scrub_snapshot_runtime_artifacts() -> Result<(), String> {
    scrub_snapshot_runtime_artifacts_at_paths(
        Path::new(SNAPSHOT_RUNTIME_ARTIFACTS_DIRECTORY),
        Path::new(SNAPSHOT_TRUST_STORE_CERT_PATH),
    )
}

fn scrub_snapshot_runtime_artifacts_at_paths(
    runtime_artifacts_directory: &Path,
    trust_store_certificate_path: &Path,
) -> Result<(), String> {
    match fs::remove_dir_all(runtime_artifacts_directory) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "failed to remove snapshot runtime artifacts directory '{}': {error}",
                runtime_artifacts_directory.display()
            ));
        }
    }

    match fs::remove_file(trust_store_certificate_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "failed to remove snapshot trust-store certificate '{}': {error}",
                trust_store_certificate_path.display()
            ));
        }
    }

    Ok(())
}

#[cfg(test)]
fn run_setup_script<C, S>(
    runtime_plan: &runtime::CompiledRuntimePlan,
    runtime_env: &BTreeMap<String, String>,
    clock: &C,
    sleeper: &S,
) -> Result<(), CommandFailure>
where
    C: Clock + ?Sized,
    S: Sleeper + ?Sized,
{
    run_setup_script_with_output_sink(runtime_plan, runtime_env, clock, sleeper, None)
}

fn run_setup_script_with_output_sink<C, S>(
    runtime_plan: &runtime::CompiledRuntimePlan,
    runtime_env: &BTreeMap<String, String>,
    clock: &C,
    sleeper: &S,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
) -> Result<(), CommandFailure>
where
    C: Clock + ?Sized,
    S: Sleeper + ?Sized,
{
    run_setup_script_in_directory_with_output_sink(
        runtime_plan,
        runtime_env,
        SETUP_SCRIPT_WORKING_DIRECTORY,
        clock,
        sleeper,
        output_sink,
    )
}

#[cfg(test)]
fn run_setup_script_in_directory<C, S>(
    runtime_plan: &runtime::CompiledRuntimePlan,
    runtime_env: &BTreeMap<String, String>,
    working_directory: &str,
    clock: &C,
    sleeper: &S,
) -> Result<(), CommandFailure>
where
    C: Clock + ?Sized,
    S: Sleeper + ?Sized,
{
    run_setup_script_in_directory_with_output_sink(
        runtime_plan,
        runtime_env,
        working_directory,
        clock,
        sleeper,
        None,
    )
}

fn run_setup_script_in_directory_with_output_sink<C, S>(
    runtime_plan: &runtime::CompiledRuntimePlan,
    runtime_env: &BTreeMap<String, String>,
    working_directory: &str,
    clock: &C,
    sleeper: &S,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
) -> Result<(), CommandFailure>
where
    C: Clock + ?Sized,
    S: Sleeper + ?Sized,
{
    let Some(setup_script) = runtime_plan.setup_script.as_ref() else {
        return Ok(());
    };
    if setup_script.trim().is_empty() {
        return Ok(());
    }

    let mut setup_script_file = tempfile::Builder::new()
        .prefix("mistle-setup-script-")
        .suffix(".sh")
        .tempfile()
        .map_err(|error| {
            setup_script_file_failure(format!("failed to create temporary file: {error}"))
        })?;
    setup_script_file
        .write_all(setup_script.as_bytes())
        .map_err(|error| {
            setup_script_file_failure(format!("failed to write temporary script file: {error}"))
        })?;
    setup_script_file.as_file_mut().flush().map_err(|error| {
        setup_script_file_failure(format!("failed to flush temporary script file: {error}"))
    })?;
    fs::set_permissions(
        setup_script_file.path(),
        fs::Permissions::from_mode(SETUP_SCRIPT_FILE_MODE),
    )
    .map_err(|error| {
        setup_script_file_failure(format!(
            "failed to make temporary script executable: {error}"
        ))
    })?;

    let setup_script_path = setup_script_file.into_temp_path();
    let setup_script_path_ref: &Path = setup_script_path.as_ref();
    let setup_script_command_path = setup_script_path_ref
        .to_str()
        .ok_or_else(|| {
            setup_script_file_failure("temporary script path is not valid unicode".to_string())
        })?
        .to_string();
    let shell_args = build_setup_script_command_args(setup_script, setup_script_command_path);
    let environment = build_setup_script_environment(runtime_env);

    let run_result = run_command_with_details_and_output_sink(
        CommandSpec {
            args: &shell_args,
            env: Some(&environment),
            cwd: Some(working_directory),
            timeout_ms: None,
        },
        clock,
        sleeper,
        DEFAULT_COMMAND_POLL_INTERVAL,
        output_sink,
    );
    let cleanup_result = setup_script_path.close().map_err(|error| {
        setup_script_file_failure(format!("failed to remove temporary script file: {error}"))
    });

    match (run_result, cleanup_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), Err(error)) | (Err(_), Err(error)) => Err(error),
    }
}

fn build_setup_script_command_args(setup_script: &str, setup_script_path: String) -> Vec<String> {
    if setup_script.as_bytes().starts_with(b"#!") {
        return vec![setup_script_path];
    }

    vec![
        DEFAULT_PTY_SHELL.to_string(),
        "-l".to_string(),
        setup_script_path,
    ]
}

fn setup_script_file_failure(message: String) -> CommandFailure {
    CommandFailure {
        message,
        exit_code: None,
        timed_out: false,
        output_tails: Default::default(),
    }
}

fn build_setup_script_environment(
    runtime_env: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut environment = std::env::vars().collect::<BTreeMap<_, _>>();
    environment.insert("TERM".to_string(), DEFAULT_PTY_TERM.to_string());

    for (name, value) in runtime_env {
        environment.insert(name.clone(), value.clone());
    }

    environment
}

#[cfg(test)]
mod tests {
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
    use crate::protocol::startup::{GitIdentity, StartupExecutionMode, StartupInput, StartupMode};
    use crate::runtime::readiness::{RuntimeReadinessManager, RuntimeReadinessMode};
    use crate::runtime::{
        CompiledRuntimePlan, RuntimeClientProcessReadiness, RuntimeClientProcessStopPolicy,
        RuntimeClientProcessStopSignal, RuntimeExecCommand,
    };
    use crate::sandboxd_state::{
        DEFAULT_GLOBAL_GIT_CONFIG_PATH, GLOBAL_GIT_CONFIG_ENV_NAME, SETUP_SCRIPT_WORKING_DIRECTORY,
        SandboxdState, build_setup_script_environment, collect_runtime_environment,
        merge_managed_runtime_environment, run_setup_script, run_setup_script_in_directory,
        scrub_snapshot_runtime_artifacts_at_paths, spawn_codex_coordination_thread,
        spawn_runtime_readiness_projection_thread,
    };
    use crate::startup_diagnostics::{StartupDiagnosticsLogger, StartupOperation};
    use crate::supervision::{ComponentHealthState, SandboxdSupervisorHandle, SupervisedComponent};
    use crate::test_support::TestEnvVarsGuard;
    use crate::time::{SystemClock, ThreadSleeper};
    use tungstenite::{Message, WebSocket, accept};

    #[test]
    fn collects_runtime_environment_from_artifacts() {
        let runtime_plan = CompiledRuntimePlan {
            image: test_runtime_plan_image(crate::runtime::CompiledRuntimePlanImageSource::Base),
            setup_script: None,
            egress_routes: Vec::new(),
            artifacts: vec![
                crate::runtime::CompiledRuntimeArtifact {
                    artifact_key: "gh-cli".to_string(),
                    name: "GitHub CLI".to_string(),
                    env: Some(BTreeMap::from([(
                        "GH_TOKEN".to_string(),
                        "token-value".to_string(),
                    )])),
                    lifecycle: crate::runtime::RuntimeArtifactLifecycle {
                        install: Vec::new(),
                    },
                },
                crate::runtime::CompiledRuntimeArtifact {
                    artifact_key: "jira-cli".to_string(),
                    name: "Jira CLI".to_string(),
                    env: Some(BTreeMap::from([(
                        "JIRA_BASE_URL".to_string(),
                        "https://mistle.atlassian.net".to_string(),
                    )])),
                    lifecycle: crate::runtime::RuntimeArtifactLifecycle {
                        install: Vec::new(),
                    },
                },
            ],
            workspace_sources: Vec::new(),
            runtime_clients: Vec::new(),
            agent_runtimes: Vec::new(),
        };

        let runtime_env =
            collect_runtime_environment(&runtime_plan).expect("runtime env should collect");

        assert_eq!(
            runtime_env,
            BTreeMap::from([
                ("GH_TOKEN".to_string(), "token-value".to_string()),
                (
                    "JIRA_BASE_URL".to_string(),
                    "https://mistle.atlassian.net".to_string(),
                ),
            ])
        );
    }

    #[test]
    fn rejects_conflicting_runtime_environment_values() {
        let runtime_plan = CompiledRuntimePlan {
            image: test_runtime_plan_image(crate::runtime::CompiledRuntimePlanImageSource::Base),
            setup_script: None,
            egress_routes: Vec::new(),
            artifacts: vec![
                crate::runtime::CompiledRuntimeArtifact {
                    artifact_key: "artifact-a".to_string(),
                    name: "Artifact A".to_string(),
                    env: Some(BTreeMap::from([(
                        "GH_TOKEN".to_string(),
                        "first".to_string(),
                    )])),
                    lifecycle: crate::runtime::RuntimeArtifactLifecycle {
                        install: Vec::new(),
                    },
                },
                crate::runtime::CompiledRuntimeArtifact {
                    artifact_key: "artifact-b".to_string(),
                    name: "Artifact B".to_string(),
                    env: Some(BTreeMap::from([(
                        "GH_TOKEN".to_string(),
                        "second".to_string(),
                    )])),
                    lifecycle: crate::runtime::RuntimeArtifactLifecycle {
                        install: Vec::new(),
                    },
                },
            ],
            workspace_sources: Vec::new(),
            runtime_clients: Vec::new(),
            agent_runtimes: Vec::new(),
        };

        let error =
            collect_runtime_environment(&runtime_plan).expect_err("conflict should fail fast");
        assert_eq!(
            error,
            "runtime plan artifacts define conflicting values for env 'GH_TOKEN'"
        );
    }

    #[test]
    fn adds_default_global_git_config_to_managed_runtime_environment() {
        let runtime_env = merge_managed_runtime_environment(BTreeMap::new(), None)
            .expect("managed runtime env should merge");

        assert_eq!(
            runtime_env,
            BTreeMap::from([(
                GLOBAL_GIT_CONFIG_ENV_NAME.to_string(),
                DEFAULT_GLOBAL_GIT_CONFIG_PATH.to_string(),
            )])
        );
    }

    #[test]
    fn allows_runtime_plan_to_define_path() {
        let runtime_env = merge_managed_runtime_environment(
            BTreeMap::from([(
                "PATH".to_string(),
                "/usr/local/bin:/usr/bin:/bin".to_string(),
            )]),
            None,
        )
        .expect("runtime plan path should be preserved");

        assert_eq!(
            runtime_env.get("PATH"),
            Some(&"/usr/local/bin:/usr/bin:/bin".to_string())
        );
        assert_eq!(
            runtime_env.get(GLOBAL_GIT_CONFIG_ENV_NAME),
            Some(&DEFAULT_GLOBAL_GIT_CONFIG_PATH.to_string())
        );
    }

    #[test]
    fn rejects_runtime_plan_global_git_config_override() {
        let error = merge_managed_runtime_environment(
            BTreeMap::from([(
                GLOBAL_GIT_CONFIG_ENV_NAME.to_string(),
                "/tmp/not-sandboxd-owned".to_string(),
            )]),
            None,
        )
        .expect_err("managed global git config should be reserved");

        assert_eq!(
            error,
            "runtime plan artifacts define managed env 'GIT_CONFIG_GLOBAL', which sandboxd reserves"
        );
    }

    #[test]
    fn build_setup_script_environment_matches_pty_basics() {
        let environment = build_setup_script_environment(&BTreeMap::from([(
            "MISTLE_TEST_ENV".to_string(),
            "runtime-value".to_string(),
        )]));

        assert_eq!(
            environment.get("TERM"),
            Some(&crate::pty::DEFAULT_PTY_TERM.to_string())
        );
        assert_eq!(
            environment.get("MISTLE_TEST_ENV"),
            Some(&"runtime-value".to_string())
        );
        assert_eq!(SETUP_SCRIPT_WORKING_DIRECTORY, "/root");
    }

    #[test]
    fn run_setup_script_skips_missing_or_blank_scripts() {
        let runtime_env = BTreeMap::new();
        let missing_setup_script_plan = CompiledRuntimePlan {
            image: test_runtime_plan_image(crate::runtime::CompiledRuntimePlanImageSource::Base),
            setup_script: None,
            egress_routes: Vec::new(),
            artifacts: Vec::new(),
            workspace_sources: Vec::new(),
            runtime_clients: Vec::new(),
            agent_runtimes: Vec::new(),
        };
        run_setup_script(
            &missing_setup_script_plan,
            &runtime_env,
            &SystemClock,
            &ThreadSleeper,
        )
        .expect("missing setup script should be a no-op");

        let blank_setup_script_plan = CompiledRuntimePlan {
            image: test_runtime_plan_image(crate::runtime::CompiledRuntimePlanImageSource::Base),
            setup_script: Some("   \n\t  ".to_string()),
            egress_routes: Vec::new(),
            artifacts: Vec::new(),
            workspace_sources: Vec::new(),
            runtime_clients: Vec::new(),
            agent_runtimes: Vec::new(),
        };
        run_setup_script(
            &blank_setup_script_plan,
            &runtime_env,
            &SystemClock,
            &ThreadSleeper,
        )
        .expect("blank setup script should be a no-op");
    }

    #[test]
    fn run_setup_script_honors_user_shebang() {
        let output_path = std::env::temp_dir().join(format!(
            "mistle-setup-script-shebang-output-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let runtime_plan = CompiledRuntimePlan {
            image: test_runtime_plan_image(crate::runtime::CompiledRuntimePlanImageSource::Base),
            setup_script: Some(format!(
                "#!/bin/false\nprintf 'script body ran' > {path}",
                path = output_path.display()
            )),
            egress_routes: Vec::new(),
            artifacts: Vec::new(),
            workspace_sources: Vec::new(),
            runtime_clients: Vec::new(),
            agent_runtimes: Vec::new(),
        };

        run_setup_script_in_directory(
            &runtime_plan,
            &BTreeMap::new(),
            std::env::temp_dir()
                .to_str()
                .expect("temporary directory should be valid unicode"),
            &SystemClock,
            &ThreadSleeper,
        )
        .expect_err("setup script should execute through the user shebang");

        assert!(
            !output_path.exists(),
            "setup script body should not run when the shebang interpreter exits first"
        );
    }

    #[test]
    fn run_setup_script_uses_root_cwd_and_runtime_environment() {
        let working_directory = std::env::temp_dir().join(format!(
            "mistle-setup-script-working-directory-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&working_directory)
            .expect("setup script test working directory should be created");
        let output_path = std::env::temp_dir().join(format!(
            "mistle-setup-script-output-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let runtime_plan = CompiledRuntimePlan {
            image: test_runtime_plan_image(crate::runtime::CompiledRuntimePlanImageSource::Base),
            setup_script: Some(format!(
                "printf '%s\\n' \"$TERM\" > {path}; printf '%s\\n' \"$MISTLE_TEST_ENV\" >> {path}; pwd >> {path}; printf '%s\\n' \"$0\" >> {path}; test -x \"$0\" && printf 'executable\\n' >> {path}",
                path = output_path.display()
            )),
            egress_routes: Vec::new(),
            artifacts: Vec::new(),
            workspace_sources: Vec::new(),
            runtime_clients: Vec::new(),
            agent_runtimes: Vec::new(),
        };
        let runtime_env =
            BTreeMap::from([("MISTLE_TEST_ENV".to_string(), "runtime-value".to_string())]);

        run_setup_script_in_directory(
            &runtime_plan,
            &runtime_env,
            working_directory
                .to_str()
                .expect("working directory should be valid unicode"),
            &SystemClock,
            &ThreadSleeper,
        )
        .expect("setup script should run successfully");

        let output = std::fs::read_to_string(&output_path)
            .expect("setup script should write its output file");
        let output_lines = output.lines().collect::<Vec<_>>();
        let canonical_working_directory = std::fs::canonicalize(&working_directory)
            .expect("working directory should canonicalize");
        assert_eq!(
            output_lines[0..3],
            [
                "xterm-256color",
                "runtime-value",
                canonical_working_directory
                    .to_str()
                    .expect("working directory should be valid unicode")
            ]
        );
        let setup_script_path = output_lines
            .get(3)
            .expect("setup script should record its file path");
        assert_eq!(output_lines.get(4), Some(&"executable"));
        assert!(
            !std::path::Path::new(setup_script_path).exists(),
            "temporary setup script should be removed after execution"
        );

        let _ = std::fs::remove_file(output_path);
        let _ = std::fs::remove_dir_all(working_directory);
    }

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
            runtime_clients: Vec::new(),
            agent_runtimes: Vec::new(),
        };

        super::run_setup_script_in_directory_with_output_sink(
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
    fn run_setup_script_captures_stdout_and_stderr_on_failure() {
        let runtime_plan = CompiledRuntimePlan {
            image: test_runtime_plan_image(crate::runtime::CompiledRuntimePlanImageSource::Base),
            setup_script: Some(
                "printf '%s\\nstdout-line' \"$0\"; printf 'stderr-line' >&2; exit 17".to_string(),
            ),
            egress_routes: Vec::new(),
            artifacts: Vec::new(),
            workspace_sources: Vec::new(),
            runtime_clients: Vec::new(),
            agent_runtimes: Vec::new(),
        };

        let error = run_setup_script_in_directory(
            &runtime_plan,
            &BTreeMap::new(),
            std::env::temp_dir()
                .to_str()
                .expect("temporary directory should be valid unicode"),
            &SystemClock,
            &ThreadSleeper,
        )
        .expect_err("failing setup script should return an error");

        assert_eq!(error.exit_code, Some(17));
        assert!(!error.timed_out);
        assert!(error.output_tails.stdout_captured);
        assert!(error.output_tails.stderr_captured);
        let stdout_tail = error
            .output_tails
            .stdout_tail
            .as_deref()
            .expect("failing setup script should capture stdout");
        let setup_script_path = stdout_tail
            .lines()
            .next()
            .expect("setup script should print its temporary path");
        assert!(
            !std::path::Path::new(setup_script_path).exists(),
            "temporary setup script should be removed after failure"
        );
        assert_eq!(
            stdout_tail
                .lines()
                .nth(1)
                .expect("setup script should print stdout marker"),
            "stdout-line"
        );
        assert_eq!(
            error.output_tails.stderr_tail.as_deref(),
            Some("stderr-line")
        );
    }

    #[test]
    fn scrub_snapshot_runtime_artifacts_removes_runtime_directory_and_trust_store_file() {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let temp_root =
            std::env::temp_dir().join(format!("mistle-snapshot-runtime-artifacts-{unique_suffix}"));
        let runtime_directory = temp_root.join("run/mistle");
        let trust_store_certificate_path =
            temp_root.join("usr/local/share/ca-certificates/mistle-egress-proxy-ca.crt");

        std::fs::create_dir_all(runtime_directory.join("sandboxd"))
            .expect("runtime directory should be creatable");
        std::fs::create_dir_all(
            trust_store_certificate_path
                .parent()
                .expect("trust store path should have a parent"),
        )
        .expect("trust store directory should be creatable");
        std::fs::write(runtime_directory.join("init.log"), "diagnostics")
            .expect("runtime diagnostics file should be writable");
        std::fs::write(&trust_store_certificate_path, "cert")
            .expect("trust store certificate should be writable");

        scrub_snapshot_runtime_artifacts_at_paths(
            &runtime_directory,
            &trust_store_certificate_path,
        )
        .expect("snapshot runtime artifacts should scrub cleanly");

        assert!(!runtime_directory.exists());
        assert!(!trust_store_certificate_path.exists());
        std::fs::remove_dir_all(&temp_root).ok();
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
            false,
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
            false,
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
            false,
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
            false,
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
        let apply_runtime_plan_index = phases
            .iter()
            .position(|phase| phase == "apply_runtime_plan")
            .expect("runtime plan phase should be recorded");
        assert!(
            start_tunnel_index < apply_runtime_plan_index,
            "common gateway tunnel must start before runtime plan materialization; phases: {phases:?}"
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
        let (bootstrap_url, gateway_thread) = start_bootstrap_gateway_with_connections(2);
        let git_config_path = std::env::temp_dir().join(format!(
            "mistle-sandboxd-resume-git-config-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let mut state = SandboxdState::initialize(
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
            false,
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
    fn snapshot_materialization_state_rejects_resume() {
        let (bootstrap_url, gateway_thread) = start_snapshot_bootstrap_gateway();
        let mut state = SandboxdState::initialize(
            &build_startup_input(
                StartupMode::New,
                StartupExecutionMode::Snapshot,
                &bootstrap_url,
                minimal_runtime_plan_json(),
                None,
            ),
            Path::new(DEFAULT_GLOBAL_GIT_CONFIG_PATH),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
            None,
            false,
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
        start_bootstrap_gateway_with_connections(1)
    }

    fn start_bootstrap_gateway_with_connections(
        connection_count: usize,
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
                let mut websocket =
                    accept(stream).expect("gateway websocket handshake should succeed");

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
                assert!(
                    saw_runtime_ready,
                    "gateway should observe a runtime.ready publish before tunnel shutdown"
                );
            }
        });

        (bootstrap_url, gateway_thread)
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
        let coordination_thread = spawn_codex_coordination_thread(
            codex_app_server_control_handle,
            codex_proxy.control_handle(),
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

        supervisor_handle
            .mark_component_restarting(SupervisedComponent::CodexProxy, "proxy restart");
        wait_for_runtime_ready_value(&runtime_readiness_manager, false, Duration::from_secs(5));

        shutdown_requested.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = projection_thread.join();
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
            if snapshot.state == expected_state && snapshot.restart_count >= expected_restart_count
            {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "expected {component:?} to reach state {expected_state:?} with restart_count >= {expected_restart_count}, got {snapshot:?}"
            );
            thread::sleep(Duration::from_millis(25));
        }
    }

    fn wait_for_codex_proxy_connected(
        supervisor_handle: &SandboxdSupervisorHandle,
        timeout: Duration,
    ) {
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
}
