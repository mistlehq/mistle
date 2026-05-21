use std::collections::BTreeMap;
use std::os::unix::process::ExitStatusExt;
use std::process::Child;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use serde_json::Value;

use crate::process::*;
use crate::runtime::RuntimeClientProcessReadiness;
use crate::supervision::SupervisedComponent;

pub(super) fn is_codex_app_server_process(process_spec: &RuntimeClientProcessSpec) -> bool {
    process_spec.process_key == "codex-app-server"
}

impl RunningRuntimeClientProcess {
    pub(super) fn pid(&self) -> u32 {
        self.child
            .lock()
            .expect("runtime client child lock should not be poisoned")
            .id()
    }
}

pub(super) fn codex_app_server_details(
    process_spec: &RuntimeClientProcessSpec,
    pid: Option<u32>,
) -> BTreeMap<String, String> {
    let mut details =
        BTreeMap::from([("processKey".to_string(), process_spec.process_key.clone())]);
    if let RuntimeClientProcessReadiness::Ws { url, .. } = &process_spec.readiness {
        details.insert("readinessUrl".to_string(), url.clone());
    }
    if let Some(pid) = pid {
        details.insert("pid".to_string(), pid.to_string());
    }
    details
}

pub(super) fn codex_app_server_readiness_url(
    process_spec: &RuntimeClientProcessSpec,
) -> Option<String> {
    match &process_spec.readiness {
        RuntimeClientProcessReadiness::Ws { url, .. } => Some(url.clone()),
        _ => None,
    }
}

pub(super) fn update_codex_app_server_observation(
    observation_handle: &CodexAppServerObservationHandle,
    process_spec: &RuntimeClientProcessSpec,
    pid: Option<u32>,
    is_alive: bool,
    last_exit_status: Option<String>,
) {
    let mut observation = observation_handle
        .state
        .lock()
        .expect("Codex app-server observation lock should not be poisoned");
    observation.process_key = process_spec.process_key.clone();
    observation.pid = pid;
    observation.readiness_url = codex_app_server_readiness_url(process_spec);
    observation.is_alive = is_alive;
    observation.last_exit_status = last_exit_status;
}

pub(super) fn spawn_codex_app_server_monitor(
    control_handle: CodexAppServerControlHandle,
    shutdown_requested: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        run_codex_app_server_monitor(control_handle, shutdown_requested);
    })
}

pub(super) fn run_codex_app_server_monitor(
    control_handle: CodexAppServerControlHandle,
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
            let (exit_reason, exit_fields) = codex_app_server_exit_event_fields(exit_status);
            update_codex_app_server_observation(
                &control_handle.managed_process.observation_handle,
                &control_handle.managed_process.spec,
                Some(current_pid),
                false,
                Some(exit_description.clone()),
            );
            control_handle
                .managed_process
                .supervisor_handle
                .replace_component_details(
                    SupervisedComponent::CodexAppServer,
                    codex_app_server_details_with_status(
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
                    SupervisedComponent::CodexAppServer,
                    exit_description.clone(),
                );
            control_handle
                .managed_process
                .supervisor_handle
                .emit_component_exited(
                    SupervisedComponent::CodexAppServer,
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

        match check_codex_app_server_post_start_readiness(&control_handle.managed_process.spec) {
            Ok(()) => {
                consecutive_readiness_failures = 0;
                update_codex_app_server_observation(
                    &control_handle.managed_process.observation_handle,
                    &control_handle.managed_process.spec,
                    Some(current_pid),
                    true,
                    None,
                );
                control_handle
                    .managed_process
                    .supervisor_handle
                    .replace_component_details(
                        SupervisedComponent::CodexAppServer,
                        codex_app_server_details_with_status(
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
                        .mark_component_healthy(SupervisedComponent::CodexAppServer);
                }
                control_handle
                    .managed_process
                    .supervisor_handle
                    .record_component_healthcheck(SupervisedComponent::CodexAppServer);
                last_readiness_ok = true;
            }
            Err(error) => {
                consecutive_readiness_failures = consecutive_readiness_failures.saturating_add(1);
                update_codex_app_server_observation(
                    &control_handle.managed_process.observation_handle,
                    &control_handle.managed_process.spec,
                    Some(current_pid),
                    true,
                    None,
                );
                control_handle
                    .managed_process
                    .supervisor_handle
                    .replace_component_details(
                        SupervisedComponent::CodexAppServer,
                        codex_app_server_details_with_status(
                            &control_handle.managed_process.spec,
                            Some(current_pid),
                            None,
                            "Alive",
                            if consecutive_readiness_failures
                                >= CODEX_APP_SERVER_POST_START_FAILURE_THRESHOLD
                            {
                                "Unreachable"
                            } else {
                                "Degraded"
                            },
                        ),
                    );
                if last_readiness_ok
                    && consecutive_readiness_failures
                        >= CODEX_APP_SERVER_POST_START_FAILURE_THRESHOLD
                {
                    control_handle
                        .managed_process
                        .supervisor_handle
                        .mark_component_restarting(
                            SupervisedComponent::CodexAppServer,
                            error.clone(),
                        );
                    control_handle
                        .managed_process
                        .supervisor_handle
                        .emit_component_healthcheck_failed(
                            SupervisedComponent::CodexAppServer,
                            "readiness_probe_failed",
                            error,
                            "readiness_http_readyz",
                            &[
                                (
                                    "consecutiveFailures",
                                    Value::String(consecutive_readiness_failures.to_string()),
                                ),
                                (
                                    "failureThreshold",
                                    Value::String(
                                        CODEX_APP_SERVER_POST_START_FAILURE_THRESHOLD.to_string(),
                                    ),
                                ),
                            ],
                        );
                }
                last_readiness_ok =
                    consecutive_readiness_failures < CODEX_APP_SERVER_POST_START_FAILURE_THRESHOLD;
            }
        }

        thread::sleep(DEFAULT_PROCESS_MONITOR_POLL_INTERVAL);
    }
}

pub(super) fn pid_from_child_handle(child: &Arc<Mutex<Child>>) -> u32 {
    child
        .lock()
        .expect("runtime client child lock should not be poisoned")
        .id()
}

pub(super) fn codex_app_server_details_with_status(
    process_spec: &RuntimeClientProcessSpec,
    pid: Option<u32>,
    last_exit_status: Option<String>,
    liveness_state: &str,
    readiness_state: &str,
) -> BTreeMap<String, String> {
    let mut details = codex_app_server_details(process_spec, pid);
    details.insert("livenessState".to_string(), liveness_state.to_string());
    details.insert("readinessState".to_string(), readiness_state.to_string());
    if let Some(last_exit_status) = last_exit_status {
        details.insert("lastExitStatus".to_string(), last_exit_status);
    }
    details
}

pub(super) fn codex_app_server_exit_event_fields(
    exit_status: std::process::ExitStatus,
) -> (&'static str, Vec<(&'static str, serde_json::Value)>) {
    if let Some(signal) = exit_status.signal() {
        return (
            "process_signaled",
            vec![
                (
                    "exitKind",
                    serde_json::Value::String("process_signaled".to_string()),
                ),
                ("signal", serde_json::Value::from(signal)),
            ],
        );
    }

    (
        "process_exited",
        vec![
            (
                "exitKind",
                serde_json::Value::String("process_exited".to_string()),
            ),
            (
                "exitCode",
                serde_json::Value::from(exit_status.code().unwrap_or_default()),
            ),
        ],
    )
}
