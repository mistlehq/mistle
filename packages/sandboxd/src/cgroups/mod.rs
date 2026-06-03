//! Linux cgroup filesystem helpers for `sandboxd`.
//!
//! This module owns the low-level cgroup layout and file operations behind user
//! process scopes: create the per-sandbox directory tree, allocate one
//! `/user/<scope-id>` directory per PTY session, attach the PTY child pid via
//! `cgroup.procs`, observe liveness from `cgroup.events`, and request scope
//! teardown with `cgroup.kill`.

use std::fmt::{self, Display};
use std::fs;
use std::path::{Path, PathBuf};

const LINUX_ESRCH: i32 = 3;

/// Default root for sandboxd-owned cgroup directories.
pub const DEFAULT_CGROUP_ROOT: &str = "/sys/fs/cgroup/mistle";

/// Carries the important directories for one sandbox's cgroup tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxCgroupPaths {
    pub sandbox_root: PathBuf,
    pub platform_root: PathBuf,
    pub user_root: PathBuf,
}

/// Carries the directory and control files for one user scope cgroup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserScopePaths {
    pub scope_root: PathBuf,
    pub procs_file: PathBuf,
    pub events_file: PathBuf,
    pub kill_file: PathBuf,
}

/// Describes why one cgroup filesystem step failed.
#[derive(Debug)]
pub enum CgroupError {
    InvalidSandboxInstanceId,
    InvalidScopeId,
    CreateDirectory {
        path: PathBuf,
        error: std::io::Error,
    },
    WriteFile {
        path: PathBuf,
        error: std::io::Error,
    },
    ReadFile {
        path: PathBuf,
        error: std::io::Error,
    },
    MissingPopulatedField {
        path: PathBuf,
    },
    InvalidPopulatedValue {
        path: PathBuf,
        value: String,
    },
}

impl Display for CgroupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSandboxInstanceId => {
                write!(f, "sandbox instance id must be a non-empty path segment")
            }
            Self::InvalidScopeId => write!(f, "scope id must be a non-empty path segment"),
            Self::CreateDirectory { path, error } => {
                write!(
                    f,
                    "failed to create cgroup directory {}: {error}",
                    path.display()
                )
            }
            Self::WriteFile { path, error } => {
                write!(f, "failed to write cgroup file {}: {error}", path.display())
            }
            Self::ReadFile { path, error } => {
                write!(f, "failed to read cgroup file {}: {error}", path.display())
            }
            Self::MissingPopulatedField { path } => {
                write!(
                    f,
                    "cgroup.events at {} is missing populated",
                    path.display()
                )
            }
            Self::InvalidPopulatedValue { path, value } => {
                write!(
                    f,
                    "cgroup.events at {} has invalid populated value '{value}'",
                    path.display()
                )
            }
        }
    }
}

impl std::error::Error for CgroupError {}

impl CgroupError {
    /// Returns true when Linux rejected a `cgroup.procs` write because the pid
    /// no longer exists. This can happen when a PTY child exits between spawn
    /// and cgroup attachment.
    pub fn is_missing_process(&self) -> bool {
        matches!(
            self,
            Self::WriteFile { error, .. } if error.raw_os_error() == Some(LINUX_ESRCH)
        )
    }
}

/// Ensures the per-sandbox cgroup tree exists under `<root>/<sandbox-instance-id>`.
pub fn ensure_sandbox_cgroup_tree(
    cgroup_root: &Path,
    sandbox_instance_id: &str,
) -> Result<SandboxCgroupPaths, CgroupError> {
    validate_segment(sandbox_instance_id, CgroupError::InvalidSandboxInstanceId)?;

    let sandbox_root = cgroup_root.join(sandbox_instance_id);
    let platform_root = sandbox_root.join("platform");
    let user_root = sandbox_root.join("user");

    fs::create_dir_all(&platform_root).map_err(|error| CgroupError::CreateDirectory {
        path: platform_root.clone(),
        error,
    })?;
    fs::create_dir_all(&user_root).map_err(|error| CgroupError::CreateDirectory {
        path: user_root.clone(),
        error,
    })?;

    Ok(SandboxCgroupPaths {
        sandbox_root,
        platform_root,
        user_root,
    })
}

