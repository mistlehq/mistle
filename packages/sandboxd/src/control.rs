//! Local Unix-socket control plane for a running `sandboxd` process.
//!
//! The daemon listens on `/run/.../control.sock` for one-shot local requests
//! from helper commands such as `sandboxd init` and `sandboxd resume`. The
//! control socket is the only boundary that accepts startup lifecycle requests
//! once the daemon is running.

use std::fmt;
use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::FileTypeExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::protocol::startup::StartupInput;
use crate::sandboxd_state::SandboxdState;
use crate::security;
use crate::time::{Sleeper, SystemClock, ThreadSleeper};

/// Default Unix socket path for the local `sandboxd` control channel.
pub const DEFAULT_CONTROL_SOCKET_PATH: &str = "/run/mistle/sandboxd/control.sock";
/// Poll interval for checking shutdown while the nonblocking listener is idle.
pub const DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// Tracks whether this daemon has already accepted startup input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InitPhase {
    Uninitialized,
    Initializing,
    Initialized,
    Failed(String),
}

/// Describes why the local control socket server or client path failed.
#[derive(Debug)]
pub enum ControlError {
    MissingSocketParent {
        path: PathBuf,
    },
    CreateSocketDirectory {
        path: PathBuf,
        error: std::io::Error,
    },
    ReadSocketMetadata {
        path: PathBuf,
        error: std::io::Error,
    },
    ExistingSocketPathIsNotSocket {
        path: PathBuf,
    },
    RemoveStaleSocket {
        path: PathBuf,
        error: std::io::Error,
    },
    BindSocket {
        path: PathBuf,
        error: std::io::Error,
    },
    AcceptConnection(std::io::Error),
    ConfigureConnection(std::io::Error),
    ReadRequest(std::io::Error),
    InvalidRequest(serde_json::Error),
    InvalidResponse(serde_json::Error),
    VerifyPeer(String),
    StartupRequestRejected(String),
    InitializeSandboxdState(String),
    ResumeSandboxdState(String),
    CloseSandboxdState(String),
    SerializeResponse(serde_json::Error),
    WriteResponse(std::io::Error),
    ResponseError(String),
    ConnectSocket {
        path: PathBuf,
        error: std::io::Error,
    },
    ShutdownSend,
    ServerPanicked,
    InitPanicked,
}

impl fmt::Display for ControlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingSocketParent { path } => {
                write!(
                    f,
                    "control socket path {} has no parent directory",
                    path.display()
                )
            }
            Self::CreateSocketDirectory { path, error } => write!(
                f,
                "failed to create control socket directory {}: {error}",
                path.display()
            ),
            Self::ReadSocketMetadata { path, error } => write!(
                f,
                "failed to inspect control socket path {}: {error}",
                path.display()
            ),
            Self::ExistingSocketPathIsNotSocket { path } => write!(
                f,
                "control socket path {} already exists and is not a unix socket",
                path.display()
            ),
            Self::RemoveStaleSocket { path, error } => {
                write!(
                    f,
                    "failed to remove stale control socket {}: {error}",
                    path.display()
                )
            }
            Self::BindSocket { path, error } => {
                write!(
                    f,
                    "failed to bind control socket {}: {error}",
                    path.display()
                )
            }
            Self::AcceptConnection(error) => {
                write!(f, "failed to accept control socket connection: {error}")
            }
            Self::ConfigureConnection(error) => {
                write!(f, "failed to configure control socket connection: {error}")
            }
            Self::ReadRequest(error) => write!(f, "failed to read control socket request: {error}"),
            Self::InvalidRequest(error) => {
                write!(f, "control socket request must be valid json: {error}")
            }
            Self::InvalidResponse(error) => {
                write!(f, "control socket response must be valid json: {error}")
            }
            Self::VerifyPeer(error) => {
                write!(f, "control socket peer verification failed: {error}")
            }
            Self::StartupRequestRejected(error) => {
                write!(f, "sandbox startup request was rejected: {error}")
            }
            Self::InitializeSandboxdState(error) => {
                write!(f, "failed to initialize sandboxd state: {error}")
            }
            Self::ResumeSandboxdState(error) => {
                write!(f, "failed to resume sandboxd state: {error}")
            }
            Self::CloseSandboxdState(error) => {
                write!(f, "failed to close sandboxd state: {error}")
            }
            Self::SerializeResponse(error) => {
                write!(f, "failed to serialize control socket response: {error}")
            }
            Self::WriteResponse(error) => {
                write!(f, "failed to write control socket response: {error}")
            }
            Self::ResponseError(error) => write!(f, "control socket returned an error: {error}"),
            Self::ConnectSocket { path, error } => {
                write!(
                    f,
                    "failed to connect to control socket {}: {error}",
                    path.display()
                )
            }
            Self::ShutdownSend => write!(f, "failed to signal control socket shutdown"),
            Self::ServerPanicked => write!(f, "control socket server panicked"),
            Self::InitPanicked => write!(f, "sandbox init worker panicked"),
        }
    }
}

