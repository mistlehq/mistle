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

use serde::Serialize;
use yaml_rust2::{Yaml, YamlLoader};

const SKILL_FILE_NAME: &str = "SKILL.md";

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
                    "duplicate skill name '{}' discovered at '{}' and '{}'",
                    name, first_path, second_path
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
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillsCommand {
    Discover { repo_root: PathBuf },
}

#[derive(Debug)]
pub enum SkillsCommandError {
    MissingSubcommand,
    UnknownSubcommand(String),
    MissingRepo,
    UnexpectedArgument(String),
    Discover(SkillsDiscoverError),
}

impl fmt::Display for SkillsCommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingSubcommand => {
                write!(
                    f,
                    "sandboxd skills requires a subcommand (expected 'discover')"
                )
            }
            Self::UnknownSubcommand(subcommand) => {
                write!(
                    f,
                    "unknown sandboxd skills subcommand '{subcommand}' (expected 'discover')"
                )
            }
            Self::MissingRepo => write!(f, "sandboxd skills discover requires --repo <path>"),
            Self::UnexpectedArgument(argument) => {
                write!(f, "unexpected sandboxd skills argument: {argument}")
            }
            Self::Discover(error) => write!(f, "{error}"),
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use serde_json::Value;

    use super::{
        DiscoveredSkill, SkillsCommand, SkillsCommandError, SkillsDiscoverError, discover_skills,
        parse_skills_command,
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
    fn rejects_skills_discover_without_repo() {
        assert!(matches!(
            parse_skills_command(["discover"]),
            Err(SkillsCommandError::MissingRepo)
        ));
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
        path
    }
}
