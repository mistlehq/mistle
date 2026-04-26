//! Live initialized runtime state owned by the running `sandboxd` daemon.
//!
//! Once the daemon accepts `init`, it needs to own the runtime resources for
//! that sandbox session in one place: runtime-plan materialization, runtime
//! client processes, runtime-specific adapters, and the live bootstrap tunnel
//! session that publishes keepalive and serves tunnel streams.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use url::Url;

use crate::codex_proxy::CodexProxyControlHandle;
use crate::command::{
    CommandFailure, CommandSpec, DEFAULT_COMMAND_POLL_INTERVAL, run_command_with_details,
};
use crate::egress_proxy::EgressProxy;
use crate::keepalive::KeepaliveManager;
use crate::process;
use crate::process::{CodexAppServerControlHandle, CodexAppServerObservationHandle};
use crate::protocol::startup::{StartupExecutionMode, StartupInput, StartupMode};
use crate::pty::{DEFAULT_PTY_SHELL, DEFAULT_PTY_TERM};
use crate::runtime;
use crate::runtime::CompiledRuntimePlanImageSource;
use crate::runtime::RuntimePlanApplyError;
use crate::runtime::adapters::{RuntimeAdapterRegistry, RuntimeAdapters};
use crate::runtime::readiness::{
    RuntimeReadinessManager, RuntimeReadinessMode, derive_runtime_ready,
};
use crate::startup_diagnostics::{
    StartupDiagnosticsLogger, startup_diagnostics_string, startup_diagnostics_u64,
};
use crate::supervision::{SandboxdHealthSnapshot, SandboxdSupervisorHandle, SupervisedComponent};
use crate::time::{Clock, Sleeper};
use crate::tunnel::session::{
    TunnelSession, TunnelSessionError, TunnelSigningRequest, TunnelSigningResponse,
    derive_sandbox_instance_id,
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

const TOKENIZER_PROXY_EGRESS_BASE_URL_ENV: &str = "SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL";
const MANAGED_RUNTIME_PATH_ENV: &str = "PATH";
const MANAGED_RUNTIME_PATH_VALUE: &str =
    "/opt/mistle/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const SETUP_SCRIPT_WORKING_DIRECTORY: &str = "/root";
const SNAPSHOT_RUNTIME_ARTIFACTS_DIRECTORY: &str = "/run/mistle";
const SNAPSHOT_TRUST_STORE_CERT_PATH: &str =
    "/usr/local/share/ca-certificates/mistle-egress-proxy-ca.crt";

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
    clock: Arc<dyn Clock>,
    sleeper: Arc<dyn Sleeper>,
    tunnel_session: Option<TunnelSession>,
}

