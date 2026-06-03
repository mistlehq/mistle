//! Runtime-plan application for `sandboxd`.
//!
//! This module materializes the non-supervised parts of the runtime plan
//! directly, while exposing the parsed process definitions that the process
//! supervision module starts and stops for the active sandbox session.

pub mod adapters;
mod artifact_install;
pub(crate) mod git_identity;
mod plan;
pub mod readiness;
mod runtime_file;
mod workspace_source;

use std::collections::BTreeMap;
use std::fmt;
use std::path::Path;
use std::sync::Arc;

use crate::command::CommandOutputSink;
use crate::protocol::session::SessionRuntimeInput;
use crate::skills::{SkillsReconcileSelection, SkillsRuntime, reconcile_materialized_skills};

pub use plan::{
    CompiledAgentRuntime, CompiledEgressRoute, CompiledEgressRouteAuthInjection,
    CompiledEgressRouteAuthInjectionType, CompiledEgressRouteCredentialHeaderInjection,
    CompiledEgressRouteCredentialResolver, CompiledEgressRouteMatch, CompiledEgressRouteUpstream,
    CompiledRuntimeArtifact, CompiledRuntimePlan, CompiledRuntimePlanImage,
    CompiledRuntimePlanImageSource, CompiledRuntimePlanSkills, CompiledSkillSelection,
    CompiledWorkspaceSource, RuntimeArtifactInstallStep, RuntimeArtifactLifecycle, RuntimeClient,
    RuntimeClientConnectionMode, RuntimeClientEndpoint, RuntimeClientEndpointTransport,
    RuntimeClientProcess, RuntimeClientProcessReadiness, RuntimeClientProcessStopPolicy,
    RuntimeClientProcessStopSignal, RuntimeClientSetup, RuntimeClientSetupFile, RuntimeExecCommand,
    WorkspaceSourceResourceKind,
};

