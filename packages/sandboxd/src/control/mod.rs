//! Local Unix-socket control plane for a running `sandboxd` process.
//!
//! The daemon listens on `/run/.../control.sock` for one-shot local requests
//! from helper commands such as `sandboxd init` and `sandboxd resume`. The
//! control socket is the only boundary that accepts startup lifecycle requests
//! once the daemon is running.

use std::fs;
use std::io::Write;
use std::net::{SocketAddr, TcpListener};
use std::os::unix::fs::FileTypeExt;
use std::os::unix::net::UnixListener;
use std::path::Path;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::protocol::startup::StartupInput;
use crate::time::Sleeper;

mod client;
mod error;
mod health;
mod protocol;
mod request;
mod state;

pub use crate::control::client::{
    submit_init, submit_ready, submit_resume, submit_signing, submit_wait_init,
};
pub use crate::control::error::ControlError;
use crate::control::health::run_health_server_loop;
use crate::control::protocol::ControlResponse;
pub use crate::control::protocol::ControlSignRequest;
use crate::control::request::handle_connection;
use crate::control::state::{
    ControlServerState, SharedInitThread, close_sandboxd_state, join_init_thread,
    lock_control_state,
};

/// Default Unix socket path for the local `sandboxd` control channel.
pub const DEFAULT_CONTROL_SOCKET_PATH: &str = "/run/mistle/sandboxd/control.sock";
/// Poll interval for checking shutdown while the nonblocking listener is idle.
pub const DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(10);
/// Default loopback HTTP address for the daemon-local health endpoint.
pub const DEFAULT_HEALTH_ENDPOINT_ADDR: &str = "127.0.0.1:3901";
/// Fixed path served by the daemon-local health endpoint.
pub const DEFAULT_HEALTH_ENDPOINT_PATH: &str = "/__healthz";
#[cfg(any(test, debug_assertions))]
pub(super) const TEST_FAULTS_ENABLED_ENV: &str = "MISTLE_SANDBOXD_ENABLE_TEST_FAULTS";
#[cfg(any(test, debug_assertions))]
pub(super) const EGRESS_PROXY_FAULT_KILL_PATH: &str = "/__faults/components/egress-proxy/kill";

/// Tracks whether this daemon has already accepted startup input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InitPhase {
    Uninitialized,
    Initializing,
    Initialized,
    Failed(String),
}

/// Owns one running control socket server thread and its observable state.
pub struct ControlServer {
    state: Arc<Mutex<ControlServerState>>,
    shutdown_sender: mpsc::Sender<()>,
    health_shutdown_sender: mpsc::Sender<()>,
    thread: Option<JoinHandle<Result<(), ControlError>>>,
    health_thread: Option<JoinHandle<Result<(), ControlError>>>,
    init_thread: SharedInitThread,
    health_endpoint_addr: SocketAddr,
}

impl ControlServer {
    /// Returns the current init phase for this daemon.
    pub fn init_phase(&self) -> InitPhase {
        match lock_control_state(&self.state) {
            Ok(state) => state.init_phase.clone(),
            Err(error) => InitPhase::Failed(error.to_string()),
        }
    }

    /// Returns the startup input accepted by this daemon, if any.
    pub fn startup_input(&self) -> Option<StartupInput> {
        lock_control_state(&self.state)
            .ok()
            .and_then(|state| state.startup_input.clone())
    }

    /// Returns the loopback socket address bound by the local health endpoint.
    pub fn health_endpoint_addr(&self) -> SocketAddr {
        self.health_endpoint_addr
    }

    /// Signals the control server thread to stop and waits for it to exit.
    pub fn close(mut self) -> Result<(), ControlError> {
        self.shutdown_sender
            .send(())
            .map_err(|_| ControlError::ShutdownSend)?;
        self.health_shutdown_sender
            .send(())
            .map_err(|_| ControlError::ShutdownSend)?;

        let thread = self
            .thread
            .take()
            .ok_or(ControlError::ServerThreadMissing)?;
        let health_thread = self
            .health_thread
            .take()
            .ok_or(ControlError::HealthServerThreadMissing)?;
        let thread_result = match thread.join() {
            Ok(result) => result,
            Err(_) => Err(ControlError::ServerPanicked),
        };
        let health_thread_result = match health_thread.join() {
            Ok(result) => result,
            Err(_) => Err(ControlError::HealthServerPanicked),
        };
        let init_result = join_init_thread(&self.init_thread);
        let stop_result = close_sandboxd_state(&self.state);

        thread_result?;
        health_thread_result?;
        init_result?;
        stop_result
    }

