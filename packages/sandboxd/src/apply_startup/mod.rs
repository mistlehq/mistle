//! `sandboxd apply-startup` command handling.
//!
//! This module owns the stdin/stdout JSON protocol for apply-startup, validates
//! one request, persists the durable manifest, and asks the running control
//! server to reload that manifest when present.

pub(crate) mod manifest;

use std::fmt;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::control;
use crate::protocol::startup::{
    StartupApplyErrorResponse, StartupApplyOkResponse, StartupApplyRequest,
};

/// Default on-disk location for the persisted startup manifest.
pub const DEFAULT_MANIFEST_PATH: &str = "/var/lib/mistle/sandboxd/manifest.json";

/// Describes why `sandboxd apply-startup` failed to read, persist, or acknowledge a request.
#[derive(Debug)]
pub enum ApplyStartupError {
    ReadRequest(std::io::Error),
    InvalidRequest(serde_json::Error),
    WriteResponse(std::io::Error),
    SerializeResponse(serde_json::Error),
    MissingManifestParent {
        path: PathBuf,
    },
    CreateManifestDirectory {
        path: PathBuf,
        error: std::io::Error,
    },
    CreateTempManifest {
        path: PathBuf,
        error: std::io::Error,
    },
    WriteTempManifest {
        path: PathBuf,
        error: std::io::Error,
    },
    FlushTempManifest {
        path: PathBuf,
        error: std::io::Error,
    },
    ReplaceManifest {
        from: PathBuf,
        to: PathBuf,
        error: std::io::Error,
    },
    SerializeManifest(serde_json::Error),
    ReadManifest {
        path: PathBuf,
        error: std::io::Error,
    },
    InvalidManifest(serde_json::Error),
    NotifyReload(String),
}

impl fmt::Display for ApplyStartupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ReadRequest(error) => write!(f, "failed to read startup apply request: {error}"),
            Self::InvalidRequest(error) => {
                write!(f, "startup apply request must be valid json: {error}")
            }
            Self::WriteResponse(error) => {
                write!(f, "failed to write startup apply response: {error}")
            }
            Self::SerializeResponse(error) => {
                write!(f, "failed to serialize startup apply response: {error}")
            }
            Self::MissingManifestParent { path } => {
                write!(
                    f,
                    "manifest path {} has no parent directory",
                    path.display()
                )
            }
            Self::CreateManifestDirectory { path, error } => write!(
                f,
                "failed to create manifest directory {}: {error}",
                path.display()
            ),
            Self::CreateTempManifest { path, error } => {
                write!(
                    f,
                    "failed to create temp manifest {}: {error}",
                    path.display()
                )
            }
            Self::WriteTempManifest { path, error } => {
                write!(
                    f,
                    "failed to write temp manifest {}: {error}",
                    path.display()
                )
            }
            Self::FlushTempManifest { path, error } => {
                write!(
                    f,
                    "failed to flush temp manifest {}: {error}",
                    path.display()
                )
            }
            Self::ReplaceManifest { from, to, error } => write!(
                f,
                "failed to replace manifest {} with {}: {error}",
                to.display(),
                from.display()
            ),
            Self::SerializeManifest(error) => {
                write!(f, "failed to serialize startup manifest: {error}")
            }
            Self::ReadManifest { path, error } => {
                write!(f, "failed to read manifest {}: {error}", path.display())
            }
            Self::InvalidManifest(error) => write!(f, "manifest is invalid: {error}"),
            Self::NotifyReload(error) => {
                write!(
                    f,
                    "failed to notify running sandboxd serve process: {error}"
                )
            }
        }
    }
}

impl std::error::Error for ApplyStartupError {}

/// Applies one startup request from stdin, persists the durable manifest, and writes a JSON response.
pub fn run_apply_startup<R, W>(
    reader: &mut R,
    writer: &mut W,
    manifest_path: &Path,
    control_socket_path: &Path,
) -> Result<(), ApplyStartupError>
where
    R: Read,
    W: Write,
{
    let mut raw_request = Vec::new();
    let request = match reader.read_to_end(&mut raw_request) {
        Ok(_) => match serde_json::from_slice::<StartupApplyRequest>(&raw_request) {
            Ok(request) => request,
            Err(error) => {
                let error = ApplyStartupError::InvalidRequest(error);
                write_response(
                    writer,
                    &StartupApplyErrorResponse {
                        ok: false,
                        error: error.to_string(),
                    },
                )?;
                return Err(error);
            }
        },
        Err(error) => {
            let error = ApplyStartupError::ReadRequest(error);
            write_response(
                writer,
                &StartupApplyErrorResponse {
                    ok: false,
                    error: error.to_string(),
                },
            )?;
            return Err(error);
        }
    };

    // Persist only the applied runtime manifest. The token is request-scoped
    // control-plane data and should not become part of durable sandbox state.
    match manifest::persist_manifest(manifest_path, &request.startup_input) {
        Ok(()) => {
            control::notify_reload(control_socket_path)
                .map_err(|error| ApplyStartupError::NotifyReload(error.to_string()))?;
            write_response(writer, &StartupApplyOkResponse { ok: true })?;
            Ok(())
        }
        Err(error) => {
            write_response(
                writer,
                &StartupApplyErrorResponse {
                    ok: false,
                    error: error.to_string(),
                },
            )?;
            Err(error)
        }
    }
}

