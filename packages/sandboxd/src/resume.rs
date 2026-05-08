//! Thin local resume submission client for `sandboxd`.
//!
//! `sandboxd resume` reads one startup payload from stdin, forwards that payload
//! to the running daemon over the local control socket, writes the daemon
//! response to stdout, and exits.

use std::fmt;
use std::io::{Read, Write};
use std::path::Path;

use crate::control;
use crate::protocol::startup::{StartupInitErrorResponse, StartupInitOkResponse, StartupInput};

/// Describes why `sandboxd resume` failed to read stdin, submit to the daemon,
/// or write its JSON response.
#[derive(Debug)]
pub enum ResumeError {
    ReadRequest(std::io::Error),
    InvalidRequest(serde_json::Error),
    SubmitResume(String),
    WriteResponse(std::io::Error),
    SerializeResponse(serde_json::Error),
}

impl fmt::Display for ResumeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ReadRequest(error) => {
                write!(f, "failed to read sandbox resume request: {error}")
            }
            Self::InvalidRequest(error) => {
                write!(f, "sandbox resume request must be valid json: {error}")
            }
            Self::SubmitResume(error) => {
                write!(f, "failed to submit sandbox resume request: {error}")
            }
            Self::WriteResponse(error) => {
                write!(f, "failed to write sandbox resume response: {error}")
            }
            Self::SerializeResponse(error) => {
                write!(f, "failed to serialize sandbox resume response: {error}")
            }
        }
    }
}

impl std::error::Error for ResumeError {}