impl SandboxdState {
    /// Initializes the sandbox runtime from one accepted startup input.
    pub fn initialize(
        startup_input: &StartupInput,
        clock: Arc<dyn Clock>,
        sleeper: Arc<dyn Sleeper>,
        diagnostics_logger: Option<StartupDiagnosticsLogger>,
    ) -> Result<Self, SandboxdStateError> {
        let mut runtime_plan: runtime::CompiledRuntimePlan =
            serde_json::from_value(startup_input.runtime_plan.clone()).map_err(|error| {
                let error_text = error.to_string();
                record_runtime_plan_apply_failure(
                    &diagnostics_logger,
                    &RuntimePlanApplyError::InvalidRuntimePlan(error),
                );
                SandboxdStateError::ApplyRuntimePlan(error_text)
            })?;
        let tokenizer_proxy_egress_base_url = resolve_tokenizer_proxy_egress_base_url()?;
        apply_runtime_startup_overrides(
            &mut runtime_plan,
            startup_input,
            &tokenizer_proxy_egress_base_url,
        )?;
        let uses_pre_materialized_snapshot = startup_input.startup_mode == StartupMode::New
            && startup_input.execution_mode == StartupExecutionMode::Session
            && runtime_plan.image.source == CompiledRuntimePlanImageSource::Snapshot;
        let sandbox_instance_id = derive_sandbox_instance_id(&startup_input.tunnel_gateway_ws_url)
            .map_err(|error| SandboxdStateError::StartTunnelSession(error.to_string()))?;
        let supervisor_handle = SandboxdSupervisorHandle::new(
            sandbox_instance_id,
            clock.clone(),
            collect_tracked_components(&runtime_plan),
        );
        let execution_mode = startup_input.execution_mode;
        record_operation_phase_started(&diagnostics_logger, "apply_git_identity");
        if !startup_input.is_snapshot() {
            runtime::git_identity::apply_git_identity(startup_input).map_err(|error| {
                record_operation_phase_failure(
                    &diagnostics_logger,
                    "apply_git_identity",
                    BTreeMap::from([(
                        "error".to_string(),
                        startup_diagnostics_string(error.clone()),
                    )]),
                );
                SandboxdStateError::ApplyGitIdentity(error)
            })?;
        }
        record_operation_phase_completed(&diagnostics_logger, "apply_git_identity");
        if !uses_pre_materialized_snapshot {
            record_operation_phase_started(&diagnostics_logger, "apply_runtime_plan");
            runtime::apply_compiled_runtime_plan(&runtime_plan).map_err(|error| {
                record_runtime_plan_apply_failure(&diagnostics_logger, &error);
                SandboxdStateError::ApplyRuntimePlan(error.to_string())
            })?;
            record_operation_phase_completed(&diagnostics_logger, "apply_runtime_plan");
        }
        record_operation_phase_started(&diagnostics_logger, "start_egress_proxy");
        let mut egress_proxy = EgressProxy::start(
            &runtime_plan,
            startup_input,
            &tokenizer_proxy_egress_base_url,
            clock.clone(),
            supervisor_handle.clone(),
        )
        .map_err(|error| {
            record_operation_phase_failure(
                &diagnostics_logger,
                "start_egress_proxy",
                BTreeMap::from([(
                    "error".to_string(),
                    startup_diagnostics_string(error.to_string()),
                )]),
            );
            SandboxdStateError::StartEgressProxy(error.to_string())
        })?;
        record_operation_phase_completed(&diagnostics_logger, "start_egress_proxy");
        let runtime_env = collect_runtime_environment(&runtime_plan)
            .map_err(SandboxdStateError::StartRuntimeProcesses)?;
        let runtime_env = merge_managed_runtime_environment(runtime_env, egress_proxy.as_ref())
            .map_err(SandboxdStateError::StartRuntimeProcesses)?;
        if !uses_pre_materialized_snapshot {
            record_operation_phase_started(&diagnostics_logger, "run_setup_script");
            run_setup_script(
                &runtime_plan,
                &runtime_env,
                clock.as_ref(),
                sleeper.as_ref(),
            )
            .map_err(|error| {
                record_setup_script_failure(&diagnostics_logger, &error);
                SandboxdStateError::RunSetupScript(error.message)
            })?;
            record_operation_phase_completed(&diagnostics_logger, "run_setup_script");
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

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
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
                SandboxdStateError::StartRuntimeAdapters(error.to_string())
            })?;
        record_operation_phase_completed(&diagnostics_logger, "start_runtime_adapters");
        let codex_proxy_control_handle = runtime_adapters.codex_proxy_control_handle().cloned();
        let agent_endpoint_url = match runtime_adapters.adapters() {
            [] => None,
            [_adapter] => Some(
                codex_proxy_control_handle
                    .as_ref()
                    .ok_or_else(|| {
                        SandboxdStateError::StartRuntimeAdapters(
                            "sandboxd is missing the typed Codex proxy control handle for the running runtime adapter"
                                .to_string(),
                        )
                    })?
                    .listen_url()
                    .to_string(),
            ),
            _ => {
                record_operation_phase_failure(
                    &diagnostics_logger,
                    "start_tunnel_session",
                    BTreeMap::from([(
                        "error".to_string(),
                        startup_diagnostics_string(
                            "sandboxd currently supports exactly one runtime adapter endpoint",
                        ),
                    )]),
                );
                return Err(SandboxdStateError::StartTunnelSession(
                    "sandboxd currently supports exactly one runtime adapter endpoint".to_string(),
                ));
            }
        };
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

