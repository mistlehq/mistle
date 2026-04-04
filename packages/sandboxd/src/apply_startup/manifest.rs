use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use crate::protocol::startup::StartupInput;

use super::ApplyStartupError;

pub fn load_manifest(path: &Path) -> Result<StartupInput, ApplyStartupError> {
    let bytes = fs::read(path).map_err(|error| ApplyStartupError::ReadManifest {
        path: path.to_path_buf(),
        error,
    })?;

    serde_json::from_slice(&bytes).map_err(ApplyStartupError::InvalidManifest)
}

pub fn persist_manifest(path: &Path, startup_input: &StartupInput) -> Result<(), ApplyStartupError> {
    let parent_dir = path.parent().ok_or_else(|| ApplyStartupError::MissingManifestParent {
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

    temp_file
        .write_all(&manifest_bytes)
        .map_err(|error| ApplyStartupError::WriteTempManifest {
            path: temp_path.clone(),
            error,
        })?;
    temp_file
        .write_all(b"\n")
        .map_err(|error| ApplyStartupError::WriteTempManifest {
            path: temp_path.clone(),
            error,
        })?;
    temp_file
        .sync_all()
        .map_err(|error| ApplyStartupError::FlushTempManifest {
            path: temp_path.clone(),
            error,
        })?;
    drop(temp_file);

    fs::rename(&temp_path, path).map_err(|error| ApplyStartupError::ReplaceManifest {
        from: temp_path,
        to: path.to_path_buf(),
        error,
    })?;

    Ok(())
}
