//! Skill discovery helpers for repository-backed agent skills.
//!
//! The discovery command intentionally reports only the repository facts the
//! control plane needs for selection: commit SHA plus skill name, description,
//! and repo-relative directory path.

use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use yaml_rust2::{Yaml, YamlLoader};

const SKILL_FILE_NAME: &str = "SKILL.md";
const AGENT_SKILLS_TARGET_ROOT: &str = "/root/.agents/skills";
const MANAGED_SKILLS_MANIFEST_FILE_NAME: &str = ".mistle-managed-skills.json";
const MANAGED_SKILLS_MANIFEST_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsDiscoverOutput {
    pub commit_sha: String,
    pub skills: Vec<DiscoveredSkill>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSkill {
    pub name: String,
    pub description: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsReconcileOutput {
    pub runtime: String,
    pub target_root: String,
    pub skills: Vec<ReconciledSkill>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconciledSkill {
    pub name: String,
    pub relative_path: String,
    pub source_path: String,
    pub target_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillsReconcileSelection {
    pub name: String,
    pub relative_path: String,
}

#[derive(Debug)]
pub enum SkillsDiscoverError {
    RepoRootCanonicalize {
        path: PathBuf,
        error: io::Error,
    },
    RepoRootNotDirectory(PathBuf),
    ReadDirectory {
        path: PathBuf,
        error: io::Error,
    },
    ReadSkillFile {
        path: PathBuf,
        error: io::Error,
    },
    MissingFrontmatter(PathBuf),
    UnterminatedFrontmatter(PathBuf),
    InvalidFrontmatterYaml {
        path: PathBuf,
        error: yaml_rust2::ScanError,
    },
    FrontmatterNotMapping(PathBuf),
    MissingFrontmatterField {
        path: PathBuf,
        field: &'static str,
    },
    InvalidFrontmatterFieldType {
        path: PathBuf,
        field: &'static str,
    },
    InvalidSkillName {
        path: PathBuf,
        name: String,
    },
    DuplicateSkillName {
        name: String,
        first_path: String,
        second_path: String,
    },
    SkillPathOutsideRepo(PathBuf),
    GitRevParse {
        repo_root: PathBuf,
        error: String,
    },
    SerializeOutput(serde_json::Error),
    WriteOutput(io::Error),
}

impl fmt::Display for SkillsDiscoverError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RepoRootCanonicalize { path, error } => {
                write!(f, "failed to resolve repo root {}: {error}", path.display())
            }
            Self::RepoRootNotDirectory(path) => {
                write!(f, "repo root {} is not a directory", path.display())
            }
            Self::ReadDirectory { path, error } => {
                write!(f, "failed to read directory {}: {error}", path.display())
            }
            Self::ReadSkillFile { path, error } => {
                write!(f, "failed to read skill file {}: {error}", path.display())
            }
            Self::MissingFrontmatter(path) => {
                write!(
                    f,
                    "skill file {} must begin with YAML frontmatter",
                    path.display()
                )
            }
            Self::UnterminatedFrontmatter(path) => {
                write!(
                    f,
                    "skill file {} has unterminated YAML frontmatter",
                    path.display()
                )
            }
            Self::InvalidFrontmatterYaml { path, error } => {
                write!(
                    f,
                    "skill file {} has invalid YAML frontmatter: {error}",
                    path.display()
                )
            }
            Self::FrontmatterNotMapping(path) => {
                write!(
                    f,
                    "skill file {} must use a YAML mapping for frontmatter",
                    path.display()
                )
            }
            Self::MissingFrontmatterField { path, field } => {
                write!(
                    f,
                    "skill file {} is missing required frontmatter field '{}'",
                    path.display(),
                    field
                )
            }
            Self::InvalidFrontmatterFieldType { path, field } => {
                write!(
                    f,
                    "skill file {} frontmatter field '{}' must be a string",
                    path.display(),
                    field
                )
            }
            Self::InvalidSkillName { path, name } => {
                write!(
                    f,
                    "skill file {} has invalid skill name '{}'",
                    path.display(),
                    name
                )
            }
            Self::DuplicateSkillName {
                name,
                first_path,
                second_path,
            } => {
                write!(
                    f,
                    "duplicate skill name '{name}' discovered at '{first_path}' and '{second_path}'"
                )
            }
            Self::SkillPathOutsideRepo(path) => {
                write!(
                    f,
                    "skill path {} could not be represented relative to the repo root",
                    path.display()
                )
            }
            Self::GitRevParse { repo_root, error } => {
                write!(
                    f,
                    "failed to read git commit SHA for repo {}: {error}",
                    repo_root.display()
                )
            }
            Self::SerializeOutput(error) => {
                write!(f, "failed to serialize skill discovery output: {error}")
            }
            Self::WriteOutput(error) => {
                write!(f, "failed to write skill discovery output: {error}")
            }
        }
    }
}

impl std::error::Error for SkillsDiscoverError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillsRuntime {
    Codex,
    OpenCode,
    Pi,
}

impl SkillsRuntime {
    pub fn parse(value: &str) -> Result<Self, SkillsReconcileError> {
        match value {
            "codex" => Ok(Self::Codex),
            "opencode" => Ok(Self::OpenCode),
            "pi" => Ok(Self::Pi),
            _ => Err(SkillsReconcileError::UnknownRuntime(value.to_string())),
        }
    }

    fn as_str(&self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::OpenCode => "opencode",
            Self::Pi => "pi",
        }
    }

    fn default_target_root(&self) -> PathBuf {
        PathBuf::from(AGENT_SKILLS_TARGET_ROOT)
    }
}

#[derive(Debug)]
pub enum SkillsReconcileError {
    RepoRootCanonicalize {
        path: PathBuf,
        error: io::Error,
    },
    RepoRootNotDirectory(PathBuf),
    GitPull {
        repo_root: PathBuf,
        error: String,
    },
    TargetRootCreate {
        path: PathBuf,
        error: io::Error,
    },
    TargetRootSymlink(PathBuf),
    TargetRootRead {
        path: PathBuf,
        error: io::Error,
    },
    TargetEntryRemove {
        path: PathBuf,
        error: io::Error,
    },
    TargetManagedEntryNotSymlink(PathBuf),
    TargetManifestRead {
        path: PathBuf,
        error: io::Error,
    },
    TargetManifestParse {
        path: PathBuf,
        error: serde_json::Error,
    },
    TargetManifestInvalidVersion {
        path: PathBuf,
        version: u32,
    },
    TargetManifestInvalidSkillName {
        path: PathBuf,
        name: String,
    },
    TargetManifestWrite {
        path: PathBuf,
        error: io::Error,
    },
    TargetSymlinkCreate {
        source_path: PathBuf,
        target_path: PathBuf,
        error: io::Error,
    },
    SelectedSkillPathInvalid(String),
    SelectedSkillPathOutsideRepo(String),
    SelectedSkillPathCanonicalize {
        relative_path: String,
        path: PathBuf,
        error: io::Error,
    },
    SelectedSkillPathNotFound {
        relative_path: String,
        expected_name: String,
        path: PathBuf,
    },
    SelectedSkillNotDirectory {
        relative_path: String,
        path: PathBuf,
    },
    SelectedSkillMissingSkillFile {
        relative_path: String,
        path: PathBuf,
    },
    SelectedSkillNameMismatch {
        relative_path: String,
        expected_name: String,
        actual_name: String,
    },
    DuplicateSelectedSkillPath(String),
    DuplicateSelectedSkillName {
        name: String,
        first_path: String,
        second_path: String,
    },
    UnknownRuntime(String),
    Discover(SkillsDiscoverError),
    SerializeOutput(serde_json::Error),
    WriteOutput(io::Error),
}

