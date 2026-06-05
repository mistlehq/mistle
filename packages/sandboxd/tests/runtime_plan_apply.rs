use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use sandboxd::protocol::session::SessionRuntimeInput;
use sandboxd::runtime;

static TEMP_TEST_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
struct RecordingRuntimePlanApplyObserver {
    records: Mutex<Vec<(runtime::RuntimePlanApplyLifecycleStep, &'static str)>>,
}

impl RecordingRuntimePlanApplyObserver {
    fn records(&self) -> Vec<(runtime::RuntimePlanApplyLifecycleStep, &'static str)> {
        self.records
            .lock()
            .expect("runtime plan observer records should be lockable")
            .clone()
    }
}

impl runtime::RuntimePlanApplyObserver for RecordingRuntimePlanApplyObserver {
    fn record_step_started(&self, step: runtime::RuntimePlanApplyLifecycleStep) {
        self.records
            .lock()
            .expect("runtime plan observer records should be lockable")
            .push((step, "started"));
    }

    fn record_step_completed(&self, step: runtime::RuntimePlanApplyLifecycleStep) {
        self.records
            .lock()
            .expect("runtime plan observer records should be lockable")
            .push((step, "completed"));
    }
}

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

    let startup_input = SessionRuntimeInput {
        operation_kind: sandboxd::protocol::startup::ActivationOperationKind::Start,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: "ws://127.0.0.1:5003/tunnel/sandbox".to_string(),
        acting_user_id: None,
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
                      "args": ["sh", "-c", format!("printf artifact > {}", artifact_output_path.display())],
                      "cwd": test_dir.display().to_string()
                    }
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
        git_identity: None,
        transparent_proxy: None,
    };

    runtime::apply_runtime_plan(&startup_input)
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

    fs::write(&runtime_file_path, "{\"ok\":false}")
        .expect("overwrite fixture should remain writable between cold starts");
    fs::write(&if_absent_path, "keep-me-local")
        .expect("if-absent fixture should remain writable between cold starts");
    fs::write(
        clone_target_path.join("README.md"),
        "local workspace change\n",
    )
    .expect("existing git repository should remain writable between cold starts");
    fs::write(clone_target_path.join("LOCAL_ONLY.txt"), "local only\n")
        .expect("untracked file fixture should be writable");

    runtime::apply_runtime_plan(&startup_input)
        .expect("cold init rerun should succeed against a reused durable filesystem");

    assert_eq!(
        fs::read_to_string(&runtime_file_path)
            .expect("overwrite runtime file should exist after cold init rerun"),
        "{\"ok\":true}"
    );
    assert_eq!(
        fs::read_to_string(&if_absent_path)
            .expect("if-absent runtime file should still exist after cold init rerun"),
        "keep-me-local"
    );
    assert_eq!(
        fs::read_to_string(clone_target_path.join("README.md"))
            .expect("existing git repository should still be present after cold init rerun"),
        "local workspace change\n"
    );
    assert_eq!(
        fs::read_to_string(clone_target_path.join("LOCAL_ONLY.txt"))
            .expect("untracked workspace file should still exist after cold init rerun"),
        "local only\n"
    );

    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

