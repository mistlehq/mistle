use std::collections::BTreeMap;
use std::sync::Arc;

use crate::command::{
    CommandOutputSink, CommandSpec, DEFAULT_COMMAND_POLL_INTERVAL,
    run_command_with_details_and_output_sink,
};
use crate::runtime::RuntimeExecCommand;
use crate::time::{Clock, Sleeper};

pub(super) fn apply_exec_command<C, S>(
    command: &RuntimeExecCommand,
    managed_env: Option<&BTreeMap<String, String>>,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
    clock: &C,
    sleeper: &S,
) -> Result<(), String>
where
    C: Clock,
    S: Sleeper,
{
    let env = merge_exec_environment(command.env.as_ref(), managed_env)?;
    run_command_with_details_and_output_sink(
        CommandSpec {
            args: &command.args,
            env: env.as_ref(),
            cwd: command.cwd.as_deref(),
            timeout_ms: command.timeout_ms,
        },
        clock,
        sleeper,
        DEFAULT_COMMAND_POLL_INTERVAL,
        output_sink,
    )
    .map_err(|error| error.message)
}

pub(super) fn merge_exec_environment(
    command_env: Option<&BTreeMap<String, String>>,
    managed_env: Option<&BTreeMap<String, String>>,
) -> Result<Option<BTreeMap<String, String>>, String> {
    let Some(managed_env) = managed_env else {
        return Ok(command_env.cloned());
    };
    let mut merged = command_env.cloned().unwrap_or_default();
    for (name, value) in managed_env {
        match merged.get(name) {
            Some(existing_value) if existing_value != value => {
                return Err(format!(
                    "artifact install command env defines managed env '{name}', which sandboxd reserves"
                ));
            }
            Some(_) => {}
            None => {
                merged.insert(name.clone(), value.clone());
            }
        }
    }
    Ok(Some(merged))
}

pub(super) fn build_mise_install_command(
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