        record_operation_phase_started(&diagnostics_logger, "start_tunnel_session");
        let tunnel_session = Some(
            TunnelSession::start_with_supervisor(
                startup_input,
                keepalive_manager.clone(),
                runtime_readiness_manager.clone(),
                agent_endpoint_url.clone(),
                runtime_env.clone(),
                clock.clone(),
                sleeper.clone(),
                supervisor_handle.clone(),
            )
            .map_err(|error| {
                record_operation_phase_failure(
                    &diagnostics_logger,
                    "start_tunnel_session",
                    BTreeMap::from([(
                        "error".to_string(),
                        startup_diagnostics_string(error.to_string()),
                    )]),
                );
                SandboxdStateError::StartTunnelSession(error.to_string())
            })?,
        );
        record_operation_phase_completed(&diagnostics_logger, "start_tunnel_session");
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
            clock,
            sleeper,
            tunnel_session,
        })
    }

    /// Reconnects the bootstrap tunnel for an already-initialized daemon.
    pub fn resume(
        &mut self,
        startup_input: &StartupInput,
        diagnostics_logger: Option<StartupDiagnosticsLogger>,
    ) -> Result<(), SandboxdStateError> {
        if self.execution_mode == StartupExecutionMode::Snapshot || startup_input.is_snapshot() {
            return Err(SandboxdStateError::StartTunnelSession(
                "snapshot materialization sandboxes do not support resume".to_string(),
            ));
        }

        record_operation_phase_started(&diagnostics_logger, "apply_git_identity");
        runtime::git_identity::apply_git_identity(startup_input).map_err(|error| {
            record_operation_phase_failure(
                &diagnostics_logger,
                "apply_git_identity",
                BTreeMap::from([(
                    "error".to_string(),
                    startup_diagnostics_string(error.clone()),
                )]),
            );
            SandboxdStateError::ApplyGitIdentity(error)
        })?;
        record_operation_phase_completed(&diagnostics_logger, "apply_git_identity");
        if let Some(tunnel_session) = self.tunnel_session.take() {
            tunnel_session.close();
        }

        let agent_endpoint_url =
            if let Some(codex_proxy_control_handle) = &self.codex_proxy_control_handle {
                Some(codex_proxy_control_handle.listen_url().to_string())
            } else {
                self.agent_endpoint_url.clone()
            };

        record_operation_phase_started(&diagnostics_logger, "start_tunnel_session");
        self.tunnel_session = Some(
            TunnelSession::start_with_supervisor(
                startup_input,
                self.keepalive_manager.clone(),
                self.runtime_readiness_manager.clone(),
                agent_endpoint_url,
                self.runtime_env.clone(),
                self.clock.clone(),
                self.sleeper.clone(),
                self.supervisor_handle.clone(),
            )
            .map_err(|error| {
                record_operation_phase_failure(
                    &diagnostics_logger,
                    "start_tunnel_session",
                    BTreeMap::from([(
                        "error".to_string(),
                        startup_diagnostics_string(error.to_string()),
                    )]),
                );
                SandboxdStateError::StartTunnelSession(error.to_string())
            })?,
        );
        record_operation_phase_completed(&diagnostics_logger, "start_tunnel_session");

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

fn record_operation_phase_failure(
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
    phase: &str,
    attributes: BTreeMap<String, serde_json::Value>,
) {
    if let Some(logger) = diagnostics_logger
        && let Err(error) = logger.record_phase_failed(phase, attributes)
    {
        eprintln!("sandboxd failed to record startup diagnostics phase failure: {error}");
    }
}

fn record_operation_phase_started(
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
    phase: &str,
) {
    if let Some(logger) = diagnostics_logger
        && let Err(error) = logger.record_phase_started(phase)
    {
        eprintln!("sandboxd failed to record startup diagnostics phase start: {error}");
    }
}

fn record_operation_phase_completed(
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
    phase: &str,
) {
    if let Some(logger) = diagnostics_logger
        && let Err(error) = logger.record_phase_completed(phase)
    {
        eprintln!("sandboxd failed to record startup diagnostics phase completion: {error}");
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

    tracked_components
}

fn resolve_tokenizer_proxy_egress_base_url() -> Result<String, SandboxdStateError> {
    std::env::var(TOKENIZER_PROXY_EGRESS_BASE_URL_ENV).map_err(|_| {
        SandboxdStateError::StartRuntimeProcesses(format!(
            "required sandbox env '{TOKENIZER_PROXY_EGRESS_BASE_URL_ENV}' is missing"
        ))
    })
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
    let mut managed_env = BTreeMap::from([(
        MANAGED_RUNTIME_PATH_ENV.to_string(),
        MANAGED_RUNTIME_PATH_VALUE.to_string(),
    )]);
    if let Some(egress_proxy) = egress_proxy {
        for (name, value) in egress_proxy.runtime_env() {
            managed_env.insert(name.clone(), value.clone());
        }
    }

    for (name, value) in managed_env {
        match runtime_env.get(&name) {
            Some(existing_value) if existing_value != &value => {
                return Err(format!(
                    "runtime plan artifacts define managed env '{name}', which sandboxd reserves"
                ));
            }
            Some(_) => {}
            None => {
                runtime_env.insert(name, value);
            }
        }
    }

    Ok(runtime_env)
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
    run_setup_script_in_directory(
        runtime_plan,
        runtime_env,
        SETUP_SCRIPT_WORKING_DIRECTORY,
        clock,
        sleeper,
    )
}

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
    let Some(setup_script) = runtime_plan.setup_script.as_ref() else {
        return Ok(());
    };
    if setup_script.trim().is_empty() {
        return Ok(());
    }

    let shell_args = vec![
        DEFAULT_PTY_SHELL.to_string(),
        "-lc".to_string(),
        setup_script.clone(),
    ];
    let environment = build_setup_script_environment(runtime_env);

    run_command_with_details(
        CommandSpec {
            args: &shell_args,
            env: Some(&environment),
            cwd: Some(working_directory),
            timeout_ms: None,
        },
        clock,
        sleeper,
        DEFAULT_COMMAND_POLL_INTERVAL,
    )
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

fn apply_runtime_startup_overrides(
    runtime_plan: &mut runtime::CompiledRuntimePlan,
    startup_input: &StartupInput,
    tokenizer_proxy_egress_base_url: &str,
) -> Result<(), SandboxdStateError> {
    for workspace_source in &mut runtime_plan.workspace_sources {
        apply_workspace_source_startup_overrides(
            workspace_source,
            &runtime_plan.egress_routes,
            &startup_input.egress_grant_by_rule_id,
            tokenizer_proxy_egress_base_url,
        )?;
    }

    Ok(())
}

fn apply_workspace_source_startup_overrides(
    workspace_source: &mut runtime::CompiledWorkspaceSource,
    egress_routes: &[runtime::CompiledEgressRoute],
    egress_grant_by_rule_id: &std::collections::BTreeMap<String, String>,
    tokenizer_proxy_egress_base_url: &str,
) -> Result<(), SandboxdStateError> {
    match workspace_source {
        runtime::CompiledWorkspaceSource::GitClone {
            path,
            origin_url,
            clone_url,
            egress_grant_token,
            ..
        } => {
            let route = resolve_workspace_source_egress_route(origin_url, egress_routes).ok_or_else(
                || {
                    SandboxdStateError::StartRuntimeProcesses(format!(
                        "workspace source '{path}' must resolve exactly one egress route for '{origin_url}'"
                    ))
                },
            )?;
            let egress_grant = egress_grant_by_rule_id
                .get(&route.egress_rule_id)
                .ok_or_else(|| {
                    SandboxdStateError::StartRuntimeProcesses(format!(
                        "missing egress grant for route '{}'",
                        route.egress_rule_id
                    ))
                })?;
            *clone_url = Some(
                resolve_tokenizer_proxy_forward_url(tokenizer_proxy_egress_base_url, origin_url)
                    .map_err(SandboxdStateError::StartRuntimeProcesses)?,
            );
            *egress_grant_token = Some(egress_grant.clone());
        }
    }

    Ok(())
}

fn resolve_tokenizer_proxy_forward_url(
    tokenizer_proxy_egress_base_url: &str,
    forward_url: &str,
) -> Result<String, String> {
    let mut tokenizer_proxy_url = Url::parse(tokenizer_proxy_egress_base_url).map_err(|error| {
        format!(
            "sandbox tokenizer proxy egress base url '{tokenizer_proxy_egress_base_url}' is invalid: {error}"
        )
    })?;
    let forward_url = Url::parse(forward_url).map_err(|error| {
        format!("workspace source origin url '{forward_url}' is invalid: {error}")
    })?;

    tokenizer_proxy_url.set_path(&join_url_path(
        tokenizer_proxy_url.path(),
        forward_url.path(),
    ));
    tokenizer_proxy_url.set_query(forward_url.query());
    tokenizer_proxy_url.set_fragment(None);

    Ok(tokenizer_proxy_url.to_string())
}

fn resolve_workspace_source_egress_route<'a>(
    origin_url: &str,
    egress_routes: &'a [runtime::CompiledEgressRoute],
) -> Option<&'a runtime::CompiledEgressRoute> {
    let origin_url = Url::parse(origin_url).ok()?;
    let origin_host = origin_url.host_str()?;
    let origin_path = origin_url.path();
    let matching_routes = egress_routes
        .iter()
        .filter(|route| {
            route.r#match.hosts.iter().any(|host| host == origin_host)
                && route
                    .r#match
                    .path_prefixes
                    .as_ref()
                    .is_some_and(|path_prefixes| {
                        path_prefixes
                            .iter()
                            .any(|path_prefix| origin_path.starts_with(path_prefix))
                    })
        })
        .collect::<Vec<_>>();

    let [route] = matching_routes.as_slice() else {
        return None;
    };

    Some(*route)
}

