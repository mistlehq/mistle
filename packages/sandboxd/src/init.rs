//! Thin local startup submission client for `sandboxd`.
//!
//! `sandboxd init` reads one startup payload from stdin, forwards that payload
//! to the running daemon over the local control socket, writes the daemon
//! response to stdout, and exits.

use std::fmt;
use std::io::{Read, Write};
use std::path::Path;

use crate::control;
use crate::protocol::startup::{StartupInitErrorResponse, StartupInitOkResponse, StartupInput};
use crate::startup_payload::{StartupPayloadReadError, StartupPayloadSource, read_startup_payload};

/// Describes why `sandboxd init` failed to read stdin, submit to the daemon, or
/// write its JSON response.
#[derive(Debug)]
pub enum InitError {
    ReadRequest(StartupPayloadReadError),
    InvalidRequest(serde_json::Error),
    SubmitInit(String),
    WriteResponse(std::io::Error),
    SerializeResponse(serde_json::Error),
}

impl fmt::Display for InitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ReadRequest(error) => write!(f, "failed to read sandbox init request: {error}"),
            Self::InvalidRequest(error) => {
                write!(f, "sandbox init request must be valid json: {error}")
            }
            Self::SubmitInit(error) => write!(f, "failed to submit sandbox init request: {error}"),
            Self::WriteResponse(error) => {
                write!(f, "failed to write sandbox init response: {error}")
            }
            Self::SerializeResponse(error) => {
                write!(f, "failed to serialize sandbox init response: {error}")
            }
        }
    }
}

impl std::error::Error for InitError {}

/// Reads one startup payload from stdin, submits it to the daemon, and writes
/// a JSON response.
pub fn run_init<R, W>(
    reader: &mut R,
    writer: &mut W,
    control_socket_path: &Path,
    detach: bool,
    payload_source: StartupPayloadSource,
) -> Result<(), InitError>
where
    R: Read,
    W: Write,
{
    let startup_input = match read_startup_payload(reader, payload_source) {
        Ok(raw_request) => match serde_json::from_slice::<StartupInput>(&raw_request) {
            Ok(startup_input) => startup_input,
            Err(error) => {
                let error = InitError::InvalidRequest(error);
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
            let error = InitError::ReadRequest(error);
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

    match control::submit_init(
        control_socket_path,
        &startup_input,
        !detach,
        should_wait_for_storage_attach_signal(),
    ) {
        Ok(()) => {
            write_response(writer, &StartupInitOkResponse { ok: true })?;
            Ok(())
        }
        Err(error) => {
            let error = InitError::SubmitInit(error.to_string());
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

fn should_wait_for_storage_attach_signal() -> bool {
    std::env::var("MISTLE_SANDBOXD_WAIT_FOR_STORAGE_ATTACH").is_ok_and(|value| value == "1")
}

fn write_response<W, T>(writer: &mut W, response: &T) -> Result<(), InitError>
where
    W: Write,
    T: serde::Serialize,
{
    let response_bytes = serde_json::to_vec(response).map_err(InitError::SerializeResponse)?;
    writer
        .write_all(&response_bytes)
        .map_err(InitError::WriteResponse)?;
    writer.write_all(b"\n").map_err(InitError::WriteResponse)?;
    writer.flush().map_err(InitError::WriteResponse)
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

    use crate::control;
    use crate::protocol::startup::{StartupInitResponse, StartupInput, StartupMode};
    use crate::startup_payload::StartupPayloadSource;
    use crate::time::{Sleeper, ThreadSleeper};

    use crate::init::run_init;

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);
    #[test]
    fn submits_startup_input_and_writes_ok_response() {
        let test_dir = create_temp_test_dir("init_ok");
        let control_socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let request = serde_json::to_string(&valid_startup_input(&gateway.ws_url))
            .expect("startup input should serialize");
        let mut stdout = Vec::new();
        let server = start_test_control_server(
            &control_socket_path,
            ThreadSleeper,
            control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        );

        run_init(
            &mut request.as_bytes(),
            &mut stdout,
            &control_socket_path,
            false,
            StartupPayloadSource::StdinUntilEof,
        )
        .expect("init should submit a valid startup input");

        let response: StartupInitResponse =
            serde_json::from_slice(&stdout).expect("init should write a valid response");

        assert_eq!(
            response,
            StartupInitResponse::Ok(crate::protocol::startup::StartupInitOkResponse { ok: true })
        );
        assert_eq!(
            server
                .startup_input()
                .expect("server should store startup input")
                .startup_mode,
            StartupMode::New
        );

        server.close().expect("control server should stop cleanly");
        gateway
            .close()
            .expect("bootstrap gateway should stop cleanly");
        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn submits_startup_input_from_exact_stdin_byte_count_without_waiting_for_eof() {
        let test_dir = create_temp_test_dir("init_stdin_bytes");
        let control_socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let request = serde_json::to_string(&valid_startup_input(&gateway.ws_url))
            .expect("startup input should serialize");
        let mut request_with_trailing_bytes = request.as_bytes().to_vec();
        request_with_trailing_bytes.extend_from_slice(b"trailing bytes that are not payload");
        let mut reader = request_with_trailing_bytes.as_slice();
        let mut stdout = Vec::new();
        let server = start_test_control_server(
            &control_socket_path,
            ThreadSleeper,
            control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        );

        run_init(
            &mut reader,
            &mut stdout,
            &control_socket_path,
            false,
            StartupPayloadSource::StdinBytes(request.len()),
        )
        .expect("init should read exactly the declared payload bytes");

        let response: StartupInitResponse =
            serde_json::from_slice(&stdout).expect("init should write a valid response");
        assert!(matches!(response, StartupInitResponse::Ok(_)));
        assert_eq!(
            server
                .startup_input()
                .expect("server should store startup input")
                .startup_mode,
            StartupMode::New
        );

        server.close().expect("control server should stop cleanly");
        gateway
            .close()
            .expect("bootstrap gateway should stop cleanly");
        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn writes_error_response_for_invalid_startup_input() {
        let test_dir = create_temp_test_dir("init_invalid");
        let control_socket_path = test_dir.join("control.sock");
        let mut stdout = Vec::new();

        let error = run_init(
            &mut br#"{"startupMode":null}"#.as_slice(),
            &mut stdout,
            &control_socket_path,
            false,
            StartupPayloadSource::StdinUntilEof,
        )
        .expect_err("invalid init request should fail");

        let response: StartupInitResponse =
            serde_json::from_slice(&stdout).expect("init should write an error response");
        assert!(matches!(error, crate::init::InitError::InvalidRequest(_)));
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

    fn valid_startup_input(tunnel_gateway_ws_url: &str) -> StartupInput {
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
                        stream
                            .set_nonblocking(false)
                            .expect("bootstrap gateway stream should become blocking");
                        let mut websocket =
                            accept(stream).expect("bootstrap gateway handshake should succeed");
                        loop {
                            match websocket.read() {
                                Ok(Message::Close(_))
                                | Err(WebSocketError::ConnectionClosed)
                                | Err(WebSocketError::Protocol(
                                    tungstenite::error::ProtocolError::ResetWithoutClosingHandshake,
                                )) => return,
                                Ok(
                                    Message::Text(_)
                                    | Message::Binary(_)
                                    | Message::Ping(_)
                                    | Message::Pong(_)
                                    | Message::Frame(_),
                                ) => {}
                                Err(error) => {
                                    panic!("bootstrap gateway should read frames: {error}")
                                }
                            }
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        ThreadSleeper.sleep(std::time::Duration::from_millis(10));
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