/// Reads one startup payload from stdin, submits it to the daemon as a resume
/// request, and writes a JSON response.
pub fn run_resume<R, W>(
    reader: &mut R,
    writer: &mut W,
    control_socket_path: &Path,
) -> Result<(), ResumeError>
where
    R: Read,
    W: Write,
{
    let mut raw_request = Vec::new();
    let startup_input = match reader.read_to_end(&mut raw_request) {
        Ok(_) => match serde_json::from_slice::<StartupInput>(&raw_request) {
            Ok(startup_input) => startup_input,
            Err(error) => {
                let error = ResumeError::InvalidRequest(error);
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
            let error = ResumeError::ReadRequest(error);
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

    match control::submit_resume(control_socket_path, &startup_input) {
        Ok(()) => {
            write_response(writer, &StartupInitOkResponse { ok: true })?;
            Ok(())
        }
        Err(error) => {
            let error = ResumeError::SubmitResume(error.to_string());
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

fn write_response<W, T>(writer: &mut W, response: &T) -> Result<(), ResumeError>
where
    W: Write,
    T: serde::Serialize,
{
    let response_bytes = serde_json::to_vec(response).map_err(ResumeError::SerializeResponse)?;
    writer
        .write_all(&response_bytes)
        .map_err(ResumeError::WriteResponse)?;
    writer
        .write_all(b"\n")
        .map_err(ResumeError::WriteResponse)?;
    writer.flush().map_err(ResumeError::WriteResponse)
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
    use crate::resume::run_resume;
    use crate::test_support::TestEnvVarGuard;
    use crate::time::{Sleeper, ThreadSleeper};

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);
    const GATEWAY_PROXY_ENABLED_ENV: &str = "GATEWAY_PROXY_ENABLED";

    #[test]
    fn submits_resume_request_and_writes_ok_response() {
        let _env_guard = TestEnvVarGuard::set(GATEWAY_PROXY_ENABLED_ENV, "1");
        let test_dir = create_temp_test_dir("resume_ok");
        let control_socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let init_request = serde_json::to_string(&valid_startup_input(
            StartupMode::New,
            "bootstrap-token-value",
            &gateway.ws_url,
        ))
        .expect("startup input should serialize");
        let resume_request = serde_json::to_string(&valid_startup_input(
            StartupMode::Existing,
            "bootstrap-token-value-2",
            &gateway.ws_url,
        ))
        .expect("resume input should serialize");
        let mut init_stdout = Vec::new();
        let mut resume_stdout = Vec::new();
        let server = start_test_control_server(
            &control_socket_path,
            ThreadSleeper,
            control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        );

        crate::init::run_init(
            &mut init_request.as_bytes(),
            &mut init_stdout,
            &control_socket_path,
        )
        .expect("init should succeed before resume");
        run_resume(
            &mut resume_request.as_bytes(),
            &mut resume_stdout,
            &control_socket_path,
        )
        .expect("resume should submit a valid startup input");

        let response: StartupInitResponse =
            serde_json::from_slice(&resume_stdout).expect("resume should write a valid response");

        assert_eq!(
            response,
            StartupInitResponse::Ok(crate::protocol::startup::StartupInitOkResponse { ok: true })
        );
        assert_eq!(
            server
                .startup_input()
                .expect("server should store latest startup input")
                .startup_mode,
            StartupMode::Existing
        );

        server.close().expect("control server should stop cleanly");
        gateway
            .close()
            .expect("bootstrap gateway should stop cleanly");
        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn writes_error_response_when_resume_is_submitted_before_init() {
        let _env_guard = TestEnvVarGuard::set(GATEWAY_PROXY_ENABLED_ENV, "1");
        let test_dir = create_temp_test_dir("resume_before_init");
        let control_socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let request = serde_json::to_string(&valid_startup_input(
            StartupMode::Existing,
            "bootstrap-token-value",
            &gateway.ws_url,
        ))
        .expect("resume input should serialize");
        let mut stdout = Vec::new();
        let server = start_test_control_server(
            &control_socket_path,
            ThreadSleeper,
            control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        );

        let error = run_resume(&mut request.as_bytes(), &mut stdout, &control_socket_path)
            .expect_err("resume should fail before daemon init");

        let response: StartupInitResponse =
            serde_json::from_slice(&stdout).expect("resume should write an error response");
        assert!(matches!(error, crate::resume::ResumeError::SubmitResume(_)));
        match response {
            StartupInitResponse::Error(error_response) => {
                assert!(
                    error_response
                        .error
                        .contains("sandboxd has not completed initialization")
                );
            }
            StartupInitResponse::Ok(_) => {
                panic!("expected resume error response before daemon init");
            }
        }

        server.close().expect("control server should stop cleanly");
        gateway
            .close()
            .expect("bootstrap gateway should stop cleanly");
        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    fn valid_startup_input(
        startup_mode: StartupMode,
        bootstrap_token: &str,
        tunnel_gateway_ws_url: &str,
    ) -> StartupInput {
        StartupInput {
            startup_mode,
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
                            .expect("accepted bootstrap connection should become blocking");
                        let mut socket =
                            accept(stream).expect("bootstrap websocket handshake should succeed");
                        loop {
                            match socket.read() {
                                Ok(Message::Ping(payload)) => {
                                    socket
                                        .send(Message::Pong(payload))
                                        .expect("bootstrap websocket should echo pong");
                                }
                                Ok(Message::Close(_)) => {
                                    match socket.close(None) {
                                        Ok(()) => {}
                                        Err(WebSocketError::ConnectionClosed)
                                        | Err(WebSocketError::AlreadyClosed) => {}
                                        Err(error) => {
                                            panic!(
                                                "bootstrap websocket should close cleanly: {error}"
                                            );
                                        }
                                    }
                                    break;
                                }
                                Ok(_) => {}
                                Err(WebSocketError::ConnectionClosed)
                                | Err(WebSocketError::AlreadyClosed) => break,
                                Err(WebSocketError::Protocol(
                                    tungstenite::error::ProtocolError::ResetWithoutClosingHandshake,
                                )) => break,
                                Err(WebSocketError::Io(error))
                                    if error.kind() == std::io::ErrorKind::ConnectionReset =>
                                {
                                    break;
                                }
                                Err(error) => {
                                    panic!("bootstrap websocket should stay readable: {error}");
                                }
                            }
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        ThreadSleeper.sleep(std::time::Duration::from_millis(10));
                    }
                    Err(error) => {
                        panic!("bootstrap gateway accept should succeed: {error}");
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
