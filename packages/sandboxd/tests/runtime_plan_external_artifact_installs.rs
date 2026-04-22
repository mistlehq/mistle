use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use sandboxd::protocol::startup::{StartupInput, StartupMode};
use sandboxd::runtime;

static TEMP_TEST_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

#[test]
fn applies_typed_mise_install_steps() {
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
                    "op": "mise_install",
                    "tools": ["--help"]
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
        git_identity: None,
    };

    runtime::apply_runtime_plan(&startup_input)
        .expect("typed mise install steps should execute through the real mise subprocess path");
}

#[test]
fn applies_github_release_artifact_install_steps_from_pinned_public_release() {
    let test_dir = create_temp_test_dir("runtime_plan_apply_github_release");
    let install_path = test_dir.join("gh");
    let (asset_name, extracted_path) = match std::env::consts::ARCH {
        "x86_64" => (
            "gh_2.76.2_linux_amd64.tar.gz",
            "gh_2.76.2_linux_amd64/bin/gh",
        ),
        "aarch64" | "arm64" => (
            "gh_2.76.2_linux_arm64.tar.gz",
            "gh_2.76.2_linux_arm64/bin/gh",
        ),
        other => panic!("unsupported test architecture: {other}"),
    };
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
                    "op": "github_release_install",
                    "repository": "cli/cli",
                    "release": {
                      "kind": "tag",
                      "match": "exact",
                      "tag": "v2.76.2"
                    },
                    "asset": {
                      "kind": "exact",
                      "fileName": asset_name,
                      "format": "tar.gz",
                      "extractedPath": extracted_path
                    },
                    "installPath": install_path.display().to_string(),
                    "timeoutMs": 30_000
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
        git_identity: None,
    };

    runtime::apply_runtime_plan(&startup_input)
        .expect("github release install should download and materialize the requested asset");

    assert!(
        install_path.exists(),
        "github release install should materialize the final binary path"
    );
    assert!(
        fs::metadata(&install_path)
            .expect("installed gh binary metadata should exist")
            .len()
            > 0,
        "installed gh binary should be non-empty"
    );
    assert!(
        fs::metadata(&install_path)
            .expect("installed gh binary metadata should exist")
            .permissions()
            .mode()
            & 0o777
            == 0o755,
        "github release install should preserve executable permissions"
    );

    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

fn create_temp_test_dir(prefix: &str) -> PathBuf {
    let unique_suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();
    let unique_counter = TEMP_TEST_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
    let sanitized_prefix =
        prefix.replace(|character: char| !character.is_ascii_alphanumeric(), "_");
    let path = PathBuf::from("/tmp").join(format!(
        "sbd_{sanitized_prefix}_{}_{}_{}",
        std::process::id(),
        unique_suffix,
        unique_counter
    ));

    fs::create_dir_all(&path).expect("temp test dir should be creatable");

    path
}
