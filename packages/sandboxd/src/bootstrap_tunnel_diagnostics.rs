//! Local bootstrap tunnel diagnostics.
//!
//! These records intentionally go to a file in the sandbox rather than over the
//! bootstrap websocket, because the websocket is the component being diagnosed.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};

pub const BOOTSTRAP_TUNNEL_LOG_PATH: &str = "/run/mistle/bootstrap-tunnel.log";

const TEST_LOG_DIR_ENV: &str = "MISTLE_SANDBOXD_OPERATION_LOG_DIR";
const SANDBOX_INSTANCE_ID_ENV: &str = "SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID";

pub fn record_bootstrap_tunnel_event(
    event: &str,
    mut attributes: BTreeMap<String, Value>,
) -> Result<(), String> {
    if let Ok(sandbox_instance_id) = std::env::var(SANDBOX_INSTANCE_ID_ENV) {
        attributes
            .entry("sandboxInstanceId".to_string())
            .or_insert(Value::String(sandbox_instance_id));
    }

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("failed to compute bootstrap tunnel event timestamp: {error}"))?
        .as_millis();
    let timestamp_value = u64::try_from(timestamp_ms)
        .map(Value::from)
        .map_err(|_| "bootstrap tunnel event timestamp exceeded u64 range".to_string())?;

    let mut payload = Map::new();
    payload.insert("timestampMs".to_string(), timestamp_value);
    payload.insert("event".to_string(), Value::String(event.to_string()));
    for (key, value) in attributes {
        payload.insert(key, value);
    }

    let line = serde_json::to_string(&Value::Object(payload))
        .map_err(|error| format!("failed to serialize bootstrap tunnel event: {error}"))?;
    append_log_line(&line)
}

fn append_log_line(line: &str) -> Result<(), String> {
    let path = bootstrap_tunnel_log_path();
    let parent = path
        .parent()
        .ok_or_else(|| format!("bootstrap tunnel log path {} has no parent", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "failed to create bootstrap tunnel log directory {}: {error}",
            parent.display()
        )
    })?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| {
            format!(
                "failed to open bootstrap tunnel log {}: {error}",
                path.display()
            )
        })?;
    writeln!(file, "{line}").map_err(|error| {
        format!(
            "failed to write bootstrap tunnel log {}: {error}",
            path.display()
        )
    })
}

fn bootstrap_tunnel_log_path() -> PathBuf {
    match std::env::var_os(TEST_LOG_DIR_ENV) {
        Some(test_log_dir) => PathBuf::from(test_log_dir).join("bootstrap-tunnel.log"),
        None => PathBuf::from(BOOTSTRAP_TUNNEL_LOG_PATH),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::Value;

    use crate::bootstrap_tunnel_diagnostics::{
        BOOTSTRAP_TUNNEL_LOG_PATH, bootstrap_tunnel_log_path, record_bootstrap_tunnel_event,
    };

    #[test]
    fn default_bootstrap_tunnel_log_path_matches_runtime_location() {
        assert_eq!(
            BOOTSTRAP_TUNNEL_LOG_PATH,
            "/run/mistle/bootstrap-tunnel.log"
        );
    }

    #[test]
    fn writes_jsonl_bootstrap_tunnel_event_to_operation_log_dir() {
        let temp_dir = tempfile::tempdir().expect("tempdir should be created");
        let _guard = crate::test_support::TestEnvVarsGuard::set([
            (
                "MISTLE_SANDBOXD_OPERATION_LOG_DIR",
                temp_dir
                    .path()
                    .to_str()
                    .expect("temp dir path should be utf8 for environment variable")
                    .to_string(),
            ),
            (
                "SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID",
                "sbi_test".to_string(),
            ),
        ]);

        record_bootstrap_tunnel_event(
            "bootstrap_tunnel.reader_closed",
            BTreeMap::from([(
                "closeKind".to_string(),
                Value::String("read_error".to_string()),
            )]),
        )
        .expect("bootstrap tunnel event should be recorded");

        let log_path = bootstrap_tunnel_log_path();
        assert_eq!(log_path, temp_dir.path().join("bootstrap-tunnel.log"));
        let log_text = std::fs::read_to_string(log_path).expect("log should be readable");
        assert!(log_text.contains(r#""event":"bootstrap_tunnel.reader_closed""#));
        assert!(log_text.contains(r#""closeKind":"read_error""#));
        assert!(log_text.contains(r#""sandboxInstanceId":"sbi_test""#));
    }
}