impl std::error::Error for ControlError {}

/// Enumerates JSON requests accepted by the local control socket.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ControlRequest {
    #[serde(rename = "init")]
    Init { startup_input: StartupInput },
    #[serde(rename = "resume")]
    Resume { startup_input: StartupInput },
}

/// Carries one JSON response back to a local control socket client.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ControlResponse {
    ok: bool,
    error: Option<String>,
}

/// Tracks observable daemon state for tests and daemon lifecycle control.
struct ControlServerState {
    init_phase: InitPhase,
    startup_input: Option<StartupInput>,
    sandboxd_state: Option<SandboxdState>,
}

type InitThread = JoinHandle<Result<(), ControlError>>;
type SharedInitThread = Arc<Mutex<Option<InitThread>>>;

/// Owns one running control socket server thread and its observable state.
pub struct ControlServer {
    state: Arc<Mutex<ControlServerState>>,
    shutdown_sender: mpsc::Sender<()>,
    thread: Option<JoinHandle<Result<(), ControlError>>>,
    init_thread: SharedInitThread,
}

impl ControlServer {
    /// Returns the current init phase for this daemon.
    pub fn init_phase(&self) -> InitPhase {
        self.state
            .lock()
            .expect("control server state lock should not be poisoned")
            .init_phase
            .clone()
    }

    /// Returns the startup input accepted by this daemon, if any.
    pub fn startup_input(&self) -> Option<StartupInput> {
        self.state
            .lock()
            .expect("control server state lock should not be poisoned")
            .startup_input
            .clone()
    }

    /// Signals the control server thread to stop and waits for it to exit.
    pub fn close(mut self) -> Result<(), ControlError> {
        self.shutdown_sender
            .send(())
            .map_err(|_| ControlError::ShutdownSend)?;

        let thread = self
            .thread
            .take()
            .expect("control server thread should exist");
        let thread_result = match thread.join() {
            Ok(result) => result,
            Err(_) => Err(ControlError::ServerPanicked),
        };
        let init_result = join_init_thread(&self.init_thread);
        let stop_result = close_sandboxd_state(&self.state);

        thread_result?;
        init_result?;
        stop_result
    }

    /// Waits for the control server thread to exit without sending shutdown first.
    pub fn wait(mut self) -> Result<(), ControlError> {
        let thread = self
            .thread
            .take()
            .expect("control server thread should exist");
        let thread_result = match thread.join() {
            Ok(result) => result,
            Err(_) => Err(ControlError::ServerPanicked),
        };
        let init_result = join_init_thread(&self.init_thread);
        let stop_result = close_sandboxd_state(&self.state);

        thread_result?;
        init_result?;
        stop_result
    }
}

