//! Local Unix-socket control plane for a running `sandboxd` process.
//!
//! The daemon listens on `/run/.../control.sock` for one-shot local requests
//! from helper commands such as `sandboxd activate`. The control socket is the
//! only boundary that accepts activation lifecycle requests
//! once the daemon is running.

use std::fs;
use std::io::Write;
use std::net::{SocketAddr, TcpListener};
use std::os::unix::fs::FileTypeExt;
use std::os::unix::net::UnixListener;
use std::path::Path;
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::protocol::activation::ActivationInput;
use crate::time::Sleeper;

mod client;
mod error;
mod health;
mod protocol;
mod request;
mod state;

pub use crate::control::client::{submit_activate, submit_ready, submit_shutdown, submit_signing};
pub use crate::control::error::ControlError;
use crate::control::health::run_health_server_loop;
use crate::control::protocol::ControlResponse;
pub use crate::control::protocol::ControlSignRequest;
use crate::control::request::handle_connection;
use crate::control::state::{
    ActivationCompletion, ControlServerState, SharedActivationThread, close_sandboxd_state,
    join_activation_thread, lock_control_state,
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

/// Tracks the daemon activation phase exposed through control and health paths.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActivationPhase {
    Unactivated,
    Activating,
    Activated,
    Failed(String),
}

/// Owns one running control socket server thread and its observable state.
pub struct ControlServer {
    state: Arc<Mutex<ControlServerState>>,
    shutdown_sender: mpsc::Sender<()>,
    health_shutdown_sender: mpsc::Sender<()>,
    thread: Option<JoinHandle<Result<(), ControlError>>>,
    health_thread: Option<JoinHandle<Result<(), ControlError>>>,
    activation_thread: SharedActivationThread,
    health_endpoint_addr: SocketAddr,
}

impl ControlServer {
    /// Returns the current init phase for this daemon.
    pub fn activation_phase(&self) -> ActivationPhase {
        match lock_control_state(&self.state) {
            Ok(state) => state.activation_phase.clone(),
            Err(error) => ActivationPhase::Failed(error.to_string()),
        }
    }

    /// Returns the activation input accepted by this daemon, if any.
    pub fn activation_input(&self) -> Option<ActivationInput> {
        lock_control_state(&self.state)
            .ok()
            .and_then(|state| state.activation_input.clone())
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
        let init_result = join_activation_thread(&self.activation_thread);
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
        let init_result = join_activation_thread(&self.activation_thread);
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
        activation_phase: ActivationPhase::Unactivated,
        activation_input: None,
        sandboxd_state: None,
        global_git_config_path: global_git_config_path.to_path_buf(),
        shutdown_after_activation: false,
    }));
    let activation_thread: SharedActivationThread = Arc::new(Mutex::new(None));
    let activation_completion: ActivationCompletion = Arc::new(Condvar::new());
    let (shutdown_sender, shutdown_receiver) = mpsc::channel::<()>();
    let (health_shutdown_sender, health_shutdown_receiver) = mpsc::channel::<()>();
    let sleeper = Arc::new(sleeper);
    let state_for_thread = state.clone();
    let activation_thread_for_loop = activation_thread.clone();
    let activation_completion_for_loop = activation_completion;
    let socket_path_for_thread = socket_path.to_path_buf();
    let sleeper_for_control = sleeper.clone();
    let sleeper_for_health = sleeper;

    let thread = thread::spawn(move || {
        let result = run_control_server_loop(
            listener,
            &state_for_thread,
            &activation_thread_for_loop,
            &activation_completion_for_loop,
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
        activation_thread,
        health_endpoint_addr,
    })
}

