use std::collections::VecDeque;
use std::io::{ErrorKind, Read, Write};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use napi::bindgen_prelude::{Buffer, Function, Uint8Array};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Error, Result, Status};
use napi_derive::napi;
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};

const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;
const PTY_TERMINATE_TIMEOUT_MS: u64 = 2_000;

#[napi(object)]
pub struct PtyEnvironmentEntry {
    pub name: String,
    pub value: String,
}

#[napi(object)]
pub struct SpawnPtyInput {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<Vec<PtyEnvironmentEntry>>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[napi(object)]
pub struct PtyEventResult {
    pub kind: String,
    pub data: Option<Uint8Array>,
    pub exit_code: Option<i32>,
    pub message: Option<String>,
}

struct OutputState {
    chunks: VecDeque<Vec<u8>>,
    closed: bool,
    error: Option<String>,
}

struct ExitState {
    exited: bool,
    exit_code: i32,
}

enum PtyEvent {
    Output(Vec<u8>),
    Exit(i32),
    Closed,
    Error(String),
}

type EventCallback = ThreadsafeFunction<PtyEvent, (), PtyEventResult, Status, false>;

struct NativePtySessionInner {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    output_state: Mutex<OutputState>,
    output_changed: Condvar,
    exit_state: Mutex<ExitState>,
    exit_changed: Condvar,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    event_callback: EventCallback,
}

#[napi]
pub struct NativePtySession {
    inner: Arc<NativePtySessionInner>,
}

fn lock<'a, T>(mutex: &'a Mutex<T>, context: &str) -> Result<MutexGuard<'a, T>> {
    mutex.lock().map_err(|_| {
        Error::new(
            Status::GenericFailure,
            format!("{context} lock is poisoned"),
        )
    })
}

fn close_output(inner: &Arc<NativePtySessionInner>, error: Option<String>) {
    if let Ok(mut output_state) = inner.output_state.lock() {
        if let Some(message) = error {
            output_state.error = Some(message);
        }
        output_state.closed = true;
        inner.output_changed.notify_all();
    }
}

fn mark_exited(inner: &Arc<NativePtySessionInner>, exit_code: i32) {
    if let Ok(mut exit_state) = inner.exit_state.lock() {
        exit_state.exited = true;
        exit_state.exit_code = exit_code;
        inner.exit_changed.notify_all();
    }
    notify_event(inner, PtyEvent::Exit(exit_code));
}

fn wait_for_exit_state(
    inner: &Arc<NativePtySessionInner>,
    timeout: Option<Duration>,
) -> Result<Option<i32>> {
    let mut exit_state = lock(&inner.exit_state, "pty exit state")?;
    if exit_state.exited {
        return Ok(Some(exit_state.exit_code));
    }

    match timeout {
        None => {
            while !exit_state.exited {
                exit_state = inner.exit_changed.wait(exit_state).map_err(|_| {
                    Error::new(Status::GenericFailure, "pty exit state lock is poisoned")
                })?;
            }
            Ok(Some(exit_state.exit_code))
        }
        Some(duration) => {
            let deadline = Instant::now() + duration;
            let mut remaining = duration;

            while !exit_state.exited {
                let waited = inner
                    .exit_changed
                    .wait_timeout(exit_state, remaining)
                    .map_err(|_| {
                        Error::new(Status::GenericFailure, "pty exit state lock is poisoned")
                    })?;
                exit_state = waited.0;
                if exit_state.exited {
                    return Ok(Some(exit_state.exit_code));
                }
                if waited.1.timed_out() {
                    return Ok(None);
                }

                let now = Instant::now();
                if now >= deadline {
                    return Ok(None);
                }
                remaining = deadline.saturating_duration_since(now);
            }

            Ok(Some(exit_state.exit_code))
        }
    }
}

fn terminate_pty_process(inner: &Arc<NativePtySessionInner>) -> Result<()> {
    let mut killer = lock(&inner.killer, "pty killer")?;
    killer.kill().map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("failed to terminate pty process: {error}"),
        )
    })
}

fn notify_event(inner: &Arc<NativePtySessionInner>, event: PtyEvent) {
    let status = inner
        .event_callback
        .call(event, ThreadsafeFunctionCallMode::NonBlocking);
    if !matches!(status, Status::Ok | Status::Closing) {
        close_output(
            inner,
            Some(format!("failed to deliver pty event callback: {status:?}")),
        );
    }
}

fn build_event_callback(callback: Function<'_, PtyEventResult, ()>) -> Result<EventCallback> {
    callback
        .build_threadsafe_function::<PtyEvent>()
        .build_callback(|context| {
            Ok(match context.value {
                PtyEvent::Output(data) => PtyEventResult {
                    kind: "output".to_string(),
                    data: Some(Uint8Array::from(data)),
                    exit_code: None,
                    message: None,
                },
                PtyEvent::Exit(exit_code) => PtyEventResult {
                    kind: "exit".to_string(),
                    data: None,
                    exit_code: Some(exit_code),
                    message: None,
                },
                PtyEvent::Closed => PtyEventResult {
                    kind: "closed".to_string(),
                    data: None,
                    exit_code: None,
                    message: None,
                },
                PtyEvent::Error(message) => PtyEventResult {
                    kind: "error".to_string(),
                    data: None,
                    exit_code: None,
                    message: Some(message),
                },
            })
        })
}

