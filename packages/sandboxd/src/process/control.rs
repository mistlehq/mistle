//! Control handles for runtime client process components.
//!
//! These methods expose restart, stop, readiness, and health operations without
//! leaking the process module's child/thread bookkeeping to higher-level
//! sandbox state code.

use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use crate::cgroups::attach_pid_to_scope;
use crate::process::*;
use crate::supervision::SupervisedComponent;
use crate::time::{Clock, Sleeper};

impl CodexAppServerControlHandle {
    pub fn observation_handle(&self) -> &CodexAppServerObservationHandle {
        &self.managed_process.observation_handle
    }

    pub fn restart(&self, clock: &dyn Clock, sleeper: &dyn Sleeper) -> Result<(), String> {
        let _restart_guard = self
            .managed_process
            .restart_lock
            .lock()
            .expect("Codex app-server restart lock should not be poisoned");
        self.managed_process
            .restart_in_progress
            .store(true, Ordering::Relaxed);

        self.managed_process
            .supervisor_handle
            .mark_component_starting(SupervisedComponent::CodexAppServer);

        let mut current_process = RunningRuntimeClientProcess {
            spec: self.managed_process.spec.clone(),
            child: self.managed_process.child.clone(),
            output_capture: self.managed_process.output_capture.clone(),
            platform_scope: self.managed_process.platform_scope.clone(),
        };
        let _ = stop_runtime_client_process(&mut current_process, clock, sleeper);

        let (mut replacement_child, replacement_output_capture) =
            match spawn_runtime_client_child(&self.managed_process.spec) {
                Ok(replacement_child) => replacement_child,
                Err(error) => {
                    self.managed_process
                        .supervisor_handle
                        .mark_component_restarting(
                            SupervisedComponent::CodexAppServer,
                            error.clone(),
                        );
                    self.managed_process
                        .supervisor_handle
                        .emit_component_healthcheck_failed(
                            SupervisedComponent::CodexAppServer,
                            "restart_spawn_failed",
                            &error,
                            "process_liveness",
                            &[],
                        );
                    self.managed_process
                        .restart_in_progress
                        .store(false, Ordering::Relaxed);
                    return Err(error);
                }
            };
        let replacement_pid = replacement_child.id();
        if let Some(platform_scope) = &self.managed_process.platform_scope
            && let Err(error) = attach_pid_to_scope(&platform_scope.scope_paths, replacement_pid)
        {
            let replacement_child = Arc::new(Mutex::new(replacement_child));
            let mut failed_replacement_process = RunningRuntimeClientProcess {
                spec: self.managed_process.spec.clone(),
                child: replacement_child,
                output_capture: replacement_output_capture.clone(),
                platform_scope: self.managed_process.platform_scope.clone(),
            };
            let _ = stop_runtime_client_process(&mut failed_replacement_process, clock, sleeper);
            let error = error.to_string();
            self.managed_process
                .supervisor_handle
                .mark_component_restarting(SupervisedComponent::CodexAppServer, error.clone());
            self.managed_process
                .restart_in_progress
                .store(false, Ordering::Relaxed);
            return Err(error);
        }
        if let Some(platform_scope) = &self.managed_process.platform_scope
            && let Err(error) = platform_scope
                .registry
                .update_supervised_root_pid(&platform_scope.registry_key, replacement_pid)
        {
            let replacement_child = Arc::new(Mutex::new(replacement_child));
            let mut failed_replacement_process = RunningRuntimeClientProcess {
                spec: self.managed_process.spec.clone(),
                child: replacement_child,
                output_capture: replacement_output_capture.clone(),
                platform_scope: self.managed_process.platform_scope.clone(),
            };
            let _ = stop_runtime_client_process(&mut failed_replacement_process, clock, sleeper);
            self.managed_process
                .supervisor_handle
                .mark_component_restarting(SupervisedComponent::CodexAppServer, error.clone());
            self.managed_process
                .restart_in_progress
                .store(false, Ordering::Relaxed);
            return Err(error);
        }
        if let Err(error) = wait_for_runtime_client_process_readiness_with(
            &self.managed_process.spec,
            &mut replacement_child,
            clock,
            sleeper,
        ) {
            let replacement_child = Arc::new(Mutex::new(replacement_child));
            let mut failed_replacement_process = RunningRuntimeClientProcess {
                spec: self.managed_process.spec.clone(),
                child: replacement_child,
                output_capture: replacement_output_capture.clone(),
                platform_scope: self.managed_process.platform_scope.clone(),
            };
            let _ = stop_runtime_client_process(&mut failed_replacement_process, clock, sleeper);
            self.managed_process
                .supervisor_handle
                .mark_component_restarting(SupervisedComponent::CodexAppServer, error.clone());
            self.managed_process
                .supervisor_handle
                .emit_component_healthcheck_failed(
                    SupervisedComponent::CodexAppServer,
                    "restart_readiness_failed",
                    &error,
                    "readiness_ws",
                    &[],
                );
            self.managed_process
                .restart_in_progress
                .store(false, Ordering::Relaxed);
            return Err(error);
        }
        {
            let mut child = self
                .managed_process
                .child
                .lock()
                .expect("runtime client child lock should not be poisoned");
            *child = replacement_child;
        }
        update_codex_app_server_observation(
            &self.managed_process.observation_handle,
            &self.managed_process.spec,
            Some(replacement_pid),
            true,
            None,
        );
        self.managed_process
            .supervisor_handle
            .replace_component_details(
                SupervisedComponent::CodexAppServer,
                codex_app_server_details_with_status(
                    &self.managed_process.spec,
                    Some(replacement_pid),
                    None,
                    "Alive",
                    "Ready",
                ),
            );
        self.managed_process
            .supervisor_handle
            .mark_component_healthy(SupervisedComponent::CodexAppServer);
        self.managed_process
            .restart_in_progress
            .store(false, Ordering::Relaxed);
        Ok(())
    }
}

