//! File materialization for runtime client setup files.
//!
//! Setup-file specs may create or append files before processes start. This
//! module owns directory permissions, write modes, and error messages for those
//! filesystem operations.

use std::fs::{DirBuilder, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::Path;

use super::plan::{RuntimeClientSetupFile, RuntimeFileWriteMode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeFileApplyOutcome {
    Written,
    SkippedIfAbsent,
}

pub fn apply_runtime_file(
    file: &RuntimeClientSetupFile,
) -> Result<RuntimeFileApplyOutcome, String> {
    let parent_directory = Path::new(&file.path)
        .parent()
        .ok_or_else(|| format!("runtime file path {} has no parent directory", file.path))?;

    DirBuilder::new()
        .recursive(true)
        .mode(0o755)
        .create(parent_directory)
        .map_err(|error| {
            format!(
                "failed to create parent directory {}: {error}",
                parent_directory.display()
            )
        })?;

    if matches!(file.write_mode, Some(RuntimeFileWriteMode::IfAbsent))
        && Path::new(&file.path).exists()
    {
        return Ok(RuntimeFileApplyOutcome::SkippedIfAbsent);
    }

    let mut output_file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(file.mode)
        .open(&file.path)
        .map_err(|error| format!("failed to write file {}: {error}", file.path))?;
    output_file
        .write_all(file.content.as_bytes())
        .map_err(|error| format!("failed to write file {}: {error}", file.path))?;

    Ok(RuntimeFileApplyOutcome::Written)
}