#[test]
fn merges_runtime_files_without_replacing_existing_runtime_config() {
    let test_dir = create_temp_test_dir("runtime_plan_merge_runtime_files");
    let codex_config_path = test_dir.join("etc").join("codex").join("config.toml");
    let agents_path = test_dir.join("root").join(".codex").join("AGENTS.md");
    let json_mcp_config_path = test_dir
        .join("root")
        .join(".config")
        .join("runtime")
        .join("mcp.json");
    let opencode_config_path = test_dir
        .join("root")
        .join(".config")
        .join("opencode")
        .join("opencode.json");

    fs::create_dir_all(
        codex_config_path
            .parent()
            .expect("codex config should have a parent"),
    )
    .expect("codex config dir should be creatable");
    fs::create_dir_all(
        agents_path
            .parent()
            .expect("AGENTS.md should have a parent"),
    )
    .expect("codex agents dir should be creatable");
    fs::create_dir_all(
        json_mcp_config_path
            .parent()
            .expect("JSON MCP config should have a parent"),
    )
    .expect("JSON MCP config dir should be creatable");
    fs::create_dir_all(
        opencode_config_path
            .parent()
            .expect("OpenCode config should have a parent"),
    )
    .expect("OpenCode config dir should be creatable");
    fs::write(
        &codex_config_path,
        [
            r#"model = "gpt-5""#,
            "",
            "[features]",
            "apps = true",
            "tool_search = false",
            "",
            "[mcp_servers.linear]",
            r#"url = "https://linear.example.test/mcp""#,
            "",
            "[mcp_servers.mistle]",
            r#"url = "https://old-mcp.example.test/mcp""#,
            "",
        ]
        .join("\n"),
    )
    .expect("codex config fixture should be writable");
    fs::set_permissions(&codex_config_path, fs::Permissions::from_mode(0o644))
        .expect("codex config fixture mode should be settable");
    fs::write(
        &agents_path,
        [
            "User instruction",
            "",
            "<!-- MISTLE-MANAGED:START mistle-sandbox-context -->",
            "old managed block",
            "<!-- MISTLE-MANAGED:END mistle-sandbox-context -->",
            "",
            "Keep this",
            "",
        ]
        .join("\n"),
    )
    .expect("AGENTS.md fixture should be writable");
    fs::write(
        &json_mcp_config_path,
        serde_json::to_string_pretty(&serde_json::json!({
          "settings": {
            "disableProxyTool": false,
            "extensions": [
              "/root/.pi/agent/extensions/existing/index.js"
            ]
          },
          "mcpServers": {
            "linear": {
              "url": "https://linear.example.test/mcp"
            },
            "mistle": {
              "url": "https://old-mcp.example.test/mcp",
              "headers": {
                "x-stale": "true"
              }
            }
          }
        }))
        .expect("JSON MCP config fixture should serialize"),
    )
    .expect("JSON MCP config fixture should be writable");
    fs::write(
        &opencode_config_path,
        serde_json::to_string_pretty(&serde_json::json!({
          "mcp": {
            "mistle": {
              "url": "https://old-mcp.example.test/mcp",
              "headers": {
                "x-stale": "true"
              }
            }
          }
        }))
        .expect("OpenCode config fixture should serialize"),
    )
    .expect("OpenCode config fixture should be writable");

    let codex_config_runtime_content = [
        "[features]",
        "tool_search = true",
        "",
        "[mcp_servers.mistle]",
        "url = \"https://current-mcp.example.test/mcp\"",
        "",
    ]
    .join("\n");
    let json_mcp_runtime_content = serde_json::to_string_pretty(&serde_json::json!({
      "settings": {
        "extensions": [
          "/root/.pi/agent/extensions/pi-mcp-adapter/index.js"
        ]
      },
      "mcpServers": {
        "mistle": {
          "url": "https://current-mcp.example.test/mcp"
        }
      }
    }))
    .expect("JSON MCP runtime content should serialize");
    let agents_runtime_content = [
        "<!-- MISTLE-MANAGED:START mistle-sandbox-context -->",
        "Mistle-managed sandbox context:",
        "",
        "- Mistle MCP tools are available.",
        "<!-- MISTLE-MANAGED:END mistle-sandbox-context -->",
        "",
    ]
    .join("\n");
    let opencode_runtime_content = serde_json::to_string_pretty(&serde_json::json!({
      "mcp": {
        "mistle": {
          "url": "https://current-mcp.example.test/mcp"
        }
      }
    }))
    .expect("OpenCode runtime content should serialize");

    let startup_input = SessionRuntimeInput {
        operation_kind: sandboxd::protocol::startup::ActivationOperationKind::Start,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: "ws://127.0.0.1:5003/tunnel/sandbox".to_string(),
        acting_user_id: None,
        runtime_plan: serde_json::json!({
          "sandboxProfileId": "sbp_123",
          "version": 1,
          "image": {
            "source": "snapshot",
            "imageRef": "sha256:snapshot"
          },
          "egressRoutes": [],
          "artifacts": [],
          "runtimeClients": [
            {
              "clientId": "codex-cli",
              "setup": {
                "env": {},
                "files": [
                  {
                    "fileId": "codex_config",
                    "path": codex_config_path.display().to_string(),
                    "mode": 384,
                    "content": codex_config_runtime_content,
                    "writeMode": "merge"
                  },
                  {
                    "fileId": "codex_global_agents",
                    "path": agents_path.display().to_string(),
                    "mode": 384,
                    "content": agents_runtime_content,
                    "writeMode": "merge"
                  },
                  {
                    "fileId": "json_mcp_config",
                    "path": json_mcp_config_path.display().to_string(),
                    "mode": 384,
                    "content": json_mcp_runtime_content,
                    "writeMode": "merge"
                  },
                  {
                    "fileId": "opencode_config",
                    "path": opencode_config_path.display().to_string(),
                    "mode": 384,
                    "content": opencode_runtime_content,
                    "writeMode": "merge"
                  }
                ]
              },
              "processes": [],
              "endpoints": []
            }
          ],
          "workspaceSources": [],
          "agentRuntimes": []
        }),
        git_identity: None,
        transparent_proxy: None,
    };

    runtime::apply_runtime_plan(&startup_input)
        .expect("runtime plan apply should merge platform MCP config");

    let config = fs::read_to_string(&codex_config_path).expect("codex config should exist");
    assert!(config.contains(r#"model = "gpt-5""#));
    assert!(config.contains("apps = true"));
    assert!(config.contains("tool_search = true"));
    assert!(config.contains("[mcp_servers.linear]"));
    assert!(config.contains(r#"url = "https://linear.example.test/mcp""#));
    assert!(config.contains("[mcp_servers.mistle]"));
    assert!(config.contains(r#"url = "https://current-mcp.example.test/mcp""#));
    assert!(!config.contains("old-mcp.example.test"));
    assert_eq!(
        fs::metadata(&codex_config_path)
            .expect("codex config metadata should be readable")
            .permissions()
            .mode()
            & 0o777,
        0o600,
    );

    let agents = fs::read_to_string(&agents_path).expect("AGENTS.md should exist");
    assert!(agents.contains("User instruction"));
    assert!(agents.contains("Keep this"));
    assert!(agents.contains("Mistle MCP tools are available."));
    assert_eq!(agents.matches("Mistle-managed sandbox context:").count(), 1);
    assert!(!agents.contains("old managed block"));

    let json_mcp_config =
        fs::read_to_string(&json_mcp_config_path).expect("JSON MCP config should exist");
    assert!(json_mcp_config.contains(r#""disableProxyTool": false"#));
    assert!(json_mcp_config.contains(r#""/root/.pi/agent/extensions/existing/index.js""#));
    assert!(json_mcp_config.contains(r#""/root/.pi/agent/extensions/pi-mcp-adapter/index.js""#));
    assert!(json_mcp_config.contains(r#""linear""#));
    assert!(json_mcp_config.contains(r#""https://linear.example.test/mcp""#));
    assert!(json_mcp_config.contains(r#""mistle""#));
    assert!(json_mcp_config.contains(r#""https://current-mcp.example.test/mcp""#));
    assert!(!json_mcp_config.contains("old-mcp.example.test"));
    assert!(!json_mcp_config.contains("x-stale"));

    let opencode_config =
        fs::read_to_string(&opencode_config_path).expect("OpenCode config should exist");
    assert!(opencode_config.contains(r#""https://current-mcp.example.test/mcp""#));
    assert!(!opencode_config.contains("old-mcp.example.test"));
    assert!(!opencode_config.contains("x-stale"));

    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

#[test]
fn preserves_existing_non_git_workspace_source_target() {
    let test_dir = create_temp_test_dir("runtime_plan_non_git_workspace");
    let clone_source_path = test_dir.join("source-repo");
    let clone_target_path = test_dir.join("workspace").join("repo");
    create_git_repository(&clone_source_path);
    fs::create_dir_all(&clone_target_path)
        .expect("non-git workspace directory fixture should be creatable");
    fs::write(clone_target_path.join("plain.txt"), "not a repository")
        .expect("non-git workspace fixture should be writable");

    let startup_input = create_runtime_plan_apply_input(&clone_source_path, &clone_target_path);

    runtime::apply_runtime_plan(&startup_input)
        .expect("cold init should leave an existing non-git workspace path in place");

    assert_eq!(
        fs::read_to_string(clone_target_path.join("plain.txt"))
            .expect("existing non-git workspace contents should be preserved"),
        "not a repository"
    );

    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

#[test]
fn fails_skills_reconciliation_when_source_is_not_a_workspace_source() {
    let startup_input = SessionRuntimeInput {
        operation_kind: sandboxd::protocol::startup::ActivationOperationKind::Start,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: "ws://127.0.0.1:5003/tunnel/sandbox".to_string(),
        acting_user_id: None,
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
          "skills": {
            "originUrl": "https://github.com/acme/skills.git",
            "selectedSkills": [
              {
                "name": "triage",
                "relativePath": "triage"
              }
            ]
          },
          "agentRuntimes": [
            {
              "runtimeId": "codex",
              "runtimeKey": "codex",
              "clientId": "codex-cli",
              "endpointKey": "app-server",
              "ptyLaunch": {}
            }
          ]
        }),
        git_identity: None,
        transparent_proxy: None,
    };

    let error = runtime::apply_runtime_plan(&startup_input)
        .expect_err("skills source absent from workspace sources should fail startup");

    assert!(matches!(
        error,
        runtime::RuntimePlanApplyError::SkillsReconcile { .. }
    ));
    assert!(
        error
            .to_string()
            .contains("skills source 'https://github.com/acme/skills.git' was not found")
    );
}

#[test]
fn records_skills_runtime_plan_step_when_skills_reconciliation_starts() {
    let runtime_plan: runtime::CompiledRuntimePlan = serde_json::from_value(serde_json::json!({
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
      "skills": {
        "originUrl": "https://github.com/acme/skills.git",
        "selectedSkills": [
          {
            "name": "triage",
            "relativePath": "triage"
          }
        ]
      },
      "agentRuntimes": [
        {
          "runtimeId": "codex",
          "runtimeKey": "codex",
          "clientId": "codex-cli",
          "endpointKey": "app-server",
          "ptyLaunch": {}
        }
      ]
    }))
    .expect("runtime plan with skills should decode");
    let observer = RecordingRuntimePlanApplyObserver::default();

    let error = runtime::apply_compiled_runtime_plan_with_output_sink_and_observer(
        &runtime_plan,
        None,
        None,
        Some(&observer),
    )
    .expect_err("missing skills workspace source should fail after entering skills phase");

    assert!(matches!(
        error,
        runtime::RuntimePlanApplyError::SkillsReconcile { .. }
    ));
    assert_eq!(
        observer.records(),
        vec![(runtime::RuntimePlanApplyLifecycleStep::Skills, "started")]
    );
}

#[test]
fn preserves_existing_workspace_source_target_inside_another_repository() {
    let test_dir = create_temp_test_dir("runtime_plan_nested_non_git_workspace");
    let clone_source_path = test_dir.join("source-repo");
    let enclosing_repo_path = test_dir.join("enclosing-repo");
    let clone_target_path = enclosing_repo_path.join("nested").join("repo");
    create_git_repository(&clone_source_path);
    create_git_repository(&enclosing_repo_path);
    fs::create_dir_all(&clone_target_path)
        .expect("nested non-git workspace directory fixture should be creatable");
    fs::write(clone_target_path.join("plain.txt"), "not the repo root")
        .expect("nested non-git workspace fixture should be writable");

    let startup_input = create_runtime_plan_apply_input(&clone_source_path, &clone_target_path);

    runtime::apply_runtime_plan(&startup_input).expect(
        "cold init should leave an existing workspace path alone even when it sits inside another repository",
    );

    assert_eq!(
        fs::read_to_string(clone_target_path.join("plain.txt"))
            .expect("nested workspace path contents should be preserved"),
        "not the repo root"
    );

    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

#[test]
fn preserves_existing_git_repository_with_origin_mismatch() {
    let test_dir = create_temp_test_dir("runtime_plan_origin_mismatch");
    let clone_source_path = test_dir.join("source-repo");
    let mismatched_origin_path = test_dir.join("other-source-repo");
    let clone_target_path = test_dir.join("workspace").join("repo");
    create_git_repository(&clone_source_path);
    create_git_repository(&mismatched_origin_path);

    let startup_input = create_runtime_plan_apply_input(&clone_source_path, &clone_target_path);
    runtime::apply_runtime_plan(&startup_input)
        .expect("initial clone should succeed before origin mismatch is introduced");

    run_command(
        &[
            "git",
            "remote",
            "set-url",
            "origin",
            &mismatched_origin_path.display().to_string(),
        ],
        &clone_target_path,
    );

    runtime::apply_runtime_plan(&startup_input).expect(
        "cold init should leave an existing git repository in place even when origin changes",
    );

    assert_eq!(
        git_remote_url(&clone_target_path, "origin"),
        mismatched_origin_path.display().to_string()
    );

    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

#[test]
fn decodes_typed_artifact_install_steps() {
    let runtime_plan: runtime::CompiledRuntimePlan = serde_json::from_value(serde_json::json!({
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
                  "args": ["sh", "-c", "echo typed-exec"]
                }
              },
              {
                "op": "mise_install",
                "tools": ["node@22.0.0"]
              },
              {
                "op": "github_release_install",
                "repository": "openai/codex",
                "release": {
                  "kind": "tag",
                  "match": "exact",
                  "tag": "rust-v0.137.0"
                },
                "asset": {
                  "kind": "by_arch",
                  "x86_64": {
                    "fileName": "codex-x86_64-unknown-linux-musl.tar.gz",
                    "format": "tar.gz",
                    "extractedPath": "codex-x86_64-unknown-linux-musl"
                  },
                  "aarch64": {
                    "fileName": "codex-aarch64-unknown-linux-musl.tar.gz",
                    "format": "tar.gz",
                    "extractedPath": "codex-aarch64-unknown-linux-musl"
                  }
                },
                "installPath": "/usr/local/bin/codex"
              }
            ]
          }
        }
      ],
      "runtimeClients": [],
      "workspaceSources": [],
      "agentRuntimes": []
    }))
    .expect("runtime plan should decode typed artifact install steps");

    assert!(matches!(
        runtime_plan.artifacts[0].lifecycle.install[0],
        runtime::RuntimeArtifactInstallStep::Exec { .. }
    ));
    assert!(matches!(
        runtime_plan.artifacts[0].lifecycle.install[1],
        runtime::RuntimeArtifactInstallStep::MiseInstall { .. }
    ));
    assert!(matches!(
        runtime_plan.artifacts[0].lifecycle.install[2],
        runtime::RuntimeArtifactInstallStep::GitHubReleaseInstall { .. }
    ));
}

#[test]
fn rejects_invalid_typed_artifact_install_payload_shapes_during_decode() {
    let invalid_missing_tag =
        serde_json::from_value::<runtime::CompiledRuntimePlan>(serde_json::json!({
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
                    "op": "github_release_install",
                    "repository": "mistlehq/tools",
                    "release": {
                      "kind": "tag",
                      "match": "exact"
                    },
                    "asset": {
                      "kind": "exact",
                      "fileName": "slack-linux-amd64",
                      "format": "binary"
                    },
                    "installPath": "/usr/local/bin/slack"
                  }
                ]
              }
            }
          ],
          "runtimeClients": [],
          "workspaceSources": [],
          "agentRuntimes": []
        }));
    assert!(
        invalid_missing_tag.is_err(),
        "typed github release selectors missing the exact tag should fail decode"
    );

    let invalid_missing_extracted_path =
        serde_json::from_value::<runtime::CompiledRuntimePlan>(serde_json::json!({
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
                    "op": "github_release_install",
                    "repository": "openai/codex",
                    "release": {
                      "kind": "latest"
                    },
                    "asset": {
                      "kind": "exact",
                      "fileName": "codex.tar.gz",
                      "format": "tar.gz"
                    },
                    "installPath": "/usr/local/bin/codex"
                  }
                ]
              }
            }
          ],
          "runtimeClients": [],
          "workspaceSources": [],
          "agentRuntimes": []
        }));
    assert!(
        invalid_missing_extracted_path.is_err(),
        "typed tar.gz assets missing extractedPath should fail decode"
    );

    let invalid_empty_mise_tools =
        serde_json::from_value::<runtime::CompiledRuntimePlan>(serde_json::json!({
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
                    "op": "mise_install",
                    "tools": []
                  }
                ]
              }
            }
          ],
          "runtimeClients": [],
          "workspaceSources": [],
          "agentRuntimes": []
        }));
    assert!(
        invalid_empty_mise_tools.is_err(),
        "typed mise installs with no tools should fail decode"
    );

    let invalid_missing_binary_format =
        serde_json::from_value::<runtime::CompiledRuntimePlan>(serde_json::json!({
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
                    "op": "github_release_install",
                    "repository": "mistlehq/tools",
                    "release": {
                      "kind": "tag",
                      "match": "latest_matching_prefix",
                      "prefix": "slack/"
                    },
                    "asset": {
                      "kind": "exact",
                      "fileName": "slack-linux-amd64"
                    },
                    "installPath": "/usr/local/bin/slack"
                  }
                ]
              }
            }
          ],
          "runtimeClients": [],
          "workspaceSources": [],
          "agentRuntimes": []
        }));
    assert!(
        invalid_missing_binary_format
            .expect_err("binary github release assets without format should be rejected")
            .to_string()
            .contains("missing field `format`")
    );
}