impl OpenCodeServerControlHandle {
    pub fn restart(&self, clock: &dyn Clock, sleeper: &dyn Sleeper) -> Result<(), String> {
        let _restart_guard = self
            .managed_process
            .restart_lock
            .lock()
            .map_err(|error| format!("OpenCode server restart lock was poisoned: {error}"))?;
        self.managed_process
            .restart_in_progress
            .store(true, Ordering::Relaxed);

        self.managed_process
            .supervisor_handle
            .mark_component_starting(SupervisedComponent::OpenCodeServer);

        let mut current_process = RunningRuntimeClientProcess {
            spec: self.managed_process.spec.clone(),
            child: self.managed_process.child.clone(),
            output_capture: self.managed_process.output_capture.clone(),
            platform_scope: self.managed_process.platform_scope.clone(),
        };
        let _ = stop_runtime_client_process(&mut current_process, clock, sleeper);

        let (mut replacement_child, replacement_output_capture) =
            match spawn_runtime_client_child(&self.managed_process.spec) {
                Ok(replacement_child) => replacement_child,
                Err(error) => {
                    self.managed_process
                        .supervisor_handle
                        .mark_component_restarting(
                            SupervisedComponent::OpenCodeServer,
                            error.clone(),
                        );
                    self.managed_process
                        .supervisor_handle
                        .emit_component_healthcheck_failed(
                            SupervisedComponent::OpenCodeServer,
                            "restart_spawn_failed",
                            &error,
                            "process_liveness",
                            &[],
                        );
                    self.managed_process
                        .restart_in_progress
                        .store(false, Ordering::Relaxed);
                    return Err(error);
                }
            };
        let replacement_pid = replacement_child.id();
        if let Some(platform_scope) = &self.managed_process.platform_scope
            && let Err(error) = attach_pid_to_scope(&platform_scope.scope_paths, replacement_pid)
        {
            let replacement_child = Arc::new(Mutex::new(replacement_child));
            let mut failed_replacement_process = RunningRuntimeClientProcess {
                spec: self.managed_process.spec.clone(),
                child: replacement_child,
                output_capture: replacement_output_capture.clone(),
                platform_scope: self.managed_process.platform_scope.clone(),
            };
            let _ = stop_runtime_client_process(&mut failed_replacement_process, clock, sleeper);
            let error = error.to_string();
            self.managed_process
                .supervisor_handle
                .mark_component_restarting(SupervisedComponent::OpenCodeServer, error.clone());
            self.managed_process
                .restart_in_progress
                .store(false, Ordering::Relaxed);
            return Err(error);
        }
        if let Some(platform_scope) = &self.managed_process.platform_scope
            && let Err(error) = platform_scope
                .registry
                .update_supervised_root_pid(&platform_scope.registry_key, replacement_pid)
        {
            let replacement_child = Arc::new(Mutex::new(replacement_child));
            let mut failed_replacement_process = RunningRuntimeClientProcess {
                spec: self.managed_process.spec.clone(),
                child: replacement_child,
                output_capture: replacement_output_capture.clone(),
                platform_scope: self.managed_process.platform_scope.clone(),
            };
            let _ = stop_runtime_client_process(&mut failed_replacement_process, clock, sleeper);
            self.managed_process
                .supervisor_handle
                .mark_component_restarting(SupervisedComponent::OpenCodeServer, error.clone());
            self.managed_process
                .restart_in_progress
                .store(false, Ordering::Relaxed);
            return Err(error);
        }
        if let Err(error) = wait_for_runtime_client_process_readiness_with(
            &self.managed_process.spec,
            &mut replacement_child,
            clock,
            sleeper,
        ) {
            let replacement_child = Arc::new(Mutex::new(replacement_child));
            let mut failed_replacement_process = RunningRuntimeClientProcess {
                spec: self.managed_process.spec.clone(),
                child: replacement_child,
                output_capture: replacement_output_capture.clone(),
                platform_scope: self.managed_process.platform_scope.clone(),
            };
            let _ = stop_runtime_client_process(&mut failed_replacement_process, clock, sleeper);
            self.managed_process
                .supervisor_handle
                .mark_component_restarting(SupervisedComponent::OpenCodeServer, error.clone());
            self.managed_process
                .supervisor_handle
                .emit_component_healthcheck_failed(
                    SupervisedComponent::OpenCodeServer,
                    "restart_readiness_failed",
                    &error,
                    "readiness_http",
                    &[],
                );
            self.managed_process
                .restart_in_progress
                .store(false, Ordering::Relaxed);
            return Err(error);
        }
        {
            let mut child = match self.managed_process.child.lock() {
                Ok(child) => child,
                Err(error) => {
                    self.managed_process
                        .restart_in_progress
                        .store(false, Ordering::Relaxed);
                    return Err(format!("runtime client child lock was poisoned: {error}"));
                }
            };
            *child = replacement_child;
        }
        self.managed_process
            .supervisor_handle
            .replace_component_details(
                SupervisedComponent::OpenCodeServer,
                opencode_server_details_with_status(
                    &self.managed_process.spec,
                    Some(replacement_pid),
                    None,
                    "Alive",
                    "Ready",
                ),
            );
        self.managed_process
            .supervisor_handle
            .mark_component_healthy(SupervisedComponent::OpenCodeServer);
        self.managed_process
            .restart_in_progress
            .store(false, Ordering::Relaxed);
        Ok(())
    }
}