/// Describes why one runtime-plan setup step failed while applying session input.
#[derive(Debug)]
pub enum RuntimePlanApplyError {
    InvalidRuntimePlan(serde_json::Error),
    ArtifactInstall {
        artifact_index: usize,
        install_index: usize,
        artifact_key: String,
        op: &'static str,
        error: String,
    },
    WorkspaceSource {
        source_index: usize,
        source_kind: &'static str,
        path: String,
        origin_url: String,
        clone_url: Option<String>,
        error: String,
    },
    SkillsReconcile {
        origin_url: String,
        runtime_id: String,
        repo_path: Option<String>,
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
            Self::ArtifactInstall {
                artifact_index,
                install_index,
                artifact_key,
                op,
                error,
            } => write!(
                f,
                "runtime plan artifacts[{artifact_index}] lifecycle.install[{install_index}] failed (artifactKey={artifact_key} op={op}): {error}"
            ),
            Self::WorkspaceSource {
                source_index,
                source_kind,
                path,
                origin_url,
                clone_url,
                error,
            } => write!(
                f,
                "runtime plan workspaceSources[{source_index}] failed (sourceKind={source_kind} path={path} originUrl={origin_url}{}): {error}",
                clone_url
                    .as_ref()
                    .map(|value| format!(" cloneUrl={value}"))
                    .unwrap_or_default()
            ),
            Self::SkillsReconcile {
                origin_url,
                runtime_id,
                repo_path,
                error,
            } => write!(
                f,
                "runtime plan skills reconciliation failed (originUrl={origin_url} runtimeId={runtime_id}{}): {error}",
                repo_path
                    .as_ref()
                    .map(|value| format!(" repoPath={value}"))
                    .unwrap_or_default()
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimePlanApplyLifecycleStep {
    RuntimeArtifacts,
    WorkspaceSources,
    Skills,
    RuntimeFiles,
}

pub trait RuntimePlanApplyObserver {
    fn record_step_started(&self, step: RuntimePlanApplyLifecycleStep);

    fn record_step_completed(&self, step: RuntimePlanApplyLifecycleStep);
}

/// Applies the artifact, workspace-source, and setup-file portions of one session runtime plan.
pub fn apply_runtime_plan(
    session_input: &SessionRuntimeInput,
) -> Result<(), RuntimePlanApplyError> {
    let runtime_plan: CompiledRuntimePlan =
        serde_json::from_value(session_input.runtime_plan.clone())
            .map_err(RuntimePlanApplyError::InvalidRuntimePlan)?;
    apply_compiled_runtime_plan(&runtime_plan, None)
}

/// Applies the artifact, workspace-source, and setup-file portions of one compiled runtime plan.
pub fn apply_compiled_runtime_plan(
    runtime_plan: &CompiledRuntimePlan,
    managed_env: Option<&BTreeMap<String, String>>,
) -> Result<(), RuntimePlanApplyError> {
    apply_compiled_runtime_plan_with_output_sink(runtime_plan, managed_env, None)
}

/// Applies the artifact, workspace-source, and setup-file portions of one compiled runtime plan,
/// teeing subprocess output to the provided sink when runtime setup commands run.
pub fn apply_compiled_runtime_plan_with_output_sink(
    runtime_plan: &CompiledRuntimePlan,
    managed_env: Option<&BTreeMap<String, String>>,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
) -> Result<(), RuntimePlanApplyError> {
    apply_compiled_runtime_plan_with_output_sink_and_observer(
        runtime_plan,
        managed_env,
        output_sink,
        None,
    )
}

/// Applies runtime-plan setup while notifying an observer about user-visible setup sections.
pub fn apply_compiled_runtime_plan_with_output_sink_and_observer(
    runtime_plan: &CompiledRuntimePlan,
    managed_env: Option<&BTreeMap<String, String>>,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
    observer: Option<&dyn RuntimePlanApplyObserver>,
) -> Result<(), RuntimePlanApplyError> {
    // Materialize artifacts, workspace sources, and setup files before later PRs add
    // long-lived process supervision on top of this state.
    if runtime_plan
        .artifacts
        .iter()
        .any(|artifact| !artifact.lifecycle.install.is_empty())
        && let Some(observer) = observer
    {
        observer.record_step_started(RuntimePlanApplyLifecycleStep::RuntimeArtifacts);
    }
    for (artifact_index, artifact) in runtime_plan.artifacts.iter().enumerate() {
        for (install_index, install_step) in artifact.lifecycle.install.iter().enumerate() {
            artifact_install::apply_artifact_install_step(
                install_step,
                managed_env,
                output_sink.clone(),
            )
            .map_err(|error| RuntimePlanApplyError::ArtifactInstall {
                artifact_index,
                install_index,
                artifact_key: artifact.artifact_key.clone(),
                op: artifact_install::artifact_install_step_op(install_step),
                error,
            })?;
        }
    }
    if runtime_plan
        .artifacts
        .iter()
        .any(|artifact| !artifact.lifecycle.install.is_empty())
        && let Some(observer) = observer
    {
        observer.record_step_completed(RuntimePlanApplyLifecycleStep::RuntimeArtifacts);
    }

    if !runtime_plan.workspace_sources.is_empty()
        && let Some(observer) = observer
    {
        observer.record_step_started(RuntimePlanApplyLifecycleStep::WorkspaceSources);
    }
    for (source_index, workspace_source) in runtime_plan.workspace_sources.iter().enumerate() {
        let (source_kind, path, origin_url, clone_url) = match workspace_source {
            plan::CompiledWorkspaceSource::GitClone {
                path,
                origin_url,
                clone_url,
                ..
            } => (
                "git-clone",
                path.clone(),
                origin_url.clone(),
                clone_url.clone(),
            ),
        };
        workspace_source::apply_workspace_source(
            workspace_source,
            managed_env,
            output_sink.clone(),
        )
        .map_err(|error| RuntimePlanApplyError::WorkspaceSource {
            source_index,
            source_kind,
            path,
            origin_url,
            clone_url,
            error,
        })?;
    }
    if !runtime_plan.workspace_sources.is_empty()
        && let Some(observer) = observer
    {
        observer.record_step_completed(RuntimePlanApplyLifecycleStep::WorkspaceSources);
    }

    if let Some(skills) = &runtime_plan.skills {
        if let Some(observer) = observer {
            observer.record_step_started(RuntimePlanApplyLifecycleStep::Skills);
        }
        let runtime_id = resolve_runtime_plan_skills_runtime_id(runtime_plan);
        let repo_path = resolve_runtime_plan_skills_repo_path(runtime_plan, &skills.origin_url)
            .map_err(|error| RuntimePlanApplyError::SkillsReconcile {
                origin_url: skills.origin_url.clone(),
                runtime_id: runtime_id.clone(),
                repo_path: None,
                error,
            })?;
        apply_runtime_plan_skills(skills, &runtime_id, &repo_path).map_err(|error| {
            RuntimePlanApplyError::SkillsReconcile {
                origin_url: skills.origin_url.clone(),
                runtime_id,
                repo_path: Some(repo_path),
                error,
            }
        })?;
        if let Some(observer) = observer {
            observer.record_step_completed(RuntimePlanApplyLifecycleStep::Skills);
        }
    }

    if runtime_plan
        .runtime_clients
        .iter()
        .any(|runtime_client| !runtime_client.setup.files.is_empty())
        && let Some(observer) = observer
    {
        observer.record_step_started(RuntimePlanApplyLifecycleStep::RuntimeFiles);
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
    if runtime_plan
        .runtime_clients
        .iter()
        .any(|runtime_client| !runtime_client.setup.files.is_empty())
        && let Some(observer) = observer
    {
        observer.record_step_completed(RuntimePlanApplyLifecycleStep::RuntimeFiles);
    }

    Ok(())
}

fn apply_runtime_plan_skills(
    skills: &CompiledRuntimePlanSkills,
    runtime_id: &str,
    repo_path: &str,
) -> Result<(), String> {
    let runtime = SkillsRuntime::parse(runtime_id).map_err(|error| error.to_string())?;
    let selected_skills = skills
        .selected_skills
        .iter()
        .map(|skill| SkillsReconcileSelection {
            name: skill.name.clone(),
            relative_path: skill.relative_path.clone(),
        })
        .collect::<Vec<_>>();

    reconcile_materialized_skills(Path::new(repo_path), &runtime, &selected_skills, None)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn resolve_runtime_plan_skills_runtime_id(runtime_plan: &CompiledRuntimePlan) -> String {
    runtime_plan
        .agent_runtimes
        .first()
        .map(|agent_runtime| agent_runtime.runtime_id.clone())
        .unwrap_or_default()
}

fn resolve_runtime_plan_skills_repo_path(
    runtime_plan: &CompiledRuntimePlan,
    origin_url: &str,
) -> Result<String, String> {
    let mut matching_paths = runtime_plan
        .workspace_sources
        .iter()
        .filter_map(|workspace_source| match workspace_source {
            plan::CompiledWorkspaceSource::GitClone {
                origin_url: workspace_origin_url,
                path,
                ..
            } if workspace_origin_url == origin_url => Some(path.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();

    if matching_paths.is_empty() {
        return Err(format!(
            "skills source '{origin_url}' was not found in runtime plan workspace sources"
        ));
    }

    if matching_paths.len() > 1 {
        return Err(format!(
            "skills source '{origin_url}' matched multiple runtime plan workspace sources"
        ));
    }

    let Some(path) = matching_paths.pop() else {
        return Err(format!(
            "skills source '{origin_url}' was not found in runtime plan workspace sources"
        ));
    };

    Ok(path)
}
