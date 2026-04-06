use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use sandboxd::protocol::startup::{StartupInput, StartupMode};
use sandboxd::runtime;

#[test]
fn applies_runtime_plan_artifacts_workspace_sources_and_runtime_files() {
    let test_dir = create_temp_test_dir("runtime_plan_apply");
    let artifact_output_path = test_dir.join("artifact-output.txt");
    let runtime_file_path = test_dir.join("runtime-client").join("config.json");
    let if_absent_path = test_dir.join("runtime-client").join("existing.txt");
    let clone_source_path = test_dir.join("source-repo");
    let clone_target_path = test_dir.join("workspace").join("repo");

    fs::create_dir_all(
        if_absent_path
            .parent()
            .expect("if-absent file should have a parent"),
    )
    .expect("runtime client dir should be creatable");
    fs::write(&if_absent_path, "keep-me").expect("if-absent fixture file should be writable");
    create_git_repository(&clone_source_path);

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
                    "args": ["sh", "-c", format!("printf artifact > {}", artifact_output_path.display())],
                    "cwd": test_dir.display().to_string()
                  }
                ]
              }
            }
          ],
          "runtimeClients": [
            {
              "clientId": "runtime_client_1",
              "setup": {
                "env": {},
                "files": [
                  {
                    "fileId": "config",
                    "path": runtime_file_path.display().to_string(),
                    "mode": 420,
                    "content": "{\"ok\":true}",
                    "writeMode": "overwrite"
                  },
                  {
                    "fileId": "existing",
                    "path": if_absent_path.display().to_string(),
                    "mode": 420,
                    "content": "replace-me",
                    "writeMode": "if-absent"
                  }
                ]
              },
              "processes": [],
              "endpoints": []
            }
          ],
          "workspaceSources": [
            {
              "sourceKind": "git-clone",
              "resourceKind": "repository",
              "path": clone_target_path.display().to_string(),
              "originUrl": clone_source_path.display().to_string()
            }
          ],
          "agentRuntimes": []
        }),
        egress_grant_by_rule_id: BTreeMap::new(),
    };

    let runtime_plan: runtime::CompiledRuntimePlan =
        serde_json::from_value(startup_input.runtime_plan.clone())
            .expect("runtime plan fixture should decode");

    runtime::apply_runtime_plan(&runtime_plan)
        .expect("runtime plan apply should materialize files and workspace state");

    assert_eq!(
        fs::read_to_string(&artifact_output_path).expect("artifact output should exist"),
        "artifact"
    );
    assert_eq!(
        fs::read_to_string(&runtime_file_path).expect("runtime file should exist"),
        "{\"ok\":true}"
    );
    assert_eq!(
        fs::read_to_string(&if_absent_path).expect("if-absent file should still exist"),
        "keep-me"
    );
    assert_eq!(
        fs::read_to_string(clone_target_path.join("README.md"))
            .expect("git clone should materialize committed repository content"),
        "hello from source repo\n"
    );

    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

fn create_git_repository(path: &Path) {
    fs::create_dir_all(path).expect("git repository dir should be creatable");
    run_command(&["git", "init", "--quiet"], path);
    run_command(
        &["git", "config", "user.email", "sandboxd@example.test"],
        path,
    );
    run_command(&["git", "config", "user.name", "sandboxd"], path);
    fs::write(path.join("README.md"), "hello from source repo\n")
        .expect("git repository file should be writable");
    run_command(&["git", "add", "README.md"], path);
    run_command(&["git", "commit", "--quiet", "-m", "initial commit"], path);
}

fn run_command(args: &[&str], cwd: &Path) {
    let status = Command::new(args[0])
        .args(&args[1..])
        .current_dir(cwd)
        .status()
        .expect("test helper command should start");
    assert!(status.success(), "test helper command should succeed");
}

fn create_temp_test_dir(prefix: &str) -> PathBuf {
    let unique_suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();
    let short_prefix = &prefix[..prefix.len().min(8)];
    let path = PathBuf::from("/tmp").join(format!(
        "sbd_{short_prefix}_{}_{}",
        std::process::id(),
        unique_suffix
    ));

    fs::create_dir_all(&path).expect("temp test dir should be creatable");

    path
}