fn spawn_pty_impl(
    input: SpawnPtyInput,
    event_callback: EventCallback,
) -> Result<NativePtySession> {
    if input.command.trim().is_empty() {
        return Err(Error::new(
            Status::InvalidArg,
            "pty command is required".to_string(),
        ));
    }

    let cols = input.cols.unwrap_or(DEFAULT_COLS);
    let rows = input.rows.unwrap_or(DEFAULT_ROWS);
    if cols == 0 || rows == 0 {
        return Err(Error::new(
            Status::InvalidArg,
            "pty cols and rows must be between 1 and 65535".to_string(),
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
        .map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("failed to start pty process: {error}"),
            )
        })?;

    let mut command = CommandBuilder::new(input.command);
    command.args(input.args);
    if let Some(cwd) = input.cwd {
        command.cwd(cwd);
    }
    if let Some(environment) = input.env {
        for entry in environment {
            command.env(entry.name, entry.value);
        }
    }

    let mut child = pair.slave.spawn_command(command).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("failed to start pty process: {error}"),
        )
    })?;

    let killer = child.clone_killer();

    let mut reader = pair.master.try_clone_reader().map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("failed to start pty process: {error}"),
        )
    })?;
    let writer = pair.master.take_writer().map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("failed to start pty process: {error}"),
        )
    })?;

    let inner = Arc::new(NativePtySessionInner {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        output_state: Mutex::new(OutputState {
            chunks: VecDeque::new(),
            closed: false,
            error: None,
        }),
        output_changed: Condvar::new(),
        exit_state: Mutex::new(ExitState {
            exited: false,
            exit_code: 0,
        }),
        exit_changed: Condvar::new(),
        killer: Mutex::new(killer),
        event_callback,
    });

    let reader_inner = inner.clone();
    thread::spawn(move || {
        let mut buffer = vec![0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    close_output(&reader_inner, None);
                    notify_event(&reader_inner, PtyEvent::Closed);
                    return;
                }
                Ok(read_bytes) => {
                    let chunk = buffer[..read_bytes].to_vec();
                    if let Ok(mut output_state) = reader_inner.output_state.lock() {
                        output_state.chunks.push_back(chunk.clone());
                        reader_inner.output_changed.notify_all();
                    } else {
                        return;
                    }

                    notify_event(&reader_inner, PtyEvent::Output(chunk));
                }
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(error) => {
                    let message = format!("failed to read pty output: {error}");
                    close_output(&reader_inner, Some(message.clone()));
                    notify_event(&reader_inner, PtyEvent::Error(message));
                    return;
                }
            }
        }
    });

    let exit_inner = inner.clone();
    thread::spawn(move || {
        let exit_status = child.wait();
        let exit_code = match exit_status {
            Ok(status) => status.exit_code() as i32,
            Err(_) => 1,
        };
        mark_exited(&exit_inner, exit_code);
    });

    Ok(NativePtySession { inner })
}

pub struct TerminateTask {
    inner: Arc<NativePtySessionInner>,
}

impl napi::Task for TerminateTask {
    type Output = i32;
    type JsValue = i32;

    fn compute(&mut self) -> Result<Self::Output> {
        if let Some(exit_code) = wait_for_exit_state(&self.inner, Some(Duration::from_millis(0)))? {
            return Ok(exit_code);
        }

        terminate_pty_process(&self.inner)?;
        if let Some(exit_code) = wait_for_exit_state(
            &self.inner,
            Some(Duration::from_millis(PTY_TERMINATE_TIMEOUT_MS)),
        )? {
            return Ok(exit_code);
        }

        Err(Error::new(
            Status::GenericFailure,
            format!(
                "pty process did not exit after {}ms",
                PTY_TERMINATE_TIMEOUT_MS
            ),
        ))
    }

    fn resolve(&mut self, _env: napi::Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn spawn_pty(
    input: SpawnPtyInput,
    on_event: Function<'_, PtyEventResult, ()>,
) -> Result<NativePtySession> {
    spawn_pty_impl(input, build_event_callback(on_event)?)
}

#[napi]
impl NativePtySession {
    #[napi]
    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        if cols == 0 || rows == 0 {
            return Err(Error::new(
                Status::InvalidArg,
                "pty resize cols and rows must be between 1 and 65535".to_string(),
            ));
        }

        if wait_for_exit_state(&self.inner, Some(Duration::from_millis(0)))?.is_some() {
            return Err(Error::new(
                Status::GenericFailure,
                "pty session has already exited".to_string(),
            ));
        }

        let master = lock(&self.inner.master, "pty master")?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| {
                Error::new(
                    Status::GenericFailure,
                    format!("failed to apply pty resize: {error}"),
                )
            })
    }

    #[napi]
    pub fn write(&self, data: Buffer) -> Result<()> {
        if wait_for_exit_state(&self.inner, Some(Duration::from_millis(0)))?.is_some() {
            return Ok(());
        }

        let mut writer = lock(&self.inner.writer, "pty writer")?;
        writer.write_all(data.as_ref()).map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("failed to write pty input: {error}"),
            )
        })
    }

    #[napi]
    pub fn terminate(&self) -> napi::bindgen_prelude::AsyncTask<TerminateTask> {
        napi::bindgen_prelude::AsyncTask::new(TerminateTask {
            inner: self.inner.clone(),
        })
    }
}