/// Starts the local control socket server that accepts startup lifecycle requests.
pub fn start_control_server<S>(
    socket_path: &Path,
    sleeper: S,
    accept_poll_interval: Duration,
) -> Result<ControlServer, ControlError>
where
    S: Sleeper + 'static,
{
    let parent_dir = socket_path
        .parent()
        .ok_or_else(|| ControlError::MissingSocketParent {
            path: socket_path.to_path_buf(),
        })?;
    fs::create_dir_all(parent_dir).map_err(|error| ControlError::CreateSocketDirectory {
        path: parent_dir.to_path_buf(),
        error,
    })?;
    remove_stale_socket(socket_path)?;

    let listener = UnixListener::bind(socket_path).map_err(|error| ControlError::BindSocket {
        path: socket_path.to_path_buf(),
        error,
    })?;
    listener
        .set_nonblocking(true)
        .map_err(|error| ControlError::BindSocket {
            path: socket_path.to_path_buf(),
            error,
        })?;

    let state = Arc::new(Mutex::new(ControlServerState {
        init_phase: InitPhase::Uninitialized,
        startup_input: None,
        sandboxd_state: None,
    }));
    let init_thread: SharedInitThread = Arc::new(Mutex::new(None));
    let (shutdown_sender, shutdown_receiver) = mpsc::channel::<()>();
    let state_for_thread = state.clone();
    let init_thread_for_loop = init_thread.clone();
    let socket_path_for_thread = socket_path.to_path_buf();

    let thread = thread::spawn(move || {
        let result = run_control_server_loop(
            listener,
            &state_for_thread,
            &init_thread_for_loop,
            &shutdown_receiver,
            &sleeper,
            accept_poll_interval,
        );
        let _ = fs::remove_file(&socket_path_for_thread);
        result
    });

    Ok(ControlServer {
        state,
        shutdown_sender,
        thread: Some(thread),
        init_thread,
    })
}

/// Submits one startup payload to the running daemon over the local control socket.
pub fn submit_init(socket_path: &Path, startup_input: &StartupInput) -> Result<(), ControlError> {
    submit_startup_request(socket_path, ControlRequest::Init {
        startup_input: startup_input.clone(),
    })
}

/// Submits one resume payload to the running daemon over the local control socket.
pub fn submit_resume(socket_path: &Path, startup_input: &StartupInput) -> Result<(), ControlError> {
    submit_startup_request(socket_path, ControlRequest::Resume {
        startup_input: startup_input.clone(),
    })
}

fn submit_startup_request(
    socket_path: &Path,
    request: ControlRequest,
) -> Result<(), ControlError> {
    let mut stream =
        UnixStream::connect(socket_path).map_err(|error| ControlError::ConnectSocket {
            path: socket_path.to_path_buf(),
        error,
        })?;

    let request = serde_json::to_vec(&request).map_err(ControlError::SerializeResponse)?;
    stream
        .write_all(&request)
        .map_err(ControlError::WriteResponse)?;
    stream
        .shutdown(std::net::Shutdown::Write)
        .map_err(ControlError::WriteResponse)?;

    let mut raw_response = Vec::new();
    stream
        .read_to_end(&mut raw_response)
        .map_err(ControlError::ReadRequest)?;
    let response: ControlResponse =
        serde_json::from_slice(&raw_response).map_err(ControlError::InvalidResponse)?;

    if response.ok {
        return Ok(());
    }

    Err(ControlError::ResponseError(response.error.unwrap_or_else(
        || "control socket returned ok=false without an error".to_string(),
    )))
}

fn run_control_server_loop(
    listener: UnixListener,
    state: &Arc<Mutex<ControlServerState>>,
    init_thread: &SharedInitThread,
    shutdown_receiver: &mpsc::Receiver<()>,
    sleeper: &impl Sleeper,
    accept_poll_interval: Duration,
) -> Result<(), ControlError> {
    loop {
        if shutdown_receiver.try_recv().is_ok() {
            return Ok(());
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_nonblocking(false)
                    .map_err(ControlError::ConfigureConnection)?;
                let response = match handle_connection(&mut stream, state, init_thread) {
                    Ok(()) => ControlResponse {
                        ok: true,
                        error: None,
                    },
                    Err(error) => ControlResponse {
                        ok: false,
                        error: Some(error.to_string()),
                    },
                };
                let response_bytes =
                    serde_json::to_vec(&response).map_err(ControlError::SerializeResponse)?;
                stream
                    .write_all(&response_bytes)
                    .map_err(ControlError::WriteResponse)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                sleeper.sleep(accept_poll_interval);
            }
            Err(error) => {
                return Err(ControlError::AcceptConnection(error));
            }
        }
    }
}

