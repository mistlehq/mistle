//! Local Unix-socket control plane for a running `sandboxd` process.
//!
//! This module starts the `/run/.../control.sock` listener used by
//! `apply-startup` to trigger manifest reloads, and it owns the small request /
//! response protocol that flows across that socket.

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

use crate::apply_startup::ApplyStartupError;
use crate::apply_startup::manifest;
use crate::process;
use crate::protocol::startup::StartupInput;
use crate::runtime;
use crate::time::{Sleeper, SystemClock, ThreadSleeper};

/// Default Unix socket path for the local `sandboxd` control channel.
pub const DEFAULT_CONTROL_SOCKET_PATH: &str = "/run/mistle/sandboxd/control.sock";
/// Poll interval for checking shutdown while the nonblocking listener is idle.
pub const DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(10);

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
    LoadManifest(String),
    ApplyRuntimePlan(String),
    StartProcessManager(String),
    StopProcessManager(String),
    ResponseError(String),
    SerializeResponse(serde_json::Error),
    WriteResponse(std::io::Error),
    ConnectSocket {
        path: PathBuf,
        error: std::io::Error,
    },
    ShutdownSend,
    ServerPanicked,
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
            Self::LoadManifest(error) => write!(f, "failed to reload startup manifest: {error}"),
            Self::ApplyRuntimePlan(error) => {
                write!(f, "failed to apply startup manifest runtime plan: {error}")
            }
            Self::StartProcessManager(error) => {
                write!(f, "failed to start runtime client processes: {error}")
            }
            Self::StopProcessManager(error) => {
                write!(f, "failed to stop runtime client processes: {error}")
            }
            Self::ResponseError(error) => write!(f, "control socket returned an error: {error}"),
            Self::SerializeResponse(error) => {
                write!(f, "failed to serialize control socket response: {error}")
            }
            Self::WriteResponse(error) => {
                write!(f, "failed to write control socket response: {error}")
            }
            Self::ConnectSocket { path, error } => {
                write!(
                    f,
                    "failed to connect to control socket {}: {error}",
                    path.display()
                )
            }
            Self::ShutdownSend => write!(f, "failed to signal control socket shutdown"),
            Self::ServerPanicked => write!(f, "control socket server panicked"),
        }
    }
}

impl std::error::Error for ControlError {}

/// Enumerates JSON requests accepted by the local control socket.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ControlRequest {
    #[serde(rename = "reload.startup")]
    ReloadStartup,
}

/// Carries one JSON response back to a local control socket client.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ControlResponse {
    ok: bool,
    error: Option<String>,
}

/// Tracks observable control-server state for tests and later supervisor wiring.
#[derive(Debug)]
struct ControlServerState {
    reload_count: usize,
    latest_manifest: Option<StartupInput>,
    process_manager: Option<process::RuntimeClientProcessManager>,
}

/// Owns one running control socket server thread and its observable state.
pub struct ControlServer {
    state: Arc<Mutex<ControlServerState>>,
    shutdown_sender: mpsc::Sender<()>,
    thread: Option<JoinHandle<Result<(), ControlError>>>,
}

impl ControlServer {
    /// Returns how many successful reload requests this server has processed.
    pub fn reload_count(&self) -> usize {
        self.state
            .lock()
            .expect("control server state lock should not be poisoned")
            .reload_count
    }

    /// Returns the most recently loaded manifest after a successful reload request.
    pub fn latest_manifest(&self) -> Option<StartupInput> {
        self.state
            .lock()
            .expect("control server state lock should not be poisoned")
            .latest_manifest
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
        let stop_result = stop_managed_processes(&self.state);

        thread_result?;
        stop_result
    }

    /// Waits for the control server thread to exit without sending a shutdown signal first.
    pub fn wait(mut self) -> Result<(), ControlError> {
        let thread = self
            .thread
            .take()
            .expect("control server thread should exist");
        let thread_result = match thread.join() {
            Ok(result) => result,
            Err(_) => Err(ControlError::ServerPanicked),
        };
        let stop_result = stop_managed_processes(&self.state);

        thread_result?;
        stop_result
    }
}

/// Starts the local control socket server that accepts startup-manifest reload requests.
pub fn start_control_server<S>(
    socket_path: &Path,
    manifest_path: &Path,
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
        reload_count: 0,
        latest_manifest: None,
        process_manager: None,
    }));
    load_persisted_manifest_if_present(manifest_path, &state)?;
    let (shutdown_sender, shutdown_receiver) = mpsc::channel::<()>();
    let state_for_thread = state.clone();
    let socket_path_for_thread = socket_path.to_path_buf();
    let manifest_path_for_thread = manifest_path.to_path_buf();

    let thread = thread::spawn(move || {
        let result = run_control_server_loop(
            listener,
            &manifest_path_for_thread,
            &state_for_thread,
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
    })
}

/// Notifies a running `sandboxd serve` process that it should reload the persisted manifest.
pub fn notify_reload(socket_path: &Path) -> Result<(), ControlError> {
    let mut stream = match UnixStream::connect(socket_path) {
        Ok(stream) => stream,
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused
            ) =>
        {
            return Ok(());
        }
        Err(error) => {
            return Err(ControlError::ConnectSocket {
                path: socket_path.to_path_buf(),
                error,
            });
        }
    };

    let request = serde_json::to_vec(&ControlRequest::ReloadStartup)
        .map_err(ControlError::SerializeResponse)?;
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

