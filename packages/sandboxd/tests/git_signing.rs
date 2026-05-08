use std::ffi::OsString;
use std::fs;
#[cfg(target_os = "linux")]
use std::net::TcpListener;
#[cfg(target_os = "linux")]
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(target_os = "linux")]
use std::sync::mpsc;
use std::sync::{LazyLock, Mutex, MutexGuard};
#[cfg(target_os = "linux")]
use std::thread;
#[cfg(target_os = "linux")]
use std::time::Duration as StdDuration;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(target_os = "linux")]
use base64::Engine;
#[cfg(target_os = "linux")]
use base64::engine::general_purpose::STANDARD as Base64;
#[cfg(target_os = "linux")]
use sandboxd::control;
#[cfg(target_os = "linux")]
use sandboxd::protocol::startup::{GitIdentity, GitSigningConfig, StartupInput, StartupMode};
#[cfg(target_os = "linux")]
use sandboxd::test_support::TestAttachmentRootGuard;
#[cfg(target_os = "linux")]
use sandboxd::time::{Duration, Sleeper, ThreadSleeper};
#[cfg(target_os = "linux")]
use tungstenite::{Message, accept};

static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);
static ENV_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
#[cfg(target_os = "linux")]
const GATEWAY_PROXY_ENABLED_ENV: &str = "GATEWAY_PROXY_ENABLED";
#[cfg(target_os = "linux")]
const TEST_PUBLIC_KEY: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE";
#[cfg(target_os = "linux")]
const TEST_SIGNATURE: &str =
    "-----BEGIN SSH SIGNATURE-----\nexample-signature\n-----END SSH SIGNATURE-----\n";

