//! Setup-script execution during sandbox initialization.
//!
//! Startup may include shell setup work that runs before runtime processes. This
//! module writes the script, executes it through the shared command runner, and
//! streams diagnostics output.

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
use crate::sandboxd_state::lifecycle::{SETUP_SCRIPT_FILE_MODE, SETUP_SCRIPT_WORKING_DIRECTORY};
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

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::runtime::{
        CompiledRuntimePlan, CompiledRuntimePlanImage, CompiledRuntimePlanImageSource,
    };
    use crate::sandboxd_state::lifecycle::SETUP_SCRIPT_WORKING_DIRECTORY;
    use crate::sandboxd_state::setup_script::{
        build_setup_script_environment, run_setup_script, run_setup_script_in_directory,
    };
    use crate::time::{SystemClock, ThreadSleeper};

    #[test]
    fn build_setup_script_environment_matches_pty_basics() {
        let environment = build_setup_script_environment(&BTreeMap::from([(
            "MISTLE_TEST_ENV".to_string(),
            "runtime-value".to_string(),
        )]));

        assert_eq!(
            environment.get("TERM"),
            Some(&crate::pty::DEFAULT_PTY_TERM.to_string())
        );
        assert_eq!(
            environment.get("MISTLE_TEST_ENV"),
            Some(&"runtime-value".to_string())
        );
        assert_eq!(SETUP_SCRIPT_WORKING_DIRECTORY, "/root");
    }

    #[test]
    fn run_setup_script_skips_missing_or_blank_scripts() {
        let runtime_env = BTreeMap::new();
        let missing_setup_script_plan = CompiledRuntimePlan {
            image: test_runtime_plan_image(CompiledRuntimePlanImageSource::Base),
            setup_script: None,
            egress_routes: Vec::new(),
            artifacts: Vec::new(),
            workspace_sources: Vec::new(),
            runtime_clients: Vec::new(),
            agent_runtimes: Vec::new(),
        };
        run_setup_script(
            &missing_setup_script_plan,
            &runtime_env,
            &SystemClock,
            &ThreadSleeper,
        )
        .expect("missing setup script should be a no-op");

        let blank_setup_script_plan = CompiledRuntimePlan {
            image: test_runtime_plan_image(CompiledRuntimePlanImageSource::Base),
            setup_script: Some("   \n\t  ".to_string()),
            egress_routes: Vec::new(),
            artifacts: Vec::new(),
            workspace_sources: Vec::new(),
            runtime_clients: Vec::new(),
            agent_runtimes: Vec::new(),
        };
        run_setup_script(
            &blank_setup_script_plan,
            &runtime_env,
            &SystemClock,
            &ThreadSleeper,
        )
        .expect("blank setup script should be a no-op");
    }

    #[test]
    fn run_setup_script_honors_user_shebang() {
        let output_path = std::env::temp_dir().join(format!(
            "mistle-setup-script-shebang-output-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let runtime_plan = CompiledRuntimePlan {
            image: test_runtime_plan_image(CompiledRuntimePlanImageSource::Base),
            setup_script: Some(format!(
                "#!/bin/false\nprintf 'script body ran' > {path}",
                path = output_path.display()
            )),
            egress_routes: Vec::new(),
            artifacts: Vec::new(),
            workspace_sources: Vec::new(),
            runtime_clients: Vec::new(),
            agent_runtimes: Vec::new(),
        };

        run_setup_script_in_directory(
            &runtime_plan,
            &BTreeMap::new(),
            std::env::temp_dir()
                .to_str()
                .expect("temporary directory should be valid unicode"),
            &SystemClock,
            &ThreadSleeper,
        )
        .expect_err("setup script should execute through the user shebang");

        assert!(
            !output_path.exists(),
            "setup script body should not run when the shebang interpreter exits first"
        );
    }

    #[test]
    fn run_setup_script_uses_root_cwd_and_runtime_environment() {
        let working_directory = std::env::temp_dir().join(format!(
            "mistle-setup-script-working-directory-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&working_directory)
            .expect("setup script test working directory should be created");
        let output_path = std::env::temp_dir().join(format!(
            "mistle-setup-script-output-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let runtime_plan = CompiledRuntimePlan {
            image: test_runtime_plan_image(CompiledRuntimePlanImageSource::Base),
            setup_script: Some(format!(
                "printf '%s\\n' \"$TERM\" > {path}; printf '%s\\n' \"$MISTLE_TEST_ENV\" >> {path}; pwd >> {path}; printf '%s\\n' \"$0\" >> {path}; test -x \"$0\" && printf 'executable\\n' >> {path}",
                path = output_path.display()
            )),
            egress_routes: Vec::new(),
            artifacts: Vec::new(),
            workspace_sources: Vec::new(),
            runtime_clients: Vec::new(),
            agent_runtimes: Vec::new(),
        };
        let runtime_env =
            BTreeMap::from([("MISTLE_TEST_ENV".to_string(), "runtime-value".to_string())]);

        run_setup_script_in_directory(
            &runtime_plan,
            &runtime_env,
            working_directory
                .to_str()
                .expect("working directory should be valid unicode"),
            &SystemClock,
            &ThreadSleeper,
        )
        .expect("setup script should run successfully");

        let output = std::fs::read_to_string(&output_path)
            .expect("setup script should write its output file");
        let output_lines = output.lines().collect::<Vec<_>>();
        let canonical_working_directory = std::fs::canonicalize(&working_directory)
            .expect("working directory should canonicalize");
        assert_eq!(
            output_lines[0..3],
            [
                "xterm-256color",
                "runtime-value",
                canonical_working_directory
                    .to_str()
                    .expect("working directory should be valid unicode")
            ]
        );
        let setup_script_path = output_lines
            .get(3)
            .expect("setup script should record its file path");
        assert_eq!(output_lines.get(4), Some(&"executable"));
        assert!(
            !std::path::Path::new(setup_script_path).exists(),
            "temporary setup script should be removed after execution"
        );

        let _ = std::fs::remove_file(output_path);
        let _ = std::fs::remove_dir_all(working_directory);
    }

    #[test]
    fn run_setup_script_captures_stdout_and_stderr_on_failure() {
        let runtime_plan = CompiledRuntimePlan {
            image: test_runtime_plan_image(CompiledRuntimePlanImageSource::Base),
            setup_script: Some(
                "printf '%s\\nstdout-line' \"$0\"; printf 'stderr-line' >&2; exit 17".to_string(),
            ),
            egress_routes: Vec::new(),
            artifacts: Vec::new(),
            workspace_sources: Vec::new(),
            runtime_clients: Vec::new(),
            agent_runtimes: Vec::new(),
        };

        let error = run_setup_script_in_directory(
            &runtime_plan,
            &BTreeMap::new(),
            std::env::temp_dir()
                .to_str()
                .expect("temporary directory should be valid unicode"),
            &SystemClock,
            &ThreadSleeper,
        )
        .expect_err("failing setup script should return an error");

        assert_eq!(error.exit_code, Some(17));
        assert!(!error.timed_out);
        assert!(error.output_tails.stdout_captured);
        assert!(error.output_tails.stderr_captured);
        let stdout_tail = error
            .output_tails
            .stdout_tail
            .as_deref()
            .expect("failing setup script should capture stdout");
        let setup_script_path = stdout_tail
            .lines()
            .next()
            .expect("setup script should print its temporary path");
        assert!(
            !std::path::Path::new(setup_script_path).exists(),
            "temporary setup script should be removed after failure"
        );
        assert_eq!(
            stdout_tail
                .lines()
                .nth(1)
                .expect("setup script should print stdout marker"),
            "stdout-line"
        );
        assert_eq!(
            error.output_tails.stderr_tail.as_deref(),
            Some("stderr-line")
        );
    }

    fn test_runtime_plan_image(source: CompiledRuntimePlanImageSource) -> CompiledRuntimePlanImage {
        CompiledRuntimePlanImage {
            source,
            image_ref: "registry.example.test/base:latest".to_string(),
        }
    }
}
