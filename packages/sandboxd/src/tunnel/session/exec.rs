//! Exec stream handling for the live tunnel session.

use std::collections::BTreeMap;
use std::io::{ErrorKind, Read, Write};
use std::os::fd::AsFd;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration as StdDuration, Instant};

use nix::errno::Errno;
use nix::fcntl::{FcntlArg, OFlag, fcntl};
use nix::sys::signal::{Signal, kill};
use nix::unistd::Pid;
use tokio::sync::mpsc;

use crate::tunnel::protocol::ExecStreamOpen;
use crate::tunnel::session::state::TunnelSessionEvent;

const DEFAULT_EXEC_TIMEOUT_MS: u64 = 15_000;
const DEFAULT_EXEC_MAX_OUTPUT_BYTES: usize = 16 * 1024 * 1024;
const EXEC_OUTPUT_READ_BUFFER_BYTES: usize = 8192;

#[derive(Clone)]
pub(super) struct PendingExecOpenState {
    cancel_requested: Arc<AtomicBool>,
    child_pid: Arc<Mutex<Option<u32>>>,
}

impl PendingExecOpenState {
    pub(super) fn new() -> Self {
        Self {
            cancel_requested: Arc::new(AtomicBool::new(false)),
            child_pid: Arc::new(Mutex::new(None)),
        }
    }
}

pub(super) struct ExecCommandResult {
    pub(super) exit_code: i32,
    pub(super) stdout: String,
    pub(super) stderr: String,
    pub(super) truncated: bool,
}

pub(super) fn spawn_exec_task(
    message: ExecStreamOpen,
    runtime_env: BTreeMap<String, String>,
    pending_exec_open: &PendingExecOpenState,
    event_sender: mpsc::UnboundedSender<TunnelSessionEvent>,
) {
    let cancel_requested = Arc::clone(&pending_exec_open.cancel_requested);
    let child_pid = Arc::clone(&pending_exec_open.child_pid);
    tokio::task::spawn_blocking(move || {
        let result = run_exec_command(
            &message,
            &runtime_env,
            &cancel_requested,
            Arc::clone(&child_pid),
        );
        let _ = event_sender.send(TunnelSessionEvent::ExecCompleted {
            stream_id: message.stream_id,
            result: Box::new(result),
        });
    });
}

struct BoundedOutput {
    text: String,
    truncated: bool,
}

fn run_exec_command(
    message: &ExecStreamOpen,
    runtime_env: &BTreeMap<String, String>,
    cancel_requested: &AtomicBool,
    child_pid: Arc<Mutex<Option<u32>>>,
) -> Result<ExecCommandResult, String> {
    let max_output_bytes = message
        .channel
        .max_output_bytes
        .unwrap_or(DEFAULT_EXEC_MAX_OUTPUT_BYTES);
    let timeout_ms = message
        .channel
        .timeout_ms
        .unwrap_or(DEFAULT_EXEC_TIMEOUT_MS);
    let mut child_command = Command::new(&message.channel.command);
    if let Some(args) = message.channel.args.as_ref() {
        child_command.args(args);
    }
    child_command.stdin(if message.channel.stdin.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    child_command.stdout(Stdio::piped());
    child_command.stderr(Stdio::piped());
    child_command.envs(runtime_env);
    if let Some(cwd) = message.channel.cwd.as_deref() {
        child_command.current_dir(cwd);
    }

    let mut child = child_command
        .spawn()
        .map_err(|error| format!("failed to spawn command: {error}"))?;
    {
        let mut stored_pid = child_pid
            .lock()
            .expect("exec child pid lock should not be poisoned");
        *stored_pid = Some(child.id());
    }
    let foreground_process_exited = Arc::new(AtomicBool::new(false));
    let stdin_thread = if let Some(stdin) = message.channel.stdin.clone() {
        let child_stdin = child
            .stdin
            .take()
            .ok_or_else(|| "command stdin pipe was not available".to_string())?;
        let stdin_foreground_process_exited = Arc::clone(&foreground_process_exited);
        Some(thread::spawn(move || {
            write_exec_stdin(child_stdin, stdin, stdin_foreground_process_exited)
        }))
    } else {
        None
    };
    if cancel_requested.load(Ordering::Relaxed) {
        kill_exec_child_process(child.id())?;
    }
    let stdout_reader = child
        .stdout
        .take()
        .ok_or_else(|| "command stdout pipe was not available".to_string())?;
    let stderr_reader = child
        .stderr
        .take()
        .ok_or_else(|| "command stderr pipe was not available".to_string())?;
    let shared_budget = Arc::new(Mutex::new(max_output_bytes));
    let stdout_budget = Arc::clone(&shared_budget);
    let stderr_budget = Arc::clone(&shared_budget);
    let stdout_thread = thread::spawn(move || read_bounded_output(stdout_reader, stdout_budget));
    let stderr_thread = thread::spawn(move || read_bounded_output(stderr_reader, stderr_budget));
    let status_result = wait_for_exec_child(&mut child, timeout_ms, cancel_requested);
    foreground_process_exited.store(true, Ordering::Relaxed);
    if let Some(stdin_thread) = stdin_thread {
        stdin_thread
            .join()
            .map_err(|_| "command stdin writer panicked".to_string())??;
    }
    let status = status_result?;
    let stdout = stdout_thread
        .join()
        .map_err(|_| "command stdout reader panicked".to_string())??;
    let stderr = stderr_thread
        .join()
        .map_err(|_| "command stderr reader panicked".to_string())??;

    Ok(ExecCommandResult {
        exit_code: status.code().unwrap_or(-1),
        stdout: stdout.text,
        stderr: stderr.text,
        truncated: stdout.truncated || stderr.truncated,
    })
}

fn write_exec_stdin(
    mut child_stdin: std::process::ChildStdin,
    stdin: String,
    foreground_process_exited: Arc<AtomicBool>,
) -> Result<(), String> {
    set_exec_stdin_nonblocking(&child_stdin)?;

    let bytes = stdin.as_bytes();
    let mut bytes_written = 0;
    while bytes_written < bytes.len() {
        match child_stdin.write(&bytes[bytes_written..]) {
            Ok(0) if foreground_process_exited.load(Ordering::Relaxed) => return Ok(()),
            Ok(0) => thread::sleep(StdDuration::from_millis(10)),
            Ok(count) => bytes_written += count,
            Err(error) if error.kind() == ErrorKind::BrokenPipe => return Ok(()),
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                if foreground_process_exited.load(Ordering::Relaxed) {
                    return Ok(());
                }
                thread::sleep(StdDuration::from_millis(10));
            }
            Err(error) => return Err(format!("failed to write command stdin: {error}")),
        }
    }

    Ok(())
}

