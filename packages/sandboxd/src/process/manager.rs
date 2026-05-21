use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

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
    let mut started_processes = Vec::new();
    let mut codex_app_server_observation_handle = None;
    let mut codex_app_server_control_handle = None;

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
        let mut process = start_runtime_client_process(process_spec).map_err(|error| {
            ProcessManagerError::StartProcess {
                process_index,
                process_key: process_spec.process_key.clone(),
                error,
                output_tails: Box::default(),
            }
        })?;

        if let Err(error) = wait_for_runtime_client_process_readiness(&mut process, clock, sleeper)
        {
            let _ = stop_started_processes(&mut started_processes, clock, sleeper);
            let _ = stop_runtime_client_process(&mut process, clock, sleeper);
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
                        observation_handle: observation_handle.clone(),
                        supervisor_handle: supervisor_handle.clone(),
                        restart_lock: Mutex::new(()),
                        restart_in_progress: AtomicBool::new(false),
                    }),
                });
            }
        }

        started_processes.push(process);
    }

    let monitor_shutdown_requested = Arc::new(AtomicBool::new(false));
    let monitor_thread = codex_app_server_control_handle
        .clone()
        .map(|control_handle| {
            spawn_codex_app_server_monitor(control_handle, monitor_shutdown_requested.clone())
        });

    Ok(RuntimeClientProcessManager {
        processes: started_processes,
        codex_app_server_observation_handle,
        codex_app_server_control_handle,
        monitor_shutdown_requested,
        monitor_thread,
        supervisor_handle,
    })
}

impl RuntimeClientProcessManager {
    pub fn codex_app_server_observation_handle(&self) -> Option<&CodexAppServerObservationHandle> {
        self.codex_app_server_observation_handle.as_ref()
    }

    pub fn codex_app_server_control_handle(&self) -> Option<&CodexAppServerControlHandle> {
        self.codex_app_server_control_handle.as_ref()
    }

    /// Stops all managed processes in reverse start order using their stop policies.
    pub fn stop(
        mut self,
        clock: &dyn Clock,
        sleeper: &dyn Sleeper,
    ) -> Result<(), ProcessManagerError> {
        self.monitor_shutdown_requested
            .store(true, Ordering::Relaxed);
        if let Some(monitor_thread) = self.monitor_thread.take() {
            let _ = monitor_thread.join();
        }
        stop_started_processes(&mut self.processes, clock, sleeper)
            .map_err(ProcessManagerError::StopProcesses)?;
        if self
            .supervisor_handle
            .tracks_component(SupervisedComponent::CodexAppServer)
        {
            self.supervisor_handle
                .mark_component_stopped(SupervisedComponent::CodexAppServer);
        }
        Ok(())
    }
}
