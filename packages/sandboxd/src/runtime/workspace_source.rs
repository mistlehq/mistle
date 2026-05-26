//! Workspace-source materialization for runtime clients.
//!
//! Runtime plans can source workspace content from repositories; this module
//! applies git-clone workspace sources before runtime processes are started.

use std::collections::BTreeMap;
use std::fs::DirBuilder;
use std::os::unix::fs::DirBuilderExt;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use super::plan::{CompiledWorkspaceSource, RuntimeExecCommand, WorkspaceSourceResourceKind};
use crate::command::{
    CommandFailure, CommandOutputSink, CommandSpec, DEFAULT_COMMAND_POLL_INTERVAL,
    run_command_with_details_and_output_sink,
};
use crate::time::{Sleeper, SystemClock, ThreadSleeper};

const EGRESS_GRANT_HEADER_NAME: &str = "X-Mistle-Egress-Grant";
const GIT_CLONE_ATTEMPTS: usize = 3;
const GIT_CLONE_RETRY_BACKOFFS_MS: [u64; 2] = [1_000, 2_000];

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

    run_git_clone_command_with_retry(&command, output_sink.clone(), &ThreadSleeper)?;

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

fn run_git_clone_command_with_retry(
    command: &RuntimeExecCommand,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
    sleeper: &dyn Sleeper,
) -> Result<(), String> {
    for attempt_index in 0..GIT_CLONE_ATTEMPTS {
        match run_command_with_details_and_output_sink(
            CommandSpec {
                args: &command.args,
                env: command.env.as_ref(),
                cwd: command.cwd.as_deref(),
                timeout_ms: command.timeout_ms,
            },
            &SystemClock,
            sleeper,
            DEFAULT_COMMAND_POLL_INTERVAL,
            output_sink.clone(),
        ) {
            Ok(()) => return Ok(()),
            Err(error) => {
                let attempt_number = attempt_index + 1;
                let attempts_remaining = GIT_CLONE_ATTEMPTS - attempt_number;
                let should_retry = attempts_remaining > 0 && is_retryable_git_clone_failure(&error);
                if !should_retry {
                    return Err(format_git_clone_failure(error, attempt_number));
                }

                let backoff_ms = GIT_CLONE_RETRY_BACKOFFS_MS
                    .get(attempt_index)
                    .copied()
                    .unwrap_or_default();
                sleeper.sleep(Duration::from_millis(backoff_ms));
            }
        }
    }

    Err("failed to clone repository: git clone retry loop exhausted unexpectedly".to_string())
}

fn format_git_clone_failure(error: CommandFailure, attempt_count: usize) -> String {
    if attempt_count <= 1 {
        return format!("failed to clone repository: {}", error.message);
    }

    format!(
        "failed to clone repository after {attempt_count} attempts: {}",
        error.message
    )
}

