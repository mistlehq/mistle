//! Local SSH-signer-compatible client for `sandboxd`.
//!
//! Git invokes `gpg.ssh.program` using the OpenSSH-compatible signer argv
//! shape. This client parses the signing request, forwards it to the running
//! daemon over the local control socket, and writes the detached signature file
//! back to the payload path Git supplied.

use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as Base64;

use crate::control;

pub const DEFAULT_SIGNER_ALIAS_NAME: &str = "mistle-ssh-sign";

#[derive(Debug, Clone, PartialEq, Eq)]
struct SignInvocation {
    namespace: String,
    key_ref: String,
    payload_path: PathBuf,
}

/// Describes why the signer-compatible local client failed.
#[derive(Debug)]
pub enum SignError {
    UnsupportedInvocation(String),
    ReadKeyFile {
        path: PathBuf,
        error: std::io::Error,
    },
    InvalidKeyFile(PathBuf),
    ReadPayloadFile {
        path: PathBuf,
        error: std::io::Error,
    },
    SubmitSigning(String),
    DecodeSignature(base64::DecodeError),
    WriteSignatureFile {
        path: PathBuf,
        error: std::io::Error,
    },
}

impl fmt::Display for SignError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedInvocation(message) => {
                write!(f, "unsupported SSH signing invocation: {message}")
            }
            Self::ReadKeyFile { path, error } => {
                write!(
                    f,
                    "failed to read Git SSH signing key file {}: {error}",
                    path.display()
                )
            }
            Self::InvalidKeyFile(path) => {
                write!(
                    f,
                    "Git SSH signing key file {} does not contain a usable public key",
                    path.display()
                )
            }
            Self::ReadPayloadFile { path, error } => {
                write!(
                    f,
                    "failed to read Git SSH signing payload file {}: {error}",
                    path.display()
                )
            }
            Self::SubmitSigning(error) => {
                write!(f, "failed to submit Git SSH signing request: {error}")
            }
            Self::DecodeSignature(error) => {
                write!(f, "failed to decode Git SSH signing response: {error}")
            }
            Self::WriteSignatureFile { path, error } => {
                write!(
                    f,
                    "failed to write Git SSH signature file {}: {error}",
                    path.display()
                )
            }
        }
    }
}

impl std::error::Error for SignError {}

pub fn run_sign<I, S>(args: I, control_socket_path: &Path) -> Result<(), SignError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let invocation = parse_sign_invocation(args.into_iter().map(Into::into))?;
    let payload_bytes =
        fs::read(&invocation.payload_path).map_err(|error| SignError::ReadPayloadFile {
            path: invocation.payload_path.clone(),
            error,
        })?;
    let signature_base64 = control::submit_signing(
        control_socket_path,
        &control::ControlSignRequest {
            key_ref: invocation.key_ref,
            payload_base64: Base64.encode(payload_bytes),
        },
    )
    .map_err(|error| SignError::SubmitSigning(error.to_string()))?;
    let signature_bytes = Base64
        .decode(signature_base64)
        .map_err(SignError::DecodeSignature)?;
    let signature_path = signature_output_path(&invocation.payload_path);
    fs::write(&signature_path, signature_bytes).map_err(|error| SignError::WriteSignatureFile {
        path: signature_path,
        error,
    })
}

