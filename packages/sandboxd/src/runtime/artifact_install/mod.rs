use std::collections::BTreeMap;
use std::sync::Arc;

use crate::command::CommandOutputSink;
use crate::time::{Clock, Sleeper, SystemClock, ThreadSleeper};

mod archive;
mod exec;
mod github;
mod retry;
mod workspace;

use archive::*;
use exec::*;
use github::*;
use retry::*;
use workspace::*;

use super::RuntimeArtifactInstallStep;
use super::plan::{RuntimeArtifactGitHubReleaseInstallAsset, RuntimeArtifactGitHubReleaseSelector};

pub(super) const GITHUB_API_BASE_URL: &str = "https://api.github.com";
pub(super) const GITHUB_RELEASES_BASE_URL: &str = "https://github.com";
pub(super) const GITHUB_API_ACCEPT_HEADER: &str = "application/vnd.github+json";
pub(super) const GITHUB_INSTALLER_USER_AGENT: &str = "mistle-sandboxd-artifact-installer";
pub(super) const GITHUB_RELEASE_ATTEMPTS: usize = 3;
pub(super) const GITHUB_RELEASE_RETRY_BACKOFFS_MS: [u64; 2] = [1_000, 2_000];
pub(super) const INSTALLED_BINARY_MODE: u32 = 0o755;

pub(crate) fn artifact_install_step_op(step: &RuntimeArtifactInstallStep) -> &'static str {
    match step {
        RuntimeArtifactInstallStep::GitHubReleaseInstall { .. } => "github_release_install",
        RuntimeArtifactInstallStep::MiseInstall { .. } => "mise_install",
        RuntimeArtifactInstallStep::Exec { .. } => "exec",
    }
}

pub(crate) fn apply_artifact_install_step(
    step: &RuntimeArtifactInstallStep,
    managed_env: Option<&BTreeMap<String, String>>,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
) -> Result<(), String> {
    apply_artifact_install_step_with_dependencies(
        step,
        managed_env,
        output_sink,
        &SystemClock,
        &ThreadSleeper,
    )
}

fn apply_artifact_install_step_with_dependencies<C, S>(
    step: &RuntimeArtifactInstallStep,
    managed_env: Option<&BTreeMap<String, String>>,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
    clock: &C,
    sleeper: &S,
) -> Result<(), String>
where
    C: Clock,
    S: Sleeper,
{
    match step {
        RuntimeArtifactInstallStep::Exec { command } => {
            apply_exec_command(command, managed_env, output_sink, clock, sleeper)
        }
        RuntimeArtifactInstallStep::MiseInstall {
            tools,
            force,
            timeout_ms,
        } => {
            let command = build_mise_install_command(tools, *force, *timeout_ms);
            apply_exec_command(&command, managed_env, output_sink, clock, sleeper)
        }
        RuntimeArtifactInstallStep::GitHubReleaseInstall {
            repository,
            release,
            asset,
            install_path,
            timeout_ms,
        } => apply_github_release_install(
            GitHubReleaseInstallRequest {
                repository,
                release,
                asset,
                install_path,
                timeout_ms: *timeout_ms,
                managed_env,
            },
            clock,
            sleeper,
        ),
    }
}

pub(super) struct GitHubReleaseInstallRequest<'a> {
    pub(super) repository: &'a str,
    pub(super) release: &'a RuntimeArtifactGitHubReleaseSelector,
    pub(super) asset: &'a RuntimeArtifactGitHubReleaseInstallAsset,
    pub(super) install_path: &'a str,
    pub(super) timeout_ms: Option<u64>,
    pub(super) managed_env: Option<&'a BTreeMap<String, String>>,
}

#[cfg(test)]
mod tests;
