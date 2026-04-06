//! Native PTY session management for `sandboxd`.
//!
//! This module owns the Linux terminal process lifecycle used by interactive
//! tunnel streams: spawn one PTY-backed child process, surface its output and
//! exit events, forward resize and input writes, and terminate it when the
//! tunnel closes the primary stream.

use std::collections::BTreeMap;
use std::fmt::{self, Display};
use std::io::{ErrorKind, Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{Child, ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};

use crate::cgroups::{
    UserScopePaths, attach_pid_to_scope, create_user_scope, is_scope_populated,
};
use crate::time::{Clock, Duration, Sleeper};

/// Default PTY column count when the caller does not specify one.
pub const DEFAULT_PTY_COLS: u16 = 80;
/// Default PTY row count when the caller does not specify one.
pub const DEFAULT_PTY_ROWS: u16 = 24;
/// Default interactive shell used when the caller does not provide a command.
pub const DEFAULT_PTY_SHELL: &str = "/bin/bash";
/// Preferred terminal identifier propagated into PTY child processes.
pub const DEFAULT_PTY_TERM: &str = "xterm-256color";
/// Poll interval used while waiting for a terminated PTY child to report exit.
pub const DEFAULT_PTY_TERMINATE_POLL_INTERVAL: Duration = Duration::from_millis(10);
/// Maximum time `sandboxd` waits after sending a PTY termination signal.
pub const DEFAULT_PTY_TERMINATE_TIMEOUT_MS: u64 = 2_000;

static PTY_SCOPE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Carries one environment entry into the PTY child process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PtyEnvironmentEntry {
    pub name: String,
    pub value: String,
}

/// Collects the spawn parameters for one PTY-backed child process.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PtySpawnRequest {
    pub cwd: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
}

/// Describes one observable PTY session event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtyEvent {
    Output(Vec<u8>),
    Exit(i32),
    Closed,
    Error(String),
}

/// Describes why one PTY lifecycle step failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PtyError {
    message: String,
}

impl PtyError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for PtyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for PtyError {}

#[derive(Debug, Default)]
struct PtyExitState {
    exited: bool,
    exit_code: i32,
}

struct PtySessionInner {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    exit_state: Mutex<PtyExitState>,
}

/// Owns one live PTY session plus the event stream produced by its child.
pub struct PtySession {
    process_id: Option<u32>,
    scope_id: Option<String>,
    scope_paths: Option<UserScopePaths>,
    inner: Arc<PtySessionInner>,
    events: Receiver<PtyEvent>,
}

impl PtySession {
    /// Returns the child process identifier when the PTY backend exposes one.
    pub fn process_id(&self) -> Option<u32> {
        self.process_id
    }

    /// Returns the cgroup scope id allocated for this PTY session, if any.
    pub fn scope_id(&self) -> Option<&str> {
        self.scope_id.as_deref()
    }

    /// Returns the cgroup scope paths attached to this PTY session, if any.
    pub fn scope_paths(&self) -> Option<&UserScopePaths> {
        self.scope_paths.as_ref()
    }

    /// Returns whether the PTY session's user scope still reports live processes.
    pub fn scope_is_populated(&self) -> Result<bool, PtyError> {
        let scope_paths = self
            .scope_paths()
            .ok_or_else(|| PtyError::new("pty session does not have a user scope"))?;

        is_scope_populated(scope_paths).map_err(|error| PtyError::new(error.to_string()))
    }

    /// Resizes the PTY window for the running child process.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), PtyError> {
        if cols == 0 || rows == 0 {
            return Err(PtyError::new(
                "pty resize cols and rows must be between 1 and 65535",
            ));
        }

        if self.exit_code().is_some() {
            return Err(PtyError::new("pty session has already exited"));
        }