fn parse_sign_invocation<I>(args: I) -> Result<SignInvocation, SignError>
where
    I: IntoIterator<Item = String>,
{
    let mut parsed_args = args.into_iter();
    match parsed_args.next().as_deref() {
        Some("-Y") => {}
        Some(other) => {
            return Err(SignError::UnsupportedInvocation(format!(
                "expected '-Y' but received '{other}'"
            )));
        }
        None => {
            return Err(SignError::UnsupportedInvocation(
                "missing '-Y sign' arguments".to_string(),
            ));
        }
    }

    match parsed_args.next().as_deref() {
        Some("sign") => {}
        Some(other) => {
            return Err(SignError::UnsupportedInvocation(format!(
                "expected 'sign' after '-Y' but received '{other}'"
            )));
        }
        None => {
            return Err(SignError::UnsupportedInvocation(
                "missing 'sign' after '-Y'".to_string(),
            ));
        }
    }

    let mut namespace: Option<String> = None;
    let mut key_file_path: Option<PathBuf> = None;
    let mut payload_path: Option<PathBuf> = None;

    while let Some(argument) = parsed_args.next() {
        match argument.as_str() {
            "-n" => {
                let value = parsed_args.next().ok_or_else(|| {
                    SignError::UnsupportedInvocation("missing namespace after '-n'".to_string())
                })?;
                namespace = Some(value);
            }
            "-f" => {
                let value = parsed_args.next().ok_or_else(|| {
                    SignError::UnsupportedInvocation("missing key file after '-f'".to_string())
                })?;
                key_file_path = Some(PathBuf::from(value));
            }
            "-U" => {
                let value = parsed_args.next().ok_or_else(|| {
                    SignError::UnsupportedInvocation("missing payload file after '-U'".to_string())
                })?;
                payload_path = Some(PathBuf::from(value));
            }
            value if value.starts_with('-') => {
                return Err(SignError::UnsupportedInvocation(format!(
                    "unsupported ssh signing flag '{value}'"
                )));
            }
            value => {
                if payload_path.is_some() {
                    return Err(SignError::UnsupportedInvocation(
                        "multiple payload paths were provided".to_string(),
                    ));
                }
                payload_path = Some(PathBuf::from(value));
            }
        }
    }

    let namespace = namespace.ok_or_else(|| {
        SignError::UnsupportedInvocation("missing required '-n <namespace>'".to_string())
    })?;
    if namespace != "git" {
        return Err(SignError::UnsupportedInvocation(format!(
            "unsupported SSH signing namespace '{namespace}'"
        )));
    }

    let key_file_path = key_file_path.ok_or_else(|| {
        SignError::UnsupportedInvocation("missing required '-f <key-file>'".to_string())
    })?;
    let payload_path = payload_path.ok_or_else(|| {
        SignError::UnsupportedInvocation("missing required payload file".to_string())
    })?;
    let key_ref = read_key_ref(&key_file_path)?;

    Ok(SignInvocation {
        namespace,
        key_ref,
        payload_path,
    })
}

fn read_key_ref(path: &Path) -> Result<String, SignError> {
    let key_text = fs::read_to_string(path).map_err(|error| SignError::ReadKeyFile {
        path: path.to_path_buf(),
        error,
    })?;
    let public_key = key_text.trim();
    if public_key.is_empty() {
        return Err(SignError::InvalidKeyFile(path.to_path_buf()));
    }

    Ok(format!("key::{public_key}"))
}