/// Creates one `/user/<scope-id>` directory and returns its control-file paths.
pub fn create_user_scope(
    cgroup_root: &Path,
    sandbox_instance_id: &str,
    scope_id: &str,
) -> Result<UserScopePaths, CgroupError> {
    validate_segment(scope_id, CgroupError::InvalidScopeId)?;
    let sandbox_paths = ensure_sandbox_cgroup_tree(cgroup_root, sandbox_instance_id)?;
    let scope_root = sandbox_paths.user_root.join(scope_id);

    fs::create_dir_all(&scope_root).map_err(|error| CgroupError::CreateDirectory {
        path: scope_root.clone(),
        error,
    })?;

    Ok(UserScopePaths {
        procs_file: scope_root.join("cgroup.procs"),
        events_file: scope_root.join("cgroup.events"),
        kill_file: scope_root.join("cgroup.kill"),
        scope_root,
    })
}

/// Requests kernel teardown for every user process scope under one sandbox tree.
pub fn kill_sandbox_user_scopes(
    cgroup_root: &Path,
    sandbox_instance_id: &str,
) -> Result<(), CgroupError> {
    validate_segment(sandbox_instance_id, CgroupError::InvalidSandboxInstanceId)?;
    let user_root = cgroup_root.join(sandbox_instance_id).join("user");
    let entries = match fs::read_dir(&user_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(CgroupError::ReadFile {
                path: user_root,
                error,
            });
        }
    };

    for entry_result in entries {
        let entry = entry_result.map_err(|error| CgroupError::ReadFile {
            path: user_root.clone(),
            error,
        })?;
        let entry_type = entry.file_type().map_err(|error| CgroupError::ReadFile {
            path: entry.path(),
            error,
        })?;
        if !entry_type.is_dir() {
            continue;
        }

        let scope_root = entry.path();
        kill_scope(&UserScopePaths {
            procs_file: scope_root.join("cgroup.procs"),
            events_file: scope_root.join("cgroup.events"),
            kill_file: scope_root.join("cgroup.kill"),
            scope_root,
        })?;
    }

    Ok(())
}

/// Attaches one pid to a user scope by writing it to `cgroup.procs`.
pub fn attach_pid_to_scope(scope_paths: &UserScopePaths, pid: u32) -> Result<(), CgroupError> {
    fs::write(&scope_paths.procs_file, format!("{pid}\n")).map_err(|error| CgroupError::WriteFile {
        path: scope_paths.procs_file.clone(),
        error,
    })
}

/// Returns whether `cgroup.events` currently reports `populated 1`.
pub fn is_scope_populated(scope_paths: &UserScopePaths) -> Result<bool, CgroupError> {
    let events =
        fs::read_to_string(&scope_paths.events_file).map_err(|error| CgroupError::ReadFile {
            path: scope_paths.events_file.clone(),
            error,
        })?;

    for line in events.lines() {
        let Some((key, value)) = line.split_once(' ') else {
            continue;
        };
        if key != "populated" {
            continue;
        }

        return match value.trim() {
            "0" => Ok(false),
            "1" => Ok(true),
            invalid_value => Err(CgroupError::InvalidPopulatedValue {
                path: scope_paths.events_file.clone(),
                value: invalid_value.to_string(),
            }),
        };
    }

    Err(CgroupError::MissingPopulatedField {
        path: scope_paths.events_file.clone(),
    })
}

/// Requests that the kernel kill every process still attached to the scope.
pub fn kill_scope(scope_paths: &UserScopePaths) -> Result<(), CgroupError> {
    fs::write(&scope_paths.kill_file, "1\n").map_err(|error| CgroupError::WriteFile {
        path: scope_paths.kill_file.clone(),
        error,
    })
}

