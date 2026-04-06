#![cfg(target_os = "linux")]

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use sandboxd::control;
use sandboxd::protocol::startup::{StartupInput, StartupMode};
use sandboxd::time::{Duration, Sleeper, ThreadSleeper};

static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

#[test]
fn daemon_applies_startup_input_after_init_submission() {
    let test_dir = create_temp_test_dir("serve_runtime_apply");
    let control_socket_path = test_dir.join("control.sock");
    let startup_output_path = test_dir.join("startup-output.txt");

    let startup_input = StartupInput {
        startup_mode: StartupMode::New,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: "ws://127.0.0.1:5003/tunnel/sandbox".to_string(),
        runtime_plan: serde_json::json!({
          "sandboxProfileId": "sbp_123",
          "version": 1,
          "image": {
            "source": "base",
            "imageRef": "mistle/sandbox-base:dev"
          },
          "egressRoutes": [],
          "artifacts": [
            {
              "artifactKey": "artifact_1",
              "name": "artifact one",
              "lifecycle": {
                "install": [
                  {
                    "args": ["sh", "-c", format!("printf startup > {}", startup_output_path.display())]
                  }
                ]
              }
            }
          ],
          "runtimeClients": [],
          "workspaceSources": [],
          "agentRuntimes": []
        }),
        egress_grant_by_rule_id: BTreeMap::new(),
    };

    let server = control::start_control_server(
        &control_socket_path,
        ThreadSleeper,
        control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
    )
    .expect("daemon should start");
    control::submit_init(&control_socket_path, &startup_input)
        .expect("init submission should succeed");

    wait_for_file_contents(&startup_output_path, "startup");
    assert_eq!(
        server
            .startup_input()
            .expect("daemon should retain the accepted startup input")
            .bootstrap_token,
        "bootstrap-token-value"
    );

    server.close().expect("daemon should shut down cleanly");
    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

fn wait_for_file_contents(path: &PathBuf, expected: &str) {
    for _ in 0..100 {
        if let Ok(contents) = fs::read_to_string(path)
            && contents == expected
        {
            return;
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
