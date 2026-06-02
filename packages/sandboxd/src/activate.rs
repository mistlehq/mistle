//! Thin local activation submission client for `sandboxd`.
//!
//! `sandboxd activate` reads one activation payload from stdin, forwards that
//! payload to the running daemon over the local control socket, writes the daemon
//! response to stdout, and exits.

use std::fmt;
use std::io::{Read, Write};
use std::path::Path;

use crate::control;
use crate::protocol::activation::ActivationInput;
use crate::protocol::startup::{StartupInitErrorResponse, StartupInitOkResponse};
use crate::startup_payload::{StartupPayloadReadError, StartupPayloadSource, read_startup_payload};

#[derive(Debug)]
pub enum ActivateError {
    ReadRequest(StartupPayloadReadError),
    InvalidRequest(serde_json::Error),
    SubmitActivate(String),
    WriteResponse(std::io::Error),
    SerializeResponse(serde_json::Error),
}

impl fmt::Display for ActivateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ReadRequest(error) => {
                write!(f, "failed to read sandbox activate request: {error}")
            }
            Self::InvalidRequest(error) => {
                write!(f, "sandbox activate request must be valid json: {error}")
            }
            Self::SubmitActivate(error) => {
                write!(f, "failed to submit sandbox activate request: {error}")
            }
            Self::WriteResponse(error) => {
                write!(f, "failed to write sandbox activate response: {error}")
            }
            Self::SerializeResponse(error) => {
                write!(f, "failed to serialize sandbox activate response: {error}")
            }
        }
    }
}

impl std::error::Error for ActivateError {}

pub fn run_activate<R, W>(
    reader: &mut R,
    writer: &mut W,
    control_socket_path: &Path,
    payload_source: StartupPayloadSource,
) -> Result<(), ActivateError>
where
    R: Read,
    W: Write,
{
    let activation_input = match read_startup_payload(reader, payload_source) {
        Ok(raw_request) => match serde_json::from_slice::<ActivationInput>(&raw_request) {
            Ok(activation_input) => activation_input,
            Err(error) => {
                let error = ActivateError::InvalidRequest(error);
                write_response(
                    writer,
                    &StartupInitErrorResponse {
                        ok: false,
                        error: error.to_string(),
                    },
                )?;
                return Err(error);
            }
        },
        Err(error) => {
            let error = ActivateError::ReadRequest(error);
            write_response(
                writer,
                &StartupInitErrorResponse {
                    ok: false,
                    error: error.to_string(),
                },
            )?;
            return Err(error);
        }
    };

    match control::submit_activate(control_socket_path, &activation_input) {
        Ok(()) => {
            write_response(writer, &StartupInitOkResponse { ok: true })?;
            Ok(())
        }
        Err(error) => {
            let error = ActivateError::SubmitActivate(error.to_string());
            write_response(
                writer,
                &StartupInitErrorResponse {
                    ok: false,
                    error: error.to_string(),
                },
            )?;
            Err(error)
        }
    }
}

fn write_response<W, T>(writer: &mut W, response: &T) -> Result<(), ActivateError>
where
    W: Write,
    T: serde::Serialize,
{
    let response_bytes = serde_json::to_vec(response).map_err(ActivateError::SerializeResponse)?;
    writer
        .write_all(&response_bytes)
        .map_err(ActivateError::WriteResponse)?;
    writer
        .write_all(b"\n")
        .map_err(ActivateError::WriteResponse)?;
    writer.flush().map_err(ActivateError::WriteResponse)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc;
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    use tungstenite::{Error as WebSocketError, Message, accept};

    use crate::activate::run_activate;
    use crate::control;
    use crate::protocol::activation::ActivationInput;
    use crate::protocol::startup::{StartupInitResponse, StartupOperationKind};
    use crate::startup_payload::StartupPayloadSource;
    use crate::time::{Sleeper, ThreadSleeper};

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn submits_activation_input_and_writes_ok_response() {
        let test_dir = create_temp_test_dir("activate_ok");
        let control_socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let request = serde_json::to_string(&valid_activation_input(&gateway.ws_url))
            .expect("activation input should serialize");
        let mut stdout = Vec::new();
        let server = start_test_control_server(
            &control_socket_path,
            ThreadSleeper,
            control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        );

        run_activate(
            &mut request.as_bytes(),
            &mut stdout,
            &control_socket_path,
            StartupPayloadSource::StdinUntilEof,
        )
        .expect("activate should submit a valid activation input");

        let response: StartupInitResponse =
            serde_json::from_slice(&stdout).expect("activate should write a valid response");
        assert!(matches!(response, StartupInitResponse::Ok(_)));
        assert_eq!(
            server
                .activation_input()
                .expect("server should store activation input")
                .operation_kind,
            StartupOperationKind::Start
        );
        assert!(
            server.startup_input().is_none(),
            "activation should not require caller-provided startup input"
        );

        server.close().expect("control server should stop cleanly");
        gateway
            .close()
            .expect("bootstrap gateway should stop cleanly");
        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn writes_error_response_for_legacy_startup_mode() {
        let test_dir = create_temp_test_dir("activate_invalid");
        let control_socket_path = test_dir.join("control.sock");
        let mut stdout = Vec::new();

        let error = run_activate(
            &mut br#"{"startupMode":"new"}"#.as_slice(),
            &mut stdout,
            &control_socket_path,
            StartupPayloadSource::StdinUntilEof,
        )
        .expect_err("invalid activation request should fail");

        let response: StartupInitResponse =
            serde_json::from_slice(&stdout).expect("activate should write an error response");
        assert!(matches!(
            error,
            crate::activate::ActivateError::InvalidRequest(_)
        ));
        assert!(matches!(response, StartupInitResponse::Error(_)));

        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
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

        fs::create_dir_all(&path).expect("temp test dir should be creatable");

        path
    }

    fn start_test_control_server<S: Sleeper + 'static>(
        socket_path: &std::path::Path,
        sleeper: S,
        accept_poll_interval: std::time::Duration,
    ) -> crate::control::ControlServer {
        control::start_control_server_with_health_endpoint(
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

    fn valid_activation_input(tunnel_gateway_ws_url: &str) -> ActivationInput {
        ActivationInput {
            operation_kind: StartupOperationKind::Start,
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
            git_identity: None,
            transparent_proxy: None,
        }
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
                        let mut websocket =
                            accept(stream).expect("bootstrap gateway should accept websocket");
                        loop {
                            match websocket.read() {
                                Ok(Message::Close(_)) => return,
                                Ok(Message::Ping(payload)) => websocket
                                    .send(Message::Pong(payload))
                                    .expect("bootstrap gateway should write pong"),
                                Ok(_) => {}
                                Err(WebSocketError::ConnectionClosed) => return,
                                Err(error) => {
                                    panic!("bootstrap gateway websocket failed: {error}");
                                }
                            }
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Err(error) => {
                        panic!("bootstrap gateway accept failed: {error}");
                    }
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