fn set_exec_stdin_nonblocking(child_stdin: &std::process::ChildStdin) -> Result<(), String> {
    let flags_bits = fcntl(child_stdin.as_fd(), FcntlArg::F_GETFL)
        .map_err(|error| format!("failed to read command stdin flags: {error}"))?;
    let flags = OFlag::from_bits_truncate(flags_bits);
    fcntl(
        child_stdin.as_fd(),
        FcntlArg::F_SETFL(flags | OFlag::O_NONBLOCK),
    )
    .map_err(|error| format!("failed to set command stdin non-blocking: {error}"))?;
    Ok(())
}

fn wait_for_exec_child(
    child: &mut std::process::Child,
    timeout_ms: u64,
    cancel_requested: &AtomicBool,
) -> Result<std::process::ExitStatus, String> {
    let deadline = Instant::now() + StdDuration::from_millis(timeout_ms);
    loop {
        match child
            .try_wait()
            .map_err(|error| format!("failed to poll command: {error}"))?
        {
            Some(status) => return Ok(status),
            None if cancel_requested.load(Ordering::Relaxed) => {
                kill_exec_child_process(child.id())?;
                let _ = child
                    .wait()
                    .map_err(|error| format!("failed to wait for cancelled command: {error}"))?;
                return Err("command was cancelled".to_string());
            }
            None if Instant::now() >= deadline => {
                kill_exec_child_process(child.id())?;
                let _ = child
                    .wait()
                    .map_err(|error| format!("failed to wait for timed out command: {error}"))?;
                return Err(format!("command timed out after {timeout_ms}ms"));
            }
            None => thread::sleep(StdDuration::from_millis(10)),
        }
    }
}

fn kill_exec_child_process(child_pid: u32) -> Result<(), String> {
    match kill(Pid::from_raw(child_pid as i32), Signal::SIGKILL) {
        Ok(()) | Err(Errno::ESRCH) => Ok(()),
        Err(error) => Err(format!("failed to kill exec command: {error}")),
    }
}

fn read_bounded_output<R>(
    mut reader: R,
    remaining_bytes: Arc<Mutex<usize>>,
) -> Result<BoundedOutput, String>
where
    R: Read,
{
    let mut buffer = [0_u8; EXEC_OUTPUT_READ_BUFFER_BYTES];
    let mut output = Vec::new();
    let mut truncated = false;

    loop {
        let bytes_read = reader
            .read(&mut buffer)
            .map_err(|error| format!("failed to read command output: {error}"))?;
        if bytes_read == 0 {
            break;
        }

        let allowed_bytes = {
            let mut remaining = remaining_bytes
                .lock()
                .expect("remaining exec output budget lock should not be poisoned");
            let allowed = (*remaining).min(bytes_read);
            *remaining -= allowed;
            allowed
        };

        if allowed_bytes > 0 {
            output.extend_from_slice(&buffer[..allowed_bytes]);
        }
        if allowed_bytes < bytes_read {
            truncated = true;
        }
    }

    decode_bounded_output(output, truncated)
}

fn decode_bounded_output(output: Vec<u8>, truncated: bool) -> Result<BoundedOutput, String> {
    match String::from_utf8(output) {
        Ok(text) => Ok(BoundedOutput { text, truncated }),
        Err(error) if truncated => {
            let valid_up_to = error.utf8_error().valid_up_to();
            let bytes = error.into_bytes();
            let text =
                String::from_utf8(bytes[..valid_up_to].to_vec()).map_err(|decode_error| {
                    format!("command output was not valid utf-8: {decode_error}")
                })?;
            Ok(BoundedOutput {
                text,
                truncated: true,
            })
        }
        Err(error) => Err(format!("command output was not valid utf-8: {error}")),
    }
}

pub(super) fn cancel_pending_exec_open(pending_exec_open: PendingExecOpenState) {
    pending_exec_open
        .cancel_requested
        .store(true, Ordering::Relaxed);
    let child_pid = pending_exec_open
        .child_pid
        .lock()
        .expect("exec child pid lock should not be poisoned")
        .to_owned();
    if let Some(child_pid) = child_pid {
        let _ = kill_exec_child_process(child_pid);
    }
}

#[cfg(test)]
mod tests {
    use crate::tunnel::session::exec::decode_bounded_output;

    #[test]
    fn trims_truncated_output_to_a_valid_utf8_boundary() {
        let mut truncated_output = b"prefix ".to_vec();
        truncated_output.extend_from_slice(&"€".as_bytes()[..2]);

        let decoded = decode_bounded_output(truncated_output, true)
            .expect("truncated output should decode to the last valid utf-8 boundary");

        assert_eq!(decoded.text, "prefix ");
        assert!(decoded.truncated);
    }
}