/// Serializes one JSON response object to the command's stdout stream.
fn write_response<W, T>(writer: &mut W, response: &T) -> Result<(), ApplyStartupError>
where
    W: Write,
    T: serde::Serialize,
{
    let response_bytes =
        serde_json::to_vec(response).map_err(ApplyStartupError::SerializeResponse)?;
    writer
        .write_all(&response_bytes)
        .map_err(ApplyStartupError::WriteResponse)?;
    writer
        .write_all(b"\n")
        .map_err(ApplyStartupError::WriteResponse)?;
    writer.flush().map_err(ApplyStartupError::WriteResponse)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::control;
    use crate::protocol::startup::{StartupApplyResponse, StartupInput, StartupMode};
    use crate::time::ThreadSleeper;

    use crate::apply_startup::run_apply_startup;

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn persists_manifest_and_writes_ok_response() {
        let request = include_str!(
            "../../../sandbox-runtime-contract/tests/fixtures/startup-apply-request.valid.json"
        );
        let test_dir = create_temp_test_dir("apply_startup_ok");
        let manifest_path = test_dir.join("manifest.json");
        let control_socket_path = test_dir.join("control.sock");
        let mut stdout = Vec::new();

        run_apply_startup(
            &mut request.as_bytes(),
            &mut stdout,
            &manifest_path,
            &control_socket_path,
        )
        .expect("apply-startup should persist a valid manifest");

        let response: StartupApplyResponse =
            serde_json::from_slice(&stdout).expect("apply-startup should write a valid response");
        let manifest: StartupInput = serde_json::from_slice(
            &fs::read(&manifest_path).expect("manifest should be readable after apply"),
        )
        .expect("manifest should decode after apply");

        assert_eq!(
            response,
            StartupApplyResponse::Ok(crate::protocol::startup::StartupApplyOkResponse { ok: true })
        );
        assert_eq!(manifest.startup_mode, StartupMode::New);
        assert_eq!(manifest.bootstrap_token, "bootstrap-token-value");
        assert_eq!(manifest.runtime_plan["sandboxProfileId"], "sbp_123");

        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn writes_error_response_for_invalid_request() {
        let mut stdout = Vec::new();
        let mut invalid_request = br#"{"token":""}"#.as_slice();
        let test_dir = create_temp_test_dir("apply_startup_invalid");
        let manifest_path = test_dir.join("manifest.json");
        let control_socket_path = test_dir.join("control.sock");

        let error = run_apply_startup(
            &mut invalid_request,
            &mut stdout,
            &manifest_path,
            &control_socket_path,
        )
        .expect_err("invalid request should fail");
        let response: StartupApplyResponse =
            serde_json::from_slice(&stdout).expect("failed apply-startup should write a response");

        assert_eq!(
            response,
            StartupApplyResponse::Error(crate::protocol::startup::StartupApplyErrorResponse {
                ok: false,
                error: "startup apply request must be valid json: missing field `startupInput` at line 1 column 12".to_string(),
            })
        );
        assert_eq!(
            error.to_string(),
            "startup apply request must be valid json: missing field `startupInput` at line 1 column 12"
        );

        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn notifies_running_control_server_after_persisting_manifest() {
        let request = include_str!(
            "../../../sandbox-runtime-contract/tests/fixtures/startup-apply-request.valid.json"
        );
        let test_dir = create_temp_test_dir("apply_startup_control_reload");
        let manifest_path = test_dir.join("manifest.json");
        let control_socket_path = test_dir.join("control.sock");
        let mut stdout = Vec::new();
        let server = control::start_control_server(
            &control_socket_path,
            &manifest_path,
            ThreadSleeper,
            control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        )
        .expect("control server should start");

        run_apply_startup(
            &mut request.as_bytes(),
            &mut stdout,
            &manifest_path,
            &control_socket_path,
        )
        .expect("apply-startup should notify the running control server");

        assert_eq!(server.reload_count(), 1);
        let latest_manifest = server
            .latest_manifest()
            .expect("control server should load the persisted manifest");
        assert_eq!(latest_manifest.bootstrap_token, "bootstrap-token-value");

        server.close().expect("control server should stop cleanly");
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
}
