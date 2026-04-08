//! Thin local startup submission client for `sandboxd`.
//!
//! `sandboxd init` is the only one-shot command path that remains outside the
//! daemon. It reads one startup payload from stdin, forwards that payload to
//! the running daemon over the local control socket, writes the daemon
//! response to stdout, and exits.

use std::fmt;
use std::io::{Read, Write};
use std::path::Path;

use crate::control;
use crate::protocol::startup::{StartupInitErrorResponse, StartupInitOkResponse, StartupInput};

/// Describes why `sandboxd init` failed to read stdin, submit to the daemon, or
/// write its JSON response.
#[derive(Debug)]
pub enum InitError {
    ReadRequest(std::io::Error),
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
) -> Result<(), InitError>
where
    R: Read,
    W: Write,
{
    let mut raw_request = Vec::new();
    let startup_input = match reader.read_to_end(&mut raw_request) {
        Ok(_) => match serde_json::from_slice::<StartupInput>(&raw_request) {
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

    match control::submit_init(control_socket_path, &startup_input) {
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
    use std::ffi::OsString;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{LazyLock, Mutex, mpsc};
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    use tungstenite::{Error as WebSocketError, Message, accept};

    use crate::control;
    use crate::protocol::startup::{StartupInitResponse, StartupInput, StartupMode};
    use crate::time::{Sleeper, ThreadSleeper};

    use crate::init::run_init;

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);
    static ENV_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
    const TOKENIZER_PROXY_EGRESS_BASE_URL_ENV: &str =
        "SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL";

    #[test]
    fn submits_startup_input_and_writes_ok_response() {
        let _env_guard =
            TestEnvVarGuard::set(TOKENIZER_PROXY_EGRESS_BASE_URL_ENV, "http://127.0.0.1:5205");
        let test_dir = create_temp_test_dir("init_ok");
        let control_socket_path = test_dir.join("control.sock");
        let gateway = start_bootstrap_gateway();
        let request = serde_json::to_string(&valid_startup_input(&gateway.ws_url))
            .expect("startup input should serialize");
        let mut stdout = Vec::new();
        let server = control::start_control_server(
            &control_socket_path,
            ThreadSleeper,
            control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        )
        .expect("control server should start");

        run_init(&mut request.as_bytes(), &mut stdout, &control_socket_path)
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
    fn writes_error_response_for_invalid_startup_input() {
        let test_dir = create_temp_test_dir("init_invalid");
        let control_socket_path = test_dir.join("control.sock");
        let mut stdout = Vec::new();

        let error = run_init(
            &mut br#"{"startupMode":null}"#.as_slice(),
            &mut stdout,
            &control_socket_path,
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

    fn valid_startup_input(tunnel_gateway_ws_url: &str) -> StartupInput {
        StartupInput {
            startup_mode: StartupMode::New,
            bootstrap_token: "bootstrap-token-value".to_string(),
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

    struct TestEnvVarGuard {
        _lock: std::sync::MutexGuard<'static, ()>,
        name: &'static str,
        previous: Option<OsString>,
    }

    impl TestEnvVarGuard {
        fn set(name: &'static str, value: &str) -> Self {
            let lock = ENV_MUTEX
                .lock()
                .expect("test env mutex should not be poisoned");
            let previous = std::env::var_os(name);
            // SAFETY: tests serialize environment mutation through ENV_MUTEX.
            unsafe {
                std::env::set_var(name, value);
            }
            Self {
                _lock: lock,
                name,
                previous,
            }
        }
    }

    impl Drop for TestEnvVarGuard {
        fn drop(&mut self) {
            match &self.previous {
                Some(previous) => {
                    // SAFETY: tests serialize environment mutation through ENV_MUTEX.
                    unsafe {
                        std::env::set_var(self.name, previous);
                    }
                }
                None => {
                    // SAFETY: tests serialize environment mutation through ENV_MUTEX.
                    unsafe {
                        std::env::remove_var(self.name);
                    }
                }
            }
        }
    }
}