fn run_control_server_loop(
    listener: UnixListener,
    state: &Arc<Mutex<ControlServerState>>,
    activation_thread: &SharedActivationThread,
    activation_completion: &ActivationCompletion,
    shutdown_receiver: &mpsc::Receiver<()>,
    sleeper: &impl Sleeper,
    accept_poll_interval: Duration,
) -> Result<(), ControlError> {
    loop {
        if shutdown_receiver.try_recv().is_ok() {
            return Ok(());
        }
        if should_shutdown_after_activation(state)? {
            return Ok(());
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_nonblocking(false)
                    .map_err(ControlError::ConfigureConnection)?;
                let response =
                    handle_connection(&mut stream, state, activation_thread, activation_completion)
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

fn should_shutdown_after_activation(
    state: &Arc<Mutex<ControlServerState>>,
) -> Result<bool, ControlError> {
    Ok(lock_control_state(state)?.shutdown_after_activation)
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
    use std::net::{SocketAddr, TcpListener, TcpStream};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use tungstenite::{Message, accept};

    use crate::control::{
        ActivationPhase, ControlSignRequest, DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        DEFAULT_HEALTH_ENDPOINT_PATH, start_control_server_with_health_endpoint, submit_activate,
        submit_ready, submit_shutdown, submit_signing,
    };
    use crate::protocol::activation::ActivationInput;
    use crate::protocol::startup::{ActivationOperationKind, GitIdentity, GitSigningConfig};
    use crate::time::{Sleeper, ThreadSleeper};

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);
    const TEST_PUBLIC_KEY: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE";

    #[test]
    fn activate_initializes_the_daemon_from_the_control_socket() {
        let test_dir = create_temp_test_dir("control_activate");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let activation_input = valid_activation_input(&gateway.ws_url);
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        submit_activate(&socket_path, &activation_input).expect("activation should succeed");

        wait_for_activation_phase(&server, ActivationPhase::Activated);
        assert_eq!(server.activation_input(), Some(activation_input));

        server.close().expect("control server should stop cleanly");
        gateway.close().expect("gateway should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn activate_is_idempotent_for_matching_input_after_activation() {
        let test_dir = create_temp_test_dir("control_activate_idempotent");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let activation_input = valid_activation_input(&gateway.ws_url);
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        submit_activate(&socket_path, &activation_input).expect("first activation should succeed");
        submit_activate(&socket_path, &activation_input)
            .expect("matching activation should succeed");

        assert_eq!(server.activation_phase(), ActivationPhase::Activated);
        assert_eq!(server.activation_input(), Some(activation_input));

        server.close().expect("control server should stop cleanly");
        gateway.close().expect("gateway should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn shutdown_gracefully_clears_initialized_daemon_state() {
        let test_dir = create_temp_test_dir("control_shutdown");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let activation_input = valid_activation_input(&gateway.ws_url);
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        submit_activate(&socket_path, &activation_input).expect("activation should succeed");
        wait_for_activation_phase(&server, ActivationPhase::Activated);

        submit_shutdown(&socket_path).expect("shutdown should succeed");
        submit_shutdown(&socket_path).expect("duplicate shutdown should succeed");

        assert_eq!(server.activation_phase(), ActivationPhase::Unactivated);
        assert_eq!(server.activation_input(), None);

        server.close().expect("control server should stop cleanly");
        gateway.close().expect("gateway should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn shutdown_is_idempotent_before_activation() {
        let test_dir = create_temp_test_dir("control_shutdown_unactivated");
        let socket_path = test_dir.join("control.sock");
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        submit_shutdown(&socket_path).expect("shutdown should succeed");
        submit_shutdown(&socket_path).expect("duplicate shutdown should succeed");

        assert_eq!(server.activation_phase(), ActivationPhase::Unactivated);
        assert_eq!(server.activation_input(), None);

        server.close().expect("control server should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn activated_daemon_rejects_runtime_plan_changes_without_clearing_health_snapshot() {
        let test_dir = create_temp_test_dir("control_activate_plan_reject");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let activation_input = valid_activation_input(&gateway.ws_url);
        let mut candidate_activation_input = activation_input.clone();
        candidate_activation_input.runtime_plan["sandboxProfileId"] =
            serde_json::json!("sbp_replacement");
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        submit_activate(&socket_path, &activation_input).expect("activation should succeed");
        let error = submit_activate(&socket_path, &candidate_activation_input)
            .expect_err("runtime plan change should be rejected");
        let (status_code, body) = fetch_health_response(server.health_endpoint_addr());

        assert!(
            error
                .to_string()
                .contains("initialized activation cannot change runtime plan")
        );
        assert_eq!(server.activation_phase(), ActivationPhase::Activated);
        assert_eq!(server.activation_input(), Some(activation_input));
        assert_eq!(status_code, 200);
        assert_eq!(body["daemon_phase"], "activated");
        assert!(body["snapshot"].is_object());

        server.close().expect("control server should stop cleanly");
        gateway.close().expect("gateway should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn ready_request_does_not_initialize_the_daemon() {
        let test_dir = create_temp_test_dir("control_ready");
        let socket_path = test_dir.join("control.sock");
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        submit_ready(&socket_path).expect("ready submission should succeed");

        assert_eq!(server.activation_phase(), ActivationPhase::Unactivated);

        server.close().expect("control server should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn signing_requests_work_after_activation() {
        let test_dir = create_temp_test_dir("control_sign_after_activate");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_signing_gateway();
        let activation_input =
            valid_signing_activation_input(&gateway.ws_url, format!("key::{TEST_PUBLIC_KEY}"));
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        submit_activate(&socket_path, &activation_input).expect("activation should succeed");
        wait_for_activation_phase(&server, ActivationPhase::Activated);

        let signature_base64 = submit_signing(
            &socket_path,
            &ControlSignRequest {
                key_ref: format!("key::{TEST_PUBLIC_KEY}"),
                payload_base64: "c2lnbiBtZQ==".to_string(),
            },
        )
        .expect("signing request should succeed");

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
    fn failed_activation_reports_failure_to_later_activation_attempts() {
        let test_dir = create_temp_test_dir("control_activate_failure");
        let socket_path = test_dir.join("control.sock");
        let activation_input = valid_activation_input("ws://127.0.0.1:9/bootstrap");
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        let error = submit_activate(&socket_path, &activation_input)
            .expect_err("unreachable bootstrap gateway should fail activation");

        assert!(
            error
                .to_string()
                .contains("failed to start bootstrap tunnel session")
        );
        let duplicate_error = submit_activate(&socket_path, &activation_input)
            .expect_err("activation should remain failed after a failed activation");
        assert!(
            duplicate_error
                .to_string()
                .contains("sandboxd activation already failed")
        );

        match server.activation_phase() {
            ActivationPhase::Failed(message) => {
                assert!(message.contains("failed to start bootstrap tunnel session"));
            }
            phase => panic!("activation phase should be failed, got {phase:?}"),
        }

        server.close().expect("control server should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn snapshot_activation_requests_shutdown_after_materialization() {
        let test_dir = create_temp_test_dir("control_snapshot_activate");
        let socket_path = test_dir.join("control.sock");
        let output_path = test_dir.join("snapshot-artifact-output.txt");
        let gateway = start_bootstrap_gateway();
        let mut activation_input = valid_activation_input(&gateway.ws_url);
        activation_input.operation_kind = ActivationOperationKind::Snapshot;
        activation_input.runtime_plan["artifacts"] = serde_json::json!([
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
                                    format!("printf snapshot-artifact > {}", output_path.display())
                                ]
                            }
                        }
                    ]
                }
            }
        ]);
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        submit_activate(&socket_path, &activation_input)
            .expect("snapshot activation should succeed");

        server
            .wait()
            .expect("snapshot activation should stop the control server");
        assert_eq!(
            std::fs::read_to_string(&output_path).expect("snapshot artifact output should exist"),
            "snapshot-artifact"
        );
        gateway.close().expect("gateway should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn serves_health_snapshot_after_activation() {
        let test_dir = create_temp_test_dir("control_health_activation");
        let socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let activation_input = valid_activation_input(&gateway.ws_url);
        let server = start_test_control_server(&socket_path, ThreadSleeper);

        submit_activate(&socket_path, &activation_input).expect("activation should succeed");
        wait_for_activation_phase(&server, ActivationPhase::Activated);

        let (status_code, body) = fetch_health_response(server.health_endpoint_addr());

        assert_eq!(status_code, 200);
        assert_eq!(body["daemon_phase"], "activated");
        assert!(body["snapshot"].is_object());
        assert!(body["init_error"].is_null());

        server.close().expect("control server should stop cleanly");
        gateway.close().expect("gateway should stop cleanly");
        std::fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    fn start_test_control_server<S: Sleeper + 'static>(
        socket_path: &std::path::Path,
        sleeper: S,
    ) -> crate::control::ControlServer {
        start_control_server_with_health_endpoint(
            socket_path,
            "127.0.0.1:0"
                .parse()
                .expect("test health endpoint address should parse"),
            sleeper,
            DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
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
        let mut stream =
            TcpStream::connect(health_endpoint_addr).expect("health endpoint should accept TCP");
        stream
            .write_all(
                format!(
                    "GET {DEFAULT_HEALTH_ENDPOINT_PATH} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
                )
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

    fn wait_for_activation_phase(
        server: &crate::control::ControlServer,
        expected: ActivationPhase,
    ) {
        for _ in 0..100 {
            match server.activation_phase() {
                phase if phase == expected => return,
                ActivationPhase::Failed(error) => {
                    panic!("sandboxd activation failed while waiting for {expected:?}: {error}")
                }
                ActivationPhase::Activated => {
                    panic!(
                        "sandboxd reached activated while waiting for different phase {expected:?}"
                    )
                }
                ActivationPhase::Activating | ActivationPhase::Unactivated => {}
            }

            ThreadSleeper.sleep(Duration::from_millis(10));
        }

        panic!("timed out waiting for activation phase");
    }

    fn valid_activation_input(tunnel_gateway_ws_url: &str) -> ActivationInput {
        ActivationInput {
            operation_kind: ActivationOperationKind::Start,
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
                "runtimeClients": [],
                "workspaceSources": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        }
    }

    fn valid_signing_activation_input(
        tunnel_gateway_ws_url: &str,
        key_ref: String,
    ) -> ActivationInput {
        let mut input = valid_activation_input(tunnel_gateway_ws_url);
        input.git_identity = Some(GitIdentity {
            name: "Mistle User".to_string(),
            email: "mistle@example.test".to_string(),
            signing: Some(GitSigningConfig {
                format: "ssh".to_string(),
                program: "/opt/mistle/bin/mistle-ssh-sign".to_string(),
                key_ref,
                organization_id: "org_123".to_string(),
                provider_family: "github".to_string(),
                integration_connection_id: Some("icn_123".to_string()),
                acting_user_id: "usr_123".to_string(),
                grant: "grant-token".to_string(),
            }),
        });
        input
    }

    fn create_temp_test_dir(prefix: &str) -> std::path::PathBuf {
        let counter = TEMP_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_millis();
        let path = std::path::PathBuf::from("/tmp").join(format!(
            "sbd-{prefix}-{}-{timestamp}-{counter}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("temp test dir should be created");
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
            if let Some(thread) = self.thread.take() {
                thread
                    .join()
                    .map_err(|_| "bootstrap gateway thread panicked".to_string())?;
            }
            Ok(())
        }
    }

    fn start_bootstrap_gateway() -> BootstrapGateway {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bootstrap gateway should bind");
        listener
            .set_nonblocking(true)
            .expect("bootstrap gateway listener should become nonblocking");
        let ws_url = format!(
            "ws://127.0.0.1:{}/bootstrap?sandbox_instance_id=sbi_test",
            listener
                .local_addr()
                .expect("bootstrap gateway should expose its address")
                .port()
        );
        let (shutdown_sender, shutdown_receiver) = mpsc::channel();

        let thread =
            thread::spawn(move || {
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
                            Err(error) => panic!("bootstrap gateway should read frames: {error}"),
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
            "ws://127.0.0.1:{}/bootstrap?sandbox_instance_id=sbi_test",
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
                                Err(error) => panic!("signing gateway should read frames: {error}"),
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
