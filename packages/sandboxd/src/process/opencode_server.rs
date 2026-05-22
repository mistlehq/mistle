//! OpenCode server process health projection.
//!
//! This module monitors the raw OpenCode process readiness endpoint and marks
//! repeated failures for coordinated restart; restart execution lives in the
//! runtime coordination and process-control path.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};

use serde_json::Value;

use crate::process::*;
use crate::runtime::RuntimeClientProcessReadiness;
use crate::supervision::SupervisedComponent;

pub(super) fn is_opencode_server_process(process_spec: &RuntimeClientProcessSpec) -> bool {
    process_spec.process_key == "opencode-server"
}

pub(super) fn opencode_server_details(
    process_spec: &RuntimeClientProcessSpec,
    pid: Option<u32>,
) -> BTreeMap<String, String> {
    let mut details =
        BTreeMap::from([("processKey".to_string(), process_spec.process_key.clone())]);
    if let RuntimeClientProcessReadiness::Http { url, .. } = &process_spec.readiness {
        details.insert("readinessUrl".to_string(), url.clone());
    }
    if let Some(pid) = pid {
        details.insert("pid".to_string(), pid.to_string());
    }
    details
}

pub(super) fn spawn_opencode_server_monitor(
    control_handle: OpenCodeServerControlHandle,
    shutdown_requested: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        run_opencode_server_monitor(control_handle, shutdown_requested);
    })
}

pub(super) fn run_opencode_server_monitor(
    control_handle: OpenCodeServerControlHandle,
    shutdown_requested: Arc<AtomicBool>,
) {
    let mut last_readiness_ok = true;
    let mut last_reported_exit_pid = None;
    let mut consecutive_readiness_failures = 0u8;

    while !shutdown_requested.load(Ordering::Relaxed) {
        if control_handle
            .managed_process
            .restart_in_progress
            .load(Ordering::Relaxed)
        {
            thread::sleep(DEFAULT_PROCESS_MONITOR_POLL_INTERVAL);
            continue;
        }

        let current_pid = pid_from_child_handle(&control_handle.managed_process.child);
        let exit_status = {
            let mut child = control_handle
                .managed_process
                .child
                .lock()
                .expect("runtime client child lock should not be poisoned");
            child.try_wait().ok().flatten()
        };

        if let Some(exit_status) = exit_status {
            if last_reported_exit_pid == Some(current_pid) {
                thread::sleep(DEFAULT_PROCESS_MONITOR_POLL_INTERVAL);
                continue;
            }
            let exit_description = describe_process_exit(exit_status);
            let (exit_reason, exit_fields) = runtime_process_exit_event_fields(exit_status);
            control_handle
                .managed_process
                .supervisor_handle
                .replace_component_details(
                    SupervisedComponent::OpenCodeServer,
                    opencode_server_details_with_status(
                        &control_handle.managed_process.spec,
                        Some(current_pid),
                        Some(exit_description.clone()),
                        "Exited",
                        if last_readiness_ok {
                            "Ready"
                        } else {
                            "Unreachable"
                        },
                    ),
                );
            control_handle
                .managed_process
                .supervisor_handle
                .mark_component_restarting(
                    SupervisedComponent::OpenCodeServer,
                    exit_description.clone(),
                );
            control_handle
                .managed_process
                .supervisor_handle
                .emit_component_exited(
                    SupervisedComponent::OpenCodeServer,
                    exit_reason,
                    Some(&exit_description),
                    &exit_fields,
                );
            last_reported_exit_pid = Some(current_pid);
            last_readiness_ok = false;
            thread::sleep(DEFAULT_PROCESS_MONITOR_POLL_INTERVAL);
            continue;
        }
        last_reported_exit_pid = None;

        match check_runtime_client_process_readiness_from_spec(&control_handle.managed_process.spec)
        {
            Ok(()) => {
                consecutive_readiness_failures = 0;
                control_handle
                    .managed_process
                    .supervisor_handle
                    .replace_component_details(
                        SupervisedComponent::OpenCodeServer,
                        opencode_server_details_with_status(
                            &control_handle.managed_process.spec,
                            Some(current_pid),
                            None,
                            "Alive",
                            "Ready",
                        ),
                    );
                if !last_readiness_ok {
                    control_handle
                        .managed_process
                        .supervisor_handle
                        .mark_component_healthy(SupervisedComponent::OpenCodeServer);
                }
                control_handle
                    .managed_process
                    .supervisor_handle
                    .record_component_healthcheck(SupervisedComponent::OpenCodeServer);
                last_readiness_ok = true;
            }
            Err(error) => {
                consecutive_readiness_failures = consecutive_readiness_failures.saturating_add(1);
                control_handle
                    .managed_process
                    .supervisor_handle
                    .replace_component_details(
                        SupervisedComponent::OpenCodeServer,
                        opencode_server_details_with_status(
                            &control_handle.managed_process.spec,
                            Some(current_pid),
                            None,
                            "Alive",
                            if consecutive_readiness_failures
                                >= OPENCODE_SERVER_POST_START_FAILURE_THRESHOLD
                            {
                                "Unreachable"
                            } else {
                                "Degraded"
                            },
                        ),
                    );
                if last_readiness_ok
                    && consecutive_readiness_failures
                        >= OPENCODE_SERVER_POST_START_FAILURE_THRESHOLD
                {
                    control_handle
                        .managed_process
                        .supervisor_handle
                        .mark_component_restarting(
                            SupervisedComponent::OpenCodeServer,
                            error.clone(),
                        );
                    control_handle
                        .managed_process
                        .supervisor_handle
                        .emit_component_healthcheck_failed(
                            SupervisedComponent::OpenCodeServer,
                            "readiness_probe_failed",
                            error,
                            "readiness_http",
                            &[
                                (
                                    "consecutiveFailures",
                                    Value::String(consecutive_readiness_failures.to_string()),
                                ),
                                (
                                    "failureThreshold",
                                    Value::String(
                                        OPENCODE_SERVER_POST_START_FAILURE_THRESHOLD.to_string(),
                                    ),
                                ),
                            ],
                        );
                }
                last_readiness_ok =
                    consecutive_readiness_failures < OPENCODE_SERVER_POST_START_FAILURE_THRESHOLD;
            }
        }

        thread::sleep(DEFAULT_PROCESS_MONITOR_POLL_INTERVAL);
    }
}

pub(super) fn opencode_server_details_with_status(
    process_spec: &RuntimeClientProcessSpec,
    pid: Option<u32>,
    last_exit_status: Option<String>,
    liveness_state: &str,
    readiness_state: &str,
) -> BTreeMap<String, String> {
    let mut details = opencode_server_details(process_spec, pid);
    details.insert("livenessState".to_string(), liveness_state.to_string());
    details.insert("readinessState".to_string(), readiness_state.to_string());
    if let Some(last_exit_status) = last_exit_status {
        details.insert("lastExitStatus".to_string(), last_exit_status);
    }
    details
}
