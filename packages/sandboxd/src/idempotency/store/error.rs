use std::fmt;
use std::path::PathBuf;

use crate::idempotency::{AgentRuntimeId, IdempotencyOperation, IdempotencyRecordError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdempotencyStoreError {
    CreateDirectory {
        path: PathBuf,
        error: String,
    },
    StoreRootIsNotDirectory {
        path: PathBuf,
    },
    ReadDirectory {
        path: PathBuf,
        error: String,
    },
    ReadDirectoryEntry {
        path: PathBuf,
        error: String,
    },
    UnexpectedDirectoryEntry {
        path: PathBuf,
    },
    ReadRecord {
        path: PathBuf,
        error: String,
    },
    DecodeRecord {
        path: PathBuf,
        error: String,
    },
    RecordPathMismatch {
        path: PathBuf,
        expected_path: PathBuf,
    },
    UnsupportedRecordVersion {
        path: PathBuf,
        version: u8,
        supported_version: u8,
    },
    DuplicateRecord {
        runtime_id: AgentRuntimeId,
        operation: IdempotencyOperation,
        key: String,
    },
    MissingRecord {
        runtime_id: AgentRuntimeId,
        operation: IdempotencyOperation,
        key: String,
    },
    EncodeRecord {
        key: String,
        error: String,
    },
    CreateTempRecord {
        path: PathBuf,
        error: String,
    },
    WriteTempRecord {
        path: PathBuf,
        error: String,
    },
    SyncTempRecord {
        path: PathBuf,
        error: String,
    },
    RenameTempRecord {
        temp_path: PathBuf,
        final_path: PathBuf,
        error: String,
    },
    DeleteRecord {
        path: PathBuf,
        error: String,
    },
    RemoveTempRecord {
        path: PathBuf,
        error: String,
    },
    SyncDirectory {
        path: PathBuf,
        error: String,
    },
    Record(IdempotencyRecordError),
    LockPoisoned {
        error: String,
    },
}

impl fmt::Display for IdempotencyStoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CreateDirectory { path, error } => {
                write!(
                    f,
                    "failed to create idempotency store directory '{}': {error}",
                    path.display()
                )
            }
            Self::StoreRootIsNotDirectory { path } => {
                write!(
                    f,
                    "idempotency store root '{}' is not a directory",
                    path.display()
                )
            }
            Self::ReadDirectory { path, error } => {
                write!(
                    f,
                    "failed to read idempotency store directory '{}': {error}",
                    path.display()
                )
            }
            Self::ReadDirectoryEntry { path, error } => {
                write!(
                    f,
                    "failed to read idempotency store directory entry '{}': {error}",
                    path.display()
                )
            }
            Self::UnexpectedDirectoryEntry { path } => {
                write!(
                    f,
                    "unexpected idempotency store directory entry '{}'",
                    path.display()
                )
            }
            Self::ReadRecord { path, error } => {
                write!(
                    f,
                    "failed to read idempotency record '{}': {error}",
                    path.display()
                )
            }
            Self::DecodeRecord { path, error } => {
                write!(
                    f,
                    "failed to decode idempotency record '{}': {error}",
                    path.display()
                )
            }
            Self::RecordPathMismatch {
                path,
                expected_path,
            } => {
                write!(
                    f,
                    "idempotency record '{}' belongs at '{}'",
                    path.display(),
                    expected_path.display()
                )
            }
            Self::UnsupportedRecordVersion {
                path,
                version,
                supported_version,
            } => {
                write!(
                    f,
                    "unsupported idempotency record version {version} in '{}' (supported version: {supported_version})",
                    path.display()
                )
            }
            Self::DuplicateRecord {
                runtime_id,
                operation,
                key,
            } => {
                write!(
                    f,
                    "duplicate idempotency record for runtime {runtime_id:?}, operation {operation:?}, and key '{key}'"
                )
            }
            Self::MissingRecord {
                runtime_id,
                operation,
                key,
            } => {
                write!(
                    f,
                    "missing idempotency record for runtime {runtime_id:?}, operation {operation:?}, and key '{key}'"
                )
            }
            Self::EncodeRecord { key, error } => {
                write!(
                    f,
                    "failed to encode idempotency record for key '{key}': {error}"
                )
            }
            Self::CreateTempRecord { path, error } => {
                write!(
                    f,
                    "failed to create temporary idempotency record '{}': {error}",
                    path.display()
                )
            }
            Self::WriteTempRecord { path, error } => {
                write!(
                    f,
                    "failed to write temporary idempotency record '{}': {error}",
                    path.display()
                )
            }
            Self::SyncTempRecord { path, error } => {
                write!(
                    f,
                    "failed to sync temporary idempotency record '{}': {error}",
                    path.display()
                )
            }
            Self::RenameTempRecord {
                temp_path,
                final_path,
                error,
            } => {
                write!(
                    f,
                    "failed to rename temporary idempotency record '{}' to '{}': {error}",
                    temp_path.display(),
                    final_path.display()
                )
            }
            Self::DeleteRecord { path, error } => {
                write!(
                    f,
                    "failed to delete idempotency record '{}': {error}",
                    path.display()
                )
            }
            Self::RemoveTempRecord { path, error } => {
                write!(
                    f,
                    "failed to remove temporary idempotency record '{}': {error}",
                    path.display()
                )
            }
            Self::SyncDirectory { path, error } => {
                write!(
                    f,
                    "failed to sync idempotency store directory '{}': {error}",
                    path.display()
                )
            }
            Self::Record(error) => write!(f, "{error}"),
            Self::LockPoisoned { error } => {
                write!(f, "idempotency store lock is poisoned: {error}")
            }
        }
    }
}

impl std::error::Error for IdempotencyStoreError {}
