//! Manager for the runtime client processes declared by the compiled plan.
//!
//! The manager flattens runtime clients into concrete process specs, starts
//! them through the shared lifecycle helpers, and installs per-runtime
//! component supervisors where a process needs ongoing health management.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use std::path::{Path, PathBuf};

use crate::cgroups::create_platform_scope;
use crate::process::*;
use crate::runtime::{RuntimeClient, RuntimeExecCommand};
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};
use crate::time::SystemClock;
use crate::time::{Clock, Sleeper};

/// Flattens runtime clients into the concrete process specs that need supervision.
pub fn flatten_runtime_client_processes(
    runtime_clients: &[RuntimeClient],
    runtime_env: &BTreeMap<String, String>,
) -> Vec<RuntimeClientProcessSpec> {
    let mut processes = Vec::new();

    for runtime_client in runtime_clients {
        for process in &runtime_client.processes {
            let merged_env = merge_runtime_client_process_env(
                runtime_env,
                &runtime_client.setup.env,
                process.command.env.as_ref(),
            );
            processes.push(RuntimeClientProcessSpec {
                process_key: process.process_key.clone(),
                command: RuntimeExecCommand {
                    args: process.command.args.clone(),
                    env: merged_env,
                    cwd: process.command.cwd.clone(),
                    timeout_ms: process.command.timeout_ms,
                },
                readiness: process.readiness.clone(),
                stop: process.stop.clone(),
            });
        }
    }

    processes
}

/// Starts every runtime client process and waits for each declared readiness check.
pub fn start_runtime_client_process_manager(
    process_specs: &[RuntimeClientProcessSpec],
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<RuntimeClientProcessManager, ProcessManagerError> {
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandboxd-process-manager",
        Arc::new(SystemClock),
        BTreeSet::new(),
    );

    start_runtime_client_process_manager_with_supervisor(
        process_specs,
        clock,
        sleeper,
        supervisor_handle,
    )
}

/// Starts every runtime client process using the shared supervisor boundary.
pub fn start_runtime_client_process_manager_with_supervisor(
    process_specs: &[RuntimeClientProcessSpec],
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
    supervisor_handle: SandboxdSupervisorHandle,
) -> Result<RuntimeClientProcessManager, ProcessManagerError> {
    start_runtime_client_process_manager_with_supervisor_and_observer(
        process_specs,
        clock,
        sleeper,
        supervisor_handle,
        None,
    )
}

/// Starts every runtime client process using the shared supervisor boundary and lifecycle observer.
pub fn start_runtime_client_process_manager_with_supervisor_and_observer(
    process_specs: &[RuntimeClientProcessSpec],
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
    supervisor_handle: SandboxdSupervisorHandle,
    observer: Option<&dyn RuntimeClientProcessObserver>,
) -> Result<RuntimeClientProcessManager, ProcessManagerError> {
    start_runtime_client_process_manager_with_supervisor_observer_and_platform_scopes(
        process_specs,
        clock,
        sleeper,
        supervisor_handle,
        observer,
        None,
    )
}

/// Starts every runtime client process and attaches it to platform process cgroups.
pub fn start_runtime_client_process_manager_with_platform_scopes(
    process_specs: &[RuntimeClientProcessSpec],
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
    supervisor_handle: SandboxdSupervisorHandle,
    observer: Option<&dyn RuntimeClientProcessObserver>,
    platform_scope_input: PlatformProcessScopeInput,
) -> Result<RuntimeClientProcessManager, ProcessManagerError> {
    start_runtime_client_process_manager_with_supervisor_observer_and_platform_scopes(
        process_specs,
        clock,
        sleeper,
        supervisor_handle,
        observer,
        Some(platform_scope_input),
    )
}

pub struct PlatformProcessScopeInput {
    pub cgroup_root: PathBuf,
    pub sandbox_instance_id: String,
    pub registry: PlatformProcessRegistry,
}

