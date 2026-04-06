//! Durable startup-manifest persistence helpers for `sandboxd apply-startup`.
//!
//! This module keeps disk-format concerns separate from command handling so
//! later supervisor code can load and persist the same manifest through one
//! shared path.

use std::fs::{self, OpenOptions};
use std::io;
use std::io::Write;
use std::path::Path;

use crate::protocol::startup::StartupInput;

use crate::apply_startup::ApplyStartupError;

/// Loads the persisted startup manifest from disk and decodes it into the shared protocol type.
pub fn load_manifest(path: &Path) -> Result<StartupInput, ApplyStartupError> {
    let manifest_bytes = fs::read(path).map_err(|error| ApplyStartupError::ReadManifest {
        path: path.to_path_buf(),
        error,
    })?;

    serde_json::from_slice(&manifest_bytes).map_err(ApplyStartupError::InvalidManifest)
}

/// Persists the startup manifest with an atomic temp-file write followed by rename.
pub fn persist_manifest(
    path: &Path,
    startup_input: &StartupInput,
) -> Result<(), ApplyStartupError> {
    let parent_dir = path
        .parent()
        .ok_or_else(|| ApplyStartupError::MissingManifestParent {
            path: path.to_path_buf(),
        })?;

    fs::create_dir_all(parent_dir).map_err(|error| ApplyStartupError::CreateManifestDirectory {
        path: parent_dir.to_path_buf(),
        error,
    })?;

    let manifest_bytes =
        serde_json::to_vec_pretty(startup_input).map_err(ApplyStartupError::SerializeManifest)?;
    let temp_path = parent_dir.join(format!(
        ".{}.tmp.{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("manifest.json"),
        std::process::id()
    ));

    // Write the next manifest beside the final target and rename it into place
    // so later `serve` logic never observes a partially written file.
    let mut temp_file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| ApplyStartupError::CreateTempManifest {
            path: temp_path.clone(),
            error,
        })?;

    if let Err(error) = temp_file.write_all(&manifest_bytes) {
        drop(temp_file);
        cleanup_temp_manifest(&temp_path);
        return Err(ApplyStartupError::WriteTempManifest {
            path: temp_path.clone(),
            error,
        });
    }
    if let Err(error) = temp_file.write_all(b"\n") {
        drop(temp_file);
        cleanup_temp_manifest(&temp_path);
        return Err(ApplyStartupError::WriteTempManifest {
            path: temp_path.clone(),
            error,
        });
    }
    if let Err(error) = temp_file.sync_all() {
        drop(temp_file);
        cleanup_temp_manifest(&temp_path);
        return Err(ApplyStartupError::FlushTempManifest {
            path: temp_path.clone(),
            error,
        });
    }
    drop(temp_file);

    if let Err(error) = fs::rename(&temp_path, path) {
        cleanup_temp_manifest(&temp_path);
        return Err(ApplyStartupError::ReplaceManifest {
            from: temp_path,
            to: path.to_path_buf(),
            error,
        });
    }

    Ok(())
}

/// Best-effort cleanup for abandoned temp manifests after a failed write or rename.
fn cleanup_temp_manifest(path: &Path) {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::apply_startup::manifest::persist_manifest;
    use crate::protocol::startup::{StartupInput, StartupMode};

    #[test]
    fn persists_manifest_happy_path() {
        let test_dir = create_temp_test_dir("manifest_persist_ok");
        let manifest_path = test_dir.join("manifest.json");
        let startup_input = valid_startup_input();

        persist_manifest(&manifest_path, &startup_input)
            .expect("persist_manifest should write the manifest");

        let manifest: StartupInput = serde_json::from_slice(
            &fs::read(&manifest_path).expect("manifest should be readable after persist"),
        )
        .expect("persisted manifest should decode");

        assert_eq!(manifest, startup_input);

        let temp_path = test_dir.join(format!(".{}.tmp.{}", "manifest.json", std::process::id()));
        assert!(
            !temp_path.exists(),
            "temp manifest should not remain after a successful rename"
        );

        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn removes_temp_manifest_when_rename_fails() {
        let test_dir = create_temp_test_dir("manifest_rename_failure");
        let manifest_path = test_dir.join("manifest.json");
        fs::create_dir(&manifest_path).expect("test should create conflicting manifest dir");
        let startup_input = valid_startup_input();

        let error = persist_manifest(&manifest_path, &startup_input)
            .expect_err("persist_manifest should fail when final path is a directory");

        assert!(matches!(
            error,
            crate::apply_startup::ApplyStartupError::ReplaceManifest { .. }
        ));

        let temp_path = test_dir.join(format!(".{}.tmp.{}", "manifest.json", std::process::id()));
        assert!(
            !temp_path.exists(),
            "temp manifest should be removed after a failed rename"
        );

        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    fn valid_startup_input() -> StartupInput {
        StartupInput {
            startup_mode: StartupMode::New,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: "wss://gateway.example.test".to_string(),
            runtime_plan: serde_json::json!({
                "schemaVersion": 1,
                "sandboxProfileId": "sbp_123",
                "publishedTarget": {
                    "targetId": "target_123",
                    "targetType": "app"
                },
                "wsEndpoints": [],
                "readinessProbe": null,
                "environment": [],
                "files": [],
                "setupCommands": [],
                "agentRuntimes": []
            }),
            egress_grant_by_rule_id: std::collections::BTreeMap::new(),
        }
    }

    fn create_temp_test_dir(prefix: &str) -> std::path::PathBuf {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "sandboxd_{prefix}_{}_{}",
            std::process::id(),
            unique_suffix
        ));

        fs::create_dir_all(&path).expect("temp test dir should be creatable");

        path
    }
}
