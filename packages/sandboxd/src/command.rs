//! Shared process execution helpers for `sandboxd`.
//!
//! Keep subprocess spawning and timeout handling in one place so runtime setup
//! code can share the same behavior without depending on one another's modules.

use std::collections::BTreeMap;
use std::io::Read;
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::Duration;

use crate::time::{Clock, Sleeper};

/// Default polling interval used while waiting for child processes with a timeout.
pub const DEFAULT_COMMAND_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// Describes one subprocess invocation.
pub struct CommandSpec<'a> {
    pub args: &'a [String],
    pub env: Option<&'a BTreeMap<String, String>>,
    pub cwd: Option<&'a str>,
    pub timeout_ms: Option<u64>,
}

struct CommandResult {
    status: ExitStatus,
    stdout: String,
    stderr: String,
    timed_out: bool,
}

/// Runs one subprocess and returns an error that includes combined output on failure.
pub fn run_command<C, S>(
    command: CommandSpec<'_>,
    clock: &C,
    sleeper: &S,
    poll_interval: Duration,
) -> Result<(), String>
where
    C: Clock,
    S: Sleeper,
{
    let executable = command
        .args
        .first()
        .ok_or_else(|| "command args must not be empty".to_string())?;

    let mut child_command = Command::new(executable);
    child_command.args(&command.args[1..]);
    child_command.stdin(Stdio::null());
    child_command.stdout(Stdio::piped());
    child_command.stderr(Stdio::piped());

    if let Some(cwd) = command.cwd {
        child_command.current_dir(cwd);
    }

    if let Some(env) = command.env {
        child_command.envs(env);
    }

    let mut child = child_command
        .spawn()
        .map_err(|error| format!("failed to spawn command: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "command stdout pipe was not available".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "command stderr pipe was not available".to_string())?;

    let stdout_thread = thread::spawn(move || read_pipe(stdout));
    let stderr_thread = thread::spawn(move || read_pipe(stderr));
    let (status, timed_out) = wait_for_child(
        &mut child,
        command.timeout_ms,
        clock,
        sleeper,
        poll_interval,
    )?;

    let stdout = stdout_thread
        .join()
        .map_err(|_| "command stdout reader panicked".to_string())??;
    let stderr = stderr_thread
        .join()
        .map_err(|_| "command stderr reader panicked".to_string())??;
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
        return Err(format!("command timed out after {timeout_ms}ms"));
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

fn wait_for_child<C, S>(
    child: &mut std::process::Child,
    timeout_ms: Option<u64>,
    clock: &C,
    sleeper: &S,
    poll_interval: Duration,
) -> Result<(ExitStatus, bool), String>
where
    C: Clock,
    S: Sleeper,
{
    let Some(timeout_ms) = timeout_ms else {
        let status = child
            .wait()
            .map_err(|error| format!("failed to wait for command: {error}"))?;
        return Ok((status, false));
    };

    let deadline_ms = clock.now_ms().saturating_add(timeout_ms);
    loop {
        match child
            .try_wait()
            .map_err(|error| format!("failed to poll command: {error}"))?
        {
            Some(status) => return Ok((status, false)),
            None if clock.now_ms() >= deadline_ms => {
                child
                    .kill()
                    .map_err(|error| format!("failed to kill timed out command: {error}"))?;
                let status = child
                    .wait()
                    .map_err(|error| format!("failed to wait for timed out command: {error}"))?;
                return Ok((status, true));
            }
            None => sleeper.sleep(poll_interval),
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
        .map_err(|error| format!("failed to read command output: {error}"))?;
    String::from_utf8(bytes).map_err(|error| format!("command output was not valid utf-8: {error}"))
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
        Some(code) => format!("command failed with exit code {code}"),
        None => "command failed".to_string(),
    }
}