fn handle_connection(
    stream: &mut UnixStream,
    state: &Arc<Mutex<ControlServerState>>,
    init_thread: &SharedInitThread,
) -> Result<(), ControlError> {
    security::ensure_unix_socket_peer_matches_current_process_uid(stream)
        .map_err(|error| ControlError::VerifyPeer(error.to_string()))?;

    let mut raw_request = Vec::new();
    stream
        .read_to_end(&mut raw_request)
        .map_err(ControlError::ReadRequest)?;
    let request: ControlRequest =
        serde_json::from_slice(&raw_request).map_err(ControlError::InvalidRequest)?;

    match request {
        ControlRequest::Init { startup_input } => begin_init(startup_input, state, init_thread),
        ControlRequest::Resume { startup_input } => begin_resume(startup_input, state),
    }
}

fn begin_init(
    startup_input: StartupInput,
    state: &Arc<Mutex<ControlServerState>>,
    init_thread: &SharedInitThread,
) -> Result<(), ControlError> {
    {
        let mut state_guard = state
            .lock()
            .expect("control server state lock should not be poisoned");
        match &state_guard.init_phase {
            InitPhase::Uninitialized => {
                state_guard.init_phase = InitPhase::Initializing;
                state_guard.startup_input = Some(startup_input.clone());
            }
            InitPhase::Initializing => {
                return Err(ControlError::StartupRequestRejected(
                    "sandboxd is already initializing".to_string(),
                ));
            }
            InitPhase::Initialized => {
                return Err(ControlError::StartupRequestRejected(
                    "sandboxd has already completed initialization".to_string(),
                ));
            }
            InitPhase::Failed(error) => {
                return Err(ControlError::StartupRequestRejected(format!(
                    "sandboxd initialization already failed: {error}"
                )));
            }
        }
    }

    let mut init_thread_guard = init_thread
        .lock()
        .expect("control init thread lock should not be poisoned");
    if init_thread_guard.is_some() {
        return Err(ControlError::StartupRequestRejected(
            "sandboxd init worker is already running".to_string(),
        ));
    }

    let state_for_thread = state.clone();
    *init_thread_guard = Some(thread::spawn(move || {
        let result = SandboxdState::initialize(
            &startup_input,
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        );

        match result {
            Ok(sandboxd_state) => {
                let mut state_guard = state_for_thread
                    .lock()
                    .expect("control server state lock should not be poisoned");
                state_guard.sandboxd_state = Some(sandboxd_state);
                state_guard.init_phase = InitPhase::Initialized;
                Ok(())
            }
            Err(error) => {
                let error_text = error.to_string();
                state_for_thread
                    .lock()
                    .expect("control server state lock should not be poisoned")
                    .init_phase = InitPhase::Failed(error_text.clone());
                Err(ControlError::InitializeSandboxdState(error_text))
            }
        }
    }));
    drop(init_thread_guard);

    join_init_thread(init_thread)
}