        let master = self
            .inner
            .master
            .lock()
            .expect("pty master lock should not be poisoned");
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| PtyError::new(format!("failed to apply pty resize: {error}")))?;

        Ok(())
    }

    /// Writes raw stdin bytes into the PTY child process.
    pub fn write(&self, payload: &[u8]) -> Result<(), PtyError> {
        if self.exit_code().is_some() {
            return Ok(());
        }

        let mut writer = self
            .inner
            .writer
            .lock()
            .expect("pty writer lock should not be poisoned");
        writer
            .write_all(payload)
            .map_err(|error| PtyError::new(format!("failed to write pty input: {error}")))?;
        writer
            .flush()
            .map_err(|error| PtyError::new(format!("failed to flush pty input: {error}")))?;

        Ok(())
    }

    /// Returns the next PTY event, timing out when no event arrives in time.
    pub fn next_event_timeout(&self, timeout: Duration) -> Result<Option<PtyEvent>, PtyError> {
        match self.events.recv_timeout(timeout) {
            Ok(event) => Ok(Some(event)),
            Err(RecvTimeoutError::Timeout) => Ok(None),
            Err(RecvTimeoutError::Disconnected) => Ok(None),
        }
    }

    /// Returns the observed exit code when the PTY child has already exited.
    pub fn exit_code(&self) -> Option<i32> {
        let exit_state = self
            .inner
            .exit_state
            .lock()
            .expect("pty exit state lock should not be poisoned");
        if exit_state.exited {
            Some(exit_state.exit_code)
        } else {
            None
        }
    }

    /// Terminates the PTY child process and waits for its exit notification.
    pub fn terminate(
        &self,
        clock: &dyn Clock,
        sleeper: &dyn Sleeper,
        poll_interval: Duration,
        timeout_ms: u64,
    ) -> Result<i32, PtyError> {
        if let Some(exit_code) = self.exit_code() {
            return Ok(exit_code);
        }

        self.inner
            .killer
            .lock()
            .expect("pty killer lock should not be poisoned")
            .kill()
            .map_err(|error| PtyError::new(format!("failed to terminate pty process: {error}")))?;

        let deadline_ms = clock.now_ms().saturating_add(timeout_ms);
        loop {
            if let Some(exit_code) = self.exit_code() {
                return Ok(exit_code);
            }

            if clock.now_ms() >= deadline_ms {
                return Err(PtyError::new(format!(
                    "pty process did not exit after {timeout_ms}ms"
                )));
            }

            sleeper.sleep(poll_interval);
        }
    }
}

/// Spawns one PTY-backed child process and returns the live session handle.
pub fn start_pty_session(request: PtySpawnRequest) -> Result<PtySession, PtyError> {
    let command = request
        .command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_PTY_SHELL);
    let args = match request.command.as_ref() {
        Some(_) => request.args.unwrap_or_default(),
        None => vec!["-i".to_string()],
    };

    let cols = request.cols.unwrap_or(DEFAULT_PTY_COLS);
    let rows = request.rows.unwrap_or(DEFAULT_PTY_ROWS);
    if cols == 0 || rows == 0 {
        return Err(PtyError::new(
            "pty cols and rows must be between 1 and 65535",
        ));
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| PtyError::new(format!("failed to start pty process: {error}")))?;

    let mut child_command = CommandBuilder::new(command);
    child_command.args(args);
    if let Some(cwd) = request.cwd {
        child_command.cwd(cwd);
    }
    for entry in resolve_pty_environment() {
        child_command.env(entry.name, entry.value);
    }

    let child = pair
        .slave
        .spawn_command(child_command)
        .map_err(|error| PtyError::new(format!("failed to start pty process: {error}")))?;
    let process_id = child.process_id();
    let killer = child.clone_killer();

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| PtyError::new(format!("failed to start pty process: {error}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| PtyError::new(format!("failed to start pty process: {error}")))?;

    let inner = Arc::new(PtySessionInner {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        killer: Mutex::new(killer),
        exit_state: Mutex::new(PtyExitState::default()),
    });
    let (event_sender, event_receiver) = mpsc::channel();
    spawn_pty_output_thread(event_sender.clone(), reader);
    spawn_pty_exit_thread(inner.clone(), event_sender, child);

    Ok(PtySession {
        process_id,
        scope_id: None,
        scope_paths: None,
        inner,
        events: event_receiver,
    })
}

/// Spawns one PTY child and attaches it to a dedicated user scope cgroup.
pub fn start_scoped_pty_session(
    request: PtySpawnRequest,
    cgroup_root: &Path,
    sandbox_instance_id: &str,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<PtySession, PtyError> {
    let scope_id = allocate_scope_id(clock);
    let scope_paths = create_user_scope(cgroup_root, sandbox_instance_id, &scope_id)
        .map_err(|error| PtyError::new(error.to_string()))?;
    let mut session = start_pty_session(request)?;
    let Some(process_id) = session.process_id() else {
        let _ = session.terminate(
            clock,
            sleeper,
            DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
            DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
        );
        return Err(PtyError::new(
            "pty backend did not expose a child process id for cgroup attachment",
        ));
    };

    if let Err(error) = attach_pid_to_scope(&scope_paths, process_id) {
        let _ = session.terminate(
            clock,
            sleeper,
            DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
            DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
        );
        return Err(PtyError::new(error.to_string()));
    }

    session.scope_id = Some(scope_id);
    session.scope_paths = Some(scope_paths);
    Ok(session)
}

fn spawn_pty_output_thread(event_sender: Sender<PtyEvent>, mut reader: Box<dyn Read + Send>) {
    thread::spawn(move || {
        let mut buffer = vec![0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = event_sender.send(PtyEvent::Closed);
                    return;
                }
                Ok(read_bytes) => {
                    let _ = event_sender.send(PtyEvent::Output(buffer[..read_bytes].to_vec()));
                }
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(error) => {
                    let _ = event_sender.send(PtyEvent::Error(format!(
                        "failed to read pty output: {error}"
                    )));
                    return;
                }
            }
        }
    });
}

