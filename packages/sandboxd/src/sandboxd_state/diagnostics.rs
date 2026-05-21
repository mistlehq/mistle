use std::collections::BTreeMap;

use crate::command::CommandFailure;
use crate::process;
use crate::runtime::RuntimePlanApplyError;
use crate::startup_diagnostics::{
    StartupDiagnosticsLogger, StartupTranscriptStream, startup_diagnostics_string,
    startup_diagnostics_u64,
};

pub(super) fn record_operation_phase_failure(
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

pub(super) fn record_operation_phase_started(
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

pub(super) fn record_operation_phase_completed(
    diagnostics_logger: &Option<StartupDiagnosticsLogger>,
    phase: &str,
) {
    record_operation_phase_completed_with_attributes(diagnostics_logger, phase, BTreeMap::new());
}

pub(super) fn record_operation_phase_completed_with_attributes(
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

pub(super) fn record_runtime_plan_apply_failure(
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

pub(super) fn record_runtime_process_failure(
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

pub(super) fn record_setup_script_failure(
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
