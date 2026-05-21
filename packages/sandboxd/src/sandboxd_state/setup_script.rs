use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Arc;

use crate::command::{
    CommandFailure, CommandOutputSink, CommandSpec, DEFAULT_COMMAND_POLL_INTERVAL,
    run_command_with_details_and_output_sink,
};
use crate::pty::{DEFAULT_PTY_SHELL, DEFAULT_PTY_TERM};
use crate::runtime;
use crate::sandboxd_state::{SETUP_SCRIPT_FILE_MODE, SETUP_SCRIPT_WORKING_DIRECTORY};
use crate::time::{Clock, Sleeper};

#[cfg(test)]
pub(super) fn run_setup_script<C, S>(
    runtime_plan: &runtime::CompiledRuntimePlan,
    runtime_env: &BTreeMap<String, String>,
    clock: &C,
    sleeper: &S,
) -> Result<(), CommandFailure>
where
    C: Clock + ?Sized,
    S: Sleeper + ?Sized,
{
    run_setup_script_with_output_sink(runtime_plan, runtime_env, clock, sleeper, None)
}

pub(super) fn run_setup_script_with_output_sink<C, S>(
    runtime_plan: &runtime::CompiledRuntimePlan,
    runtime_env: &BTreeMap<String, String>,
    clock: &C,
    sleeper: &S,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
) -> Result<(), CommandFailure>
where
    C: Clock + ?Sized,
    S: Sleeper + ?Sized,
{
    run_setup_script_in_directory_with_output_sink(
        runtime_plan,
        runtime_env,
        SETUP_SCRIPT_WORKING_DIRECTORY,
        clock,
        sleeper,
        output_sink,
    )
}

#[cfg(test)]
pub(super) fn run_setup_script_in_directory<C, S>(
    runtime_plan: &runtime::CompiledRuntimePlan,
    runtime_env: &BTreeMap<String, String>,
    working_directory: &str,
    clock: &C,
    sleeper: &S,
) -> Result<(), CommandFailure>
where
    C: Clock + ?Sized,
    S: Sleeper + ?Sized,
{
    run_setup_script_in_directory_with_output_sink(
        runtime_plan,
        runtime_env,
        working_directory,
        clock,
        sleeper,
        None,
    )
}

pub(super) fn run_setup_script_in_directory_with_output_sink<C, S>(
    runtime_plan: &runtime::CompiledRuntimePlan,
    runtime_env: &BTreeMap<String, String>,
    working_directory: &str,
    clock: &C,
    sleeper: &S,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
) -> Result<(), CommandFailure>
where
    C: Clock + ?Sized,
    S: Sleeper + ?Sized,
{
    let Some(setup_script) = runtime_plan.setup_script.as_ref() else {
        return Ok(());
    };
    if setup_script.trim().is_empty() {
        return Ok(());
    }

    let mut setup_script_file = tempfile::Builder::new()
        .prefix("mistle-setup-script-")
        .suffix(".sh")
        .tempfile()
        .map_err(|error| {
            setup_script_file_failure(format!("failed to create temporary file: {error}"))
        })?;
    setup_script_file
        .write_all(setup_script.as_bytes())
        .map_err(|error| {
            setup_script_file_failure(format!("failed to write temporary script file: {error}"))
        })?;
    setup_script_file.as_file_mut().flush().map_err(|error| {
        setup_script_file_failure(format!("failed to flush temporary script file: {error}"))
    })?;
    fs::set_permissions(
        setup_script_file.path(),
        fs::Permissions::from_mode(SETUP_SCRIPT_FILE_MODE),
    )
    .map_err(|error| {
        setup_script_file_failure(format!(
            "failed to make temporary script executable: {error}"
        ))
    })?;

    let setup_script_path = setup_script_file.into_temp_path();
    let setup_script_path_ref: &Path = setup_script_path.as_ref();
    let setup_script_command_path = setup_script_path_ref
        .to_str()
        .ok_or_else(|| {
            setup_script_file_failure("temporary script path is not valid unicode".to_string())
        })?
        .to_string();
    let shell_args = build_setup_script_command_args(setup_script, setup_script_command_path);
    let environment = build_setup_script_environment(runtime_env);

    let run_result = run_command_with_details_and_output_sink(
        CommandSpec {
            args: &shell_args,
            env: Some(&environment),
            cwd: Some(working_directory),
            timeout_ms: None,
        },
        clock,
        sleeper,
        DEFAULT_COMMAND_POLL_INTERVAL,
        output_sink,
    );
    let cleanup_result = setup_script_path.close().map_err(|error| {
        setup_script_file_failure(format!("failed to remove temporary script file: {error}"))
    });

    match (run_result, cleanup_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), Err(error)) | (Err(_), Err(error)) => Err(error),
    }
}

fn build_setup_script_command_args(setup_script: &str, setup_script_path: String) -> Vec<String> {
    if setup_script.as_bytes().starts_with(b"#!") {
        return vec![setup_script_path];
    }

    vec![
        DEFAULT_PTY_SHELL.to_string(),
        "-l".to_string(),
        setup_script_path,
    ]
}

fn setup_script_file_failure(message: String) -> CommandFailure {
    CommandFailure {
        message,
        exit_code: None,
        timed_out: false,
        output_tails: Default::default(),
    }
}

pub(super) fn build_setup_script_environment(
    runtime_env: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut environment = std::env::vars().collect::<BTreeMap<_, _>>();
    environment.insert("TERM".to_string(), DEFAULT_PTY_TERM.to_string());

    for (name, value) in runtime_env {
        environment.insert(name.clone(), value.clone());
    }

    environment
}