/// Runs the blocking accept loop for the local control socket server.
fn run_control_server_loop(
    listener: UnixListener,
    manifest_path: &Path,
    state: &Arc<Mutex<ControlServerState>>,
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
                // The listener is nonblocking so the accept loop can observe shutdowns.
                // Each accepted control connection should switch back to blocking mode so
                // request/response reads wait for the peer to finish writing.
                stream
                    .set_nonblocking(false)
                    .map_err(ControlError::ConfigureConnection)?;
                let response = match handle_connection(&mut stream, manifest_path, state) {
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

/// Handles one accepted control socket connection from request read through response state update.
fn handle_connection(
    stream: &mut UnixStream,
    manifest_path: &Path,
    state: &Arc<Mutex<ControlServerState>>,
) -> Result<(), ControlError> {
    let mut raw_request = Vec::new();
    stream
        .read_to_end(&mut raw_request)
        .map_err(ControlError::ReadRequest)?;
    let request: ControlRequest =
        serde_json::from_slice(&raw_request).map_err(ControlError::InvalidRequest)?;

    match request {
        ControlRequest::ReloadStartup => {
            let manifest = manifest::load_manifest(manifest_path)
                .map_err(|error| ControlError::LoadManifest(error.to_string()))?;
            apply_loaded_manifest(manifest, state, true)
        }
    }
}

fn load_persisted_manifest_if_present(
    manifest_path: &Path,
    state: &Arc<Mutex<ControlServerState>>,
) -> Result<(), ControlError> {
    match manifest::load_manifest(manifest_path) {
        Ok(manifest) => apply_loaded_manifest(manifest, state, false),
        Err(ApplyStartupError::ReadManifest { error, .. })
            if error.kind() == std::io::ErrorKind::NotFound =>
        {
            Ok(())
        }
        Err(error) => Err(ControlError::LoadManifest(error.to_string())),
    }
}

fn apply_loaded_manifest(
    manifest: StartupInput,
    state: &Arc<Mutex<ControlServerState>>,
    increment_reload_count: bool,
) -> Result<(), ControlError> {
    // Use the same apply path for initial startup and later reloads so setup work
    // stays driven by the persisted manifest rather than ad hoc in-memory state.
    let runtime_plan: runtime::CompiledRuntimePlan =
        serde_json::from_value(manifest.runtime_plan.clone())
            .map_err(|error| ControlError::ApplyRuntimePlan(error.to_string()))?;
    take_process_manager(state)
        .map(|process_manager| process_manager.stop(&SystemClock, &ThreadSleeper))
        .transpose()
        .map_err(|error| ControlError::StopProcessManager(error.to_string()))?;
    runtime::apply_runtime_plan(&runtime_plan)
        .map_err(|error| ControlError::ApplyRuntimePlan(error.to_string()))?;
    let process_specs = process::flatten_runtime_client_processes(&runtime_plan.runtime_clients);
    let process_manager = if process_specs.is_empty() {
        None
    } else {
        Some(
            process::start_runtime_client_process_manager(
                &process_specs,
                &SystemClock,
                &ThreadSleeper,
            )
            .map_err(|error| ControlError::StartProcessManager(error.to_string()))?,
        )
    };

    let mut state = state
        .lock()
        .expect("control server state lock should not be poisoned");
    if increment_reload_count {
        state.reload_count += 1;
    }
    state.latest_manifest = Some(manifest);
    state.process_manager = process_manager;
    Ok(())
}

fn take_process_manager(
    state: &Arc<Mutex<ControlServerState>>,
) -> Option<process::RuntimeClientProcessManager> {
    state
        .lock()
        .expect("control server state lock should not be poisoned")
        .process_manager
        .take()
}

fn stop_managed_processes(state: &Arc<Mutex<ControlServerState>>) -> Result<(), ControlError> {
    take_process_manager(state)
        .map(|process_manager| process_manager.stop(&SystemClock, &ThreadSleeper))
        .transpose()
        .map_err(|error| ControlError::StopProcessManager(error.to_string()))?;
    Ok(())
}

/// Removes an existing socket file only when it is actually a stale Unix socket.
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
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use crate::apply_startup::manifest::persist_manifest;
    use crate::control::{
        DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL, notify_reload, start_control_server,
    };
    use crate::protocol::startup::{StartupInput, StartupMode};
    use crate::time::ThreadSleeper;
    use crate::time::testing::ManualSleeper;

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn reloads_manifest_from_control_socket() {
        let test_dir = create_temp_test_dir("control_reload");
        let socket_path = test_dir.join("control.sock");
        let manifest_path = test_dir.join("manifest.json");
        let startup_input = valid_startup_input("bootstrap-token-value");

        persist_manifest(&manifest_path, &startup_input)
            .expect("manifest should persist before reload");
        let server = start_control_server(
            &socket_path,
            &manifest_path,
            ThreadSleeper,
            DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        )
        .expect("control server should start");

        notify_reload(&socket_path).expect("reload notification should succeed");

        assert_eq!(server.reload_count(), 1);
        assert_eq!(server.latest_manifest(), Some(startup_input));

        server.close().expect("control server should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn ignores_missing_control_socket() {
        let test_dir = create_temp_test_dir("control_missing_socket");
        let socket_path = test_dir.join("missing.sock");

        notify_reload(&socket_path).expect("missing control socket should be ignored");

        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn records_control_loop_sleep_requests_with_manual_sleeper() {
        let test_dir = create_temp_test_dir("control_manual_sleeper");
        let socket_path = test_dir.join("control.sock");
        let manifest_path = test_dir.join("manifest.json");
        let sleeper = ManualSleeper::default();
        let server = start_control_server(
            &socket_path,
            &manifest_path,
            sleeper.clone(),
            Duration::from_millis(7),
        )
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

    fn valid_startup_input(bootstrap_token: &str) -> StartupInput {
        StartupInput {
            startup_mode: StartupMode::New,
            bootstrap_token: bootstrap_token.to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: "wss://gateway.example.test".to_string(),
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
}