fn join_url_path(base_path: &str, suffix_path: &str) -> String {
    let normalized_base_path = base_path.strip_suffix('/').unwrap_or(base_path);
    let normalized_suffix_path = suffix_path.strip_prefix('/').unwrap_or(suffix_path);

    if normalized_base_path.is_empty() || normalized_base_path == "/" {
        if normalized_suffix_path.is_empty() {
            return "/".to_string();
        }

        return format!("/{normalized_suffix_path}");
    }

    if normalized_suffix_path.is_empty() {
        return normalized_base_path.to_string();
    }

    format!("{normalized_base_path}/{normalized_suffix_path}")
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};
    use std::net::TcpListener;
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
        CompiledRuntimePlan, RuntimeClient, RuntimeClientEndpoint, RuntimeClientEndpointTransport,
        RuntimeClientProcess, RuntimeClientProcessReadiness, RuntimeClientProcessStopPolicy,
        RuntimeClientProcessStopSignal, RuntimeClientSetup, RuntimeClientSetupFile,
        RuntimeExecCommand,
    };
    use crate::sandboxd_state::{
        MANAGED_RUNTIME_PATH_ENV, MANAGED_RUNTIME_PATH_VALUE, SETUP_SCRIPT_WORKING_DIRECTORY,
        SandboxdState, TOKENIZER_PROXY_EGRESS_BASE_URL_ENV, apply_runtime_startup_overrides,
        build_setup_script_environment, collect_runtime_environment,
        merge_managed_runtime_environment, run_setup_script, run_setup_script_in_directory,
        scrub_snapshot_runtime_artifacts_at_paths, spawn_codex_coordination_thread,
        spawn_runtime_readiness_projection_thread,
    };
    use crate::supervision::{ComponentHealthState, SandboxdSupervisorHandle, SupervisedComponent};
    use crate::test_support::TestEnvVarGuard;
    use crate::time::{SystemClock, ThreadSleeper};

    #[test]
    fn preserves_codex_runtime_client_config_while_rewriting_workspace_sources() {
        let mut runtime_plan = CompiledRuntimePlan {
            image: test_runtime_plan_image(crate::runtime::CompiledRuntimePlanImageSource::Base),
            setup_script: None,
            egress_routes: vec![
                crate::runtime::CompiledEgressRoute {
                    egress_rule_id: "egress_rule_bind_openai_agent".to_string(),
                    binding_id: "bind_openai_agent".to_string(),
                    family_id: "openai".to_string(),
                    variant_id: "openai-default".to_string(),
                    r#match: crate::runtime::CompiledEgressRouteMatch {
                        hosts: vec!["api.openai.com".to_string()],
                        path_prefixes: Some(vec!["/v1/responses".to_string()]),
                        methods: Some(vec!["POST".to_string()]),
                    },
                    upstream: crate::runtime::CompiledEgressRouteUpstream {
                        base_url: "https://api.openai.com/v1".to_string(),
                    },
                    auth_injection: crate::runtime::CompiledEgressRouteAuthInjection {
                        r#type: crate::runtime::CompiledEgressRouteAuthInjectionType::Bearer,
                        target: Some("authorization".to_string()),
                        username: None,
                        service: None,
                        region: None,
                    },
                    additional_headers: None,
                    additional_credential_headers: None,
                    credential_resolver:
                        crate::runtime::CompiledEgressRouteCredentialResolver::IntegrationConnection {
                        connection_id: "icn_test".to_string(),
                        secret_type: "api_key".to_string(),
                        slot_key: None,
                        resolver_key: None,
                    },
                    request_middleware: None,
                },
                crate::runtime::CompiledEgressRoute {
                    egress_rule_id: "egress_rule_bind_github".to_string(),
                    binding_id: "bind_github".to_string(),
                    family_id: "github".to_string(),
                    variant_id: "github-default".to_string(),
                    r#match: crate::runtime::CompiledEgressRouteMatch {
                        hosts: vec!["github.com".to_string()],
                        path_prefixes: Some(vec!["/mistlehq/private-repo.git".to_string()]),
                        methods: Some(vec!["GET".to_string(), "POST".to_string()]),
                    },
                    upstream: crate::runtime::CompiledEgressRouteUpstream {
                        base_url: "https://github.com".to_string(),
                    },
                    auth_injection: crate::runtime::CompiledEgressRouteAuthInjection {
                        r#type: crate::runtime::CompiledEgressRouteAuthInjectionType::Basic,
                        target: Some("authorization".to_string()),
                        username: Some("x-access-token".to_string()),
                        service: None,
                        region: None,
                    },
                    additional_headers: None,
                    additional_credential_headers: None,
                    credential_resolver:
                        crate::runtime::CompiledEgressRouteCredentialResolver::IntegrationConnection {
                        connection_id: "icn_github".to_string(),
                        secret_type: "github_app_installation_token".to_string(),
                        slot_key: None,
                        resolver_key: Some("github_app_installation_token".to_string()),
                    },
                    request_middleware: None,
                },
            ],
            artifacts: Vec::new(),
            workspace_sources: vec![crate::runtime::CompiledWorkspaceSource::GitClone {
                resource_kind: crate::runtime::WorkspaceSourceResourceKind::Repository,
                path: "/workspace/mistlehq/private-repo".to_string(),
                origin_url: "https://github.com/mistlehq/private-repo.git".to_string(),
                clone_url: None,
                egress_grant_token: None,
            }],
            runtime_clients: vec![RuntimeClient {
                client_id: "codex-cli".to_string(),
                setup: RuntimeClientSetup {
                    env: BTreeMap::new(),
                    files: vec![RuntimeClientSetupFile {
                        file_id: "codex_config".to_string(),
                        path: "/etc/codex/config.toml".to_string(),
                        mode: 0o600,
                        content: r#"
model = "gpt-5.4-codex"
model_provider = "proxy"

[model_providers.proxy]
name = "OpenAI"
base_url = "https://api.openai.com/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
"#
                        .trim()
                        .to_string(),
                        write_mode: None,
                    }],
                    launch_args: None,
                },
                processes: vec![RuntimeClientProcess {
                    process_key: "codex-app-server".to_string(),
                    command: crate::runtime::RuntimeExecCommand {
                        args: vec![
                            "/usr/local/bin/codex".to_string(),
                            "app-server".to_string(),
                            "--listen".to_string(),
                            "ws://127.0.0.1:4501".to_string(),
                        ],
                        env: None,
                        cwd: None,
                        timeout_ms: None,
                    },
                    readiness: RuntimeClientProcessReadiness::Ws {
                        url: "ws://127.0.0.1:4501".to_string(),
                        timeout_ms: 5_000,
                    },
                    stop: RuntimeClientProcessStopPolicy {
                        signal: RuntimeClientProcessStopSignal::Sigterm,
                        timeout_ms: 10_000,
                        grace_period_ms: Some(2_000),
                    },
                }],
                endpoints: vec![RuntimeClientEndpoint {
                    endpoint_key: "app-server".to_string(),
                    process_key: Some("codex-app-server".to_string()),
                    transport: RuntimeClientEndpointTransport::Ws {
                        url: "ws://127.0.0.1:4500".to_string(),
                    },
                    connection_mode: crate::runtime::RuntimeClientConnectionMode::Dedicated,
                }],
            }],
            agent_runtimes: vec![crate::runtime::CompiledAgentRuntime {
                binding_id: "bind_openai_agent".to_string(),
                runtime_id: "codex".to_string(),
                runtime_key: "codex-app-server".to_string(),
                client_id: "codex-cli".to_string(),
                endpoint_key: "app-server".to_string(),
                pty_launch: serde_json::json!({}),
            }],
        };
        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: "ws://127.0.0.1:5000/bootstrap".to_string(),
            runtime_plan: serde_json::json!({
                "egressRoutes": [
                    {
                        "egressRuleId": "egress_rule_bind_openai_agent",
                        "bindingId": "bind_openai_agent",
                        "upstream": {
                            "baseUrl": "https://api.openai.com/v1"
                        }
                    },
                    {
                        "egressRuleId": "egress_rule_bind_github",
                        "bindingId": "bind_github",
                        "upstream": {
                            "baseUrl": "https://github.com"
                        }
                    }
                ],
                "artifacts": [],
                "workspaceSources": [
                    {
                        "sourceKind": "git-clone",
                        "resourceKind": "repository",
                        "path": "/workspace/mistlehq/private-repo",
                        "originUrl": "https://github.com/mistlehq/private-repo.git"
                    }
                ],
                "runtimeClients": [
                    {
                        "clientId": "codex-cli",
                        "setup": {
                            "env": {},
                            "files": []
                        },
                        "processes": [
                            {
                                "processKey": "codex-app-server",
                                "command": {
                                    "args": [
                                        "/usr/local/bin/codex",
                                        "app-server",
                                        "--listen",
                                        "ws://127.0.0.1:4501"
                                    ]
                                },
                                "readiness": {
                                    "type": "ws",
                                    "url": "ws://127.0.0.1:4501",
                                    "timeoutMs": 5000
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
                                "processKey": "codex-app-server",
                                "transport": {
                                    "type": "ws",
                                    "url": "ws://127.0.0.1:4500"
                                },
                                "connectionMode": "dedicated"
                            }
                        ]
                    }
                ],
                "agentRuntimes": [
                    {
                        "bindingId": "bind_openai_agent",
                        "runtimeId": "codex",
                        "runtimeKey": "codex-app-server",
                        "clientId": "codex-cli",
                        "endpointKey": "app-server",
                        "ptyLaunch": {}
                    }
                ]
            }),
            egress_grant_by_rule_id: BTreeMap::from([
                (
                    "egress_rule_bind_openai_agent".to_string(),
                    "signed-egress-grant".to_string(),
                ),
                (
                    "egress_rule_bind_github".to_string(),
                    "signed-github-egress-grant".to_string(),
                ),
            ]),
            git_identity: None,
        };
        let original_config = runtime_plan
            .runtime_clients
            .first()
            .expect("runtime client should exist")
            .setup
            .files
            .first()
            .expect("codex config file should exist")
            .content
            .clone();

        apply_runtime_startup_overrides(
            &mut runtime_plan,
            &startup_input,
            "http://127.0.0.1:5205/tokenizer-proxy/egress",
        )
        .expect("workspace source startup overrides should apply");

        let runtime_client = runtime_plan
            .runtime_clients
            .first()
            .expect("runtime client should exist");
        let config = &runtime_client
            .setup
            .files
            .first()
            .expect("codex config file should exist")
            .content;
        assert_eq!(config, &original_config);
        let workspace_source = runtime_plan
            .workspace_sources
            .first()
            .expect("workspace source should exist");
        let (
            workspace_source_origin_url,
            workspace_source_clone_url,
            workspace_source_egress_grant_token,
        ) = match workspace_source {
            crate::runtime::CompiledWorkspaceSource::GitClone {
                origin_url,
                clone_url,
                egress_grant_token,
                ..
            } => (origin_url, clone_url, egress_grant_token),
        };
        assert_eq!(
            workspace_source_origin_url,
            "https://github.com/mistlehq/private-repo.git"
        );
        assert_eq!(
            workspace_source_clone_url,
            &Some(
                "http://127.0.0.1:5205/tokenizer-proxy/egress/mistlehq/private-repo.git"
                    .to_string()
            )
        );
        assert_eq!(
            workspace_source_egress_grant_token,
            &Some("signed-github-egress-grant".to_string())
        );
    }

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
    fn merges_managed_runtime_path_into_runtime_environment() {
        let runtime_env = merge_managed_runtime_environment(BTreeMap::new(), None)
            .expect("managed runtime env should merge");

        assert_eq!(
            runtime_env.get(MANAGED_RUNTIME_PATH_ENV),
            Some(&MANAGED_RUNTIME_PATH_VALUE.to_string())
        );
    }

    #[test]
    fn rejects_conflicting_managed_runtime_path_values() {
        let error = merge_managed_runtime_environment(
            BTreeMap::from([(
                MANAGED_RUNTIME_PATH_ENV.to_string(),
                "/usr/local/bin:/usr/bin:/bin".to_string(),
            )]),
            None,
        )
        .expect_err("conflicting managed path should fail fast");

        assert_eq!(
            error,
            "runtime plan artifacts define managed env 'PATH', which sandboxd reserves"
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
                "printf '%s\\n' \"$TERM\" > {path}; printf '%s\\n' \"$MISTLE_TEST_ENV\" >> {path}; pwd >> {path}",
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
        let canonical_working_directory = std::fs::canonicalize(&working_directory)
            .expect("working directory should canonicalize");
        assert_eq!(
            output,
            format!(
                "xterm-256color\nruntime-value\n{}\n",
                canonical_working_directory.display()
            )
        );

        let _ = std::fs::remove_file(output_path);
        let _ = std::fs::remove_dir_all(working_directory);
    }

    #[test]
    fn run_setup_script_captures_stdout_and_stderr_on_failure() {
        let runtime_plan = CompiledRuntimePlan {
            image: test_runtime_plan_image(crate::runtime::CompiledRuntimePlanImageSource::Base),
            setup_script: Some(
                "printf 'stdout-line'; printf 'stderr-line' >&2; exit 17".to_string(),
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
        assert_eq!(
            error.output_tails.stdout_tail.as_deref(),
            Some("stdout-line")
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
        let _tokenizer_proxy_env_guard =
            TestEnvVarGuard::set(TOKENIZER_PROXY_EGRESS_BASE_URL_ENV, "http://127.0.0.1:5205");
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
                "ws://127.0.0.1:9/bootstrap",
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
                            "bindingId": "arb_123",
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
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
            None,
        )
        .expect("snapshot materialization init should succeed after static runtime-plan setup");

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
    fn snapshot_materialization_state_rejects_resume() {
        let _tokenizer_proxy_env_guard =
            TestEnvVarGuard::set(TOKENIZER_PROXY_EGRESS_BASE_URL_ENV, "http://127.0.0.1:5205");
        let mut state = SandboxdState::initialize(
            &build_startup_input(
                StartupMode::New,
                StartupExecutionMode::Snapshot,
                "ws://127.0.0.1:9/bootstrap",
                minimal_runtime_plan_json(),
                None,
            ),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
            None,
        )
        .expect("snapshot materialization init should succeed");

        let error = state
            .resume(
                &build_startup_input(
                    StartupMode::Existing,
                    StartupExecutionMode::Session,
                    "ws://127.0.0.1:9/bootstrap",
                    minimal_runtime_plan_json(),
                    None,
                ),
                None,
            )
            .expect_err("snapshot materialization state should reject resume");

        assert_eq!(
            error.to_string(),
            "failed to start bootstrap tunnel session: snapshot materialization sandboxes do not support resume"
        );
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
        StartupInput {
            startup_mode,
            execution_mode,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: tunnel_gateway_ws_url.to_string(),
            runtime_plan,
            egress_grant_by_rule_id: BTreeMap::new(),
            git_identity,
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