fn start_runtime_client_process_manager_with_supervisor_observer_and_platform_scopes(
    process_specs: &[RuntimeClientProcessSpec],
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
    supervisor_handle: SandboxdSupervisorHandle,
    observer: Option<&dyn RuntimeClientProcessObserver>,
    platform_scope_input: Option<PlatformProcessScopeInput>,
) -> Result<RuntimeClientProcessManager, ProcessManagerError> {
    let mut started_processes = Vec::new();
    let mut codex_app_server_observation_handle = None;
    let mut codex_app_server_control_handle = None;
    let mut opencode_server_control_handle = None;
    let monitor_shutdown_requested = Arc::new(AtomicBool::new(false));
    let mut monitor_threads = Vec::new();

    for (process_index, process_spec) in process_specs.iter().enumerate() {
        if is_codex_app_server_process(process_spec)
            && supervisor_handle.tracks_component(SupervisedComponent::CodexAppServer)
        {
            supervisor_handle.replace_component_details(
                SupervisedComponent::CodexAppServer,
                codex_app_server_details_with_status(
                    process_spec,
                    None,
                    None,
                    "Starting",
                    "Starting",
                ),
            );
            supervisor_handle.mark_component_starting(SupervisedComponent::CodexAppServer);
            codex_app_server_observation_handle = Some(CodexAppServerObservationHandle {
                state: Arc::new(Mutex::new(CodexAppServerObservation {
                    process_key: process_spec.process_key.clone(),
                    pid: None,
                    readiness_url: codex_app_server_readiness_url(process_spec),
                    is_alive: false,
                    last_exit_status: None,
                })),
            });
        }
        if is_opencode_server_process(process_spec)
            && supervisor_handle.tracks_component(SupervisedComponent::OpenCodeServer)
        {
            supervisor_handle.replace_component_details(
                SupervisedComponent::OpenCodeServer,
                opencode_server_details_with_status(
                    process_spec,
                    None,
                    None,
                    "Starting",
                    "Starting",
                ),
            );
            supervisor_handle.mark_component_starting(SupervisedComponent::OpenCodeServer);
        }
        if let Some(observer) = observer {
            observer.record_process_started(process_spec);
        }
        let platform_scope = match platform_scope_input.as_ref() {
            Some(input) => match create_runtime_client_process_platform_scope(
                &input.cgroup_root,
                &input.sandbox_instance_id,
                process_index,
                process_spec,
                &input.registry,
            ) {
                Ok(platform_scope) => Some(platform_scope),
                Err(error) => {
                    stop_process_monitor_threads(&monitor_shutdown_requested, &mut monitor_threads);
                    let _ = stop_started_processes_and_platform_scopes(
                        &mut started_processes,
                        clock,
                        sleeper,
                    );
                    return Err(ProcessManagerError::StartProcess {
                        process_index,
                        process_key: process_spec.process_key.clone(),
                        error,
                        output_tails: Box::default(),
                    });
                }
            },
            None => None,
        };

        let process_start_result = match platform_scope {
            Some(platform_scope) => {
                start_scoped_runtime_client_process(process_spec, platform_scope)
            }
            None => start_runtime_client_process(process_spec),
        };
        let mut process = match process_start_result {
            Ok(process) => process,
            Err(error) => {
                stop_process_monitor_threads(&monitor_shutdown_requested, &mut monitor_threads);
                let _ = stop_started_processes_and_platform_scopes(
                    &mut started_processes,
                    clock,
                    sleeper,
                );
                return Err(ProcessManagerError::StartProcess {
                    process_index,
                    process_key: process_spec.process_key.clone(),
                    error,
                    output_tails: Box::default(),
                });
            }
        };

        if let Err(error) = wait_for_runtime_client_process_readiness(&mut process, clock, sleeper)
        {
            stop_process_monitor_threads(&monitor_shutdown_requested, &mut monitor_threads);
            let _ =
                stop_started_processes_and_platform_scopes(&mut started_processes, clock, sleeper);
            let _ = stop_runtime_client_process_and_platform_scope(&mut process, clock, sleeper);
            return Err(ProcessManagerError::ReadinessCheck {
                process_index,
                process_key: process_spec.process_key.clone(),
                error,
                details: Box::new(ProcessReadinessFailureDetails {
                    readiness_type: readiness_type(process_spec).to_string(),
                    readiness_target: readiness_target(process_spec),
                    timeout_ms: readiness_timeout_ms(process_spec),
                    output_tails: process.output_capture.collect_tails_after_process_exit(),
                }),
            });
        }

        if is_codex_app_server_process(process_spec)
            && supervisor_handle.tracks_component(SupervisedComponent::CodexAppServer)
        {
            if let Some(observation_handle) = &codex_app_server_observation_handle {
                update_codex_app_server_observation(
                    observation_handle,
                    process_spec,
                    Some(process.pid()),
                    true,
                    None,
                );
            }
            supervisor_handle.replace_component_details(
                SupervisedComponent::CodexAppServer,
                codex_app_server_details_with_status(
                    process_spec,
                    Some(process.pid()),
                    None,
                    "Alive",
                    "Ready",
                ),
            );
            supervisor_handle.mark_component_healthy(SupervisedComponent::CodexAppServer);
            if let Some(observation_handle) = &codex_app_server_observation_handle {
                codex_app_server_control_handle = Some(CodexAppServerControlHandle {
                    managed_process: Arc::new(ManagedCodexAppServerProcess {
                        spec: process_spec.clone(),
                        child: process.child.clone(),
                        output_capture: process.output_capture.clone(),
                        platform_scope: process.platform_scope.clone(),
                        observation_handle: observation_handle.clone(),
                        supervisor_handle: supervisor_handle.clone(),
                        restart_lock: Mutex::new(()),
                        restart_in_progress: AtomicBool::new(false),
                    }),
                });
            }
        }
        if is_opencode_server_process(process_spec)
            && supervisor_handle.tracks_component(SupervisedComponent::OpenCodeServer)
        {
            let control_handle = OpenCodeServerControlHandle {
                managed_process: Arc::new(ManagedOpenCodeServerProcess {
                    spec: process_spec.clone(),
                    child: process.child.clone(),
                    output_capture: process.output_capture.clone(),
                    platform_scope: process.platform_scope.clone(),
                    supervisor_handle: supervisor_handle.clone(),
                    restart_lock: Mutex::new(()),
                    restart_in_progress: AtomicBool::new(false),
                }),
            };
            supervisor_handle.replace_component_details(
                SupervisedComponent::OpenCodeServer,
                opencode_server_details_with_status(
                    process_spec,
                    Some(process.pid()),
                    None,
                    "Alive",
                    "Ready",
                ),
            );
            supervisor_handle.mark_component_healthy(SupervisedComponent::OpenCodeServer);
            monitor_threads.push(spawn_opencode_server_monitor(
                control_handle.clone(),
                monitor_shutdown_requested.clone(),
            ));
            opencode_server_control_handle = Some(control_handle);
        }

        if let Some(observer) = observer {
            observer.record_process_completed(process_spec);
        }
        started_processes.push(process);
    }

    if let Some(control_handle) = codex_app_server_control_handle.clone() {
        monitor_threads.push(spawn_codex_app_server_monitor(
            control_handle,
            monitor_shutdown_requested.clone(),
        ));
    }

    Ok(RuntimeClientProcessManager {
        processes: started_processes,
        codex_app_server_observation_handle,
        codex_app_server_control_handle,
        opencode_server_control_handle,
        monitor_shutdown_requested,
        monitor_threads,
        supervisor_handle,
    })
}