impl fmt::Display for SkillsReconcileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RepoRootCanonicalize { path, error } => {
                write!(f, "failed to resolve repo root {}: {error}", path.display())
            }
            Self::RepoRootNotDirectory(path) => {
                write!(f, "repo root {} is not a directory", path.display())
            }
            Self::GitPull { repo_root, error } => {
                write!(
                    f,
                    "failed to pull skills repo {} before reconciliation: {error}",
                    repo_root.display()
                )
            }
            Self::TargetRootCreate { path, error } => {
                write!(
                    f,
                    "failed to create skills target root {}: {error}",
                    path.display()
                )
            }
            Self::TargetRootSymlink(path) => {
                write!(
                    f,
                    "skills target root path {} must not contain symlinks",
                    path.display()
                )
            }
            Self::TargetRootRead { path, error } => {
                write!(
                    f,
                    "failed to read skills target root {}: {error}",
                    path.display()
                )
            }
            Self::TargetEntryRemove { path, error } => {
                write!(
                    f,
                    "failed to remove stale skills target entry {}: {error}",
                    path.display()
                )
            }
            Self::TargetManagedEntryNotSymlink(path) => {
                write!(
                    f,
                    "managed skills target entry {} is not a symlink",
                    path.display()
                )
            }
            Self::TargetManifestRead { path, error } => {
                write!(
                    f,
                    "failed to read managed skills manifest {}: {error}",
                    path.display()
                )
            }
            Self::TargetManifestParse { path, error } => {
                write!(
                    f,
                    "failed to parse managed skills manifest {}: {error}",
                    path.display()
                )
            }
            Self::TargetManifestInvalidVersion { path, version } => {
                write!(
                    f,
                    "managed skills manifest {} has unsupported version {}",
                    path.display(),
                    version
                )
            }
            Self::TargetManifestInvalidSkillName { path, name } => {
                write!(
                    f,
                    "managed skills manifest {} contains invalid skill name '{}'",
                    path.display(),
                    name
                )
            }
            Self::TargetManifestWrite { path, error } => {
                write!(
                    f,
                    "failed to write managed skills manifest {}: {error}",
                    path.display()
                )
            }
            Self::TargetSymlinkCreate {
                source_path,
                target_path,
                error,
            } => {
                write!(
                    f,
                    "failed to symlink skill {} to {}: {error}",
                    target_path.display(),
                    source_path.display()
                )
            }
            Self::SelectedSkillPathInvalid(relative_path) => {
                write!(
                    f,
                    "selected skill path '{relative_path}' must be a repo-relative directory path"
                )
            }
            Self::SelectedSkillPathOutsideRepo(relative_path) => {
                write!(
                    f,
                    "selected skill path '{relative_path}' resolves outside the repo root"
                )
            }
            Self::SelectedSkillPathCanonicalize {
                relative_path,
                path,
                error,
            } => {
                write!(
                    f,
                    "failed to resolve selected skill path '{}' at {}: {error}",
                    relative_path,
                    path.display()
                )
            }
            Self::SelectedSkillPathNotFound {
                relative_path,
                expected_name,
                path,
            } => {
                write!(
                    f,
                    "selected skill '{}' at path '{}' was not found at {}",
                    expected_name,
                    relative_path,
                    path.display()
                )
            }
            Self::SelectedSkillNotDirectory {
                relative_path,
                path,
            } => {
                write!(
                    f,
                    "selected skill path '{}' at {} is not a directory",
                    relative_path,
                    path.display()
                )
            }
            Self::SelectedSkillMissingSkillFile {
                relative_path,
                path,
            } => {
                write!(
                    f,
                    "selected skill path '{}' at {} is missing SKILL.md",
                    relative_path,
                    path.display()
                )
            }
            Self::SelectedSkillNameMismatch {
                relative_path,
                expected_name,
                actual_name,
            } => {
                write!(
                    f,
                    "selected skill path '{relative_path}' declares skill name '{actual_name}' but the runtime plan selected '{expected_name}'"
                )
            }
            Self::DuplicateSelectedSkillPath(relative_path) => {
                write!(
                    f,
                    "selected skill path '{relative_path}' was provided more than once"
                )
            }
            Self::DuplicateSelectedSkillName {
                name,
                first_path,
                second_path,
            } => {
                write!(
                    f,
                    "selected skills '{first_path}' and '{second_path}' both declare skill name '{name}'"
                )
            }
            Self::UnknownRuntime(runtime) => {
                write!(
                    f,
                    "unknown skills runtime '{runtime}' (expected 'codex', 'opencode', or 'pi')"
                )
            }
            Self::Discover(error) => write!(f, "{error}"),
            Self::SerializeOutput(error) => {
                write!(f, "failed to serialize skill reconcile output: {error}")
            }
            Self::WriteOutput(error) => {
                write!(f, "failed to write skill reconcile output: {error}")
            }
        }
    }
}

impl std::error::Error for SkillsReconcileError {}

pub fn discover_skills(repo_root: &Path) -> Result<SkillsDiscoverOutput, SkillsDiscoverError> {
    let repo_root =
        repo_root
            .canonicalize()
            .map_err(|error| SkillsDiscoverError::RepoRootCanonicalize {
                path: repo_root.to_path_buf(),
                error,
            })?;
    if !repo_root.is_dir() {
        return Err(SkillsDiscoverError::RepoRootNotDirectory(repo_root));
    }

    let commit_sha = read_git_commit_sha(&repo_root)?;
    let mut skill_files = Vec::new();
    collect_skill_files(&repo_root, &mut skill_files)?;
    skill_files.sort();

    let mut discovered_skills = Vec::new();
    let mut names_to_paths = BTreeMap::new();
    for skill_file in skill_files {
        let skill = read_skill_file(&repo_root, &skill_file)?;
        if let Some(first_path) =
            names_to_paths.insert(skill.name.clone(), skill.relative_path.clone())
        {
            return Err(SkillsDiscoverError::DuplicateSkillName {
                name: skill.name,
                first_path,
                second_path: skill.relative_path,
            });
        }
        discovered_skills.push(skill);
    }

    discovered_skills.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(SkillsDiscoverOutput {
        commit_sha,
        skills: discovered_skills,
    })
}

pub fn run_skills_discover<W: io::Write>(
    repo_root: &Path,
    stdout: &mut W,
) -> Result<(), SkillsDiscoverError> {
    let output = discover_skills(repo_root)?;
    serde_json::to_writer(&mut *stdout, &output).map_err(SkillsDiscoverError::SerializeOutput)?;
    writeln!(stdout).map_err(SkillsDiscoverError::WriteOutput)
}

pub fn reconcile_skills(
    repo_root: &Path,
    runtime: &SkillsRuntime,
    selected_relative_paths: &[String],
    target_root_override: Option<&Path>,
) -> Result<SkillsReconcileOutput, SkillsReconcileError> {
    let selections = selected_relative_paths
        .iter()
        .map(|relative_path| SkillsReconcileRequest {
            expected_name: None,
            relative_path: relative_path.clone(),
        })
        .collect::<Vec<_>>();
    reconcile_skills_with_options(
        repo_root,
        runtime,
        &selections,
        target_root_override,
        SkillsReconcileOptions {
            pull_repo: true,
            target_ownership: SkillsTargetOwnership::AllTargetRootEntries,
        },
    )
}