fn validate_segment(value: &str, error: CgroupError) -> Result<(), CgroupError> {
    if value.trim().is_empty()
        || value.contains(std::path::MAIN_SEPARATOR)
        || value.contains('/')
        || value == "."
        || value == ".."
    {
        return Err(error);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::cgroups::{
        CgroupError, attach_pid_to_scope, create_user_scope, ensure_sandbox_cgroup_tree,
        is_scope_populated, kill_sandbox_user_scopes, kill_scope,
    };

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn creates_sandbox_tree_and_user_scope_paths() {
        let temp_root = create_temp_test_dir("cgroups_tree");
        let sandbox_paths = ensure_sandbox_cgroup_tree(&temp_root, "sbi_123")
            .expect("sandbox tree should be created");
        let scope_paths =
            create_user_scope(&temp_root, "sbi_123", "scope_123").expect("scope should exist");

        assert!(sandbox_paths.platform_root.is_dir());
        assert!(sandbox_paths.user_root.is_dir());
        assert!(scope_paths.scope_root.is_dir());

        fs::remove_dir_all(temp_root).expect("temp dir should be removable");
    }

    #[test]
    fn writes_pid_and_kill_requests_into_scope_files() {
        let temp_root = create_temp_test_dir("cgroups_files");
        let scope_paths =
            create_user_scope(&temp_root, "sbi_123", "scope_123").expect("scope should exist");

        attach_pid_to_scope(&scope_paths, 4242).expect("pid attach should succeed");
        kill_scope(&scope_paths).expect("scope kill should succeed");

        assert_eq!(
            fs::read_to_string(&scope_paths.procs_file).expect("cgroup.procs should exist"),
            "4242\n"
        );
        assert_eq!(
            fs::read_to_string(&scope_paths.kill_file).expect("cgroup.kill should exist"),
            "1\n"
        );

        fs::remove_dir_all(temp_root).expect("temp dir should be removable");
    }

    #[test]
    fn kills_every_user_scope_for_a_sandbox() {
        let temp_root = create_temp_test_dir("cgroups_kill_sandbox_user");
        let first_scope =
            create_user_scope(&temp_root, "sbi_123", "scope_1").expect("first scope should exist");
        let second_scope =
            create_user_scope(&temp_root, "sbi_123", "scope_2").expect("second scope should exist");
        let other_scope = create_user_scope(&temp_root, "sbi_other", "scope_3")
            .expect("other scope should exist");
        fs::write(&other_scope.kill_file, "").expect("other kill file should be writable");

        kill_sandbox_user_scopes(&temp_root, "sbi_123").expect("sandbox scopes should be killed");

        assert_eq!(
            fs::read_to_string(&first_scope.kill_file).expect("first kill file should exist"),
            "1\n"
        );
        assert_eq!(
            fs::read_to_string(&second_scope.kill_file).expect("second kill file should exist"),
            "1\n"
        );
        assert_eq!(
            fs::read_to_string(&other_scope.kill_file).expect("other kill file should exist"),
            ""
        );

        fs::remove_dir_all(temp_root).expect("temp dir should be removable");
    }

    #[test]
    fn killing_user_scopes_is_idempotent_when_sandbox_tree_is_missing() {
        let temp_root = create_temp_test_dir("cgroups_kill_missing_sandbox_user");

        kill_sandbox_user_scopes(&temp_root, "sbi_missing")
            .expect("missing sandbox scopes should be treated as already clean");

        fs::remove_dir_all(temp_root).expect("temp dir should be removable");
    }

    #[test]
    fn detects_missing_process_cgroup_write_errors() {
        let error = CgroupError::WriteFile {
            path: PathBuf::from("/sys/fs/cgroup/mistle/sbi_123/user/scope_123/cgroup.procs"),
            error: std::io::Error::from_raw_os_error(3),
        };

        assert!(error.is_missing_process());
    }

    #[test]
    fn parses_populated_flag_from_cgroup_events() {
        let temp_root = create_temp_test_dir("cgroups_events");
        let scope_paths =
            create_user_scope(&temp_root, "sbi_123", "scope_123").expect("scope should exist");

        fs::write(&scope_paths.events_file, "populated 1\nfrozen 0\n")
            .expect("events file should be writable");
        assert!(is_scope_populated(&scope_paths).expect("events should parse"));

        fs::write(&scope_paths.events_file, "populated 0\n")
            .expect("events file should be writable");
        assert!(!is_scope_populated(&scope_paths).expect("events should parse"));

        fs::remove_dir_all(temp_root).expect("temp dir should be removable");
    }

    #[test]
    fn rejects_invalid_events_payloads() {
        let temp_root = create_temp_test_dir("cgroups_invalid_events");
        let scope_paths =
            create_user_scope(&temp_root, "sbi_123", "scope_123").expect("scope should exist");

        fs::write(&scope_paths.events_file, "populated 2\n")
            .expect("events file should be writable");
        let invalid_value =
            is_scope_populated(&scope_paths).expect_err("invalid populated values should fail");
        assert!(matches!(
            invalid_value,
            CgroupError::InvalidPopulatedValue { .. }
        ));

        fs::write(&scope_paths.events_file, "frozen 0\n").expect("events file should be writable");
        let missing_field =
            is_scope_populated(&scope_paths).expect_err("missing populated should fail");
        assert!(matches!(
            missing_field,
            CgroupError::MissingPopulatedField { .. }
        ));

        fs::remove_dir_all(temp_root).expect("temp dir should be removable");
    }

    fn create_temp_test_dir(prefix: &str) -> PathBuf {
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