fn is_retryable_git_clone_failure(error: &CommandFailure) -> bool {
    if error.timed_out {
        return true;
    }

    let failure_text = [
        Some(error.message.as_str()),
        error.output_tails.stdout_tail.as_deref(),
        error.output_tails.stderr_tail.as_deref(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join("\n")
    .to_ascii_lowercase();

    is_retryable_git_http_failure(&failure_text) || is_retryable_git_network_failure(&failure_text)
}

fn is_retryable_git_http_failure(failure_text: &str) -> bool {
    [
        "returned error: 403",
        "returned error: 404",
        "returned error: 429",
        "returned error: 500",
        "returned error: 502",
        "returned error: 503",
        "returned error: 504",
        "http 403",
        "http 404",
        "http 429",
        "http 500",
        "http 502",
        "http 503",
        "http 504",
    ]
    .iter()
    .any(|needle| failure_text.contains(needle))
}

fn is_retryable_git_network_failure(failure_text: &str) -> bool {
    [
        "could not resolve host",
        "couldn't connect to server",
        "failed to connect",
        "connection reset",
        "connection timed out",
        "early eof",
        "gnutls recv error",
        "network is unreachable",
        "operation timed out",
        "ssl connection timeout",
        "temporary failure in name resolution",
        "tls connection",
    ]
    .iter()
    .any(|needle| failure_text.contains(needle))
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
    use std::fs;
    use std::path::Path;
    use std::time::Duration;

    use crate::command::{CommandFailure, CommandOutputTails};
    use crate::runtime::plan::RuntimeExecCommand;
    use crate::time::testing::ManualSleeper;

    use super::{
        build_git_command_environment, format_git_clone_failure, is_retryable_git_clone_failure,
        run_git_clone_command_with_retry,
    };

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

    #[test]
    fn classifies_transient_git_clone_failures_as_retryable() {
        let failures = [
            "fatal: unable to access 'https://github.com/org/private.git/': The requested URL returned error: 404",
            "fatal: unable to access 'https://github.com/org/private.git/': The requested URL returned error: 429",
            "fatal: unable to access 'https://github.com/org/private.git/': Failed to connect to github.com port 443",
            "fatal: unable to access 'https://github.com/org/private.git/': Could not resolve host: github.com",
            "error: RPC failed; HTTP 502 curl 22 The requested URL returned error: 502",
        ];

        for failure in failures {
            assert!(
                is_retryable_git_clone_failure(&command_failure(failure)),
                "expected retryable git clone failure: {failure}"
            );
        }
    }

    #[test]
    fn keeps_local_git_clone_failures_terminal() {
        let failures = [
            "fatal: destination path '/workspace/repo' already exists and is not an empty directory.",
            "fatal: repository 'not-a-url' does not exist",
            "git: 'clonee' is not a git command. See 'git --help'.",
        ];

        for failure in failures {
            assert!(
                !is_retryable_git_clone_failure(&command_failure(failure)),
                "expected terminal git clone failure: {failure}"
            );
        }
    }

    #[test]
    fn includes_attempt_count_after_retry_exhaustion() {
        let error = format_git_clone_failure(command_failure("returned error: 404"), 3);

        assert_eq!(
            error,
            "failed to clone repository after 3 attempts: returned error: 404"
        );
    }

    #[test]
    fn retries_transient_git_clone_failures_until_subprocess_succeeds() {
        let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
        let attempts_path = temp_dir.path().join("attempts");
        let sleeper = ManualSleeper::default();
        let command = shell_command(
            r#"
attempts=$(cat "$ATTEMPTS_PATH" 2>/dev/null || printf '0')
attempts=$((attempts + 1))
printf '%s' "$attempts" > "$ATTEMPTS_PATH"
if [ "$attempts" -lt 3 ]; then
  printf '%s\n' "fatal: unable to access 'https://github.com/mistlehq/mistle.git/': The requested URL returned error: 502" >&2
  exit 128
fi
exit 0
"#,
            &attempts_path,
        );

        run_git_clone_command_with_retry(&command, None, &sleeper)
            .expect("third transient clone attempt should succeed");

        assert_eq!(read_attempt_count(&attempts_path), 3);
        assert_eq!(
            sleeper.requested_durations(),
            vec![Duration::from_secs(1), Duration::from_secs(2)]
        );
    }

    #[test]
    fn does_not_retry_terminal_git_clone_failures() {
        let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
        let attempts_path = temp_dir.path().join("attempts");
        let sleeper = ManualSleeper::default();
        let command = shell_command(
            r#"
attempts=$(cat "$ATTEMPTS_PATH" 2>/dev/null || printf '0')
attempts=$((attempts + 1))
printf '%s' "$attempts" > "$ATTEMPTS_PATH"
printf '%s\n' "fatal: destination path '/workspace/repo' already exists and is not an empty directory." >&2
exit 128
"#,
            &attempts_path,
        );

        let error = run_git_clone_command_with_retry(&command, None, &sleeper)
            .expect_err("terminal clone failure should not be retried");

        assert_eq!(read_attempt_count(&attempts_path), 1);
        assert!(
            sleeper.requested_durations().is_empty(),
            "terminal clone failure should not request retry backoff"
        );
        assert!(
            error.starts_with("failed to clone repository: command failed with exit code 128"),
            "unexpected terminal clone error: {error}"
        );
    }

    #[test]
    fn stops_after_exhausting_transient_git_clone_retries() {
        let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
        let attempts_path = temp_dir.path().join("attempts");
        let sleeper = ManualSleeper::default();
        let command = shell_command(
            r#"
attempts=$(cat "$ATTEMPTS_PATH" 2>/dev/null || printf '0')
attempts=$((attempts + 1))
printf '%s' "$attempts" > "$ATTEMPTS_PATH"
printf '%s\n' "fatal: unable to access 'https://github.com/mistlehq/mistle.git/': The requested URL returned error: 502" >&2
exit 128
"#,
            &attempts_path,
        );

        let error = run_git_clone_command_with_retry(&command, None, &sleeper)
            .expect_err("transient clone failures should stop after bounded retries");

        assert_eq!(read_attempt_count(&attempts_path), 3);
        assert_eq!(
            sleeper.requested_durations(),
            vec![Duration::from_secs(1), Duration::from_secs(2)]
        );
        assert!(
            error.starts_with(
                "failed to clone repository after 3 attempts: command failed with exit code 128"
            ),
            "unexpected exhausted retry error: {error}"
        );
    }

    fn shell_command(script: &str, attempts_path: &Path) -> RuntimeExecCommand {
        RuntimeExecCommand {
            args: vec!["sh".to_string(), "-c".to_string(), script.to_string()],
            env: Some(BTreeMap::from([(
                "ATTEMPTS_PATH".to_string(),
                attempts_path
                    .to_str()
                    .expect("attempts path should be utf-8")
                    .to_string(),
            )])),
            cwd: None,
            timeout_ms: None,
        }
    }

    fn read_attempt_count(path: &Path) -> usize {
        fs::read_to_string(path)
            .expect("attempt count file should exist")
            .parse()
            .expect("attempt count should be numeric")
    }

    fn command_failure(message: &str) -> CommandFailure {
        CommandFailure {
            message: message.to_string(),
            exit_code: Some(128),
            timed_out: false,
            output_tails: CommandOutputTails {
                stdout_tail: None,
                stderr_tail: Some(message.to_string()),
                stdout_captured: false,
                stderr_captured: true,
            },
        }
    }
}
