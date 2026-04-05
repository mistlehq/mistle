use std::collections::BTreeMap;
use std::fs::DirBuilder;
use std::os::unix::fs::DirBuilderExt;
use std::path::Path;

use super::artifact_command::run_runtime_artifact_command;
use super::plan::{CompiledWorkspaceSource, RuntimeArtifactCommand};

pub fn apply_workspace_source(workspace_source: &CompiledWorkspaceSource) -> Result<(), String> {
    match workspace_source {
        CompiledWorkspaceSource::GitClone { path, origin_url, .. } => {
            apply_git_clone_workspace_source(path, origin_url)
        }
    }
}

fn apply_git_clone_workspace_source(path: &str, origin_url: &str) -> Result<(), String> {
    if Path::new(path).exists() {
        return Err(format!("workspace source path '{path}' already exists"));
    }

    let parent_directory = Path::new(path)
        .parent()
        .ok_or_else(|| format!("workspace source path {path} has no parent directory"))?;
    let mut dir_builder = DirBuilder::new();
    dir_builder.recursive(true);
    dir_builder.mode(0o755);
    dir_builder.create(parent_directory).map_err(|error| {
        format!(
            "failed to create parent directory {}: {error}",
            parent_directory.display()
        )
    })?;

    let mut env = BTreeMap::new();
    env.insert("GIT_TERMINAL_PROMPT".to_string(), "0".to_string());
    let command = RuntimeArtifactCommand {
        args: vec![
            "git".to_string(),
            "clone".to_string(),
            "--origin".to_string(),
            "origin".to_string(),
            origin_url.to_string(),
            path.to_string(),
        ],
        env: Some(env),
        cwd: None,
        timeout_ms: None,
    };

    run_runtime_artifact_command(&command)
        .map_err(|error| format!("failed to clone repository: {error}"))
}
