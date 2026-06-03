//! Activation diagnostics mapping for sandbox activation.
//!
//! Lifecycle code reports rich Rust errors; this module converts those failures
//! into stable diagnostic operation records and transcript entries.

use std::collections::BTreeMap;

use crate::command::CommandFailure;
use crate::process;
use crate::runtime::RuntimePlanApplyError;
use crate::startup_diagnostics::{
    ActivationDiagnosticsLogger, ActivationTranscriptStream, activation_diagnostics_string,
    activation_diagnostics_u64,
};

pub(super) fn timeline_attributes(key: &str, label: &str) -> BTreeMap<String, serde_json::Value> {
    BTreeMap::from([
        (
            "timelineKey".to_string(),
            activation_diagnostics_string(key.to_string()),
        ),
        (
            "timelineLabel".to_string(),
            activation_diagnostics_string(label.to_string()),
        ),
    ])
}

pub(super) fn hidden_timeline_attributes() -> BTreeMap<String, serde_json::Value> {
    BTreeMap::from([("timelineHidden".to_string(), serde_json::Value::Bool(true))])
}

pub(super) fn runtime_process_timeline_attributes(
    process_key: &str,
) -> BTreeMap<String, serde_json::Value> {
    timeline_attributes(
        &format!("runtime-process:{process_key}"),
        &runtime_process_timeline_label(process_key),
    )
}

pub(super) fn runtime_adapter_timeline_attributes(
    runtime_id: &str,
) -> BTreeMap<String, serde_json::Value> {
    timeline_attributes(
        &format!("runtime-adapter:{runtime_id}"),
        &runtime_adapter_timeline_label(runtime_id),
    )
}

fn runtime_process_timeline_label(process_key: &str) -> String {
    match process_key {
        "codex-app-server" => "Starting Codex app server".to_string(),
        "opencode-server" => "Starting OpenCode server".to_string(),
        _ => format!("Starting {process_key}"),
    }
}

fn runtime_adapter_timeline_label(runtime_id: &str) -> String {
    match runtime_id {
        "codex" => "Starting Codex adapter".to_string(),
        "opencode" => "Starting OpenCode adapter".to_string(),
        "pi" => "Starting Pi adapter".to_string(),
        _ => format!("Starting {runtime_id} adapter"),
    }
}

pub(super) fn record_operation_phase_failure(
    diagnostics_logger: &Option<ActivationDiagnosticsLogger>,
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
            eprintln!("sandboxd failed to record activation diagnostics phase failure: {error}");
        }
        if let Err(error) = logger.record_transcript(
            Some(phase),
            ActivationTranscriptStream::System,
            transcript_message.as_bytes(),
        ) {
            eprintln!("sandboxd failed to record activation diagnostics transcript: {error}");
        }
    }
}

pub(super) fn record_operation_phase_started(
    diagnostics_logger: &Option<ActivationDiagnosticsLogger>,
    phase: &str,
) {
    record_operation_phase_started_with_attributes(diagnostics_logger, phase, BTreeMap::new());
}

pub(super) fn record_operation_phase_started_with_attributes(
    diagnostics_logger: &Option<ActivationDiagnosticsLogger>,
    phase: &str,
    attributes: BTreeMap<String, serde_json::Value>,
) {
    if let Some(logger) = diagnostics_logger {
        if let Err(error) = logger.record_phase_started_with_attributes(phase, attributes) {
            eprintln!("sandboxd failed to record activation diagnostics phase start: {error}");
        }
        if let Err(error) = logger.record_transcript(
            Some(phase),
            ActivationTranscriptStream::System,
            format!("{phase} started").as_bytes(),
        ) {
            eprintln!("sandboxd failed to record activation diagnostics transcript: {error}");
        }
    }
}

pub(super) fn record_operation_phase_completed(
    diagnostics_logger: &Option<ActivationDiagnosticsLogger>,
    phase: &str,
) {
    record_operation_phase_completed_with_attributes(diagnostics_logger, phase, BTreeMap::new());
}

pub(super) fn record_operation_phase_completed_with_attributes(
    diagnostics_logger: &Option<ActivationDiagnosticsLogger>,
    phase: &str,
    attributes: BTreeMap<String, serde_json::Value>,
) {
    if let Some(logger) = diagnostics_logger {
        if let Err(error) = logger.record_phase_completed_with_attributes(phase, attributes) {
            eprintln!("sandboxd failed to record activation diagnostics phase completion: {error}");
        }
        if let Err(error) = logger.record_transcript(
            Some(phase),
            ActivationTranscriptStream::System,
            format!("{phase} completed").as_bytes(),
        ) {
            eprintln!("sandboxd failed to record activation diagnostics transcript: {error}");
        }
    }
}

