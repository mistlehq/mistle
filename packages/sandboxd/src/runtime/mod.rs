//! Runtime-plan application for `sandboxd`.
//!
//! This module materializes the non-supervised parts of the runtime plan
//! directly, while exposing the parsed process definitions that the process
//! supervision module starts and stops for the active sandbox session.

pub mod adapters;
mod plan;
pub mod readiness;
mod runtime_file;
mod workspace_source;

use std::fmt;

use crate::command::{CommandSpec, DEFAULT_COMMAND_POLL_INTERVAL, run_command};
use crate::protocol::startup::StartupInput;
use crate::time::{SystemClock, ThreadSleeper};

pub use plan::{
    CompiledAgentRuntime, CompiledEgressRoute, CompiledEgressRouteAuthInjection,
    CompiledEgressRouteAuthInjectionType, CompiledEgressRouteCredentialResolver,
    CompiledEgressRouteMatch, CompiledEgressRouteUpstream, CompiledRuntimeArtifact,
    CompiledRuntimePlan, CompiledWorkspaceSource, RuntimeArtifactInstallEntry,
    RuntimeArtifactInstallStep, RuntimeArtifactLifecycle, RuntimeClient,
    RuntimeClientConnectionMode, RuntimeClientEndpoint, RuntimeClientEndpointTransport,
    RuntimeClientProcess, RuntimeClientProcessReadiness, RuntimeClientProcessStopPolicy,
    RuntimeClientProcessStopSignal, RuntimeClientSetup, RuntimeClientSetupFile, RuntimeExecCommand,
    WorkspaceSourceResourceKind,
};

/// Describes why one runtime-plan setup step failed while applying startup input.
#[derive(Debug)]
pub enum RuntimePlanApplyError {
    InvalidRuntimePlan(serde_json::Error),
    ArtifactInstallEntry {
        artifact_index: usize,
        install_index: usize,
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
            Self::ArtifactInstallEntry {
                artifact_index,
                install_index,
                artifact_key,
                error,
            } => write!(
                f,
                "runtime plan artifacts[{artifact_index}] lifecycle.install[{install_index}] failed (artifactKey={artifact_key}): {error}"
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

fn apply_legacy_artifact_command(command: &RuntimeExecCommand) -> Result<(), String> {
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
}

fn dispatch_artifact_install_step(step: &RuntimeArtifactInstallStep) -> Result<(), String> {
    let op = match step {
        RuntimeArtifactInstallStep::GitHubReleaseInstall { .. } => "github_release_install",
        RuntimeArtifactInstallStep::MiseInstall { .. } => "mise_install",
        RuntimeArtifactInstallStep::Exec { .. } => "exec",
    };

    Err(format!(
        "artifact install op '{op}' is not supported yet by sandboxd"
    ))
}

fn apply_artifact_install_entry(entry: &RuntimeArtifactInstallEntry) -> Result<(), String> {
    match entry {
        RuntimeArtifactInstallEntry::LegacyCommand(command) => {
            apply_legacy_artifact_command(command)
        }
        RuntimeArtifactInstallEntry::Step(step) => dispatch_artifact_install_step(step),
    }
}

/// Applies the artifact, workspace-source, and setup-file portions of one startup input's runtime
/// plan.
pub fn apply_runtime_plan(startup_input: &StartupInput) -> Result<(), RuntimePlanApplyError> {
    let runtime_plan: CompiledRuntimePlan =
        serde_json::from_value(startup_input.runtime_plan.clone())
            .map_err(RuntimePlanApplyError::InvalidRuntimePlan)?;
    apply_compiled_runtime_plan(&runtime_plan)
}

/// Applies the artifact, workspace-source, and setup-file portions of one compiled runtime plan.
pub fn apply_compiled_runtime_plan(
    runtime_plan: &CompiledRuntimePlan,
) -> Result<(), RuntimePlanApplyError> {
    // Materialize artifacts, workspace sources, and setup files before later PRs add
    // long-lived process supervision on top of this state.
    for (artifact_index, artifact) in runtime_plan.artifacts.iter().enumerate() {
        for (install_index, install_entry) in artifact.lifecycle.install.iter().enumerate() {
            apply_artifact_install_entry(install_entry).map_err(|error| {
                RuntimePlanApplyError::ArtifactInstallEntry {
                    artifact_index,
                    install_index,
                    artifact_key: artifact.artifact_key.clone(),
                    error,
                }
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