fn create_runtime_client_process_platform_scope(
    cgroup_root: &Path,
    sandbox_instance_id: &str,
    process_index: usize,
    process_spec: &RuntimeClientProcessSpec,
    registry: &PlatformProcessRegistry,
) -> Result<RuntimeClientProcessPlatformScope, String> {
    let scope_id = format!("runtime-{process_index}");
    let scope_paths = create_platform_scope(cgroup_root, sandbox_instance_id, &scope_id)
        .map_err(|error| error.to_string())?;

    Ok(RuntimeClientProcessPlatformScope {
        registry_key: scope_id,
        process_key: process_spec.process_key.clone(),
        scope_paths,
        registry: registry.clone(),
    })
}

impl RuntimeClientProcessManager {
    pub fn codex_app_server_observation_handle(&self) -> Option<&CodexAppServerObservationHandle> {
        self.codex_app_server_observation_handle.as_ref()
    }

    pub fn codex_app_server_control_handle(&self) -> Option<&CodexAppServerControlHandle> {
        self.codex_app_server_control_handle.as_ref()
    }

    pub fn opencode_server_control_handle(&self) -> Option<&OpenCodeServerControlHandle> {
        self.opencode_server_control_handle.as_ref()
    }

    /// Stops all managed processes in reverse start order using their stop policies.
    pub fn stop(
        mut self,
        clock: &dyn Clock,
        sleeper: &dyn Sleeper,
    ) -> Result<(), ProcessManagerError> {
        self.monitor_shutdown_requested
            .store(true, Ordering::Relaxed);
        join_process_monitor_threads(&mut self.monitor_threads);
        let mut stop_errors = Vec::new();
        if let Err(error) = stop_started_processes(&mut self.processes, clock, sleeper) {
            stop_errors.push(error);
        }
        for process in &self.processes {
            if let Err(error) = kill_runtime_client_process_platform_scope(process) {
                stop_errors.push(format!(
                    "platform scope processKey={}: {error}",
                    process.spec.process_key
                ));
            }
        }
        if !stop_errors.is_empty() {
            return Err(ProcessManagerError::StopProcesses(stop_errors.join("; ")));
        }
        if self
            .supervisor_handle
            .tracks_component(SupervisedComponent::CodexAppServer)
        {
            self.supervisor_handle
                .mark_component_stopped(SupervisedComponent::CodexAppServer);
        }
        if self
            .supervisor_handle
            .tracks_component(SupervisedComponent::OpenCodeServer)
        {
            self.supervisor_handle
                .mark_component_stopped(SupervisedComponent::OpenCodeServer);
        }
        Ok(())
    }
}

