//! Filesystem paths for startup diagnostics logs.
//!
//! Production writes to the fixed daemon log locations, while tests can set an
//! explicit directory override to keep diagnostics artifacts isolated.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use crate::startup_diagnostics::{StartupOperation, TEST_LOG_DIR_ENV};

pub(super) fn operation_log_path(operation: StartupOperation) -> PathBuf {
    if let Some(test_dir) = test_log_dir_override() {
        return test_dir.join(match operation {
            StartupOperation::Init => "init.log",
            StartupOperation::Resume => "resume.log",
            StartupOperation::Activation { .. } => "activate.log",
        });
    }

    PathBuf::from(operation.default_log_path())
}

pub(super) fn test_log_dir_override() -> Option<PathBuf> {
    test_log_dir_override_lock();
    std::env::var_os(TEST_LOG_DIR_ENV).map(PathBuf::from)
}

pub(super) fn test_log_dir_override_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}