pub(super) fn record_runtime_plan_apply_failure(
    diagnostics_logger: &Option<ActivationDiagnosticsLogger>,
    error: &RuntimePlanApplyError,
) {
    record_operation_phase_failure(
        diagnostics_logger,
        "apply_runtime_plan",
        runtime_plan_apply_failure_attributes(error),
    );
}

fn runtime_plan_apply_failure_attributes(
    error: &RuntimePlanApplyError,
) -> BTreeMap<String, serde_json::Value> {
    match error {
        RuntimePlanApplyError::InvalidRuntimePlan(error) => BTreeMap::from([
            (
                "failureKind".to_string(),
                activation_diagnostics_string("invalid_runtime_plan"),
            ),
            (
                "error".to_string(),
                activation_diagnostics_string(error.to_string()),
            ),
        ]),
        RuntimePlanApplyError::ArtifactInstall {
            artifact_key,
            install_index,
            op,
            error,
            ..
        } => {
            let mut map = timeline_attributes("runtime-artifacts", "Installing runtime artifacts");
            map.extend([
                (
                    "failureKind".to_string(),
                    activation_diagnostics_string("artifact_install_failed"),
                ),
                (
                    "artifactKey".to_string(),
                    activation_diagnostics_string(artifact_key.clone()),
                ),
                (
                    "installIndex".to_string(),
                    activation_diagnostics_u64(*install_index as u64),
                ),
                ("installOp".to_string(), activation_diagnostics_string(*op)),
                (
                    "error".to_string(),
                    activation_diagnostics_string(error.clone()),
                ),
            ]);
            map
        }
        RuntimePlanApplyError::WorkspaceSource {
            source_kind,
            path,
            origin_url,
            clone_url,
            error,
            ..
        } => {
            let mut map = timeline_attributes("workspace", "Preparing workspace");
            map.extend([
                (
                    "failureKind".to_string(),
                    activation_diagnostics_string("workspace_source_failed"),
                ),
                (
                    "sourceKind".to_string(),
                    activation_diagnostics_string(*source_kind),
                ),
                (
                    "path".to_string(),
                    activation_diagnostics_string(path.clone()),
                ),
                (
                    "originUrl".to_string(),
                    activation_diagnostics_string(origin_url.clone()),
                ),
                (
                    "error".to_string(),
                    activation_diagnostics_string(error.clone()),
                ),
            ]);
            if let Some(clone_url) = clone_url {
                map.insert(
                    "cloneUrl".to_string(),
                    activation_diagnostics_string(clone_url.clone()),
                );
            }
            map
        }
        RuntimePlanApplyError::SkillsReconcile {
            origin_url,
            runtime_id,
            repo_path,
            error,
        } => {
            let mut map = timeline_attributes("skills", "Reconciling skills");
            map.extend([
                (
                    "failureKind".to_string(),
                    activation_diagnostics_string("skills_reconcile_failed"),
                ),
                (
                    "originUrl".to_string(),
                    activation_diagnostics_string(origin_url.clone()),
                ),
                (
                    "runtimeId".to_string(),
                    activation_diagnostics_string(runtime_id.clone()),
                ),
                (
                    "error".to_string(),
                    activation_diagnostics_string(error.clone()),
                ),
            ]);
            if let Some(repo_path) = repo_path {
                map.insert(
                    "repoPath".to_string(),
                    activation_diagnostics_string(repo_path.clone()),
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
        } => {
            let mut map = timeline_attributes("runtime-files", "Writing runtime files");
            map.extend([
                (
                    "failureKind".to_string(),
                    activation_diagnostics_string("runtime_file_failed"),
                ),
                (
                    "clientId".to_string(),
                    activation_diagnostics_string(client_id.clone()),
                ),
                (
                    "fileId".to_string(),
                    activation_diagnostics_string(file_id.clone()),
                ),
                (
                    "path".to_string(),
                    activation_diagnostics_string(path.clone()),
                ),
                (
                    "error".to_string(),
                    activation_diagnostics_string(error.clone()),
                ),
            ]);
            map
        }
    }
}

pub(super) fn record_runtime_process_failure(
    diagnostics_logger: &Option<ActivationDiagnosticsLogger>,
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
                    activation_diagnostics_string("runtime_process_spawn_failed"),
                ),
                (
                    "processKey".to_string(),
                    activation_diagnostics_string(process_key.clone()),
                ),
                (
                    "processIndex".to_string(),
                    activation_diagnostics_u64(*process_index as u64),
                ),
                (
                    "error".to_string(),
                    activation_diagnostics_string(error.clone()),
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
                    activation_diagnostics_string(stdout_tail.clone()),
                );
            }
            if let Some(stderr_tail) = &output_tails.stderr_tail {
                map.insert(
                    "stderrTail".to_string(),
                    activation_diagnostics_string(stderr_tail.clone()),
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
                    activation_diagnostics_string("runtime_process_readiness_failed"),
                ),
                (
                    "processKey".to_string(),
                    activation_diagnostics_string(process_key.clone()),
                ),
                (
                    "processIndex".to_string(),
                    activation_diagnostics_u64(*process_index as u64),
                ),
                (
                    "readinessType".to_string(),
                    activation_diagnostics_string(details.readiness_type.clone()),
                ),
                (
                    "readinessTarget".to_string(),
                    activation_diagnostics_string(details.readiness_target.clone()),
                ),
                (
                    "timeoutMs".to_string(),
                    activation_diagnostics_u64(details.timeout_ms),
                ),
                (
                    "error".to_string(),
                    activation_diagnostics_string(error.clone()),
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
                    activation_diagnostics_string(stdout_tail.clone()),
                );
            }
            if let Some(stderr_tail) = &details.output_tails.stderr_tail {
                map.insert(
                    "stderrTail".to_string(),
                    activation_diagnostics_string(stderr_tail.clone()),
                );
            }
            map
        }
        process::ProcessManagerError::StopProcesses(error) => BTreeMap::from([(
            "error".to_string(),
            activation_diagnostics_string(error.clone()),
        )]),
    };

    let mut attributes = attributes;
    if let Some(process_key) = attributes
        .get("processKey")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
    {
        attributes.extend(runtime_process_timeline_attributes(&process_key));
    }

    record_operation_phase_failure(diagnostics_logger, "start_runtime_processes", attributes);
}