    /// Waits for the control server thread to exit without sending shutdown first.
    pub fn wait(mut self) -> Result<(), ControlError> {
        let thread = self
            .thread
            .take()
            .ok_or(ControlError::ServerThreadMissing)?;
        let thread_result = match thread.join() {
            Ok(result) => result,
            Err(_) => Err(ControlError::ServerPanicked),
        };
        self.health_shutdown_sender
            .send(())
            .map_err(|_| ControlError::ShutdownSend)?;
        let health_thread = self
            .health_thread
            .take()
            .ok_or(ControlError::HealthServerThreadMissing)?;
        let health_thread_result = match health_thread.join() {
            Ok(result) => result,
            Err(_) => Err(ControlError::HealthServerPanicked),
        };
        let init_result = join_init_thread(&self.init_thread);
        let stop_result = close_sandboxd_state(&self.state);

        thread_result?;
        health_thread_result?;
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
    start_control_server_with_global_git_config_path(
        socket_path,
        sleeper,
        accept_poll_interval,
        Path::new(crate::sandboxd_state::DEFAULT_GLOBAL_GIT_CONFIG_PATH),
    )
}

pub fn start_control_server_with_global_git_config_path<S>(
    socket_path: &Path,
    sleeper: S,
    accept_poll_interval: Duration,
    global_git_config_path: &Path,
) -> Result<ControlServer, ControlError>
where
    S: Sleeper + 'static,
{
    start_control_server_with_health_endpoint(
        socket_path,
        DEFAULT_HEALTH_ENDPOINT_ADDR.parse().map_err(|error| {
            ControlError::InvalidDefaultHealthEndpoint {
                address: DEFAULT_HEALTH_ENDPOINT_ADDR.to_string(),
                error,
            }
        })?,
        sleeper,
        accept_poll_interval,
        global_git_config_path,
    )
}

pub fn start_control_server_with_health_endpoint<S>(
    socket_path: &Path,
    health_endpoint_addr: SocketAddr,
    sleeper: S,
    accept_poll_interval: Duration,
    global_git_config_path: &Path,
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
    let health_listener = TcpListener::bind(health_endpoint_addr).map_err(|error| {
        ControlError::BindHealthEndpoint {
            address: health_endpoint_addr,
            error,
        }
    })?;
    let health_endpoint_addr =
        health_listener
            .local_addr()
            .map_err(|error| ControlError::BindHealthEndpoint {
                address: health_endpoint_addr,
                error,
            })?;
    health_listener
        .set_nonblocking(true)
        .map_err(|error| ControlError::BindHealthEndpoint {
            address: health_endpoint_addr,
            error,
        })?;

    let state = Arc::new(Mutex::new(ControlServerState {
        init_phase: InitPhase::Uninitialized,
        startup_input: None,
        sandboxd_state: None,
        global_git_config_path: global_git_config_path.to_path_buf(),
        shutdown_after_init: false,
    }));
    let init_thread: SharedInitThread = Arc::new(Mutex::new(None));
    let (shutdown_sender, shutdown_receiver) = mpsc::channel::<()>();
    let (health_shutdown_sender, health_shutdown_receiver) = mpsc::channel::<()>();
    let sleeper = Arc::new(sleeper);
    let state_for_thread = state.clone();
    let init_thread_for_loop = init_thread.clone();
    let socket_path_for_thread = socket_path.to_path_buf();
    let sleeper_for_control = sleeper.clone();
    let sleeper_for_health = sleeper;

    let thread = thread::spawn(move || {
        let result = run_control_server_loop(
            listener,
            &state_for_thread,
            &init_thread_for_loop,
            &shutdown_receiver,
            sleeper_for_control.as_ref(),
            accept_poll_interval,
        );
        let _ = fs::remove_file(&socket_path_for_thread);
        result
    });
    let state_for_health_thread = state.clone();
    let health_thread = thread::spawn(move || {
        run_health_server_loop(
            health_listener,
            &state_for_health_thread,
            &health_shutdown_receiver,
            sleeper_for_health.as_ref(),
            accept_poll_interval,
        )
    });

    Ok(ControlServer {
        state,
        shutdown_sender,
        health_shutdown_sender,
        thread: Some(thread),
        health_thread: Some(health_thread),
        init_thread,
        health_endpoint_addr,
    })
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
        if should_shutdown_after_init(state)? {
            return Ok(());
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_nonblocking(false)
                    .map_err(ControlError::ConfigureConnection)?;
                let response = handle_connection(&mut stream, state, init_thread)
                    .unwrap_or_else(|error| ControlResponse::error(error.to_string()));
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

fn should_shutdown_after_init(
    state: &Arc<Mutex<ControlServerState>>,
) -> Result<bool, ControlError> {
    Ok(lock_control_state(state)?.shutdown_after_init)
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
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::net::{SocketAddr, TcpStream};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use tungstenite::{Message, accept};

    use crate::control::{
        ControlSignRequest, DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL, DEFAULT_HEALTH_ENDPOINT_PATH,
        EGRESS_PROXY_FAULT_KILL_PATH, InitPhase, TEST_FAULTS_ENABLED_ENV,
        start_control_server_with_health_endpoint, submit_init, submit_ready, submit_resume,
        submit_signing,
    };
    use crate::protocol::startup::{
        GitIdentity, GitSigningConfig, StartupExecutionMode, StartupInput, StartupMode,
    };
    use crate::test_support::TestEnvVarGuard;
    use crate::time::testing::ManualSleeper;
    use crate::time::{Sleeper, ThreadSleeper};

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);
    const TEST_PUBLIC_KEY: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE";

    #[test]
    fn accepts_one_init_request_from_the_control_socket() {
        let test_dir = create_temp_test_dir("control_init");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let startup_input =
            valid_startup_input(StartupMode::New, "bootstrap-token-value", &gateway.ws_url);
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        submit_init(&socket_path, &startup_input, true, false)
            .expect("init submission should succeed");

        wait_for_init_phase(&server, InitPhase::Initialized);
        assert_eq!(server.startup_input(), Some(startup_input));

        server.close().expect("control server should stop cleanly");
        gateway
            .close()
            .expect("bootstrap gateway should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn accepts_ready_request_without_initializing_the_daemon() {
        let test_dir = create_temp_test_dir("control_ready");
        let socket_path = test_dir.join("control.sock");
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        submit_ready(&socket_path).expect("ready submission should succeed");

        assert_eq!(server.init_phase(), InitPhase::Uninitialized);

        server.close().expect("control server should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn rejects_second_init_requests_after_initialization_begins() {
        let test_dir = create_temp_test_dir("control_second_init");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let startup_input =
            valid_startup_input(StartupMode::New, "bootstrap-token-value", &gateway.ws_url);
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        submit_init(&socket_path, &startup_input, true, false).expect("first init should succeed");
        let error = submit_init(&socket_path, &startup_input, true, false)
            .expect_err("second init should fail");

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
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        submit_init(&socket_path, &init_startup_input, true, false)
            .expect("init submission should succeed");
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
        let test_dir = create_temp_test_dir("control_resume_before_init");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let resume_startup_input = valid_startup_input(
            StartupMode::Existing,
            "bootstrap-token-value",
            &gateway.ws_url,
        );
        let server = start_test_control_server(&socket_path, ThreadSleeper);

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
    fn accepts_signing_requests_after_initialization() {
        let test_dir = create_temp_test_dir("control_sign_ok");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_signing_gateway();
        let startup_input =
            valid_signing_startup_input(&gateway.ws_url, format!("key::{TEST_PUBLIC_KEY}"));
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        submit_init(&socket_path, &startup_input, true, false)
            .expect("init submission should succeed");
        wait_for_init_phase(&server, InitPhase::Initialized);

        let signature_base64 = submit_signing(
            &socket_path,
            &ControlSignRequest {
                key_ref: format!("key::{TEST_PUBLIC_KEY}"),
                payload_base64: "c2lnbiBtZQ==".to_string(),
            },
        )
        .expect("sign submission should succeed");

        assert_eq!(
            signature_base64,
            "LS0tLS1CRUdJTiBTU0ggU0lHTkFUVVJFLS0tLS0KZXhhbXBsZS1zaWduYXR1cmUKLS0tLS1FTkQgU1NIIFNJR05BVFVSRS0tLS0tCg=="
        );

        server.close().expect("control server should stop cleanly");
        gateway
            .close()
            .expect("signing gateway should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn rejects_signing_requests_for_a_different_key_ref() {
        let test_dir = create_temp_test_dir("control_sign_wrong_key");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_signing_gateway();
        let startup_input =
            valid_signing_startup_input(&gateway.ws_url, format!("key::{TEST_PUBLIC_KEY}"));
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        submit_init(&socket_path, &startup_input, true, false)
            .expect("init submission should succeed");
        wait_for_init_phase(&server, InitPhase::Initialized);

        let error = submit_signing(
            &socket_path,
            &ControlSignRequest {
                key_ref: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDIFFERENT".to_string(),
                payload_base64: "c2lnbiBtZQ==".to_string(),
            },
        )
        .expect_err("sign submission should fail for a mismatched key ref");

        assert!(error.to_string().contains(
            "requested Git signing key does not match the configured Git signing identity"
        ));

        server.close().expect("control server should stop cleanly");
        gateway
            .close()
            .expect("signing gateway should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn returns_init_failure_to_the_control_socket_client() {
        let test_dir = create_temp_test_dir("control_init_failure");
        let socket_path = test_dir.join("control.sock");
        let startup_input = valid_startup_input(
            StartupMode::New,
            "bootstrap-token-value",
            "ws://127.0.0.1:9/bootstrap",
        );
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        let error = submit_init(&socket_path, &startup_input, true, false)
            .expect_err("init submission should fail when bootstrap tunnel cannot connect");

        assert!(error.to_string().contains(
            "failed to initialize sandboxd state: failed to start bootstrap tunnel session"
        ));
        match server.init_phase() {
            InitPhase::Failed(message) => {
                assert!(message.contains("failed to start bootstrap tunnel session"));
            }
            phase => panic!("init phase should be failed, got {phase:?}"),
        }

        server.close().expect("control server should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn records_control_loop_sleep_requests_with_manual_sleeper() {
        let test_dir = create_temp_test_dir("control_manual_sleeper");
        let socket_path = test_dir.join("control.sock");
        let sleeper = ManualSleeper::default();
        let server = start_test_control_server_with_interval(
            &socket_path,
            sleeper.clone(),
            Duration::from_millis(7),
        );

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

    #[test]
    fn serves_uninitialized_health_snapshot_over_loopback_http() {
        let test_dir = create_temp_test_dir("control_health_uninitialized");
        let socket_path = test_dir.join("control.sock");
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        let (status_code, body) = fetch_health_response(server.health_endpoint_addr());

        assert_eq!(status_code, 200);
        assert_eq!(body["daemon_phase"], "uninitialized");
        assert!(body["snapshot"].is_null());
        assert!(body["init_error"].is_null());

        server.close().expect("control server should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn serves_initialized_health_snapshot_over_loopback_http() {
        let test_dir = create_temp_test_dir("control_health_initialized");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let startup_input =
            valid_startup_input(StartupMode::New, "bootstrap-token-value", &gateway.ws_url);
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        submit_init(&socket_path, &startup_input, true, false)
            .expect("init submission should succeed");
        wait_for_init_phase(&server, InitPhase::Initialized);

        let (status_code, body) = fetch_health_response(server.health_endpoint_addr());

        assert_eq!(status_code, 200);
        assert_eq!(body["daemon_phase"], "initialized");
        assert!(body["snapshot"].is_object());
        assert!(body["init_error"].is_null());
        let components = body["snapshot"]["components"]
            .as_array()
            .expect("components should serialize as an array");
        assert!(
            components
                .iter()
                .any(|component| component["component"] == "tunnel_session"),
            "initialized health response should include the tunnel component"
        );

        server.close().expect("control server should stop cleanly");
        gateway
            .close()
            .expect("bootstrap gateway should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn snapshot_materialization_init_applies_runtime_plan_and_exits_after_init() {
        let test_dir = create_temp_test_dir("control_snapshot_materialization");
        let socket_path = test_dir.join("control.sock");
        let startup_output_path = test_dir.join("snapshot-artifact-output.txt");
        let gateway = start_bootstrap_gateway();
        let server = start_test_control_server(&socket_path, ThreadSleeper);
        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: StartupExecutionMode::Snapshot,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: gateway.ws_url.clone(),
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": "registry.example.test/base:latest"
                },
                "egressRoutes": [],
                "artifacts": [
                    {
                        "artifactKey": "artifact_1",
                        "name": "artifact one",
                        "lifecycle": {
                            "install": [
                                {
                                    "op": "exec",
                                    "command": {
                                        "args": [
                                            "sh",
                                            "-c",
                                            format!("printf snapshot-artifact > {}", startup_output_path.display())
                                        ]
                                    }
                                }
                            ]
                        }
                    }
                ],
                "runtimeClients": [
                    {
                        "clientId": "snapshot-client",
                        "setup": {
                            "env": {},
                            "files": []
                        },
                        "processes": [
                            {
                                "processKey": "should-not-start",
                                "command": {
                                    "args": ["/definitely/missing-binary"]
                                },
                                "readiness": {
                                    "type": "none"
                                },
                                "stop": {
                                    "signal": "sigterm",
                                    "timeoutMs": 10000,
                                    "gracePeriodMs": 2000
                                }
                            }
                        ],
                        "endpoints": []
                    }
                ],
                "workspaceSources": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        submit_init(&socket_path, &startup_input, true, false)
            .expect("snapshot materialization init submission should succeed");

        server
            .wait()
            .expect("control server should exit after snapshot materialization init");
        assert_eq!(
            std::fs::read_to_string(&startup_output_path)
                .expect("snapshot runtime-plan artifact output should exist"),
            "snapshot-artifact"
        );
        gateway
            .close()
            .expect("bootstrap gateway should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn rejects_fault_injection_requests_when_runtime_opt_in_is_missing() {
        let _fault_guard = TestEnvVarGuard::unset(TEST_FAULTS_ENABLED_ENV);
        let test_dir = create_temp_test_dir("control_fault_injection_disabled");
        let socket_path = test_dir.join("control.sock");
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        let (status_code, body) = fetch_http_json_response(
            server.health_endpoint_addr(),
            "POST",
            EGRESS_PROXY_FAULT_KILL_PATH,
        );

        assert_eq!(status_code, 403);
        assert_eq!(body["error"], "test_fault_injection_disabled");

        server.close().expect("control server should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn rejects_fault_injection_requests_when_the_target_component_is_unavailable() {
        let _fault_guard = TestEnvVarGuard::set(TEST_FAULTS_ENABLED_ENV, "1");
        let test_dir = create_temp_test_dir("control_fault_injection_unavailable");
        let socket_path = test_dir.join("control.sock");
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        let (status_code, body) = fetch_http_json_response(
            server.health_endpoint_addr(),
            "POST",
            EGRESS_PROXY_FAULT_KILL_PATH,
        );

        assert_eq!(status_code, 409);
        assert_eq!(body["error"], "sandboxd is not initialized");

        server.close().expect("control server should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    fn start_test_control_server<S: Sleeper + 'static>(
        socket_path: &std::path::Path,
        sleeper: S,
    ) -> crate::control::ControlServer {
        start_test_control_server_with_interval(
            socket_path,
            sleeper,
            DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        )
    }

    fn start_test_control_server_with_interval<S: Sleeper + 'static>(
        socket_path: &std::path::Path,
        sleeper: S,
        accept_poll_interval: Duration,
    ) -> crate::control::ControlServer {
        start_control_server_with_health_endpoint(
            socket_path,
            "127.0.0.1:0"
                .parse()
                .expect("test health endpoint address should parse"),
            sleeper,
            accept_poll_interval,
            &test_global_git_config_path(socket_path),
        )
        .expect("control server should start")
    }

    fn test_global_git_config_path(socket_path: &std::path::Path) -> std::path::PathBuf {
        socket_path
            .parent()
            .expect("test control socket should have a parent")
            .join("home")
            .join(".gitconfig")
    }

    fn fetch_health_response(health_endpoint_addr: SocketAddr) -> (u16, serde_json::Value) {
        fetch_http_json_response(health_endpoint_addr, "GET", DEFAULT_HEALTH_ENDPOINT_PATH)
    }

    fn fetch_http_json_response(
        health_endpoint_addr: SocketAddr,
        method: &str,
        path: &str,
    ) -> (u16, serde_json::Value) {
        let mut stream =
            TcpStream::connect(health_endpoint_addr).expect("health endpoint should accept TCP");
        stream
            .write_all(
                format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                    .as_bytes(),
            )
            .expect("health endpoint request should write");
        let mut raw_response = String::new();
        stream
            .read_to_string(&mut raw_response)
            .expect("health endpoint response should read");

        let (head, body) = raw_response
            .split_once("\r\n\r\n")
            .expect("HTTP response should contain a header/body separator");
        let status_code = head
            .lines()
            .next()
            .and_then(|status_line| status_line.split_whitespace().nth(1))
            .and_then(|code| code.parse::<u16>().ok())
            .expect("HTTP response should include a numeric status code");
        let body = serde_json::from_str(body).expect("health endpoint body should be valid json");

        (status_code, body)
    }

    fn wait_for_init_phase(server: &crate::control::ControlServer, expected: InitPhase) {
        for _ in 0..100 {
            match server.init_phase() {
                phase if phase == expected => return,
                InitPhase::Failed(error) => {
                    panic!("sandboxd init failed while waiting for {expected:?}: {error}")
                }
                InitPhase::Initialized => {
                    panic!(
                        "sandboxd reached initialized while waiting for different phase {expected:?}"
                    )
                }
                InitPhase::Initializing | InitPhase::Uninitialized => {}
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
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: bootstrap_token.to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: tunnel_gateway_ws_url.to_string(),
            acting_user_id: None,
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
            git_identity: None,
            transparent_proxy: None,
        }
    }

    fn valid_signing_startup_input(tunnel_gateway_ws_url: &str, key_ref: String) -> StartupInput {
        StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: tunnel_gateway_ws_url.to_string(),
            acting_user_id: None,
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
            git_identity: Some(GitIdentity {
                name: "Mistle User".to_string(),
                email: "mistle-user@example.com".to_string(),
                signing: Some(GitSigningConfig {
                    format: "ssh".to_string(),
                    program: "/opt/mistle/bin/mistle-ssh-sign".to_string(),
                    key_ref,
                    organization_id: "org_123".to_string(),
                    provider_family: "github".to_string(),
                    integration_connection_id: Some("icn_github".to_string()),
                    acting_user_id: "usr_123".to_string(),
                    grant: "grant-token".to_string(),
                }),
            }),
            transparent_proxy: None,
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

    fn start_signing_gateway() -> BootstrapGateway {
        let listener = TcpListener::bind("127.0.0.1:0").expect("signing gateway should bind");
        listener
            .set_nonblocking(true)
            .expect("signing gateway listener should become nonblocking");
        let ws_url = format!(
            "ws://127.0.0.1:{}/bootstrap",
            listener
                .local_addr()
                .expect("signing gateway should expose its address")
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
                            .expect("signing gateway stream should become blocking");
                        let mut websocket =
                            accept(stream).expect("signing gateway handshake should succeed");
                        loop {
                            match websocket.read() {
                                Ok(Message::Text(message)) => {
                                    let payload = message.as_str();
                                    if payload.contains("\"type\":\"signing.request\"") {
                                        let request: serde_json::Value =
                                            serde_json::from_str(payload)
                                                .expect("signing request should be valid json");
                                        let request_id = request["requestId"]
                                            .as_str()
                                            .expect("signing request id should exist");
                                        let response = serde_json::json!({
                                            "type": "signing.result",
                                            "requestId": request_id,
                                            "ok": true,
                                            "signature": "LS0tLS1CRUdJTiBTU0ggU0lHTkFUVVJFLS0tLS0KZXhhbXBsZS1zaWduYXR1cmUKLS0tLS1FTkQgU1NIIFNJR05BVFVSRS0tLS0tCg==",
                                            "encoding": "base64"
                                        });
                                        websocket
                                            .send(Message::Text(response.to_string().into()))
                                            .expect("signing result should send");
                                    }
                                }
                                Ok(Message::Close(_)) => return,
                                Ok(
                                    Message::Binary(_)
                                    | Message::Ping(_)
                                    | Message::Pong(_)
                                    | Message::Frame(_),
                                ) => {}
                                Err(tungstenite::Error::ConnectionClosed)
                                | Err(tungstenite::Error::Protocol(
                                    tungstenite::error::ProtocolError::ResetWithoutClosingHandshake,
                                )) => return,
                                Err(error) => {
                                    panic!("signing gateway should read frames: {error}");
                                }
                            }
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        ThreadSleeper.sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("signing gateway accept should succeed: {error}"),
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
