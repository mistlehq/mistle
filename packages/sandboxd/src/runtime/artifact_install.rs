use crate::command::{CommandSpec, DEFAULT_COMMAND_POLL_INTERVAL, run_command};
use crate::time::{SystemClock, ThreadSleeper};

use super::{RuntimeArtifactInstallEntry, RuntimeArtifactInstallStep, RuntimeExecCommand};

pub(crate) fn artifact_install_entry_op(entry: &RuntimeArtifactInstallEntry) -> &'static str {
    match entry {
        RuntimeArtifactInstallEntry::LegacyCommand(_) => "legacy_command",
        RuntimeArtifactInstallEntry::Step(step) => artifact_install_step_op(step),
    }
}

pub(crate) fn apply_artifact_install_entry(entry: &RuntimeArtifactInstallEntry) -> Result<(), String> {
    match entry {
        RuntimeArtifactInstallEntry::LegacyCommand(command) => apply_exec_command(command),
        RuntimeArtifactInstallEntry::Step(step) => apply_artifact_install_step(step),
    }
}

fn artifact_install_step_op(step: &RuntimeArtifactInstallStep) -> &'static str {
    match step {
        RuntimeArtifactInstallStep::GitHubReleaseInstall { .. } => "github_release_install",
        RuntimeArtifactInstallStep::MiseInstall { .. } => "mise_install",
        RuntimeArtifactInstallStep::Exec { .. } => "exec",
    }
}

fn apply_artifact_install_step(step: &RuntimeArtifactInstallStep) -> Result<(), String> {
    match step {
        RuntimeArtifactInstallStep::Exec { command } => apply_exec_command(command),
        RuntimeArtifactInstallStep::MiseInstall {
            tools,
            force,
            timeout_ms,
        } => {
            let command = build_mise_install_command(tools, *force, *timeout_ms);
            apply_exec_command(&command)
        }
        RuntimeArtifactInstallStep::GitHubReleaseInstall { .. } => Err(
            "artifact install op 'github_release_install' is not supported yet by sandboxd"
                .to_string(),
        ),
    }
}

fn apply_exec_command(command: &RuntimeExecCommand) -> Result<(), String> {
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

fn build_mise_install_command(
    tools: &[String],
    force: Option<bool>,
    timeout_ms: Option<u64>,
) -> RuntimeExecCommand {
    let mut args = vec!["mise".to_string(), "install".to_string()];
    if force == Some(true) {
        args.push("--force".to_string());
    }
    args.extend(tools.iter().cloned());

    RuntimeExecCommand {
        args,
        env: None,
        cwd: None,
        timeout_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::build_mise_install_command;

    #[test]
    fn builds_mise_install_command_with_optional_force_and_timeout() {
        let command = build_mise_install_command(
            &[String::from("node@22.0.0"), String::from("pnpm@10.0.0")],
            Some(true),
            Some(120_000),
        );

        assert_eq!(
            command.args,
            vec![
                "mise".to_string(),
                "install".to_string(),
                "--force".to_string(),
                "node@22.0.0".to_string(),
                "pnpm@10.0.0".to_string(),
            ]
        );
        assert_eq!(command.timeout_ms, Some(120_000));
    }
}
