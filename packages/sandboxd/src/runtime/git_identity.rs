use std::fs;
use std::path::Path;
use std::process::Command;

use crate::protocol::startup::StartupInput;

pub fn apply_git_identity(
    startup_input: &StartupInput,
    global_config_path: &Path,
) -> Result<(), String> {
    ensure_global_git_config_parent_exists(global_config_path)?;

    if let Some(git_identity) = startup_input.git_identity.as_ref() {
        apply_global_git_config(global_config_path, "user.name", &git_identity.name)?;
        apply_global_git_config(global_config_path, "user.email", &git_identity.email)?;
    }

    match startup_input
        .git_identity
        .as_ref()
        .and_then(|git_identity| git_identity.signing.as_ref())
    {
        Some(signing) => {
            apply_global_git_config(global_config_path, "gpg.format", &signing.format)?;
            apply_global_git_config(global_config_path, "gpg.ssh.program", &signing.program)?;
            apply_global_git_config(global_config_path, "user.signingkey", &signing.key_ref)?;
        }
        None => {
            unset_global_git_config(global_config_path, "gpg.format")?;
            unset_global_git_config(global_config_path, "gpg.ssh.program")?;
            unset_global_git_config(global_config_path, "user.signingkey")?;
        }
    }

    Ok(())
}

fn ensure_global_git_config_parent_exists(global_config_path: &Path) -> Result<(), String> {
    let parent = global_config_path.parent().ok_or_else(|| {
        format!(
            "global git config path {} must include a parent directory",
            global_config_path.display()
        )
    })?;
    if parent.as_os_str().is_empty() {
        return Err(format!(
            "global git config path {} must include a parent directory",
            global_config_path.display()
        ));
    }

    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "failed to create global git config parent directory {}: {error}",
            parent.display()
        )
    })
}

fn apply_global_git_config(
    global_config_path: &Path,
    key: &str,
    value: &str,
) -> Result<(), String> {
    ensure_global_git_config_parent_exists(global_config_path)?;

    let output = Command::new("git")
        .env("GIT_CONFIG_GLOBAL", global_config_path)
        .args(["config", "--global", key, value])
        .output()
        .map_err(|error| format!("failed to run git config for {key}: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    Err(format!(
        "git config for {key} failed with exit code {} (stdout={stdout} stderr={stderr})",
        output.status.code().unwrap_or_default()
    ))
}