#[cfg(target_os = "linux")]
#[test]
fn git_commit_s_succeeds_via_the_real_sandboxd_signer_alias() {
    let test_dir = create_temp_test_dir("git_signing_real_alias");
    let home_dir = test_dir.join("home");
    let repo_dir = test_dir.join("repo");
    let attachment_root = test_dir.join("attachments");
    let signer_path = test_dir.join("mistle-ssh-sign");
    let control_socket_path = test_dir.join("control.sock");
    let global_git_config_path = home_dir.join(".gitconfig");
    let _attachment_root_guard = TestAttachmentRootGuard::set(attachment_root.clone());
    let _env_guard = MultiEnvGuard::set([
        (GATEWAY_PROXY_ENABLED_ENV, "1".to_string()),
        (
            "HOME",
            home_dir
                .to_str()
                .expect("home dir should be representable as utf-8")
                .to_string(),
        ),
        (
            "GIT_CONFIG_GLOBAL",
            global_git_config_path
                .to_str()
                .expect("global git config path should be representable as utf-8")
                .to_string(),
        ),
    ]);

    fs::create_dir_all(&home_dir).expect("home dir should be creatable");
    fs::create_dir_all(&repo_dir).expect("repo dir should be creatable");
    fs::create_dir_all(&attachment_root).expect("attachment root should be creatable");
    symlink(env!("CARGO_BIN_EXE_sandboxd"), &signer_path)
        .expect("signer alias symlink should be creatable");

    let gateway = start_signing_gateway();
    let server = start_test_control_server(
        &control_socket_path,
        ThreadSleeper,
        control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        &global_git_config_path,
    )
    .expect("control server should start");
    control::submit_init(
        &control_socket_path,
        &valid_signing_startup_input(
            &gateway.ws_url,
            signer_path
                .to_str()
                .expect("signer path should be representable as utf-8"),
        ),
    )
    .expect("init submission should succeed");
    wait_for_init_phase(&server, control::InitPhase::Initialized);

    run_git(
        [
            "init",
            repo_dir.to_str().expect("repo path should be utf-8"),
        ],
        Some(&control_socket_path),
    )
    .expect_success();
    fs::write(repo_dir.join("file.txt"), "hello\n").expect("repo file should be writable");
    run_git(
        [
            "-C",
            repo_dir.to_str().expect("repo path should be utf-8"),
            "add",
            "file.txt",
        ],
        Some(&control_socket_path),
    )
    .expect_success();
    run_git(
        [
            "-C",
            repo_dir.to_str().expect("repo path should be utf-8"),
            "commit",
            "-S",
            "-m",
            "test signed commit",
        ],
        Some(&control_socket_path),
    )
    .expect_success();

    let commit_contents = run_git(
        [
            "-C",
            repo_dir.to_str().expect("repo path should be utf-8"),
            "cat-file",
            "-p",
            "HEAD",
        ],
        Some(&control_socket_path),
    );
    commit_contents.expect_success();
    let commit_text = String::from_utf8(commit_contents.output.stdout)
        .expect("commit text should be representable as utf-8");
    assert!(commit_text.contains("gpgsig -----BEGIN SSH SIGNATURE-----"));

    server.close().expect("control server should stop cleanly");
    gateway
        .close()
        .expect("signing gateway should stop cleanly");
    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

#[cfg(target_os = "linux")]
#[test]
fn snapshot_materialization_init_does_not_write_global_git_identity_config() {
    let test_dir = create_temp_test_dir("git_signing_snapshot_materialization");
    let home_dir = test_dir.join("home");
    let attachment_root = test_dir.join("attachments");
    let global_git_config_path = home_dir.join(".gitconfig");
    let _attachment_root_guard = TestAttachmentRootGuard::set(attachment_root);
    let _env_guard = MultiEnvGuard::set([
        (GATEWAY_PROXY_ENABLED_ENV, "1".to_string()),
        (
            "HOME",
            home_dir
                .to_str()
                .expect("home dir should be representable as utf-8")
                .to_string(),
        ),
        (
            "GIT_CONFIG_GLOBAL",
            global_git_config_path
                .to_str()
                .expect("global git config path should be representable as utf-8")
                .to_string(),
        ),
    ]);
    fs::create_dir_all(&home_dir).expect("home dir should be creatable");

    let control_socket_path = test_dir.join("control.sock");
    let server = start_test_control_server(
        &control_socket_path,
        ThreadSleeper,
        control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        &global_git_config_path,
    )
    .expect("control server should start");
    let bootstrap_gateway = start_signing_gateway();
    let mut startup_input =
        valid_signing_startup_input(&bootstrap_gateway.ws_url, "/opt/mistle/bin/mistle-ssh-sign");
    startup_input.execution_mode = sandboxd::protocol::startup::StartupExecutionMode::Snapshot;

    control::submit_init(&control_socket_path, &startup_input)
        .expect("snapshot materialization init submission should succeed");

    server
        .wait()
        .expect("control server should exit after snapshot materialization init");
    bootstrap_gateway
        .close()
        .expect("signing gateway should stop cleanly");
    assert!(
        !global_git_config_path.exists(),
        "snapshot materialization should not write acting-user git identity into the global git config"
    );

    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

#[test]
fn git_signing_without_config_matches_expected_git_behavior() {
    git_commit_without_signing_config_succeeds_without_a_signature();
    git_commit_s_fails_without_signing_config();
}

fn git_commit_without_signing_config_succeeds_without_a_signature() {
    let test_dir = create_temp_test_dir("git_signing_unsigned_commit");
    let home_dir = test_dir.join("home");
    let repo_dir = test_dir.join("repo");
    let global_git_config_path = home_dir.join(".gitconfig");
    let _env_guard = MultiEnvGuard::set([
        (
            "HOME",
            home_dir
                .to_str()
                .expect("home dir should be representable as utf-8")
                .to_string(),
        ),
        (
            "GIT_CONFIG_GLOBAL",
            global_git_config_path
                .to_str()
                .expect("global git config path should be representable as utf-8")
                .to_string(),
        ),
    ]);

    fs::create_dir_all(&home_dir).expect("home dir should be creatable");
    fs::create_dir_all(&repo_dir).expect("repo dir should be creatable");

    run_git(["config", "--global", "user.name", "Mistle User"], None).expect_success();
    run_git(
        [
            "config",
            "--global",
            "user.email",
            "mistle-user@example.com",
        ],
        None,
    )
    .expect_success();
    run_git(
        [
            "init",
            repo_dir.to_str().expect("repo path should be utf-8"),
        ],
        None,
    )
    .expect_success();
    fs::write(repo_dir.join("file.txt"), "hello\n").expect("repo file should be writable");
    run_git(
        [
            "-C",
            repo_dir.to_str().expect("repo path should be utf-8"),
            "add",
            "file.txt",
        ],
        None,
    )
    .expect_success();
    run_git(
        [
            "-C",
            repo_dir.to_str().expect("repo path should be utf-8"),
            "commit",
            "-m",
            "test unsigned commit",
        ],
        None,
    )
    .expect_success();

    let commit_contents = run_git(
        [
            "-C",
            repo_dir.to_str().expect("repo path should be utf-8"),
            "cat-file",
            "-p",
            "HEAD",
        ],
        None,
    );
    commit_contents.expect_success();
    let commit_text = String::from_utf8(commit_contents.output.stdout)
        .expect("commit text should be representable as utf-8");
    assert!(!commit_text.contains("gpgsig "));

    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

fn git_commit_s_fails_without_signing_config() {
    let test_dir = create_temp_test_dir("git_signing_missing_config");
    let home_dir = test_dir.join("home");
    let repo_dir = test_dir.join("repo");
    let global_git_config_path = home_dir.join(".gitconfig");
    let _env_guard = MultiEnvGuard::set([
        (
            "HOME",
            home_dir
                .to_str()
                .expect("home dir should be representable as utf-8")
                .to_string(),
        ),
        (
            "GIT_CONFIG_GLOBAL",
            global_git_config_path
                .to_str()
                .expect("global git config path should be representable as utf-8")
                .to_string(),
        ),
    ]);

    fs::create_dir_all(&home_dir).expect("home dir should be creatable");
    fs::create_dir_all(&repo_dir).expect("repo dir should be creatable");

    run_git(["config", "--global", "user.name", "Mistle User"], None).expect_success();
    run_git(
        [
            "config",
            "--global",
            "user.email",
            "mistle-user@example.com",
        ],
        None,
    )
    .expect_success();
    run_git(
        [
            "init",
            repo_dir.to_str().expect("repo path should be utf-8"),
        ],
        None,
    )
    .expect_success();
    fs::write(repo_dir.join("file.txt"), "hello\n").expect("repo file should be writable");
    run_git(
        [
            "-C",
            repo_dir.to_str().expect("repo path should be utf-8"),
            "add",
            "file.txt",
        ],
        None,
    )
    .expect_success();

    let commit = run_git(
        [
            "-C",
            repo_dir.to_str().expect("repo path should be utf-8"),
            "commit",
            "-S",
            "-m",
            "test missing signing config",
        ],
        None,
    );
    assert!(
        !commit.output.status.success(),
        "git commit -S should fail without signing config: stdout={} stderr={}",
        String::from_utf8_lossy(&commit.output.stdout),
        String::from_utf8_lossy(&commit.output.stderr)
    );

    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

struct GitCommandResult {
    output: Output,
}

impl GitCommandResult {
    fn expect_success(&self) {
        assert!(
            self.output.status.success(),
            "git command failed: stdout={} stderr={}",
            String::from_utf8_lossy(&self.output.stdout),
            String::from_utf8_lossy(&self.output.stderr)
        );
    }
}

struct MultiEnvGuard {
    _lock: MutexGuard<'static, ()>,
    previous: Vec<(&'static str, Option<OsString>)>,
}

impl MultiEnvGuard {
    fn set<const N: usize>(entries: [(&'static str, String); N]) -> Self {
        let lock = ENV_MUTEX
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut previous = Vec::with_capacity(N);
        for (name, value) in entries {
            previous.push((name, std::env::var_os(name)));
            unsafe {
                std::env::set_var(name, value);
            }
        }
        Self {
            _lock: lock,
            previous,
        }
    }
}

impl Drop for MultiEnvGuard {
    fn drop(&mut self) {
        for (name, previous) in self.previous.iter().rev() {
            match previous {
                Some(value) => unsafe {
                    std::env::set_var(name, value);
                },
                None => unsafe {
                    std::env::remove_var(name);
                },
            }
        }
    }
}

fn run_git<const N: usize>(
    args: [&str; N],
    control_socket_path: Option<&Path>,
) -> GitCommandResult {
    let mut command = Command::new("git");
    command.args(args);
    if let Some(path) = control_socket_path {
        command.env("MISTLE_SANDBOXD_CONTROL_SOCKET_PATH", path);
    }
    GitCommandResult {
        output: command.output().expect("git command should run"),
    }
}

#[cfg(target_os = "linux")]
fn wait_for_init_phase(server: &control::ControlServer, expected: control::InitPhase) {
    for _ in 0..100 {
        match server.init_phase() {
            phase if phase == expected => return,
            control::InitPhase::Failed(error) => {
                panic!("sandboxd init failed while waiting for {expected:?}: {error}")
            }
            control::InitPhase::Initialized => {
                panic!(
                    "sandboxd reached initialized while waiting for different phase {expected:?}"
                )
            }
            control::InitPhase::Initializing | control::InitPhase::Uninitialized => {}
        }

        ThreadSleeper.sleep(Duration::from_millis(10));
    }

    panic!("timed out waiting for init phase");
}

#[cfg(target_os = "linux")]
fn valid_signing_startup_input(tunnel_gateway_ws_url: &str, signer_program: &str) -> StartupInput {
    StartupInput {
        startup_mode: StartupMode::New,
        execution_mode: sandboxd::protocol::startup::StartupExecutionMode::Session,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: tunnel_gateway_ws_url.to_string(),
        runtime_plan: serde_json::json!({
            "sandboxProfileId": "sbp_123",
            "version": 1,
            "image": {
                "source": "base",
                "imageRef": sandboxd::test_support::local_prepared_runtime_sandbox_base_image_ref()
            },
            "egressRoutes": [],
            "artifacts": [],
            "runtimeClients": [],
            "workspaceSources": [],
            "agentRuntimes": []
        }),
        git_identity: Some(GitIdentity {
            name: "Mistle User".to_string(),
            email: "mistle-user@example.com".to_string(),
            signing: Some(GitSigningConfig {
                format: "ssh".to_string(),
                program: signer_program.to_string(),
                key_ref: format!("key::{TEST_PUBLIC_KEY}"),
                organization_id: "org_123".to_string(),
                provider_family: "github".to_string(),
                acting_user_id: "usr_123".to_string(),
                grant: "grant-token".to_string(),
            }),
        }),
        acting_user_id: None,
        transparent_proxy: None,
    }
}

fn create_temp_test_dir(prefix: &str) -> PathBuf {
    let counter = TEMP_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
    let unique_suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();
    let path = PathBuf::from("/tmp").join(format!(
        "sbd_{prefix}_{}_{}_{}",
        std::process::id(),
        counter,
        unique_suffix
    ));

    fs::create_dir_all(&path).expect("temp test dir should be creatable");

    path
}

#[cfg(target_os = "linux")]
fn start_test_control_server<S: Sleeper + 'static>(
    socket_path: &Path,
    sleeper: S,
    accept_poll_interval: Duration,
    global_git_config_path: &Path,
) -> Result<control::ControlServer, control::ControlError> {
    control::start_control_server_with_health_endpoint(
        socket_path,
        "127.0.0.1:0"
            .parse()
            .expect("test health endpoint address should parse"),
        sleeper,
        accept_poll_interval,
        global_git_config_path,
    )
}

#[cfg(target_os = "linux")]
struct SigningGateway {
    ws_url: String,
    shutdown_sender: mpsc::Sender<()>,
    thread: Option<thread::JoinHandle<()>>,
}

#[cfg(target_os = "linux")]
impl SigningGateway {
    fn close(mut self) -> Result<(), String> {
        let _ = self.shutdown_sender.send(());
        let thread = self
            .thread
            .take()
            .expect("signing gateway thread should exist");
        thread
            .join()
            .map_err(|_| "signing gateway thread panicked".to_string())
    }
}

#[cfg(target_os = "linux")]
fn start_signing_gateway() -> SigningGateway {
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
                    stream
                        .set_read_timeout(Some(StdDuration::from_millis(100)))
                        .expect("signing gateway stream should set a read timeout");
                    let mut websocket =
                        accept(stream).expect("signing gateway handshake should succeed");
                    loop {
                        if shutdown_receiver.try_recv().is_ok() {
                            return;
                        }

                        match websocket.read() {
                            Ok(Message::Text(message)) => {
                                let payload = message.as_str();
                                if payload.contains("\"type\":\"signing.request\"") {
                                    let request: serde_json::Value = serde_json::from_str(payload)
                                        .expect("signing request should be valid json");
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
                            Err(tungstenite::Error::Io(error))
                                if error.kind() == std::io::ErrorKind::WouldBlock
                                    || error.kind() == std::io::ErrorKind::TimedOut => {}
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

    SigningGateway {
        ws_url,
        shutdown_sender,
        thread: Some(thread),
    }
}