fn begin_resume(
    startup_input: StartupInput,
    state: &Arc<Mutex<ControlServerState>>,
) -> Result<(), ControlError> {
    let mut sandboxd_state = {
        let mut state_guard = state
            .lock()
            .expect("control server state lock should not be poisoned");
        match &state_guard.init_phase {
            InitPhase::Uninitialized => {
                return Err(ControlError::StartupRequestRejected(
                    "sandboxd has not completed initialization".to_string(),
                ));
            }
            InitPhase::Initializing => {
                return Err(ControlError::StartupRequestRejected(
                    "sandboxd is still initializing".to_string(),
                ));
            }
            InitPhase::Initialized => {
                state_guard.startup_input = Some(startup_input.clone());
                state_guard.sandboxd_state.take().ok_or_else(|| {
                    ControlError::ResumeSandboxdState(
                        "sandboxd state is missing for an initialized daemon".to_string(),
                    )
                })?
            }
            InitPhase::Failed(error) => {
                return Err(ControlError::StartupRequestRejected(format!(
                    "sandboxd initialization already failed: {error}"
                )));
            }
        }
    };

    let resume_result = sandboxd_state
        .resume(&startup_input)
        .map_err(|error| ControlError::ResumeSandboxdState(error.to_string()));

    state
        .lock()
        .expect("control server state lock should not be poisoned")
        .sandboxd_state = Some(sandboxd_state);

    resume_result
}

fn join_init_thread(init_thread: &SharedInitThread) -> Result<(), ControlError> {
    let Some(thread) = init_thread
        .lock()
        .expect("control init thread lock should not be poisoned")
        .take()
    else {
        return Ok(());
    };

    match thread.join() {
        Ok(result) => result,
        Err(_) => Err(ControlError::InitPanicked),
    }
}

fn take_sandboxd_state(state: &Arc<Mutex<ControlServerState>>) -> Option<SandboxdState> {
    state
        .lock()
        .expect("control server state lock should not be poisoned")
        .sandboxd_state
        .take()
}

fn close_sandboxd_state(state: &Arc<Mutex<ControlServerState>>) -> Result<(), ControlError> {
    take_sandboxd_state(state)
        .map(SandboxdState::close)
        .transpose()
        .map_err(|error| ControlError::CloseSandboxdState(error.to_string()))?;
    Ok(())
}

fn remove_stale_socket(socket_path: &Path) -> Result<(), ControlError> {
    match fs::symlink_metadata(socket_path) {
        Ok(metadata) => {
            if !metadata.file_type().is_socket() {
                return Err(ControlError::ExistingSocketPathIsNotSocket {
                    path: socket_path.to_path_buf(),
                });
            }
            fs::remove_file(socket_path).map_err(|error| ControlError::RemoveStaleSocket {
                path: socket_path.to_path_buf(),
                error,
            })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ControlError::ReadSocketMetadata {
            path: socket_path.to_path_buf(),
            error,
        }),
    }
}

#[cfg(test)]
mod tests {
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use tungstenite::{Message, accept};

