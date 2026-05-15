use std::collections::BTreeMap;
use std::fs::DirBuilder;
use std::os::unix::fs::DirBuilderExt;
use std::path::Path;
use std::sync::Arc;

use super::plan::{CompiledWorkspaceSource, RuntimeExecCommand, WorkspaceSourceResourceKind};
use crate::command::{
    CommandOutputSink, CommandSpec, DEFAULT_COMMAND_POLL_INTERVAL,
    run_command_with_details_and_output_sink,
};
use crate::time::{SystemClock, ThreadSleeper};

const EGRESS_GRANT_HEADER_NAME: &str = "X-Mistle-Egress-Grant";

pub fn apply_workspace_source(
    workspace_source: &CompiledWorkspaceSource,
    managed_env: Option<&BTreeMap<String, String>>,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
) -> Result<(), String> {
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
            managed_env,
            output_sink,
        ),
    }
}

fn apply_git_clone_workspace_source(
    path: &str,
    origin_url: &str,
    clone_url: Option<&str>,
    egress_grant_token: Option<&str>,
    managed_env: Option<&BTreeMap<String, String>>,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
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

    let env = build_git_command_environment(managed_env)?;
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
        env: Some(env.clone()),
        cwd: None,
        timeout_ms: None,
    };

    run_command_with_details_and_output_sink(
        CommandSpec {
            args: &command.args,
            env: command.env.as_ref(),
            cwd: command.cwd.as_deref(),
            timeout_ms: command.timeout_ms,
        },
        &SystemClock,
        &ThreadSleeper,
        DEFAULT_COMMAND_POLL_INTERVAL,
        output_sink.clone(),
    )
    .map_err(|error| error.message)
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
            env: Some(env),
            cwd: None,
            timeout_ms: None,
        };

        run_command_with_details_and_output_sink(
            CommandSpec {
                args: &update_origin_command.args,
                env: update_origin_command.env.as_ref(),
                cwd: update_origin_command.cwd.as_deref(),
                timeout_ms: update_origin_command.timeout_ms,
            },
            &SystemClock,
            &ThreadSleeper,
            DEFAULT_COMMAND_POLL_INTERVAL,
            output_sink,
        )
        .map_err(|error| error.message)
        .map_err(|error| format!("failed to restore repository origin url: {error}"))?;
    }

    Ok(())
}

fn build_git_command_environment(
    managed_env: Option<&BTreeMap<String, String>>,
) -> Result<BTreeMap<String, String>, String> {
    let mut env = managed_env.cloned().unwrap_or_default();
    match env.get("GIT_TERMINAL_PROMPT") {
        Some(existing_value) if existing_value != "0" => {
            return Err(
                "managed runtime env defines 'GIT_TERMINAL_PROMPT', which workspace clone reserves"
                    .to_string(),
            );
        }
        Some(_) => {}
        None => {
            env.insert("GIT_TERMINAL_PROMPT".to_string(), "0".to_string());
        }
    }
    Ok(env)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::build_git_command_environment;

    #[test]
    fn git_clone_environment_includes_managed_proxy_settings() {
        let managed_env = BTreeMap::from([
            (
                "HTTPS_PROXY".to_string(),
                "http://127.0.0.1:4819".to_string(),
            ),
            (
                "GIT_SSL_CAINFO".to_string(),
                "/run/mistle/proxy-ca-bundle.crt".to_string(),
            ),
        ]);

        let env = build_git_command_environment(Some(&managed_env))
            .expect("workspace clone env should merge managed values");

        assert_eq!(
            env.get("HTTPS_PROXY"),
            Some(&"http://127.0.0.1:4819".to_string())
        );
        assert_eq!(
            env.get("GIT_SSL_CAINFO"),
            Some(&"/run/mistle/proxy-ca-bundle.crt".to_string())
        );
        assert_eq!(env.get("GIT_TERMINAL_PROMPT"), Some(&"0".to_string()));
    }

    #[test]
    fn git_clone_environment_rejects_terminal_prompt_override() {
        let managed_env = BTreeMap::from([("GIT_TERMINAL_PROMPT".to_string(), "1".to_string())]);

        let error = build_git_command_environment(Some(&managed_env))
            .expect_err("workspace clone env should reserve terminal prompt behavior");

        assert_eq!(
            error,
            "managed runtime env defines 'GIT_TERMINAL_PROMPT', which workspace clone reserves"
        );
    }
}