fn signature_output_path(payload_path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.sig", payload_path.display()))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::net::TcpListener;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc;
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    use base64::Engine;
    use tungstenite::{Message, accept};

    use crate::control;
    use crate::protocol::startup::{GitIdentity, GitSigningConfig, StartupInput, StartupMode};
    use crate::test_support::TestEnvVarGuard;
    use crate::time::{Sleeper, ThreadSleeper};

    use super::{Base64, SignError, parse_sign_invocation, run_sign};

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);
    const TOKENIZER_PROXY_EGRESS_BASE_URL_ENV: &str =
        "SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL";
    const TEST_PUBLIC_KEY: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE";
    const TEST_SIGNATURE: &str =
        "-----BEGIN SSH SIGNATURE-----\nexample-signature\n-----END SSH SIGNATURE-----\n";

    #[test]
    fn parses_ssh_keygen_style_sign_invocation() {
        let temp_dir = create_temp_test_dir("parse_sign_invocation");
        let key_file_path = temp_dir.join("key.pub");
        let payload_path = temp_dir.join("payload");
        fs::write(&key_file_path, format!("{TEST_PUBLIC_KEY}\n"))
            .expect("key file should be writable");

        let invocation = parse_sign_invocation([
            "-Y".to_string(),
            "sign".to_string(),
            "-n".to_string(),
            "git".to_string(),
            "-f".to_string(),
            key_file_path.display().to_string(),
            "-U".to_string(),
            payload_path.display().to_string(),
        ])
        .expect("ssh signing invocation should parse");

        assert_eq!(invocation.namespace, "git");
        assert_eq!(invocation.key_ref, format!("key::{TEST_PUBLIC_KEY}"));
        assert_eq!(invocation.payload_path, payload_path);

        fs::remove_dir_all(temp_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn writes_signature_file_for_valid_signing_request() {
        let _env_guard =
            TestEnvVarGuard::set(TOKENIZER_PROXY_EGRESS_BASE_URL_ENV, "http://127.0.0.1:5205");
        let test_dir = create_temp_test_dir("sign_ok");
        let control_socket_path = test_dir.join("control.sock");
        let gateway = start_signing_gateway();
        let server = start_test_control_server(
            &control_socket_path,
            ThreadSleeper,
            control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        );

        control::submit_init(
            &control_socket_path,
            &valid_startup_input(&gateway.ws_url, true),
        )
        .expect("init submission should succeed");

        let key_file_path = test_dir.join("key.pub");
        let payload_path = test_dir.join("payload");
        fs::write(&key_file_path, format!("{TEST_PUBLIC_KEY}\n"))
            .expect("key file should be writable");
        fs::write(&payload_path, "sign me").expect("payload file should be writable");

        run_sign(
            [
                "-Y".to_string(),
                "sign".to_string(),
                "-n".to_string(),
                "git".to_string(),
                "-f".to_string(),
                key_file_path.display().to_string(),
                "-U".to_string(),
                payload_path.display().to_string(),
            ],
            &control_socket_path,
        )
        .expect("sign request should succeed");

        let signature_output_path = payload_path.with_extension("sig");
        let signature =
            fs::read_to_string(&signature_output_path).expect("signature output should exist");
        assert_eq!(signature, TEST_SIGNATURE);

        server.close().expect("control server should stop cleanly");
        gateway
            .close()
            .expect("bootstrap gateway should stop cleanly");
        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn signer_alias_dispatches_through_sandboxd_run() {
        let test_dir = create_temp_test_dir("sign_alias_dispatch");
        let missing_control_socket_path = test_dir.join("missing-control.sock");
        let control_socket_path_string = missing_control_socket_path
            .to_str()
            .expect("control socket path should be representable as utf-8")
            .to_string();
        let _control_socket_guard = TestEnvVarGuard::set(
            "MISTLE_SANDBOXD_CONTROL_SOCKET_PATH",
            &control_socket_path_string,
        );

        let key_file_path = test_dir.join("key.pub");
        let payload_path = test_dir.join("payload");
        fs::write(&key_file_path, format!("{TEST_PUBLIC_KEY}\n"))
            .expect("key file should be writable");
        fs::write(&payload_path, "sign me").expect("payload file should be writable");

        let mut stdin = std::io::empty();
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let exit_code = crate::run(
            "/opt/mistle/bin/mistle-ssh-sign",
            [
                "-Y".to_string(),
                "sign".to_string(),
                "-n".to_string(),
                "git".to_string(),
                "-f".to_string(),
                key_file_path.display().to_string(),
                "-U".to_string(),
                payload_path.display().to_string(),
            ],
            &mut stdin,
            &mut stdout,
            &mut stderr,
        );

        assert_eq!(exit_code, 1);
        assert!(
            String::from_utf8_lossy(&stderr).contains("failed to submit Git SSH signing request"),
            "stderr: {}",
            String::from_utf8_lossy(&stderr)
        );

        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn fails_when_startup_signing_config_is_missing() {
        let _env_guard =
            TestEnvVarGuard::set(TOKENIZER_PROXY_EGRESS_BASE_URL_ENV, "http://127.0.0.1:5205");
        let test_dir = create_temp_test_dir("sign_missing_config");
        let control_socket_path = test_dir.join("control.sock");
        let gateway = start_signing_gateway();
        let server = start_test_control_server(
            &control_socket_path,
            ThreadSleeper,
            control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        );

        control::submit_init(
            &control_socket_path,
            &valid_startup_input(&gateway.ws_url, false),
        )
        .expect("init submission should succeed");

        let key_file_path = test_dir.join("key.pub");
        let payload_path = test_dir.join("payload");
        fs::write(&key_file_path, format!("{TEST_PUBLIC_KEY}\n"))
            .expect("key file should be writable");
        fs::write(&payload_path, "sign me").expect("payload file should be writable");

        let error = run_sign(
            [
                "-Y".to_string(),
                "sign".to_string(),
                "-n".to_string(),
                "git".to_string(),
                "-f".to_string(),
                key_file_path.display().to_string(),
                "-U".to_string(),
                payload_path.display().to_string(),
            ],
            &control_socket_path,
        )
        .expect_err("sign request should fail without startup signing config");

        assert!(matches!(error, SignError::SubmitSigning(_)));
        assert!(
            error
                .to_string()
                .contains("sandbox does not have a configured Git signing identity")
        );

        server.close().expect("control server should stop cleanly");
        gateway
            .close()
            .expect("bootstrap gateway should stop cleanly");
        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    fn valid_startup_input(tunnel_gateway_ws_url: &str, include_signing: bool) -> StartupInput {
        StartupInput {
            startup_mode: StartupMode::New,
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
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "runtimeClients": [],
                "workspaceSources": [],
                "agentRuntimes": []
            }),
            egress_grant_by_rule_id: BTreeMap::new(),
            git_identity: Some(GitIdentity {
                name: "Mistle User".to_string(),
                email: "mistle-user@example.com".to_string(),
                signing: if include_signing {
                    Some(GitSigningConfig {
                        format: "ssh".to_string(),
                        program: "/opt/mistle/bin/mistle-ssh-sign".to_string(),
                        key_ref: format!("key::{TEST_PUBLIC_KEY}"),
                        organization_id: "org_123".to_string(),
                        provider_family: "github".to_string(),
                        acting_user_id: "usr_123".to_string(),
                        grant: "grant-token".to_string(),
                    })
                } else {
                    None
                },
            }),
            transparent_proxy: None,
        }
    }

    struct SigningGateway {
        ws_url: String,
        shutdown_sender: mpsc::Sender<()>,
        thread: Option<thread::JoinHandle<()>>,
    }

    impl SigningGateway {
        fn close(mut self) -> Result<(), String> {
            let _ = self.shutdown_sender.send(());
            self.thread
                .take()
                .expect("bootstrap gateway thread should exist")
                .join()
                .map_err(|_| "bootstrap gateway thread panicked".to_string())
        }
    }

    fn start_signing_gateway() -> SigningGateway {
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
                                Ok(Message::Text(message)) => {
                                    let payload = message.as_str();
                                    if payload.contains("\"type\":\"signing.request\"") {
                                        let request: serde_json::Value =
                                            serde_json::from_str(payload)
                                                .expect("signing request should be json");
                                        let request_id = request["requestId"]
                                            .as_str()
                                            .expect("signing request id should exist");
                                        let response = serde_json::json!({
                                            "type": "signing.result",
                                            "requestId": request_id,
                                            "ok": true,
                                            "signature": Base64.encode(TEST_SIGNATURE),
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
                                    panic!("bootstrap gateway should read frames: {error}");
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

        SigningGateway {
            ws_url,
            shutdown_sender,
            thread: Some(thread),
        }
    }

    fn create_temp_test_dir(prefix: &str) -> PathBuf {
        let counter = TEMP_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let path = Path::new("/tmp").join(format!(
            "sbd_{prefix}_{}_{}_{}",
            std::process::id(),
            counter,
            unique_suffix
        ));

        fs::create_dir_all(&path).expect("temp test dir should be creatable");

        path
    }

    fn start_test_control_server<S: Sleeper + 'static>(
        socket_path: &Path,
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

    fn test_global_git_config_path(socket_path: &Path) -> PathBuf {
        socket_path
            .parent()
            .expect("test control socket should have a parent")
            .join("home")
            .join(".gitconfig")
    }
}