    use crate::control::{
        DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL, InitPhase, start_control_server, submit_init,
        submit_resume,
    };
    use crate::protocol::startup::{StartupInput, StartupMode};
    use crate::test_support::TestEnvVarGuard;
    use crate::time::testing::ManualSleeper;
    use crate::time::{Sleeper, ThreadSleeper};

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);
    const TOKENIZER_PROXY_EGRESS_BASE_URL_ENV: &str =
        "SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL";

    #[test]
    fn accepts_one_init_request_from_the_control_socket() {
        let _env_guard =
            TestEnvVarGuard::set(TOKENIZER_PROXY_EGRESS_BASE_URL_ENV, "http://127.0.0.1:5205");
        let test_dir = create_temp_test_dir("control_init");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let startup_input =
            valid_startup_input(StartupMode::New, "bootstrap-token-value", &gateway.ws_url);
        let server = start_control_server(
            &socket_path,
            ThreadSleeper,
            DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        )
        .expect("control server should start");

        submit_init(&socket_path, &startup_input).expect("init submission should succeed");

        wait_for_init_phase(&server, InitPhase::Initialized);
        assert_eq!(server.startup_input(), Some(startup_input));

        server.close().expect("control server should stop cleanly");
        gateway
            .close()
            .expect("bootstrap gateway should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn rejects_second_init_requests_after_initialization_begins() {
        let _env_guard =
            TestEnvVarGuard::set(TOKENIZER_PROXY_EGRESS_BASE_URL_ENV, "http://127.0.0.1:5205");
        let test_dir = create_temp_test_dir("control_second_init");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let startup_input =
            valid_startup_input(StartupMode::New, "bootstrap-token-value", &gateway.ws_url);
        let server = start_control_server(
            &socket_path,
            ThreadSleeper,
            DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        )
        .expect("control server should start");

        submit_init(&socket_path, &startup_input).expect("first init should succeed");
        let error = submit_init(&socket_path, &startup_input).expect_err("second init should fail");

        assert!(
            error
                .to_string()
                .contains("sandboxd has already completed initialization")
                || error
                    .to_string()
                    .contains("sandboxd is already initializing")
        );

        server.close().expect("control server should stop cleanly");
        gateway
            .close()
            .expect("bootstrap gateway should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn resumes_after_initialization_completes() {
        let _env_guard =
            TestEnvVarGuard::set(TOKENIZER_PROXY_EGRESS_BASE_URL_ENV, "http://127.0.0.1:5205");
        let test_dir = create_temp_test_dir("control_resume");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let init_startup_input =
            valid_startup_input(StartupMode::New, "bootstrap-token-value", &gateway.ws_url);
        let resume_startup_input = valid_startup_input(
            StartupMode::Existing,
            "bootstrap-token-value-2",
            &gateway.ws_url,
        );
        let server = start_control_server(
            &socket_path,
            ThreadSleeper,
            DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        )
        .expect("control server should start");

        submit_init(&socket_path, &init_startup_input).expect("init submission should succeed");
        submit_resume(&socket_path, &resume_startup_input)
            .expect("resume submission should succeed after init");

        assert_eq!(server.init_phase(), InitPhase::Initialized);
        assert_eq!(server.startup_input(), Some(resume_startup_input));

        server.close().expect("control server should stop cleanly");
        gateway
            .close()
            .expect("bootstrap gateway should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn rejects_resume_before_initialization_completes() {
        let _env_guard =
            TestEnvVarGuard::set(TOKENIZER_PROXY_EGRESS_BASE_URL_ENV, "http://127.0.0.1:5205");
        let test_dir = create_temp_test_dir("control_resume_before_init");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let resume_startup_input =
            valid_startup_input(StartupMode::Existing, "bootstrap-token-value", &gateway.ws_url);
        let server = start_control_server(
            &socket_path,
            ThreadSleeper,
            DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        )
        .expect("control server should start");

        let error =
            submit_resume(&socket_path, &resume_startup_input).expect_err("resume should fail");

        assert!(
            error
                .to_string()
                .contains("sandboxd has not completed initialization")
        );

        server.close().expect("control server should stop cleanly");
        gateway
            .close()
            .expect("bootstrap gateway should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn returns_init_failure_to_the_control_socket_client() {
        let _env_guard = TestEnvVarGuard::unset(TOKENIZER_PROXY_EGRESS_BASE_URL_ENV);
        let test_dir = create_temp_test_dir("control_init_failure");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let startup_input =
            valid_startup_input(StartupMode::New, "bootstrap-token-value", &gateway.ws_url);
        let server = start_control_server(
            &socket_path,
            ThreadSleeper,
            DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        )
        .expect("control server should start");

        let error = submit_init(&socket_path, &startup_input)
            .expect_err("init submission should fail when required env is missing");

        assert!(
            error
                .to_string()
                .contains(
                    "failed to initialize sandboxd state: failed to start runtime client processes: required sandbox env 'SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL' is missing"
                )
        );
        assert_eq!(
            server.init_phase(),
            InitPhase::Failed(
                "failed to start runtime client processes: required sandbox env 'SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL' is missing".to_string()
            )
        );

        server.close().expect("control server should stop cleanly");
        gateway
            .close()
            .expect("bootstrap gateway should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn records_control_loop_sleep_requests_with_manual_sleeper() {
        let test_dir = create_temp_test_dir("control_manual_sleeper");
        let socket_path = test_dir.join("control.sock");
        let sleeper = ManualSleeper::default();
        let server = start_control_server(&socket_path, sleeper.clone(), Duration::from_millis(7))
            .expect("control server should start");

        assert!(
            sleeper.wait_for_sleep_requests(1, Duration::from_millis(100)),
            "control loop should request at least one sleep"
        );
        server.close().expect("control server should stop cleanly");

        assert!(
            sleeper
                .requested_durations()
                .iter()
                .any(|duration| *duration == Duration::from_millis(7)),
            "control loop should sleep using the injected duration"
        );

        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    fn wait_for_init_phase(server: &crate::control::ControlServer, expected: InitPhase) {
        for _ in 0..100 {
            if server.init_phase() == expected {
                return;
            }

            ThreadSleeper.sleep(Duration::from_millis(10));
        }

        panic!("timed out waiting for init phase");
    }

    fn valid_startup_input(
        startup_mode: StartupMode,
        bootstrap_token: &str,
        tunnel_gateway_ws_url: &str,
    ) -> StartupInput {
        StartupInput {
            startup_mode,
            bootstrap_token: bootstrap_token.to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: tunnel_gateway_ws_url.to_string(),
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": "registry.example.test/base:latest"
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            egress_grant_by_rule_id: std::collections::BTreeMap::new(),
        }
    }

    fn create_temp_test_dir(prefix: &str) -> std::path::PathBuf {
        let counter = TEMP_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let path = std::path::Path::new("/tmp").join(format!(
            "sbd_{prefix}_{}_{}_{}",
            std::process::id(),
            counter,
            unique_suffix
        ));

        std::fs::create_dir_all(&path).expect("temp test dir should be creatable");

        path
    }

    struct BootstrapGateway {
        ws_url: String,
        shutdown_sender: mpsc::Sender<()>,
        thread: Option<thread::JoinHandle<()>>,
    }

    impl BootstrapGateway {
        fn close(mut self) -> Result<(), String> {
            let _ = self.shutdown_sender.send(());
            let thread = self
                .thread
                .take()
                .expect("bootstrap gateway thread should exist");
            thread
                .join()
                .map_err(|_| "bootstrap gateway thread panicked".to_string())
        }
    }

    fn start_bootstrap_gateway() -> BootstrapGateway {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bootstrap gateway should bind");
        listener
            .set_nonblocking(true)
            .expect("bootstrap gateway listener should become nonblocking");
        let ws_url = format!(
            "ws://127.0.0.1:{}/bootstrap",
            listener
                .local_addr()
                .expect("bootstrap gateway should expose its address")
                .port()
        );
        let (shutdown_sender, shutdown_receiver) = mpsc::channel();

        let thread = thread::spawn(move || {
            loop {
                if shutdown_receiver.try_recv().is_ok() {
                    return;
                }

                match listener.accept() {
                    Ok((stream, _)) => {
                        stream
                            .set_nonblocking(false)
                            .expect("bootstrap gateway stream should become blocking");
                        let mut websocket =
                            accept(stream).expect("bootstrap gateway handshake should succeed");
                        loop {
                            match websocket.read() {
                                Ok(Message::Close(_)) => break,
                                Ok(
                                    Message::Text(_)
                                    | Message::Binary(_)
                                    | Message::Ping(_)
                                    | Message::Pong(_)
                                    | Message::Frame(_),
                                ) => {}
                                Err(tungstenite::Error::Protocol(
                                    tungstenite::error::ProtocolError::ResetWithoutClosingHandshake,
                                )) => break,
                                Err(error) => {
                                    panic!("bootstrap gateway should read frames: {error}")
                                }
                            }
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        ThreadSleeper.sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("bootstrap gateway accept should succeed: {error}"),
                }
            }
        });

        BootstrapGateway {
            ws_url,
            shutdown_sender,
            thread: Some(thread),
        }
    }
}
