//! Shared process execution helpers for `sandboxd`.
//!
//! Keep subprocess spawning and timeout handling in one place so runtime setup
//! code can share the same behavior without depending on one another's modules.

use std::collections::BTreeMap;
use std::io::Read;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::time::{Clock, Sleeper};

/// Default polling interval used while waiting for child processes with a timeout.
pub const DEFAULT_COMMAND_POLL_INTERVAL: Duration = Duration::from_millis(10);
const DEFAULT_COMMAND_STDOUT_TAIL_BYTES: usize = 4 * 1024;
const DEFAULT_COMMAND_STDERR_TAIL_BYTES: usize = 8 * 1024;

/// Describes one subprocess invocation.
pub struct CommandSpec<'a> {
    pub args: &'a [String],
    pub env: Option<&'a BTreeMap<String, String>>,
    pub cwd: Option<&'a str>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandOutputStream {
    Stdout,
    Stderr,
}

pub trait CommandOutputSink: Send + Sync {
    fn record_output(&self, stream: CommandOutputStream, bytes: &[u8]);
}

struct CommandResult {
    status: ExitStatus,
    stdout: String,
    stderr: String,
    timed_out: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CommandOutputTails {
    pub stdout_tail: Option<String>,
    pub stderr_tail: Option<String>,
    pub stdout_captured: bool,
    pub stderr_captured: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandFailure {
    pub message: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub output_tails: CommandOutputTails,
}

/// Runs one subprocess and returns an error that includes combined output on failure.
pub fn run_command<C, S>(
    command: CommandSpec<'_>,
    clock: &C,
    sleeper: &S,
    poll_interval: Duration,
) -> Result<(), String>
where
    C: Clock + ?Sized,
    S: Sleeper + ?Sized,
{
    run_command_with_details(command, clock, sleeper, poll_interval).map_err(|error| error.message)
}

/// Runs one subprocess and returns structured failure details on error.
pub fn run_command_with_details<C, S>(
    command: CommandSpec<'_>,
    clock: &C,
    sleeper: &S,
    poll_interval: Duration,
) -> Result<(), CommandFailure>
where
    C: Clock + ?Sized,
    S: Sleeper + ?Sized,
{
    run_command_with_details_and_output_sink(command, clock, sleeper, poll_interval, None)
}

pub fn run_command_with_details_and_output_sink<C, S>(
    command: CommandSpec<'_>,
    clock: &C,
    sleeper: &S,
    poll_interval: Duration,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
) -> Result<(), CommandFailure>
where
    C: Clock + ?Sized,
    S: Sleeper + ?Sized,
{
    let executable = command.args.first().ok_or_else(|| CommandFailure {
        message: "command args must not be empty".to_string(),
        exit_code: None,
        timed_out: false,
        output_tails: CommandOutputTails::default(),
    })?;

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

    let mut child = child_command.spawn().map_err(|error| CommandFailure {
        message: format!("failed to spawn command: {error}"),
        exit_code: None,
        timed_out: false,
        output_tails: CommandOutputTails::default(),
    })?;
    let stdout = child.stdout.take().ok_or_else(|| CommandFailure {
        message: "command stdout pipe was not available".to_string(),
        exit_code: None,
        timed_out: false,
        output_tails: CommandOutputTails::default(),
    })?;
    let stderr = child.stderr.take().ok_or_else(|| CommandFailure {
        message: "command stderr pipe was not available".to_string(),
        exit_code: None,
        timed_out: false,
        output_tails: CommandOutputTails::default(),
    })?;

    let stdout_sink = output_sink.clone();
    let stderr_sink = output_sink;
    let stdout_thread =
        thread::spawn(move || read_pipe(stdout, stdout_sink, CommandOutputStream::Stdout));
    let stderr_thread =
        thread::spawn(move || read_pipe(stderr, stderr_sink, CommandOutputStream::Stderr));
    let (status, timed_out) = wait_for_child(
        &mut child,
        command.timeout_ms,
        clock,
        sleeper,
        poll_interval,
    )
    .map_err(|message| CommandFailure {
        message,
        exit_code: None,
        timed_out: false,
        output_tails: CommandOutputTails::default(),
    })?;

    let stdout = stdout_thread
        .join()
        .map_err(|_| CommandFailure {
            message: "command stdout reader panicked".to_string(),
            exit_code: None,
            timed_out: false,
            output_tails: CommandOutputTails::default(),
        })?
        .map_err(|message| CommandFailure {
            message,
            exit_code: None,
            timed_out: false,
            output_tails: CommandOutputTails::default(),
        })?;
    let stderr = stderr_thread
        .join()
        .map_err(|_| CommandFailure {
            message: "command stderr reader panicked".to_string(),
            exit_code: None,
            timed_out: false,
            output_tails: CommandOutputTails::default(),
        })?
        .map_err(|message| CommandFailure {
            message,
            exit_code: None,
            timed_out: false,
            output_tails: CommandOutputTails::default(),
        })?;
    let result = CommandResult {
        status,
        stdout,
        stderr,
        timed_out,
    };
    let output_tails = collect_command_output_tails(&result);

    if result.timed_out {
        let timeout_ms = command
            .timeout_ms
            .expect("timed out result should only exist when timeoutMs is set");
        return Err(CommandFailure {
            message: format!("command timed out after {timeout_ms}ms"),
            exit_code: result.status.code(),
            timed_out: true,
            output_tails,
        });
    }

    if result.status.success() {
        return Ok(());
    }

    let output = combine_command_output(&result);
    let failure = describe_command_failure(&result);
    if output.is_empty() {
        return Err(CommandFailure {
            message: failure,
            exit_code: result.status.code(),
            timed_out: false,
            output_tails,
        });
    }

    Err(CommandFailure {
        message: format!("{failure} (output={output})"),
        exit_code: result.status.code(),
        timed_out: false,
        output_tails,
    })
}

fn wait_for_child<C, S>(
    child: &mut std::process::Child,
    timeout_ms: Option<u64>,
    clock: &C,
    sleeper: &S,
    poll_interval: Duration,
) -> Result<(ExitStatus, bool), String>
where
    C: Clock + ?Sized,
    S: Sleeper + ?Sized,
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

fn read_pipe<R>(
    mut reader: R,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
    stream: CommandOutputStream,
) -> Result<String, String>
where
    R: Read,
{
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(bytes_read) => {
                if let Some(output_sink) = &output_sink {
                    output_sink.record_output(stream, &buffer[..bytes_read]);
                }
                bytes.extend_from_slice(&buffer[..bytes_read]);
            }
            Err(error) => return Err(format!("failed to read command output: {error}")),
        }
    }
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

fn collect_command_output_tails(result: &CommandResult) -> CommandOutputTails {
    let stdout_tail = collect_output_tail(&result.stdout, DEFAULT_COMMAND_STDOUT_TAIL_BYTES);
    let stderr_tail = collect_output_tail(&result.stderr, DEFAULT_COMMAND_STDERR_TAIL_BYTES);

    CommandOutputTails {
        stdout_captured: stdout_tail.is_some(),
        stderr_captured: stderr_tail.is_some(),
        stdout_tail,
        stderr_tail,
    }
}

fn collect_output_tail(output: &str, max_bytes: usize) -> Option<String> {
    if output.is_empty() {
        return None;
    }

    let bytes = output.as_bytes();
    let start = bytes.len().saturating_sub(max_bytes);
    Some(String::from_utf8_lossy(&bytes[start..]).to_string())
}
