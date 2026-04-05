use std::io::Read;
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use super::plan::RuntimeArtifactCommand;

struct CommandResult {
    status: ExitStatus,
    stdout: String,
    stderr: String,
    timed_out: bool,
}

pub fn run_runtime_artifact_command(command: &RuntimeArtifactCommand) -> Result<(), String> {
    let executable = command
        .args
        .first()
        .ok_or_else(|| "artifact command args must not be empty".to_string())?;

    let mut child_command = Command::new(executable);
    child_command.args(&command.args[1..]);
    child_command.stdin(Stdio::null());
    child_command.stdout(Stdio::piped());
    child_command.stderr(Stdio::piped());

    if let Some(cwd) = command.cwd.as_deref() {
        child_command.current_dir(cwd);
    }

    if let Some(env) = &command.env {
        child_command.envs(env);
    }

    let mut child = child_command
        .spawn()
        .map_err(|error| format!("failed to spawn artifact command: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "artifact command stdout pipe was not available".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "artifact command stderr pipe was not available".to_string())?;

    let stdout_thread = thread::spawn(move || read_pipe(stdout));
    let stderr_thread = thread::spawn(move || read_pipe(stderr));
    let (status, timed_out) = wait_for_child(&mut child, command.timeout_ms)?;

    let stdout = stdout_thread
        .join()
        .map_err(|_| "artifact command stdout reader panicked".to_string())??;
    let stderr = stderr_thread
        .join()
        .map_err(|_| "artifact command stderr reader panicked".to_string())??;
    let result = CommandResult {
        status,
        stdout,
        stderr,
        timed_out,
    };

    if result.timed_out {
        let timeout_ms = command
            .timeout_ms
            .expect("timed out result should only exist when timeoutMs is set");
        return Err(format!("artifact command timed out after {timeout_ms}ms"));
    }

    if result.status.success() {
        return Ok(());
    }

    let output = combine_command_output(&result);
    let failure = describe_command_failure(&result);
    if output.is_empty() {
        return Err(failure);
    }

    Err(format!("{failure} (output={output})"))
}

fn wait_for_child(
    child: &mut std::process::Child,
    timeout_ms: Option<u64>,
) -> Result<(ExitStatus, bool), String> {
    let Some(timeout_ms) = timeout_ms else {
        let status = child
            .wait()
            .map_err(|error| format!("failed to wait for artifact command: {error}"))?;
        return Ok((status, false));
    };

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        match child
            .try_wait()
            .map_err(|error| format!("failed to poll artifact command: {error}"))?
        {
            Some(status) => return Ok((status, false)),
            None if Instant::now() >= deadline => {
                child
                    .kill()
                    .map_err(|error| format!("failed to kill timed out artifact command: {error}"))?;
                let status = child.wait().map_err(|error| {
                    format!("failed to wait for timed out artifact command: {error}")
                })?;
                return Ok((status, true));
            }
            None => thread::sleep(Duration::from_millis(10)),
        }
    }
}

fn read_pipe<R>(mut reader: R) -> Result<String, String>
where
    R: Read,
{
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .map_err(|error| format!("failed to read artifact command output: {error}"))?;
    String::from_utf8(bytes)
        .map_err(|error| format!("artifact command output was not valid utf-8: {error}"))
}

fn combine_command_output(result: &CommandResult) -> String {
    let output_parts = [result.stdout.trim(), result.stderr.trim()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    output_parts.join("\n")
}

fn describe_command_failure(result: &CommandResult) -> String {
    match result.status.code() {
        Some(code) => format!("artifact command failed with exit code {code}"),
        None => "artifact command failed".to_string(),
    }
}
