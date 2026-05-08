#![cfg(target_os = "linux")]

use std::fs;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use sandboxd::control;
use sandboxd::protocol::startup::{StartupInput, StartupMode};
use sandboxd::test_support::TestAttachmentRootGuard;
use sandboxd::time::{Duration, Sleeper, ThreadSleeper};
use tungstenite::{Message, accept};

static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

#[test]
fn daemon_applies_startup_input_after_init_submission() {
    let test_dir = create_temp_test_dir("serve_runtime_apply");
    let _attachment_root_guard = TestAttachmentRootGuard::set(test_dir.join("attachments"));
    let control_socket_path = test_dir.join("control.sock");
    let global_git_config_path = test_dir.join(".gitconfig");
    let startup_output_path = test_dir.join("startup-output.txt");
    let bootstrap_gateway = start_bootstrap_gateway();

    let startup_input = StartupInput {
        startup_mode: StartupMode::New,
        execution_mode: sandboxd::protocol::startup::StartupExecutionMode::Session,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: bootstrap_gateway.ws_url.clone(),
        runtime_plan: serde_json::json!({
          "sandboxProfileId": "sbp_123",
          "version": 1,
          "image": {
            "source": "base",
            "imageRef": sandboxd::test_support::local_prepared_runtime_sandbox_base_image_ref()
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
                      "args": ["sh", "-c", format!("printf startup > {}", startup_output_path.display())]
                    }
                  }
                ]
              }
            }
          ],
          "runtimeClients": [],
          "workspaceSources": [],
          "agentRuntimes": []
        }),
        git_identity: None,
        acting_user_id: None,
        transparent_proxy: None,
    };

    let server = control::start_control_server_with_health_endpoint(
        &control_socket_path,
        "127.0.0.1:0"
            .parse()
            .expect("test health endpoint address should parse"),
        ThreadSleeper,
        control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        &global_git_config_path,
    )
    .expect("daemon should start");
    control::submit_init(&control_socket_path, &startup_input)
        .expect("init submission should succeed");

    wait_for_file_contents_or_init_failure(&server, &startup_output_path, "startup");
    assert_eq!(
        server
            .startup_input()
            .expect("daemon should retain the accepted startup input")
            .bootstrap_token,
        "bootstrap-token-value"
    );

    server.close().expect("daemon should shut down cleanly");
    bootstrap_gateway
        .close()
        .expect("bootstrap gateway should stop cleanly");
    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

fn wait_for_file_contents_or_init_failure(
    server: &control::ControlServer,
    path: &PathBuf,
    expected: &str,
) {
    for _ in 0..100 {
        if let Ok(contents) = fs::read_to_string(path)
            && contents == expected
        {
            return;
        }

        match server.init_phase() {
            control::InitPhase::Failed(error) => {
                panic!("sandboxd init failed before startup output was observed: {error}");
            }
            control::InitPhase::Initialized
            | control::InitPhase::Initializing
            | control::InitPhase::Uninitialized => {}
        }

        ThreadSleeper.sleep(Duration::from_millis(10));
    }

    panic!(
        "timed out waiting for startup output file {} to contain '{expected}'",
        path.display()
    );
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
            .expect("bootstrap gateway should expose an address")
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
                        match websocket
                            .read()
                            .expect("bootstrap gateway should read frames")
                        {
                            Message::Close(_) => return,
                            Message::Text(_)
                            | Message::Binary(_)
                            | Message::Ping(_)
                            | Message::Pong(_)
                            | Message::Frame(_) => {}
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
