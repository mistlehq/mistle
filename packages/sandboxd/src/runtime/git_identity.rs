use std::process::Command;

use crate::protocol::startup::StartupInput;

pub fn apply_git_identity(startup_input: &StartupInput) -> Result<(), String> {
    let Some(git_identity) = startup_input.git_identity.as_ref() else {
        return Ok(());
    };

    apply_global_git_config("user.name", &git_identity.name)?;
    apply_global_git_config("user.email", &git_identity.email)?;

    Ok(())
}

fn apply_global_git_config(key: &str, value: &str) -> Result<(), String> {
    let output = Command::new("git")
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

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::protocol::startup::{GitIdentity, StartupInput, StartupMode};
    use crate::test_support::TestEnvVarGuard;

    use super::apply_git_identity;

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn applies_git_identity_to_global_git_config() {
        let test_dir = create_temp_test_dir("git_identity");
        let home_dir = test_dir.join("home");
        fs::create_dir_all(&home_dir).expect("home dir should be creatable");
        let home_dir_string = home_dir.display().to_string();
        let _home_guard = TestEnvVarGuard::set("HOME", &home_dir_string);

        apply_git_identity(&StartupInput {
            startup_mode: StartupMode::New,
            bootstrap_token: "bootstrap-token".to_string(),
            tunnel_exchange_token: "exchange-token".to_string(),
            tunnel_gateway_ws_url: "ws://127.0.0.1:5003/tunnel/sandbox".to_string(),
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": "mistle/sandbox-base:dev"
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
                signing: None,
            }),
        })
        .expect("git identity should apply successfully");

        let git_config_path = home_dir.join(".gitconfig");
        let git_config_contents =
            fs::read_to_string(&git_config_path).expect("git config should be written");
        assert!(git_config_contents.contains("name = Mistle User"));
        assert!(git_config_contents.contains("email = mistle-user@example.com"));

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
}
