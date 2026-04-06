//! Runtime-plan application for `sandboxd`.
//!
//! This module materializes the non-supervised parts of the runtime plan
//! directly, while exposing the parsed process definitions that the process
//! supervision module starts and stops around manifest reloads.

mod plan;
mod runtime_file;
mod workspace_source;

use std::fmt;

use crate::command::{CommandSpec, DEFAULT_COMMAND_POLL_INTERVAL, run_command};
use crate::protocol::startup::StartupInput;
use crate::time::{SystemClock, ThreadSleeper};

pub(crate) use plan::RuntimeClient;
pub use plan::{
    CompiledRuntimePlan, RuntimeArtifactCommand, RuntimeClientProcessReadiness,
    RuntimeClientProcessStopPolicy, RuntimeClientProcessStopSignal,
};

/// Describes why one runtime-plan setup step failed while applying the manifest.
#[derive(Debug)]
pub enum RuntimePlanApplyError {
    InvalidRuntimePlan(serde_json::Error),
    ArtifactCommand {
        artifact_index: usize,
        command_index: usize,
        artifact_key: String,
        error: String,
    },
    WorkspaceSource {
        source_index: usize,
        source_kind: &'static str,
        path: String,
        error: String,
    },
    RuntimeFile {
        client_index: usize,
        client_id: String,
        file_index: usize,
        file_id: String,
        path: String,
        error: String,
    },
}

impl fmt::Display for RuntimePlanApplyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRuntimePlan(error) => {
                write!(f, "runtime plan is invalid: {error}")
            }
            Self::ArtifactCommand {
                artifact_index,
                command_index,
                artifact_key,
                error,
            } => write!(
                f,
                "runtime plan artifacts[{artifact_index}] lifecycle.install[{command_index}] failed (artifactKey={artifact_key}): {error}"
            ),
            Self::WorkspaceSource {
                source_index,
                source_kind,
                path,
                error,
            } => write!(
                f,
                "runtime plan workspaceSources[{source_index}] failed (sourceKind={source_kind} path={path}): {error}"
            ),
            Self::RuntimeFile {
                client_index,
                client_id,
                file_index,
                file_id,
                path,
                error,
            } => write!(
                f,
                "runtime plan runtimeClients[{client_index}].setup.files[{file_index}] failed (clientId={client_id} fileId={file_id} path={path}): {error}"
            ),
        }
    }
}

impl std::error::Error for RuntimePlanApplyError {}

/// Applies the artifact, workspace-source, and setup-file portions of one startup input's runtime
/// plan.
pub fn apply_runtime_plan(startup_input: &StartupInput) -> Result<(), RuntimePlanApplyError> {
    let runtime_plan: CompiledRuntimePlan =
        serde_json::from_value(startup_input.runtime_plan.clone())
            .map_err(RuntimePlanApplyError::InvalidRuntimePlan)?;
    apply_compiled_runtime_plan(&runtime_plan)
}

/// Applies the artifact, workspace-source, and setup-file portions of one compiled runtime plan.
fn apply_compiled_runtime_plan(
    runtime_plan: &CompiledRuntimePlan,
) -> Result<(), RuntimePlanApplyError> {
    // Materialize artifacts, workspace sources, and setup files before later PRs add
    // long-lived process supervision on top of this state.
    for (artifact_index, artifact) in runtime_plan.artifacts.iter().enumerate() {
        for (command_index, command) in artifact.lifecycle.install.iter().enumerate() {
            run_command(
                CommandSpec {
                    args: &command.args,
                    env: command.env.as_ref(),
                    cwd: command.cwd.as_deref(),
                    timeout_ms: command.timeout_ms,
                },
                &SystemClock,
                &ThreadSleeper,
                DEFAULT_COMMAND_POLL_INTERVAL,
            )
            .map_err(|error| RuntimePlanApplyError::ArtifactCommand {
                artifact_index,
                command_index,
                artifact_key: artifact.artifact_key.clone(),
                error,
            })?;
        }
    }

    for (source_index, workspace_source) in runtime_plan.workspace_sources.iter().enumerate() {
        let (source_kind, path) = match workspace_source {
            plan::CompiledWorkspaceSource::GitClone { path, .. } => ("git-clone", path.clone()),
        };
        workspace_source::apply_workspace_source(workspace_source).map_err(|error| {
            RuntimePlanApplyError::WorkspaceSource {
                source_index,
                source_kind,
                path,
                error,
            }
        })?;
    }

    for (client_index, runtime_client) in runtime_plan.runtime_clients.iter().enumerate() {
        for (file_index, file) in runtime_client.setup.files.iter().enumerate() {
            runtime_file::apply_runtime_file(file).map_err(|error| {
                RuntimePlanApplyError::RuntimeFile {
                    client_index,
                    client_id: runtime_client.client_id.clone(),
                    file_index,
                    file_id: file.file_id.clone(),
                    path: file.path.clone(),
                    error,
                }
            })?;
        }
    }

    Ok(())
}
