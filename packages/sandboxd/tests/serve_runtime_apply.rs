use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use sandboxd::control;
use sandboxd::protocol::startup::{StartupInput, StartupMode};
use sandboxd::time::ThreadSleeper;

static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

#[test]
fn serve_applies_persisted_manifest_on_startup() {
    let test_dir = create_temp_test_dir("serve_runtime_apply");
    let manifest_path = test_dir.join("manifest.json");
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
    let mut manifest_bytes =
        serde_json::to_vec_pretty(&startup_input).expect("manifest json should serialize");
    manifest_bytes.push(b'\n');
    fs::write(&manifest_path, manifest_bytes).expect("manifest file should be writable");

    let server = control::start_control_server(
        &control_socket_path,
        &manifest_path,
        ThreadSleeper,
        control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
    )
    .expect("serve should start when persisted manifest is valid");

    assert_eq!(
        fs::read_to_string(&startup_output_path).expect("startup runtime state should be applied"),
        "startup"
    );
    assert_eq!(
        server
            .latest_manifest()
            .expect("serve should retain the applied manifest")
            .bootstrap_token,
        "bootstrap-token-value"
    );

    server.close().expect("serve should shut down cleanly");
    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
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