pub(super) fn record_setup_script_failure(
    diagnostics_logger: &Option<ActivationDiagnosticsLogger>,
    error: &CommandFailure,
) {
    let mut attributes = timeline_attributes("setup-script", "Running setup script");
    attributes.extend([
        (
            "failureKind".to_string(),
            activation_diagnostics_string("setup_script_failed"),
        ),
        (
            "error".to_string(),
            activation_diagnostics_string(error.message.clone()),
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
            activation_diagnostics_u64(exit_code as u64),
        );
    }
    if let Some(stdout_tail) = &error.output_tails.stdout_tail {
        attributes.insert(
            "stdoutTail".to_string(),
            activation_diagnostics_string(stdout_tail.clone()),
        );
    }
    if let Some(stderr_tail) = &error.output_tails.stderr_tail {
        attributes.insert(
            "stderrTail".to_string(),
            activation_diagnostics_string(stderr_tail.clone()),
        );
    }
    if error.timed_out {
        attributes.insert("timedOut".to_string(), serde_json::Value::Bool(true));
    }

    record_operation_phase_failure(diagnostics_logger, "run_setup_script", attributes);
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use crate::runtime::RuntimePlanApplyError;
    use crate::sandboxd_state::diagnostics::runtime_plan_apply_failure_attributes;

    #[test]
    fn skills_reconcile_failure_uses_skills_timeline_attributes() {
        let attributes =
            runtime_plan_apply_failure_attributes(&RuntimePlanApplyError::SkillsReconcile {
                origin_url: "https://github.com/acme/skills.git".to_string(),
                runtime_id: "codex".to_string(),
                repo_path: Some("/root/acme/skills".to_string()),
                error: "selected skill not found".to_string(),
            });

        assert_eq!(
            attributes.get("timelineKey"),
            Some(&Value::String("skills".to_string()))
        );
        assert_eq!(
            attributes.get("timelineLabel"),
            Some(&Value::String("Reconciling skills".to_string()))
        );
        assert_eq!(
            attributes.get("failureKind"),
            Some(&Value::String("skills_reconcile_failed".to_string()))
        );
    }
}
