use std::fs::{DirBuilder, OpenOptions, metadata};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::Path;

use super::plan::{RuntimeClientSetupFile, RuntimeFileWriteMode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeFileApplyOutcome {
    Written,
    SkippedIfAbsent,
}

pub fn apply_runtime_file(file: &RuntimeClientSetupFile) -> Result<RuntimeFileApplyOutcome, String> {
    let parent_directory = Path::new(&file.path)
        .parent()
        .ok_or_else(|| format!("runtime file path {} has no parent directory", file.path))?;

    let mut dir_builder = DirBuilder::new();
    dir_builder.recursive(true);
    dir_builder.mode(0o755);
    dir_builder.create(parent_directory).map_err(|error| {
        format!(
            "failed to create parent directory {}: {error}",
            parent_directory.display()
        )
    })?;

    if matches!(file.write_mode, Some(RuntimeFileWriteMode::IfAbsent)) && path_exists(&file.path) {
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

fn path_exists(path: &str) -> bool {
    metadata(path).is_ok()
}
