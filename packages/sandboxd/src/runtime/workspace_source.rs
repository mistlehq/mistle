use std::collections::BTreeMap;
use std::fs::DirBuilder;
use std::os::unix::fs::DirBuilderExt;
use std::path::Path;

use super::plan::{CompiledWorkspaceSource, RuntimeExecCommand, WorkspaceSourceResourceKind};
use crate::command::{CommandSpec, DEFAULT_COMMAND_POLL_INTERVAL, run_command};
use crate::time::{SystemClock, ThreadSleeper};

const EGRESS_GRANT_HEADER_NAME: &str = "X-Mistle-Egress-Grant";

pub fn apply_workspace_source(workspace_source: &CompiledWorkspaceSource) -> Result<(), String> {
    match workspace_source {
        CompiledWorkspaceSource::GitClone {
            resource_kind: WorkspaceSourceResourceKind::Repository,
            path,
            origin_url,
            clone_url,
            egress_grant_token,
        } => apply_git_clone_workspace_source(
            path,
            origin_url,
            clone_url.as_deref(),
            egress_grant_token.as_deref(),
        ),
    }
}

fn apply_git_clone_workspace_source(
    path: &str,
    origin_url: &str,
    clone_url: Option<&str>,
    egress_grant_token: Option<&str>,
) -> Result<(), String> {
    if Path::new(path).exists() {
        return Ok(());
    }

    let parent_directory = Path::new(path)
        .parent()
        .ok_or_else(|| format!("workspace source path {path} has no parent directory"))?;
    DirBuilder::new()
        .recursive(true)
        .mode(0o755)
        .create(parent_directory)
        .map_err(|error| {
            format!(
                "failed to create parent directory {}: {error}",
                parent_directory.display()
            )
        })?;

    let env = BTreeMap::from([("GIT_TERMINAL_PROMPT".to_string(), "0".to_string())]);
    let mut args = vec!["git".to_string()];
    if let Some(egress_grant_token) = egress_grant_token {
        args.push("-c".to_string());
        args.push(format!(
            "http.extraHeader={EGRESS_GRANT_HEADER_NAME}: {egress_grant_token}"
        ));
    }
    args.extend([
        "clone".to_string(),
        "--origin".to_string(),
        "origin".to_string(),
        clone_url.unwrap_or(origin_url).to_string(),
        path.to_string(),
    ]);

    let command = RuntimeExecCommand {
        args,
        env: Some(env),
        cwd: None,
        timeout_ms: None,
    };

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
    .map_err(|error| format!("failed to clone repository: {error}"))?;

    if clone_url.is_some_and(|clone_url| clone_url != origin_url) {
        let update_origin_command = RuntimeExecCommand {
            args: vec![
                "git".to_string(),
                "-C".to_string(),
                path.to_string(),
                "remote".to_string(),
                "set-url".to_string(),
                "origin".to_string(),
                origin_url.to_string(),
            ],
            env: Some(BTreeMap::from([(
                "GIT_TERMINAL_PROMPT".to_string(),
                "0".to_string(),
            )])),
            cwd: None,
            timeout_ms: None,
        };

        run_command(
            CommandSpec {
                args: &update_origin_command.args,
                env: update_origin_command.env.as_ref(),
                cwd: update_origin_command.cwd.as_deref(),
                timeout_ms: update_origin_command.timeout_ms,
            },
            &SystemClock,
            &ThreadSleeper,
            DEFAULT_COMMAND_POLL_INTERVAL,
        )
        .map_err(|error| format!("failed to restore repository origin url: {error}"))?;
    }

    Ok(())
}