#[test]
fn applies_typed_exec_artifact_install_steps() {
    let test_dir = create_temp_test_dir("runtime_plan_typed_exec");
    let artifact_output_path = test_dir.join("typed-exec-output.txt");

    let startup_input = SessionRuntimeInput {
        operation_kind: sandboxd::protocol::startup::ActivationOperationKind::Start,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: "ws://127.0.0.1:5003/tunnel/sandbox".to_string(),
        acting_user_id: None,
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
                      "args": ["sh", "-c", format!("printf typed-exec > {}", artifact_output_path.display())]
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
        transparent_proxy: None,
    };

    runtime::apply_runtime_plan(&startup_input)
        .expect("typed exec artifact install steps should execute through run_command");

    assert_eq!(
        fs::read_to_string(&artifact_output_path).expect("typed exec artifact output should exist"),
        "typed-exec"
    );

    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

#[test]
fn accepts_runtime_plan_egress_routes_with_additional_headers_and_slot_key_credential_resolvers() {
    let startup_input = SessionRuntimeInput {
        operation_kind: sandboxd::protocol::startup::ActivationOperationKind::Start,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: "ws://127.0.0.1:5003/tunnel/sandbox".to_string(),
        acting_user_id: None,
        runtime_plan: serde_json::json!({
          "sandboxProfileId": "sbp_123",
          "version": 1,
          "image": {
            "source": "base",
            "imageRef": sandboxd::test_support::local_prepared_runtime_sandbox_base_image_ref()
          },
          "egressRoutes": [
            {
              "egressRuleId": "egress_rule_bind_openai_agent",
              "bindingId": "bind_openai_agent",
              "familyId": "openai",
              "variantId": "openai-default",
              "match": {
                "hosts": ["api.openai.com"],
                "pathPrefixes": ["/v1/responses"],
                "methods": ["POST"]
              },
              "upstream": {
                "baseUrl": "https://api.openai.com/v1"
              },
              "authInjection": {
                "type": "bearer",
                "target": "authorization"
              },
              "additionalHeaders": {
                "chatgpt-account-id": "acct_123"
              },
              "credentialResolver": {
                "kind": "integration_connection",
                "connectionId": "icn_test",
                "secretType": "api_key",
                "slotKey": "openai.openai-default.api-key.api-key"
              }
            }
          ],
          "artifacts": [],
          "runtimeClients": [],
          "workspaceSources": [],
          "agentRuntimes": []
        }),
        git_identity: None,
        transparent_proxy: None,
    };

    runtime::apply_runtime_plan(&startup_input)
        .expect("runtime plan apply should accept additionalHeaders and slotKey resolvers");
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

fn create_runtime_plan_apply_input(
    clone_source_path: &Path,
    clone_target_path: &Path,
) -> SessionRuntimeInput {
    SessionRuntimeInput {
        operation_kind: sandboxd::protocol::startup::ActivationOperationKind::Start,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: "ws://127.0.0.1:5003/tunnel/sandbox".to_string(),
        acting_user_id: None,
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
        git_identity: None,
        transparent_proxy: None,
    }
}

fn run_command(args: &[&str], cwd: &Path) {
    let mut command = Command::new(args[0]);
    if args[0] == "git" {
        command.args(["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"]);
    }
    let status = command
        .args(&args[1..])
        .current_dir(cwd)
        .status()
        .expect("test helper command should start");
    assert!(status.success(), "test helper command should succeed");
}

fn git_remote_url(path: &Path, remote_name: &str) -> String {
    let output = Command::new("git")
        .args(["remote", "get-url", remote_name])
        .current_dir(path)
        .output()
        .expect("git remote get-url should execute");
    assert!(
        output.status.success(),
        "git remote get-url should succeed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("git remote get-url output should be valid utf-8")
        .trim()
        .to_string()
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