fn spawn_pty_exit_thread(
    inner: Arc<PtySessionInner>,
    event_sender: Sender<PtyEvent>,
    mut child: Box<dyn Child + Send + Sync>,
) {
    thread::spawn(move || {
        let exit_code = match child.wait() {
            Ok(status) => status.exit_code() as i32,
            Err(_) => 1,
        };
        let mut exit_state = inner
            .exit_state
            .lock()
            .expect("pty exit state lock should not be poisoned");
        exit_state.exited = true;
        exit_state.exit_code = exit_code;
        drop(exit_state);
        let _ = event_sender.send(PtyEvent::Exit(exit_code));
    });
}

fn resolve_pty_environment() -> Vec<PtyEnvironmentEntry> {
    let mut environment = BTreeMap::new();
    for (name, value) in std::env::vars() {
        environment.insert(name, value);
    }
    environment.insert("TERM".to_string(), DEFAULT_PTY_TERM.to_string());

    environment
        .into_iter()
        .map(|(name, value)| PtyEnvironmentEntry { name, value })
        .collect()
}

fn allocate_scope_id(clock: &dyn Clock) -> String {
    let counter = PTY_SCOPE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("scope_{}_{}", clock.now_ms(), counter)
}

#[cfg(test)]
mod tests {
    use crate::pty::{
        DEFAULT_PTY_TERMINATE_POLL_INTERVAL, DEFAULT_PTY_TERMINATE_TIMEOUT_MS, PtyEvent,
        PtySpawnRequest, start_pty_session, start_scoped_pty_session,
    };
    use crate::time::{Duration, SystemClock, ThreadSleeper};

    #[test]
    fn starts_pty_process_and_emits_output_and_exit() {
        let session = start_pty_session(PtySpawnRequest {
            command: Some("/bin/sh".to_string()),
            args: Some(vec![
                "-lc".to_string(),
                "printf 'hello from pty'; exit 7".to_string(),
            ]),
            ..PtySpawnRequest::default()
        })
        .expect("pty session should start");

        let mut output = Vec::new();
        let mut exit_code = None;
        for _ in 0..40 {
            let event = session
                .next_event_timeout(Duration::from_millis(250))
                .expect("pty event read should succeed")
                .expect("pty should emit an output or exit event");
            match event {
                PtyEvent::Output(chunk) => output.extend(chunk),
                PtyEvent::Exit(code) => exit_code = Some(code),
                PtyEvent::Closed => {}
                PtyEvent::Error(message) => panic!("unexpected pty error: {message}"),
            }

            if exit_code.is_some() && !output.is_empty() {
                break;
            }
        }

        assert_eq!(
            String::from_utf8(output).expect("output should be utf8"),
            "hello from pty"
        );
        assert_eq!(exit_code, Some(7));
    }

    #[test]
    fn terminates_long_running_pty_process() {
        let session = start_pty_session(PtySpawnRequest {
            command: Some("/bin/sh".to_string()),
            args: Some(vec!["-lc".to_string(), "sleep 30".to_string()]),
            ..PtySpawnRequest::default()
        })
        .expect("pty session should start");

        let exit_code = session
            .terminate(
                &SystemClock,
                &ThreadSleeper,
                DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
            )
            .expect("termination should succeed");

        assert_ne!(exit_code, 0);
    }

    #[test]
    fn attaches_scoped_pty_process_to_user_scope() {
        let temp_root = std::path::Path::new("/tmp").join(format!(
            "sbd_scoped_pty_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_root).expect("temp root should be creatable");

        let session = start_scoped_pty_session(
            PtySpawnRequest {
                command: Some("/bin/sh".to_string()),
                args: Some(vec![
                    "-lc".to_string(),
                    "printf 'scoped'; exit 0".to_string(),
                ]),
                ..PtySpawnRequest::default()
            },
            &temp_root,
            "sbi_123",
            &SystemClock,
            &ThreadSleeper,
        )
        .expect("scoped pty session should start");

        let scope_paths = session
            .scope_paths()
            .expect("scoped pty session should expose scope paths");
        assert!(
            session.scope_id().is_some(),
            "scoped pty session should expose a scope id"
        );
        assert_eq!(
            std::fs::read_to_string(&scope_paths.procs_file).expect("cgroup.procs should exist"),
            format!(
                "{}\n",
                session
                    .process_id()
                    .expect("scoped session should expose a process id")
            )
        );

        std::fs::remove_dir_all(temp_root).expect("temp root should be removable");
    }
}