fn stop_process_monitor_threads(
    monitor_shutdown_requested: &AtomicBool,
    monitor_threads: &mut Vec<JoinHandle<()>>,
) {
    monitor_shutdown_requested.store(true, Ordering::Relaxed);
    join_process_monitor_threads(monitor_threads);
}

fn join_process_monitor_threads(monitor_threads: &mut Vec<JoinHandle<()>>) {
    while let Some(monitor_thread) = monitor_threads.pop() {
        let _ = monitor_thread.join();
    }
}

fn stop_started_processes_and_platform_scopes(
    processes: &mut [RunningRuntimeClientProcess],
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<(), String> {
    let mut stop_errors = Vec::new();

    if let Err(error) = stop_started_processes(processes, clock, sleeper) {
        stop_errors.push(error);
    }
    for process in processes.iter().rev() {
        if let Err(error) = kill_runtime_client_process_platform_scope(process) {
            stop_errors.push(format!(
                "platform scope processKey={}: {error}",
                process.spec.process_key
            ));
        }
    }

    if stop_errors.is_empty() {
        return Ok(());
    }

    Err(stop_errors.join("; "))
}

fn stop_runtime_client_process_and_platform_scope(
    process: &mut RunningRuntimeClientProcess,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<(), String> {
    let mut stop_errors = Vec::new();

    if let Err(error) = stop_runtime_client_process(process, clock, sleeper) {
        stop_errors.push(error);
    }
    if let Err(error) = kill_runtime_client_process_platform_scope(process) {
        stop_errors.push(format!(
            "platform scope processKey={}: {error}",
            process.spec.process_key
        ));
    }

    if stop_errors.is_empty() {
        return Ok(());
    }

    Err(stop_errors.join("; "))
}