pub fn reconcile_materialized_skills(
    repo_root: &Path,
    runtime: &SkillsRuntime,
    selections: &[SkillsReconcileSelection],
    target_root_override: Option<&Path>,
) -> Result<SkillsReconcileOutput, SkillsReconcileError> {
    let selections = selections
        .iter()
        .map(|selection| SkillsReconcileRequest {
            expected_name: Some(selection.name.clone()),
            relative_path: selection.relative_path.clone(),
        })
        .collect::<Vec<_>>();
    reconcile_skills_with_options(
        repo_root,
        runtime,
        &selections,
        target_root_override,
        SkillsReconcileOptions {
            pull_repo: false,
            target_ownership: SkillsTargetOwnership::ManagedSymlinks,
        },
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SkillsReconcileOptions {
    pull_repo: bool,
    target_ownership: SkillsTargetOwnership,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SkillsTargetOwnership {
    AllTargetRootEntries,
    ManagedSymlinks,
}

fn reconcile_skills_with_options(
    repo_root: &Path,
    runtime: &SkillsRuntime,
    selections: &[SkillsReconcileRequest],
    target_root_override: Option<&Path>,
    options: SkillsReconcileOptions,
) -> Result<SkillsReconcileOutput, SkillsReconcileError> {
    let repo_root =
        repo_root
            .canonicalize()
            .map_err(|error| SkillsReconcileError::RepoRootCanonicalize {
                path: repo_root.to_path_buf(),
                error,
            })?;
    if !repo_root.is_dir() {
        return Err(SkillsReconcileError::RepoRootNotDirectory(repo_root));
    }

    let target_root = target_root_override
        .map(Path::to_path_buf)
        .unwrap_or_else(|| runtime.default_target_root());
    if options.pull_repo {
        pull_git_repo(&repo_root)?;
    }
    let selected_skills = read_selected_skills(&repo_root, selections)?;

    prepare_target_root(&target_root)?;
    match options.target_ownership {
        SkillsTargetOwnership::AllTargetRootEntries => prune_target_root(&target_root)?,
        SkillsTargetOwnership::ManagedSymlinks => prune_managed_target_symlinks(&target_root)?,
    }

    let mut reconciled_skills = Vec::new();
    for selected_skill in selected_skills {
        let target_path = target_root.join(&selected_skill.name);
        create_skill_symlink(&selected_skill.source_path, &target_path)?;
        reconciled_skills.push(ReconciledSkill {
            name: selected_skill.name,
            relative_path: selected_skill.relative_path,
            source_path: selected_skill.source_path.display().to_string(),
            target_path: target_path.display().to_string(),
        });
    }
    if options.target_ownership == SkillsTargetOwnership::ManagedSymlinks {
        let managed_skill_names = reconciled_skills
            .iter()
            .map(|skill| skill.name.as_str())
            .collect::<Vec<_>>();
        write_managed_skills_manifest(&target_root, &managed_skill_names)?;
    }

    Ok(SkillsReconcileOutput {
        runtime: runtime.as_str().to_string(),
        target_root: target_root.display().to_string(),
        skills: reconciled_skills,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedSkillsManifest {
    version: u32,
    skill_names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SkillsReconcileRequest {
    expected_name: Option<String>,
    relative_path: String,
}

pub fn run_skills_reconcile<W: io::Write>(
    repo_root: &Path,
    runtime: &SkillsRuntime,
    selected_relative_paths: &[String],
    target_root_override: Option<&Path>,
    stdout: &mut W,
) -> Result<(), SkillsReconcileError> {
    let output = reconcile_skills(
        repo_root,
        runtime,
        selected_relative_paths,
        target_root_override,
    )?;
    serde_json::to_writer(&mut *stdout, &output).map_err(SkillsReconcileError::SerializeOutput)?;
    writeln!(stdout).map_err(SkillsReconcileError::WriteOutput)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SelectedSkill {
    name: String,
    relative_path: String,
    source_path: PathBuf,
}

fn read_selected_skills(
    repo_root: &Path,
    selections: &[SkillsReconcileRequest],
) -> Result<Vec<SelectedSkill>, SkillsReconcileError> {
    let mut selected_skills = Vec::new();
    let mut selected_paths = BTreeMap::new();
    let mut names_to_paths = BTreeMap::new();
    for selection in selections {
        let normalized_relative_path = normalize_selected_relative_path(&selection.relative_path)?;
        if selected_paths
            .insert(normalized_relative_path.clone(), ())
            .is_some()
        {
            return Err(SkillsReconcileError::DuplicateSelectedSkillPath(
                normalized_relative_path,
            ));
        }

        let source_path = repo_root.join(repo_relative_path_to_path(&normalized_relative_path));
        let source_path = match source_path.canonicalize() {
            Ok(source_path) => source_path,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(SkillsReconcileError::SelectedSkillPathCanonicalize {
                    relative_path: normalized_relative_path.clone(),
                    path: source_path,
                    error,
                });
            }
        };
        if !source_path.starts_with(repo_root) {
            return Err(SkillsReconcileError::SelectedSkillPathOutsideRepo(
                normalized_relative_path.clone(),
            ));
        }
        if !source_path.is_dir() {
            if selection.expected_name.is_some() {
                continue;
            }
            return Err(SkillsReconcileError::SelectedSkillNotDirectory {
                relative_path: normalized_relative_path,
                path: source_path,
            });
        }

        let skill_file_path = source_path.join(SKILL_FILE_NAME);
        let skill_file_metadata = match fs::metadata(&skill_file_path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if selection.expected_name.is_some() {
                    continue;
                }
                return Err(SkillsReconcileError::SelectedSkillMissingSkillFile {
                    relative_path: normalized_relative_path,
                    path: source_path,
                });
            }
            Err(error) => {
                return Err(SkillsReconcileError::Discover(
                    SkillsDiscoverError::ReadSkillFile {
                        path: skill_file_path,
                        error,
                    },
                ));
            }
        };
        if !skill_file_metadata.is_file() {
            if selection.expected_name.is_some() {
                continue;
            }
            return Err(SkillsReconcileError::SelectedSkillMissingSkillFile {
                relative_path: normalized_relative_path,
                path: source_path,
            });
        }
        let skill = match read_skill_file(repo_root, &skill_file_path) {
            Ok(skill) => skill,
            Err(error) => {
                if selection.expected_name.is_some() && is_selected_skill_metadata_drift(&error) {
                    continue;
                }
                return Err(SkillsReconcileError::Discover(error));
            }
        };
        if let Some(expected_name) = &selection.expected_name
            && skill.name != *expected_name
        {
            continue;
        }
        if let Some(first_path) =
            names_to_paths.insert(skill.name.clone(), normalized_relative_path.clone())
        {
            return Err(SkillsReconcileError::DuplicateSelectedSkillName {
                name: skill.name,
                first_path,
                second_path: normalized_relative_path,
            });
        }

        selected_skills.push(SelectedSkill {
            name: skill.name,
            relative_path: skill.relative_path,
            source_path,
        });
    }
    selected_skills.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(selected_skills)
}

fn is_selected_skill_metadata_drift(error: &SkillsDiscoverError) -> bool {
    matches!(
        error,
        SkillsDiscoverError::MissingFrontmatter(_)
            | SkillsDiscoverError::UnterminatedFrontmatter(_)
            | SkillsDiscoverError::InvalidFrontmatterYaml { .. }
            | SkillsDiscoverError::FrontmatterNotMapping(_)
            | SkillsDiscoverError::MissingFrontmatterField { .. }
            | SkillsDiscoverError::InvalidFrontmatterFieldType { .. }
            | SkillsDiscoverError::InvalidSkillName { .. }
    )
}

fn normalize_selected_relative_path(relative_path: &str) -> Result<String, SkillsReconcileError> {
    if relative_path == "." {
        return Ok(".".to_string());
    }
    if relative_path.trim().is_empty() {
        return Err(SkillsReconcileError::SelectedSkillPathInvalid(
            relative_path.to_string(),
        ));
    }

    let path = Path::new(relative_path);
    if path.is_absolute() {
        return Err(SkillsReconcileError::SelectedSkillPathInvalid(
            relative_path.to_string(),
        ));
    }

    let mut components = Vec::new();
    for component in path.components() {
        let std::path::Component::Normal(value) = component else {
            return Err(SkillsReconcileError::SelectedSkillPathInvalid(
                relative_path.to_string(),
            ));
        };
        let value = value.to_str().ok_or_else(|| {
            SkillsReconcileError::SelectedSkillPathInvalid(relative_path.to_string())
        })?;
        components.push(value);
    }
    if components.is_empty() {
        return Err(SkillsReconcileError::SelectedSkillPathInvalid(
            relative_path.to_string(),
        ));
    }
    Ok(components.join("/"))
}

fn repo_relative_path_to_path(relative_path: &str) -> PathBuf {
    if relative_path == "." {
        return PathBuf::new();
    }
    PathBuf::from(relative_path)
}

fn pull_git_repo(repo_root: &Path) -> Result<(), SkillsReconcileError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("pull")
        .arg("--ff-only")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|error| SkillsReconcileError::GitPull {
            repo_root: repo_root.to_path_buf(),
            error: error.to_string(),
        })?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let details = if stderr.is_empty() { stdout } else { stderr };
    Err(SkillsReconcileError::GitPull {
        repo_root: repo_root.to_path_buf(),
        error: details,
    })
}

fn prepare_target_root(target_root: &Path) -> Result<(), SkillsReconcileError> {
    reject_symlinked_existing_target_path(target_root)?;
    fs::create_dir_all(target_root).map_err(|error| SkillsReconcileError::TargetRootCreate {
        path: target_root.to_path_buf(),
        error,
    })?;
    reject_symlinked_existing_target_path(target_root)
}

fn reject_symlinked_existing_target_path(target_root: &Path) -> Result<(), SkillsReconcileError> {
    let mut current_path = PathBuf::new();
    for component in target_root.components() {
        current_path.push(component);
        match fs::symlink_metadata(&current_path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(SkillsReconcileError::TargetRootSymlink(current_path));
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(SkillsReconcileError::TargetRootCreate {
                    path: current_path,
                    error,
                });
            }
        }
    }
    Ok(())
}

fn prune_target_root(target_root: &Path) -> Result<(), SkillsReconcileError> {
    let entries =
        fs::read_dir(target_root).map_err(|error| SkillsReconcileError::TargetRootRead {
            path: target_root.to_path_buf(),
            error,
        })?;
    for entry in entries {
        let entry = entry.map_err(|error| SkillsReconcileError::TargetRootRead {
            path: target_root.to_path_buf(),
            error,
        })?;
        let path = entry.path();
        let file_type =
            entry
                .file_type()
                .map_err(|error| SkillsReconcileError::TargetRootRead {
                    path: target_root.to_path_buf(),
                    error,
                })?;
        let result = if file_type.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        result.map_err(|error| SkillsReconcileError::TargetEntryRemove { path, error })?;
    }
    Ok(())
}

fn prune_managed_target_symlinks(target_root: &Path) -> Result<(), SkillsReconcileError> {
    let Some(manifest) = read_managed_skills_manifest(target_root)? else {
        return Ok(());
    };

    for skill_name in manifest.skill_names {
        if !is_valid_skill_name(&skill_name) {
            return Err(SkillsReconcileError::TargetManifestInvalidSkillName {
                path: managed_skills_manifest_path(target_root),
                name: skill_name,
            });
        }

        let target_path = target_root.join(skill_name);
        let metadata = match fs::symlink_metadata(&target_path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(SkillsReconcileError::TargetRootRead {
                    path: target_path,
                    error,
                });
            }
        };
        if !metadata.file_type().is_symlink() {
            return Err(SkillsReconcileError::TargetManagedEntryNotSymlink(
                target_path,
            ));
        }
        fs::remove_file(&target_path).map_err(|error| SkillsReconcileError::TargetEntryRemove {
            path: target_path,
            error,
        })?;
    }
    Ok(())
}

fn read_managed_skills_manifest(
    target_root: &Path,
) -> Result<Option<ManagedSkillsManifest>, SkillsReconcileError> {
    let manifest_path = managed_skills_manifest_path(target_root);
    let content = match fs::read_to_string(&manifest_path) {
        Ok(content) => content,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(SkillsReconcileError::TargetManifestRead {
                path: manifest_path,
                error,
            });
        }
    };
    let manifest: ManagedSkillsManifest = serde_json::from_str(&content).map_err(|error| {
        SkillsReconcileError::TargetManifestParse {
            path: manifest_path.clone(),
            error,
        }
    })?;
    if manifest.version != MANAGED_SKILLS_MANIFEST_VERSION {
        return Err(SkillsReconcileError::TargetManifestInvalidVersion {
            path: manifest_path,
            version: manifest.version,
        });
    }
    Ok(Some(manifest))
}

fn write_managed_skills_manifest(
    target_root: &Path,
    skill_names: &[&str],
) -> Result<(), SkillsReconcileError> {
    let manifest_path = managed_skills_manifest_path(target_root);
    let manifest = ManagedSkillsManifest {
        version: MANAGED_SKILLS_MANIFEST_VERSION,
        skill_names: skill_names
            .iter()
            .map(|skill_name| skill_name.to_string())
            .collect(),
    };
    let content = serde_json::to_string_pretty(&manifest).map_err(|error| {
        SkillsReconcileError::TargetManifestWrite {
            path: manifest_path.clone(),
            error: io::Error::other(error),
        }
    })?;
    fs::write(&manifest_path, content).map_err(|error| SkillsReconcileError::TargetManifestWrite {
        path: manifest_path,
        error,
    })
}

fn managed_skills_manifest_path(target_root: &Path) -> PathBuf {
    target_root.join(MANAGED_SKILLS_MANIFEST_FILE_NAME)
}

#[cfg(unix)]
fn create_skill_symlink(
    source_path: &Path,
    target_path: &Path,
) -> Result<(), SkillsReconcileError> {
    std::os::unix::fs::symlink(source_path, target_path).map_err(|error| {
        SkillsReconcileError::TargetSymlinkCreate {
            source_path: source_path.to_path_buf(),
            target_path: target_path.to_path_buf(),
            error,
        }
    })
}

fn collect_skill_files(
    directory: &Path,
    skill_files: &mut Vec<PathBuf>,
) -> Result<(), SkillsDiscoverError> {
    let entries = fs::read_dir(directory).map_err(|error| SkillsDiscoverError::ReadDirectory {
        path: directory.to_path_buf(),
        error,
    })?;

    for entry in entries {
        let entry = entry.map_err(|error| SkillsDiscoverError::ReadDirectory {
            path: directory.to_path_buf(),
            error,
        })?;
        let path = entry.path();
        let file_name = entry.file_name();
        if file_name == ".git" {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| SkillsDiscoverError::ReadDirectory {
                path: directory.to_path_buf(),
                error,
            })?;
        if file_type.is_dir() {
            collect_skill_files(&path, skill_files)?;
            continue;
        }
        if file_type.is_file() && file_name == SKILL_FILE_NAME {
            skill_files.push(path);
        }
    }

    Ok(())
}

fn read_skill_file(
    repo_root: &Path,
    skill_file_path: &Path,
) -> Result<DiscoveredSkill, SkillsDiscoverError> {
    let content = fs::read_to_string(skill_file_path).map_err(|error| {
        SkillsDiscoverError::ReadSkillFile {
            path: skill_file_path.to_path_buf(),
            error,
        }
    })?;
    let frontmatter = parse_frontmatter(skill_file_path, &content)?;
    let name = read_required_frontmatter_field(skill_file_path, &frontmatter, "name")?;
    if !is_valid_skill_name(&name) {
        return Err(SkillsDiscoverError::InvalidSkillName {
            path: skill_file_path.to_path_buf(),
            name,
        });
    }
    let description =
        read_required_frontmatter_field(skill_file_path, &frontmatter, "description")?;
    let skill_directory = skill_file_path
        .parent()
        .ok_or_else(|| SkillsDiscoverError::SkillPathOutsideRepo(skill_file_path.to_path_buf()))?;
    let relative_path = skill_directory
        .strip_prefix(repo_root)
        .map_err(|_| SkillsDiscoverError::SkillPathOutsideRepo(skill_directory.to_path_buf()))?;
    let relative_path = path_to_repo_relative_string(relative_path)
        .ok_or_else(|| SkillsDiscoverError::SkillPathOutsideRepo(skill_directory.to_path_buf()))?;

    Ok(DiscoveredSkill {
        name,
        description,
        relative_path,
    })
}

fn parse_frontmatter(skill_file_path: &Path, content: &str) -> Result<Yaml, SkillsDiscoverError> {
    let mut lines = content.lines();
    let Some(first_line) = lines.next() else {
        return Err(SkillsDiscoverError::MissingFrontmatter(
            skill_file_path.to_path_buf(),
        ));
    };
    if first_line.trim_end_matches('\r') != "---" {
        return Err(SkillsDiscoverError::MissingFrontmatter(
            skill_file_path.to_path_buf(),
        ));
    }

    let mut frontmatter = String::new();
    for raw_line in lines {
        let line = raw_line.trim_end_matches('\r');
        if line == "---" {
            let documents = YamlLoader::load_from_str(&frontmatter).map_err(|error| {
                SkillsDiscoverError::InvalidFrontmatterYaml {
                    path: skill_file_path.to_path_buf(),
                    error,
                }
            })?;
            let Some(document) = documents.into_iter().next() else {
                return Err(SkillsDiscoverError::FrontmatterNotMapping(
                    skill_file_path.to_path_buf(),
                ));
            };
            if matches!(document, Yaml::Hash(_)) {
                return Ok(document);
            }
            return Err(SkillsDiscoverError::FrontmatterNotMapping(
                skill_file_path.to_path_buf(),
            ));
        }
        frontmatter.push_str(line);
        frontmatter.push('\n');
    }

    Err(SkillsDiscoverError::UnterminatedFrontmatter(
        skill_file_path.to_path_buf(),
    ))
}

fn read_required_frontmatter_field(
    skill_file_path: &Path,
    frontmatter: &Yaml,
    field: &'static str,
) -> Result<String, SkillsDiscoverError> {
    let Yaml::Hash(fields) = frontmatter else {
        return Err(SkillsDiscoverError::FrontmatterNotMapping(
            skill_file_path.to_path_buf(),
        ));
    };
    let key = Yaml::String(field.to_string());
    let value = fields
        .get(&key)
        .ok_or_else(|| SkillsDiscoverError::MissingFrontmatterField {
            path: skill_file_path.to_path_buf(),
            field,
        })?;
    let Yaml::String(value) = value else {
        return Err(SkillsDiscoverError::InvalidFrontmatterFieldType {
            path: skill_file_path.to_path_buf(),
            field,
        });
    };
    let trimmed_value = value.trim();
    if trimmed_value.is_empty() {
        return Err(SkillsDiscoverError::MissingFrontmatterField {
            path: skill_file_path.to_path_buf(),
            field,
        });
    }
    Ok(trimmed_value.to_string())
}

fn is_valid_skill_name(name: &str) -> bool {
    if name.is_empty() || name.starts_with('-') || name.ends_with('-') {
        return false;
    }

    let mut previous_was_dash = false;
    for character in name.chars() {
        let valid_character =
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-';
        if !valid_character {
            return false;
        }
        if character == '-' {
            if previous_was_dash {
                return false;
            }
            previous_was_dash = true;
            continue;
        }
        previous_was_dash = false;
    }

    true
}

fn path_to_repo_relative_string(path: &Path) -> Option<String> {
    let mut components = Vec::new();
    for component in path.components() {
        let std::path::Component::Normal(value) = component else {
            return None;
        };
        components.push(value.to_str()?);
    }
    if components.is_empty() {
        return Some(".".to_string());
    }
    Some(components.join("/"))
}

fn read_git_commit_sha(repo_root: &Path) -> Result<String, SkillsDiscoverError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("rev-parse")
        .arg("HEAD")
        .output()
        .map_err(|error| SkillsDiscoverError::GitRevParse {
            repo_root: repo_root.to_path_buf(),
            error: error.to_string(),
        })?;
    if !output.status.success() {
        return Err(SkillsDiscoverError::GitRevParse {
            repo_root: repo_root.to_path_buf(),
            error: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn run_skills<I, S, W>(args: I, stdout: &mut W) -> Result<(), SkillsCommandError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
    W: io::Write,
{
    match parse_skills_command(args)? {
        SkillsCommand::Discover { repo_root } => {
            run_skills_discover(&repo_root, stdout).map_err(SkillsCommandError::Discover)
        }
        SkillsCommand::Reconcile {
            repo_root,
            runtime,
            selected_relative_paths,
            target_root_override,
        } => run_skills_reconcile(
            &repo_root,
            &runtime,
            &selected_relative_paths,
            target_root_override.as_deref(),
            stdout,
        )
        .map_err(SkillsCommandError::Reconcile),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillsCommand {
    Discover {
        repo_root: PathBuf,
    },
    Reconcile {
        repo_root: PathBuf,
        runtime: SkillsRuntime,
        selected_relative_paths: Vec<String>,
        target_root_override: Option<PathBuf>,
    },
}

#[derive(Debug)]
pub enum SkillsCommandError {
    MissingSubcommand,
    UnknownSubcommand(String),
    MissingRepo,
    MissingRuntime,
    MissingSkillValue,
    MissingTargetRoot,
    UnexpectedArgument(String),
    Discover(SkillsDiscoverError),
    Reconcile(SkillsReconcileError),
}

impl fmt::Display for SkillsCommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingSubcommand => {
                write!(
                    f,
                    "sandboxd skills requires a subcommand (expected 'discover' or 'reconcile')"
                )
            }
            Self::UnknownSubcommand(subcommand) => {
                write!(
                    f,
                    "unknown sandboxd skills subcommand '{subcommand}' (expected 'discover' or 'reconcile')"
                )
            }
            Self::MissingRepo => write!(f, "sandboxd skills requires --repo <path>"),
            Self::MissingRuntime => write!(f, "sandboxd skills reconcile requires --runtime <id>"),
            Self::MissingSkillValue => write!(
                f,
                "sandboxd skills reconcile --skill requires a relative path value"
            ),
            Self::MissingTargetRoot => write!(
                f,
                "sandboxd skills reconcile --target-root requires a path value"
            ),
            Self::UnexpectedArgument(argument) => {
                write!(f, "unexpected sandboxd skills argument: {argument}")
            }
            Self::Discover(error) => write!(f, "{error}"),
            Self::Reconcile(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for SkillsCommandError {}

pub fn parse_skills_command<I, S>(args: I) -> Result<SkillsCommand, SkillsCommandError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut args = args.into_iter().map(Into::into);
    let Some(subcommand) = args.next() else {
        return Err(SkillsCommandError::MissingSubcommand);
    };
    match subcommand.as_str() {
        "discover" => parse_skills_discover_args(args),
        "reconcile" => parse_skills_reconcile_args(args),
        _ => Err(SkillsCommandError::UnknownSubcommand(subcommand)),
    }
}

fn parse_skills_discover_args<I>(mut args: I) -> Result<SkillsCommand, SkillsCommandError>
where
    I: Iterator<Item = String>,
{
    let mut repo_root = None;
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--repo" => {
                if repo_root.is_some() {
                    return Err(SkillsCommandError::UnexpectedArgument(argument));
                }
                repo_root = Some(PathBuf::from(
                    args.next().ok_or(SkillsCommandError::MissingRepo)?,
                ));
            }
            _ => return Err(SkillsCommandError::UnexpectedArgument(argument)),
        }
    }
    let repo_root = repo_root.ok_or(SkillsCommandError::MissingRepo)?;
    Ok(SkillsCommand::Discover { repo_root })
}

fn parse_skills_reconcile_args<I>(mut args: I) -> Result<SkillsCommand, SkillsCommandError>
where
    I: Iterator<Item = String>,
{
    let mut repo_root = None;
    let mut runtime = None;
    let mut selected_relative_paths = Vec::new();
    let mut target_root_override = None;
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--repo" => {
                if repo_root.is_some() {
                    return Err(SkillsCommandError::UnexpectedArgument(argument));
                }
                repo_root = Some(PathBuf::from(
                    args.next().ok_or(SkillsCommandError::MissingRepo)?,
                ));
            }
            "--runtime" => {
                if runtime.is_some() {
                    return Err(SkillsCommandError::UnexpectedArgument(argument));
                }
                let runtime_arg = args.next().ok_or(SkillsCommandError::MissingRuntime)?;
                runtime = Some(
                    SkillsRuntime::parse(&runtime_arg).map_err(SkillsCommandError::Reconcile)?,
                );
            }
            "--skill" => {
                selected_relative_paths
                    .push(args.next().ok_or(SkillsCommandError::MissingSkillValue)?);
            }
            "--target-root" => {
                if target_root_override.is_some() {
                    return Err(SkillsCommandError::UnexpectedArgument(argument));
                }
                target_root_override = Some(PathBuf::from(
                    args.next().ok_or(SkillsCommandError::MissingTargetRoot)?,
                ));
            }
            _ => return Err(SkillsCommandError::UnexpectedArgument(argument)),
        }
    }
    let repo_root = repo_root.ok_or(SkillsCommandError::MissingRepo)?;
    let runtime = runtime.ok_or(SkillsCommandError::MissingRuntime)?;
    Ok(SkillsCommand::Reconcile {
        repo_root,
        runtime,
        selected_relative_paths,
        target_root_override,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use serde_json::Value;

    use super::{
        DiscoveredSkill, ReconciledSkill, SkillsCommand, SkillsCommandError, SkillsDiscoverError,
        SkillsReconcileError, SkillsReconcileOutput, SkillsReconcileSelection, SkillsRuntime,
        discover_skills, parse_skills_command, reconcile_materialized_skills, reconcile_skills,
    };

    #[test]
    fn discovers_skills_from_skill_frontmatter() {
        let repo_root = create_git_repo("skills_discover_ok");
        write_skill(
            &repo_root,
            ".agents/skills/github-pr-authoring",
            r#"---
name: github-pr-authoring
description: Draft or update GitHub pull requests.
---

Skill body.
"#,
        );
        write_skill(
            &repo_root,
            "nested/custom-skill",
            r#"---
description: |-
  Custom skill with
  a multiline description.
metadata:
  runtimes:
    - codex
  owner:
    team: agents
name: custom-skill
---
"#,
        );
        commit_all(&repo_root);
        let expected_commit_sha = git_stdout(&repo_root, ["rev-parse", "HEAD"]);

        let output = discover_skills(&repo_root).expect("skills should discover");

        assert_eq!(output.commit_sha, expected_commit_sha);
        assert_eq!(
            output.skills,
            vec![
                DiscoveredSkill {
                    name: "custom-skill".to_string(),
                    description: "Custom skill with\na multiline description.".to_string(),
                    relative_path: "nested/custom-skill".to_string(),
                },
                DiscoveredSkill {
                    name: "github-pr-authoring".to_string(),
                    description: "Draft or update GitHub pull requests.".to_string(),
                    relative_path: ".agents/skills/github-pr-authoring".to_string(),
                },
            ]
        );

        fs::remove_dir_all(repo_root).expect("repo should be removable");
    }

    #[test]
    fn discovers_root_skill_with_dot_relative_path() {
        let repo_root = create_git_repo("skills_discover_root_skill");
        write_skill(
            &repo_root,
            ".",
            r#"---
name: root-skill
description: Skill defined at the repository root.
---
"#,
        );
        commit_all(&repo_root);

        let output = discover_skills(&repo_root).expect("root skill should discover");

        assert_eq!(
            output.skills,
            vec![DiscoveredSkill {
                name: "root-skill".to_string(),
                description: "Skill defined at the repository root.".to_string(),
                relative_path: ".".to_string(),
            }]
        );
        fs::remove_dir_all(repo_root).expect("repo should be removable");
    }

    #[test]
    fn skills_discover_command_writes_json_output() {
        let repo_root = create_git_repo("skills_discover_command");
        write_skill(
            &repo_root,
            ".agents/skills/write-a-skill",
            r#"---
name: write-a-skill
description: Write a new skill.
---
"#,
        );
        commit_all(&repo_root);

        let mut stdout = Vec::new();
        let exit_code = crate::run(
            "sandboxd",
            [
                "skills".to_string(),
                "discover".to_string(),
                "--repo".to_string(),
                repo_root.display().to_string(),
            ],
            &mut std::io::empty(),
            &mut stdout,
            &mut Vec::new(),
        );

        assert_eq!(exit_code, 0);
        let output: Value = serde_json::from_slice(&stdout).expect("stdout should be json");
        assert_eq!(output["skills"][0]["name"], "write-a-skill");
        assert_eq!(output["skills"][0]["description"], "Write a new skill.");
        assert_eq!(
            output["skills"][0]["relativePath"],
            ".agents/skills/write-a-skill"
        );
        assert_eq!(
            output["commitSha"]
                .as_str()
                .expect("commit sha should be present")
                .len(),
            40
        );

        fs::remove_dir_all(repo_root).expect("repo should be removable");
    }

    #[test]
    fn reconciles_selected_skills_to_runtime_target_root() {
        let (repo_root, remote_root) = create_git_repo_with_origin("skills_reconcile_selected");
        let target_root = create_temp_test_dir("skills_reconcile_target");
        write_skill(
            &repo_root,
            ".agents/skills/github-pr-authoring",
            r#"---
name: github-pr-authoring
description: Draft or update GitHub pull requests.
---
"#,
        );
        write_skill(
            &repo_root,
            "nested/custom-skill",
            r#"---
name: custom-skill
description: Custom skill.
---
"#,
        );

        let output = reconcile_skills(
            &repo_root,
            &SkillsRuntime::Codex,
            &[
                "nested/custom-skill".to_string(),
                ".agents/skills/github-pr-authoring".to_string(),
            ],
            Some(&target_root),
        )
        .expect("selected skills should reconcile");

        assert_eq!(
            output,
            SkillsReconcileOutput {
                runtime: "codex".to_string(),
                target_root: target_root.display().to_string(),
                skills: vec![
                    ReconciledSkill {
                        name: "custom-skill".to_string(),
                        relative_path: "nested/custom-skill".to_string(),
                        source_path: repo_root.join("nested/custom-skill").display().to_string(),
                        target_path: target_root.join("custom-skill").display().to_string(),
                    },
                    ReconciledSkill {
                        name: "github-pr-authoring".to_string(),
                        relative_path: ".agents/skills/github-pr-authoring".to_string(),
                        source_path: repo_root
                            .join(".agents/skills/github-pr-authoring")
                            .display()
                            .to_string(),
                        target_path: target_root
                            .join("github-pr-authoring")
                            .display()
                            .to_string(),
                    },
                ],
            }
        );
        assert_eq!(
            fs::read_link(target_root.join("custom-skill"))
                .expect("custom skill symlink should exist"),
            repo_root.join("nested/custom-skill")
        );
        assert_eq!(
            fs::read_link(target_root.join("github-pr-authoring"))
                .expect("github skill symlink should exist"),
            repo_root.join(".agents/skills/github-pr-authoring")
        );

        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(remote_root).expect("remote should be removable");
        fs::remove_dir_all(target_root).expect("target root should be removable");
    }

    #[test]
    fn reconcile_prunes_stale_target_entries() {
        let (repo_root, remote_root) = create_git_repo_with_origin("skills_reconcile_prune_repo");
        let target_root = create_temp_test_dir("skills_reconcile_prune_target");
        write_skill(
            &repo_root,
            ".",
            r#"---
name: root-skill
description: Skill defined at the repository root.
---
"#,
        );
        fs::create_dir_all(target_root.join("stale-directory"))
            .expect("stale directory should be created");
        fs::write(target_root.join("stale-directory/old.txt"), "old")
            .expect("stale file should be created");
        fs::write(target_root.join("stale-file"), "old").expect("stale file should be created");

        let output = reconcile_skills(
            &repo_root,
            &SkillsRuntime::OpenCode,
            &[".".to_string()],
            Some(&target_root),
        )
        .expect("root skill should reconcile");

        assert_eq!(output.runtime, "opencode");
        assert_eq!(
            fs::read_link(target_root.join("root-skill")).expect("root skill symlink should exist"),
            repo_root
        );
        assert!(
            !target_root.join("stale-directory").exists(),
            "stale directory should be pruned"
        );
        assert!(
            !target_root.join("stale-file").exists(),
            "stale file should be pruned"
        );

        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(remote_root).expect("remote should be removable");
        fs::remove_dir_all(target_root).expect("target root should be removable");
    }

    #[test]
    fn reconcile_empty_selection_prunes_target_root() {
        let (repo_root, remote_root) = create_git_repo_with_origin("skills_reconcile_empty_repo");
        let target_root = create_temp_test_dir("skills_reconcile_empty_target");
        fs::write(target_root.join("stale-skill"), "old").expect("stale skill should be created");

        let output = reconcile_skills(&repo_root, &SkillsRuntime::Pi, &[], Some(&target_root))
            .expect("empty selection should reconcile");

        assert_eq!(output.runtime, "pi");
        assert_eq!(output.skills, Vec::<ReconciledSkill>::new());
        assert!(
            fs::read_dir(&target_root)
                .expect("target root should be readable")
                .next()
                .is_none(),
            "target root should be empty"
        );

        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(remote_root).expect("remote should be removable");
        fs::remove_dir_all(target_root).expect("target root should be removable");
    }

    #[test]
    fn reconcile_pulls_repo_and_prunes_selected_skills_removed_upstream() {
        let (repo_root, remote_root) = create_git_repo_with_origin("skills_reconcile_pull_repo");
        let updater_root = create_temp_test_dir("skills_reconcile_pull_updater");
        fs::remove_dir_all(&updater_root).expect("updater placeholder should be removable");
        let target_root = create_temp_test_dir("skills_reconcile_pull_target");
        write_skill(
            &repo_root,
            "skills/old-skill",
            r#"---
name: old-skill
description: Old skill.
---
"#,
        );
        commit_all(&repo_root);
        run_git(&repo_root, ["push"]);
        fs::write(target_root.join("old-skill"), "stale").expect("stale skill should be created");
        clone_repo(&remote_root, &updater_root);
        run_git(&updater_root, ["config", "user.name", "Mistle Test"]);
        run_git(
            &updater_root,
            ["config", "user.email", "mistle-test@example.com"],
        );
        fs::remove_dir_all(updater_root.join("skills/old-skill"))
            .expect("old skill should be removed upstream");
        write_skill(
            &updater_root,
            "skills/new-skill",
            r#"---
name: new-skill
description: New skill.
---
"#,
        );
        commit_all(&updater_root);
        run_git(&updater_root, ["push"]);

        let output = reconcile_skills(
            &repo_root,
            &SkillsRuntime::Codex,
            &[
                "skills/old-skill".to_string(),
                "skills/new-skill".to_string(),
            ],
            Some(&target_root),
        )
        .expect("reconcile should pull before linking selected skills");

        assert_eq!(
            output.skills,
            vec![ReconciledSkill {
                name: "new-skill".to_string(),
                relative_path: "skills/new-skill".to_string(),
                source_path: repo_root.join("skills/new-skill").display().to_string(),
                target_path: target_root.join("new-skill").display().to_string(),
            }]
        );
        assert!(
            !target_root.join("old-skill").exists(),
            "stale removed skill target should be pruned"
        );
        assert_eq!(
            fs::read_link(target_root.join("new-skill"))
                .expect("new skill symlink should be created"),
            repo_root.join("skills/new-skill")
        );

        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(remote_root).expect("remote should be removable");
        fs::remove_dir_all(updater_root).expect("updater should be removable");
        fs::remove_dir_all(target_root).expect("target root should be removable");
    }

    #[test]
    fn materialized_reconcile_does_not_pull_repo() {
        let repo_root = create_git_repo("skills_materialized_reconcile_without_origin");
        let target_root =
            create_temp_test_dir("skills_materialized_reconcile_without_origin_target");
        write_skill(
            &repo_root,
            "skills/local-skill",
            r#"---
name: local-skill
description: Local skill.
---
"#,
        );
        commit_all(&repo_root);

        let output = reconcile_materialized_skills(
            &repo_root,
            &SkillsRuntime::Codex,
            &[SkillsReconcileSelection {
                name: "local-skill".to_string(),
                relative_path: "skills/local-skill".to_string(),
            }],
            Some(&target_root),
        )
        .expect("materialized reconcile should not require a pullable origin");

        assert_eq!(
            output.skills,
            vec![ReconciledSkill {
                name: "local-skill".to_string(),
                relative_path: "skills/local-skill".to_string(),
                source_path: repo_root.join("skills/local-skill").display().to_string(),
                target_path: target_root.join("local-skill").display().to_string(),
            }]
        );
        assert_eq!(
            fs::read_link(target_root.join("local-skill"))
                .expect("local skill symlink should be created"),
            repo_root.join("skills/local-skill")
        );

        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(target_root).expect("target root should be removable");
    }

    #[test]
    fn materialized_reconcile_prunes_only_previously_managed_symlinks() {
        let repo_root = create_git_repo("skills_materialized_reconcile_managed_prune");
        let target_root = create_temp_test_dir("skills_materialized_reconcile_managed_target");
        write_skill(
            &repo_root,
            "skills/old-skill",
            r#"---
name: old-skill
description: Old skill.
---
"#,
        );
        write_skill(
            &repo_root,
            "skills/new-skill",
            r#"---
name: new-skill
description: New skill.
---
"#,
        );
        commit_all(&repo_root);
        fs::create_dir_all(target_root.join("image-skill"))
            .expect("image skill directory should be created");
        fs::write(target_root.join("image-skill/SKILL.md"), "image")
            .expect("image skill file should be created");

        reconcile_materialized_skills(
            &repo_root,
            &SkillsRuntime::OpenCode,
            &[SkillsReconcileSelection {
                name: "old-skill".to_string(),
                relative_path: "skills/old-skill".to_string(),
            }],
            Some(&target_root),
        )
        .expect("old skill should reconcile");

        let output = reconcile_materialized_skills(
            &repo_root,
            &SkillsRuntime::OpenCode,
            &[SkillsReconcileSelection {
                name: "new-skill".to_string(),
                relative_path: "skills/new-skill".to_string(),
            }],
            Some(&target_root),
        )
        .expect("new skill should reconcile");

        assert_eq!(
            output.skills,
            vec![ReconciledSkill {
                name: "new-skill".to_string(),
                relative_path: "skills/new-skill".to_string(),
                source_path: repo_root.join("skills/new-skill").display().to_string(),
                target_path: target_root.join("new-skill").display().to_string(),
            }]
        );
        assert!(
            !target_root.join("old-skill").exists(),
            "previous managed symlink should be pruned"
        );
        assert!(
            target_root.join("image-skill/SKILL.md").is_file(),
            "unmanaged image skill should remain"
        );
        assert_eq!(
            fs::read_link(target_root.join("new-skill"))
                .expect("new skill symlink should be created"),
            repo_root.join("skills/new-skill")
        );

        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(target_root).expect("target root should be removable");
    }

    #[test]
    fn materialized_reconcile_skips_skill_name_mismatch() {
        let repo_root = create_git_repo("skills_materialized_reconcile_name_mismatch");
        let target_root =
            create_temp_test_dir("skills_materialized_reconcile_name_mismatch_target");
        write_skill(
            &repo_root,
            "skills/selected-path",
            r#"---
name: replacement-skill
description: Replacement skill.
---
"#,
        );
        write_skill(
            &repo_root,
            "skills/valid-skill",
            r#"---
name: valid-skill
description: Valid skill.
---
"#,
        );
        commit_all(&repo_root);

        let output = reconcile_materialized_skills(
            &repo_root,
            &SkillsRuntime::Codex,
            &[
                SkillsReconcileSelection {
                    name: "original-skill".to_string(),
                    relative_path: "skills/selected-path".to_string(),
                },
                SkillsReconcileSelection {
                    name: "valid-skill".to_string(),
                    relative_path: "skills/valid-skill".to_string(),
                },
            ],
            Some(&target_root),
        )
        .expect("materialized reconcile should skip replaced skill at selected path");

        assert_eq!(
            output.skills,
            vec![ReconciledSkill {
                name: "valid-skill".to_string(),
                relative_path: "skills/valid-skill".to_string(),
                source_path: repo_root.join("skills/valid-skill").display().to_string(),
                target_path: target_root.join("valid-skill").display().to_string(),
            }]
        );
        assert!(
            !target_root.join("original-skill").exists(),
            "renamed selected skill should not be linked"
        );

        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(target_root).expect("target root should be removable");
    }

    #[test]
    fn materialized_reconcile_skips_missing_selected_skill_path() {
        let repo_root = create_git_repo("skills_materialized_reconcile_missing_selected_path");
        let target_root =
            create_temp_test_dir("skills_materialized_reconcile_missing_selected_path_target");
        write_skill(
            &repo_root,
            "skills/valid-skill",
            r#"---
name: valid-skill
description: Valid skill.
---
"#,
        );
        commit_all(&repo_root);

        let output = reconcile_materialized_skills(
            &repo_root,
            &SkillsRuntime::Codex,
            &[
                SkillsReconcileSelection {
                    name: "removed-skill".to_string(),
                    relative_path: "skills/removed-skill".to_string(),
                },
                SkillsReconcileSelection {
                    name: "valid-skill".to_string(),
                    relative_path: "skills/valid-skill".to_string(),
                },
            ],
            Some(&target_root),
        )
        .expect("materialized reconcile should skip missing selected skill paths");

        assert_eq!(
            output.skills,
            vec![ReconciledSkill {
                name: "valid-skill".to_string(),
                relative_path: "skills/valid-skill".to_string(),
                source_path: repo_root.join("skills/valid-skill").display().to_string(),
                target_path: target_root.join("valid-skill").display().to_string(),
            }]
        );
        assert!(
            !target_root.join("removed-skill").exists(),
            "missing selected skill should not be linked"
        );

        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(target_root).expect("target root should be removable");
    }

    #[test]
    fn materialized_reconcile_skips_selected_directory_without_skill_file() {
        let repo_root = create_git_repo("skills_materialized_reconcile_missing_skill_file");
        let target_root =
            create_temp_test_dir("skills_materialized_reconcile_missing_skill_file_target");
        fs::create_dir_all(repo_root.join("skills/stale-skill"))
            .expect("stale skill directory should be created");
        write_skill(
            &repo_root,
            "skills/valid-skill",
            r#"---
name: valid-skill
description: Valid skill.
---
"#,
        );
        commit_all(&repo_root);

        let output = reconcile_materialized_skills(
            &repo_root,
            &SkillsRuntime::Codex,
            &[
                SkillsReconcileSelection {
                    name: "stale-skill".to_string(),
                    relative_path: "skills/stale-skill".to_string(),
                },
                SkillsReconcileSelection {
                    name: "valid-skill".to_string(),
                    relative_path: "skills/valid-skill".to_string(),
                },
            ],
            Some(&target_root),
        )
        .expect("materialized reconcile should skip selected directories without SKILL.md");

        assert_eq!(
            output.skills,
            vec![ReconciledSkill {
                name: "valid-skill".to_string(),
                relative_path: "skills/valid-skill".to_string(),
                source_path: repo_root.join("skills/valid-skill").display().to_string(),
                target_path: target_root.join("valid-skill").display().to_string(),
            }]
        );
        assert!(
            !target_root.join("stale-skill").exists(),
            "selected directory without SKILL.md should not be linked"
        );

        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(target_root).expect("target root should be removable");
    }

    #[test]
    fn materialized_reconcile_skips_selected_skill_with_invalid_metadata() {
        let repo_root = create_git_repo("skills_materialized_reconcile_invalid_metadata");
        let target_root =
            create_temp_test_dir("skills_materialized_reconcile_invalid_metadata_target");
        fs::create_dir_all(repo_root.join("skills/stale-skill"))
            .expect("stale skill directory should be created");
        fs::write(
            repo_root.join("skills/stale-skill/SKILL.md"),
            r#"---
name: Invalid Skill
description: Invalid name.
---
"#,
        )
        .expect("stale skill file should be written");
        write_skill(
            &repo_root,
            "skills/valid-skill",
            r#"---
name: valid-skill
description: Valid skill.
---
"#,
        );
        commit_all(&repo_root);

        let output = reconcile_materialized_skills(
            &repo_root,
            &SkillsRuntime::Codex,
            &[
                SkillsReconcileSelection {
                    name: "stale-skill".to_string(),
                    relative_path: "skills/stale-skill".to_string(),
                },
                SkillsReconcileSelection {
                    name: "valid-skill".to_string(),
                    relative_path: "skills/valid-skill".to_string(),
                },
            ],
            Some(&target_root),
        )
        .expect("materialized reconcile should skip selected skills with invalid metadata");

        assert_eq!(
            output.skills,
            vec![ReconciledSkill {
                name: "valid-skill".to_string(),
                relative_path: "skills/valid-skill".to_string(),
                source_path: repo_root.join("skills/valid-skill").display().to_string(),
                target_path: target_root.join("valid-skill").display().to_string(),
            }]
        );
        assert!(
            !target_root.join("stale-skill").exists(),
            "selected skill with invalid metadata should not be linked"
        );

        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(target_root).expect("target root should be removable");
    }

    #[test]
    fn materialized_reconcile_rejects_selected_skill_file_read_errors() {
        let repo_root = create_git_repo("skills_materialized_reconcile_read_error");
        let target_root = create_temp_test_dir("skills_materialized_reconcile_read_error_target");
        fs::create_dir_all(repo_root.join("skills/unreadable-skill"))
            .expect("unreadable skill directory should be created");
        fs::write(
            repo_root.join("skills/unreadable-skill/SKILL.md"),
            [0xff, 0xfe, 0xfd],
        )
        .expect("unreadable skill file should be written");
        write_skill(
            &repo_root,
            "skills/valid-skill",
            r#"---
name: valid-skill
description: Valid skill.
---
"#,
        );
        commit_all(&repo_root);

        let error = reconcile_materialized_skills(
            &repo_root,
            &SkillsRuntime::Codex,
            &[
                SkillsReconcileSelection {
                    name: "unreadable-skill".to_string(),
                    relative_path: "skills/unreadable-skill".to_string(),
                },
                SkillsReconcileSelection {
                    name: "valid-skill".to_string(),
                    relative_path: "skills/valid-skill".to_string(),
                },
            ],
            Some(&target_root),
        )
        .expect_err("materialized reconcile should reject selected skill file read errors");

        assert!(matches!(
            error,
            SkillsReconcileError::Discover(SkillsDiscoverError::ReadSkillFile { .. })
        ));

        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(target_root).expect("target root should be removable");
    }

    #[cfg(unix)]
    #[test]
    fn materialized_reconcile_rejects_selected_skill_file_metadata_errors() {
        let repo_root = create_git_repo("skills_materialized_reconcile_metadata_error");
        let target_root =
            create_temp_test_dir("skills_materialized_reconcile_metadata_error_target");
        fs::create_dir_all(repo_root.join("skills/loop-skill"))
            .expect("loop skill directory should be created");
        std::os::unix::fs::symlink("SKILL.md", repo_root.join("skills/loop-skill/SKILL.md"))
            .expect("looping skill file symlink should be created");
        write_skill(
            &repo_root,
            "skills/valid-skill",
            r#"---
name: valid-skill
description: Valid skill.
---
"#,
        );
        commit_all(&repo_root);

        let error = reconcile_materialized_skills(
            &repo_root,
            &SkillsRuntime::Codex,
            &[
                SkillsReconcileSelection {
                    name: "loop-skill".to_string(),
                    relative_path: "skills/loop-skill".to_string(),
                },
                SkillsReconcileSelection {
                    name: "valid-skill".to_string(),
                    relative_path: "skills/valid-skill".to_string(),
                },
            ],
            Some(&target_root),
        )
        .expect_err("materialized reconcile should reject selected skill file metadata errors");

        assert!(matches!(
            error,
            SkillsReconcileError::Discover(SkillsDiscoverError::ReadSkillFile { .. })
        ));

        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(target_root).expect("target root should be removable");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_reconcile_target_root_without_pruning_destination() {
        let (repo_root, remote_root) =
            create_git_repo_with_origin("skills_reconcile_symlink_root_repo");
        let destination = create_temp_test_dir("skills_reconcile_symlink_root_destination");
        let target_root = create_temp_test_dir("skills_reconcile_symlink_root_target");
        fs::remove_dir_all(&target_root).expect("target root placeholder should be removed");
        fs::write(destination.join("stale-skill"), "old").expect("stale skill should be created");
        std::os::unix::fs::symlink(&destination, &target_root)
            .expect("target root symlink should be created");

        let error = reconcile_skills(&repo_root, &SkillsRuntime::Codex, &[], Some(&target_root))
            .expect_err("symlinked target root should fail");

        assert!(matches!(error, SkillsReconcileError::TargetRootSymlink(_)));
        assert_eq!(
            fs::read_to_string(destination.join("stale-skill"))
                .expect("stale skill should remain in symlink destination"),
            "old"
        );

        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(remote_root).expect("remote should be removable");
        fs::remove_file(target_root).expect("target root symlink should be removable");
        fs::remove_dir_all(destination).expect("destination should be removable");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_reconcile_target_ancestor_without_pruning_destination() {
        let (repo_root, remote_root) =
            create_git_repo_with_origin("skills_reconcile_symlink_ancestor_repo");
        let base = create_temp_test_dir("skills_reconcile_symlink_ancestor_base");
        let destination = create_temp_test_dir("skills_reconcile_symlink_ancestor_destination");
        let target_parent = base.join("linked-parent");
        let target_root = target_parent.join("skills");
        fs::create_dir_all(destination.join("skills"))
            .expect("destination target root should be created");
        fs::write(destination.join("skills/stale-skill"), "old")
            .expect("stale skill should be created");
        std::os::unix::fs::symlink(&destination, &target_parent)
            .expect("target parent symlink should be created");

        let error = reconcile_skills(&repo_root, &SkillsRuntime::Pi, &[], Some(&target_root))
            .expect_err("symlinked target ancestor should fail");

        assert!(matches!(error, SkillsReconcileError::TargetRootSymlink(_)));
        assert_eq!(
            fs::read_to_string(destination.join("skills/stale-skill"))
                .expect("stale skill should remain in symlink destination"),
            "old"
        );

        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(remote_root).expect("remote should be removable");
        fs::remove_file(target_parent).expect("target parent symlink should be removable");
        fs::remove_dir_all(base).expect("base should be removable");
        fs::remove_dir_all(destination).expect("destination should be removable");
    }

    #[test]
    fn skills_reconcile_command_writes_json_output() {
        let (repo_root, remote_root) = create_git_repo_with_origin("skills_reconcile_command_repo");
        let target_root = create_temp_test_dir("skills_reconcile_command_target");
        write_skill(
            &repo_root,
            ".agents/skills/write-a-skill",
            r#"---
name: write-a-skill
description: Write a new skill.
---
"#,
        );

        let mut stdout = Vec::new();
        let exit_code = crate::run(
            "sandboxd",
            [
                "skills".to_string(),
                "reconcile".to_string(),
                "--repo".to_string(),
                repo_root.display().to_string(),
                "--runtime".to_string(),
                "pi".to_string(),
                "--skill".to_string(),
                ".agents/skills/write-a-skill".to_string(),
                "--target-root".to_string(),
                target_root.display().to_string(),
            ],
            &mut std::io::empty(),
            &mut stdout,
            &mut Vec::new(),
        );

        assert_eq!(exit_code, 0);
        let output: Value = serde_json::from_slice(&stdout).expect("stdout should be json");
        assert_eq!(output["runtime"], "pi");
        assert_eq!(output["skills"][0]["name"], "write-a-skill");
        assert_eq!(
            output["skills"][0]["relativePath"],
            ".agents/skills/write-a-skill"
        );
        assert_eq!(
            fs::read_link(target_root.join("write-a-skill"))
                .expect("write skill symlink should exist"),
            repo_root.join(".agents/skills/write-a-skill")
        );

        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(remote_root).expect("remote should be removable");
        fs::remove_dir_all(target_root).expect("target root should be removable");
    }

    #[test]
    fn rejects_duplicate_skill_names() {
        let repo_root = create_git_repo("skills_discover_duplicate");
        write_skill(
            &repo_root,
            ".agents/skills/one",
            r#"---
name: duplicate-skill
description: First.
---
"#,
        );
        write_skill(
            &repo_root,
            ".agents/skills/two",
            r#"---
name: duplicate-skill
description: Second.
---
"#,
        );
        commit_all(&repo_root);

        let error = discover_skills(&repo_root).expect_err("duplicate names should fail");

        assert!(matches!(
            error,
            SkillsDiscoverError::DuplicateSkillName { .. }
        ));
        fs::remove_dir_all(repo_root).expect("repo should be removable");
    }

    #[test]
    fn rejects_skill_files_without_frontmatter() {
        let repo_root = create_git_repo("skills_discover_missing_frontmatter");
        write_skill(
            &repo_root,
            ".agents/skills/no-frontmatter",
            "No frontmatter.",
        );
        commit_all(&repo_root);

        let error = discover_skills(&repo_root).expect_err("missing frontmatter should fail");

        assert!(matches!(error, SkillsDiscoverError::MissingFrontmatter(_)));
        fs::remove_dir_all(repo_root).expect("repo should be removable");
    }

    #[test]
    fn rejects_malformed_yaml_frontmatter() {
        let repo_root = create_git_repo("skills_discover_malformed_yaml");
        write_skill(
            &repo_root,
            ".agents/skills/malformed",
            r#"---
name: malformed
description: [invalid
---
"#,
        );
        commit_all(&repo_root);

        let error = discover_skills(&repo_root).expect_err("malformed yaml should fail");

        assert!(matches!(
            error,
            SkillsDiscoverError::InvalidFrontmatterYaml { .. }
        ));
        fs::remove_dir_all(repo_root).expect("repo should be removable");
    }

    #[test]
    fn rejects_non_string_required_frontmatter_fields() {
        let repo_root = create_git_repo("skills_discover_non_string_field");
        write_skill(
            &repo_root,
            ".agents/skills/non-string",
            r#"---
name:
  nested: value
description: Invalid name type.
---
"#,
        );
        commit_all(&repo_root);

        let error = discover_skills(&repo_root).expect_err("non-string required field should fail");

        assert!(matches!(
            error,
            SkillsDiscoverError::InvalidFrontmatterFieldType { field: "name", .. }
        ));
        fs::remove_dir_all(repo_root).expect("repo should be removable");
    }

    #[test]
    fn rejects_reconcile_selected_paths_that_escape_repo() {
        let (repo_root, remote_root) = create_git_repo_with_origin("skills_reconcile_escape");

        let error = reconcile_skills(
            &repo_root,
            &SkillsRuntime::Codex,
            &["../outside".to_string()],
            None,
        )
        .expect_err("escaping selected path should fail");

        assert!(matches!(
            error,
            SkillsReconcileError::SelectedSkillPathInvalid(_)
        ));
        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(remote_root).expect("remote should be removable");
    }

    #[test]
    fn rejects_reconcile_selected_paths_without_skill_file() {
        let (repo_root, remote_root) =
            create_git_repo_with_origin("skills_reconcile_missing_skill_file");
        fs::create_dir_all(repo_root.join("not-a-skill")).expect("directory should be created");

        let error = reconcile_skills(
            &repo_root,
            &SkillsRuntime::Codex,
            &["not-a-skill".to_string()],
            None,
        )
        .expect_err("directory without SKILL.md should fail");

        assert!(matches!(
            error,
            SkillsReconcileError::SelectedSkillMissingSkillFile { .. }
        ));
        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(remote_root).expect("remote should be removable");
    }

    #[test]
    fn rejects_reconcile_duplicate_selected_skill_names() {
        let (repo_root, remote_root) =
            create_git_repo_with_origin("skills_reconcile_duplicate_names");
        write_skill(
            &repo_root,
            "one",
            r#"---
name: duplicate-skill
description: First.
---
"#,
        );
        write_skill(
            &repo_root,
            "two",
            r#"---
name: duplicate-skill
description: Second.
---
"#,
        );

        let error = reconcile_skills(
            &repo_root,
            &SkillsRuntime::Codex,
            &["one".to_string(), "two".to_string()],
            None,
        )
        .expect_err("duplicate names should fail");

        assert!(matches!(
            error,
            SkillsReconcileError::DuplicateSelectedSkillName { .. }
        ));
        fs::remove_dir_all(repo_root).expect("repo should be removable");
        fs::remove_dir_all(remote_root).expect("remote should be removable");
    }

    #[test]
    fn rejects_invalid_skill_names() {
        let repo_root = create_git_repo("skills_discover_invalid_name");
        write_skill(
            &repo_root,
            ".agents/skills/bad-name",
            r#"---
name: Bad_Name
description: Invalid name.
---
"#,
        );
        commit_all(&repo_root);

        let error = discover_skills(&repo_root).expect_err("invalid name should fail");

        assert!(matches!(
            error,
            SkillsDiscoverError::InvalidSkillName { .. }
        ));
        fs::remove_dir_all(repo_root).expect("repo should be removable");
    }

    #[test]
    fn parses_skills_discover_command() {
        let command = parse_skills_command(["discover", "--repo", "/root/org/repo"]);

        let Ok(SkillsCommand::Discover { repo_root }) = command else {
            panic!("skills discover command should parse");
        };
        assert_eq!(repo_root, PathBuf::from("/root/org/repo"));
    }

    #[test]
    fn parses_skills_reconcile_command() {
        let command = parse_skills_command([
            "reconcile",
            "--repo",
            "/root/org/repo",
            "--runtime",
            "codex",
            "--skill",
            ".agents/skills/one",
            "--skill",
            "nested/two",
            "--target-root",
            "/tmp/skills",
        ]);

        let Ok(SkillsCommand::Reconcile {
            repo_root,
            runtime,
            selected_relative_paths,
            target_root_override,
        }) = command
        else {
            panic!("skills reconcile command should parse");
        };
        assert_eq!(repo_root, PathBuf::from("/root/org/repo"));
        assert_eq!(runtime, SkillsRuntime::Codex);
        assert_eq!(
            selected_relative_paths,
            vec![".agents/skills/one".to_string(), "nested/two".to_string()]
        );
        assert_eq!(target_root_override, Some(PathBuf::from("/tmp/skills")));
    }

    #[test]
    fn rejects_skills_discover_without_repo() {
        assert!(matches!(
            parse_skills_command(["discover"]),
            Err(SkillsCommandError::MissingRepo)
        ));
    }

    #[test]
    fn parses_skills_reconcile_with_empty_selection() {
        let command = parse_skills_command([
            "reconcile",
            "--repo",
            "/root/org/repo",
            "--runtime",
            "codex",
        ]);

        let Ok(SkillsCommand::Reconcile {
            selected_relative_paths,
            ..
        }) = command
        else {
            panic!("skills reconcile command should parse without selected skills");
        };
        assert_eq!(selected_relative_paths, Vec::<String>::new());
    }

    fn write_skill(repo_root: &Path, relative_directory: &str, content: &str) {
        let skill_directory = repo_root.join(relative_directory);
        fs::create_dir_all(&skill_directory).expect("skill directory should be created");
        fs::write(skill_directory.join("SKILL.md"), content).expect("skill file should be written");
    }

    fn create_git_repo(prefix: &str) -> PathBuf {
        let repo_root = create_temp_test_dir(prefix);
        run_git(&repo_root, ["init"]);
        run_git(&repo_root, ["config", "user.name", "Mistle Test"]);
        run_git(
            &repo_root,
            ["config", "user.email", "mistle-test@example.com"],
        );
        repo_root
    }

    fn create_git_repo_with_origin(prefix: &str) -> (PathBuf, PathBuf) {
        let repo_root = create_git_repo(prefix);
        let remote_root = create_temp_test_dir(&format!("{prefix}_remote"));
        fs::remove_dir_all(&remote_root).expect("remote placeholder should be removable");
        run_git_command(["init", "--bare"], Some(&remote_root));
        fs::write(repo_root.join(".gitkeep"), "").expect("initial file should be written");
        commit_all(&repo_root);
        let remote_root_arg = remote_root
            .to_str()
            .expect("remote path should be utf-8")
            .to_string();
        run_git_dynamic(
            &repo_root,
            vec![
                "remote".to_string(),
                "add".to_string(),
                "origin".to_string(),
                remote_root_arg,
            ],
        );
        run_git(&repo_root, ["push", "-u", "origin", "HEAD"]);
        (repo_root, remote_root)
    }

    fn clone_repo(remote_root: &Path, clone_root: &Path) {
        let output = Command::new("git")
            .args(["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"])
            .arg("clone")
            .arg(remote_root)
            .arg(clone_root)
            .output()
            .expect("git should run");
        assert!(
            output.status.success(),
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn commit_all(repo_root: &Path) {
        run_git(repo_root, ["add", "."]);
        run_git(repo_root, ["commit", "-m", "Add skills"]);
    }

    fn run_git<const N: usize>(repo_root: &Path, args: [&str; N]) {
        let output = Command::new("git")
            .args(["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"])
            .arg("-C")
            .arg(repo_root)
            .args(args)
            .output()
            .expect("git should run");
        assert!(
            output.status.success(),
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn run_git_dynamic(repo_root: &Path, args: Vec<String>) {
        let output = Command::new("git")
            .args(["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"])
            .arg("-C")
            .arg(repo_root)
            .args(args)
            .output()
            .expect("git should run");
        assert!(
            output.status.success(),
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn run_git_command<const N: usize, P>(args: [&str; N], path_argument: Option<P>)
    where
        P: AsRef<Path>,
    {
        let mut command = Command::new("git");
        command.args(["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"]);
        command.args(args);
        if let Some(path_argument) = path_argument {
            command.arg(path_argument.as_ref());
        }
        let output = command.output().expect("git should run");
        assert!(
            output.status.success(),
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_stdout<const N: usize>(repo_root: &Path, args: [&str; N]) -> String {
        let output = Command::new("git")
            .args(["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"])
            .arg("-C")
            .arg(repo_root)
            .args(args)
            .output()
            .expect("git should run");
        assert!(
            output.status.success(),
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout)
            .expect("git stdout should be utf8")
            .trim()
            .to_string()
    }

    fn create_temp_test_dir(prefix: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "sandboxd_{prefix}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        fs::create_dir_all(&path).expect("temp test dir should be created");
        path.canonicalize()
            .expect("temp test dir should canonicalize")
    }
}