fn unset_global_git_config(global_config_path: &Path, key: &str) -> Result<(), String> {
    ensure_global_git_config_parent_exists(global_config_path)?;

    let output = Command::new("git")
        .env("GIT_CONFIG_GLOBAL", global_config_path)
        .args(["config", "--global", "--unset-all", key])
        .output()
        .map_err(|error| format!("failed to run git config --unset-all for {key}: {error}"))?;

    if output.status.success() || output.status.code() == Some(5) {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    Err(format!(
        "git config --unset-all for {key} failed with exit code {} (stdout={stdout} stderr={stderr})",
        output.status.code().unwrap_or_default()
    ))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{apply_git_identity, apply_global_git_config};
    use crate::protocol::startup::{GitIdentity, GitSigningConfig, StartupInput, StartupMode};
    use crate::test_support::TestEnvVarsGuard;

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn applies_git_identity_to_global_git_config() {
        let test_dir = create_temp_test_dir("git_identity");
        let global_git_config_path = global_git_config_path(&test_dir);

        apply_git_identity(&StartupInput {
            startup_mode: StartupMode::New,
        operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token".to_string(),
            tunnel_exchange_token: "exchange-token".to_string(),
            tunnel_gateway_ws_url: "ws://127.0.0.1:5003/tunnel/sandbox".to_string(),
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
            git_identity: Some(GitIdentity {
                name: "Mistle User".to_string(),
                email: "mistle-user@example.com".to_string(),
                signing: None,
            }),
            transparent_proxy: None,
        }, &global_git_config_path)
        .expect("git identity should apply successfully");

        let git_config_contents =
            fs::read_to_string(&global_git_config_path).expect("git config should be written");
        assert!(git_config_contents.contains("name = Mistle User"));
        assert!(git_config_contents.contains("email = mistle-user@example.com"));
        assert!(!git_config_contents.contains("gpg.format"));
        assert!(!git_config_contents.contains("gpg.ssh.program"));
        assert!(!git_config_contents.contains("user.signingkey"));

        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn explicit_global_git_config_path_overrides_ambient_git_environment() {
        let test_dir = create_temp_test_dir("git_identity_explicit_path");
        let explicit_git_config_path = global_git_config_path(&test_dir);
        let ambient_home_dir = test_dir.join("ambient-home");
        let ambient_git_config_path = ambient_home_dir.join(".gitconfig");
        fs::create_dir_all(&ambient_home_dir).expect("ambient home dir should be creatable");
        let _env_guard = TestEnvVarsGuard::set([
            ("HOME", ambient_home_dir.display().to_string()),
            (
                "GIT_CONFIG_GLOBAL",
                ambient_git_config_path.display().to_string(),
            ),
        ]);

        apply_git_identity(
            &StartupInput {
                startup_mode: StartupMode::New,
        operation_kind: crate::protocol::startup::StartupOperationKind::Start,
                execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
                bootstrap_token: "bootstrap-token".to_string(),
                tunnel_exchange_token: "exchange-token".to_string(),
                tunnel_gateway_ws_url: "ws://127.0.0.1:5003/tunnel/sandbox".to_string(),
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
                git_identity: Some(GitIdentity {
                    name: "Mistle User".to_string(),
                    email: "mistle-user@example.com".to_string(),
                    signing: None,
                }),
                transparent_proxy: None,
            },
            &explicit_git_config_path,
        )
        .expect("git identity should apply successfully");

        let explicit_git_config_contents = fs::read_to_string(&explicit_git_config_path)
            .expect("explicit git config should exist");
        assert!(explicit_git_config_contents.contains("name = Mistle User"));
        assert!(!ambient_git_config_path.exists());

        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn applies_git_signing_config_when_present() {
        let test_dir = create_temp_test_dir("git_identity_signing");
        let global_git_config_path = global_git_config_path(&test_dir);

        apply_git_identity(&StartupInput {
            startup_mode: StartupMode::New,
        operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token".to_string(),
            tunnel_exchange_token: "exchange-token".to_string(),
            tunnel_gateway_ws_url: "ws://127.0.0.1:5003/tunnel/sandbox".to_string(),
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
            git_identity: Some(GitIdentity {
                name: "Mistle User".to_string(),
                email: "mistle-user@example.com".to_string(),
                signing: Some(GitSigningConfig {
                    format: "ssh".to_string(),
                    program: "/opt/mistle/bin/mistle-ssh-sign".to_string(),
                    key_ref: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE".to_string(),
                    organization_id: "org_123".to_string(),
                    provider_family: "github".to_string(),
                    integration_connection_id: Some("icn_github".to_string()),
                    acting_user_id: "usr_123".to_string(),
                    grant: "grant-token".to_string(),
                }),
            }),
            transparent_proxy: None,
        }, &global_git_config_path)
        .expect("git identity should apply successfully");

        let git_config_contents =
            fs::read_to_string(&global_git_config_path).expect("git config should be written");
        assert!(git_config_contents.contains("format = ssh"));
        assert!(git_config_contents.contains("program = /opt/mistle/bin/mistle-ssh-sign"));
        assert!(
            git_config_contents
                .contains("signingkey = key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE")
        );

        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn clears_existing_git_signing_config_when_signing_is_absent() {
        let test_dir = create_temp_test_dir("git_identity_clear_signing");
        let global_git_config_path = global_git_config_path(&test_dir);

        apply_global_git_config(&global_git_config_path, "gpg.format", "ssh")
            .expect("precondition git config should write");
        apply_global_git_config(
            &global_git_config_path,
            "gpg.ssh.program",
            "/opt/mistle/bin/mistle-ssh-sign",
        )
        .expect("precondition git config should write");
        apply_global_git_config(
            &global_git_config_path,
            "user.signingkey",
            "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE",
        )
        .expect("precondition git config should write");

        apply_git_identity(&StartupInput {
            startup_mode: StartupMode::New,
        operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token".to_string(),
            tunnel_exchange_token: "exchange-token".to_string(),
            tunnel_gateway_ws_url: "ws://127.0.0.1:5003/tunnel/sandbox".to_string(),
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
            git_identity: Some(GitIdentity {
                name: "Mistle User".to_string(),
                email: "mistle-user@example.com".to_string(),
                signing: None,
            }),
            transparent_proxy: None,
        }, &global_git_config_path)
        .expect("git identity should apply successfully");

        let git_config_contents =
            fs::read_to_string(&global_git_config_path).expect("git config should be written");
        assert!(!git_config_contents.contains("format = ssh"));
        assert!(!git_config_contents.contains("program = /opt/mistle/bin/mistle-ssh-sign"));
        assert!(!git_config_contents.contains("signingkey = key::ssh-ed25519"));

        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    fn create_temp_test_dir(prefix: &str) -> std::path::PathBuf {
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

    fn global_git_config_path(test_dir: &Path) -> std::path::PathBuf {
        test_dir.join("home").join(".gitconfig")
    }
}
