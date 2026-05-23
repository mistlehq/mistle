use std::fs::{self, DirBuilder, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use sha2::{Digest, Sha256};

use crate::idempotency::{AgentRuntimeId, IdempotencyOperation, IdempotencyRecord};

use super::IdempotencyStoreError;

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(super) fn prepare_store_directory(path: &Path) -> Result<(), IdempotencyStoreError> {
    DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .map_err(|error| IdempotencyStoreError::CreateDirectory {
            path: path.to_path_buf(),
            error: error.to_string(),
        })?;
    let metadata = fs::metadata(path).map_err(|error| IdempotencyStoreError::ReadDirectory {
        path: path.to_path_buf(),
        error: error.to_string(),
    })?;
    if !metadata.is_dir() {
        return Err(IdempotencyStoreError::StoreRootIsNotDirectory {
            path: path.to_path_buf(),
        });
    }
    Ok(())
}

pub(super) fn remove_temp_record(root: &Path, path: &Path) -> Result<(), IdempotencyStoreError> {
    fs::remove_file(path).map_err(|error| IdempotencyStoreError::RemoveTempRecord {
        path: path.to_path_buf(),
        error: error.to_string(),
    })?;
    sync_directory(root)
}

pub(super) fn delete_record(root: &Path, path: &Path) -> Result<(), IdempotencyStoreError> {
    fs::remove_file(path).map_err(|error| IdempotencyStoreError::DeleteRecord {
        path: path.to_path_buf(),
        error: error.to_string(),
    })?;
    sync_directory(root)
}

pub(super) fn write_record_atomically(
    root: &Path,
    final_path: &Path,
    record: &IdempotencyRecord,
) -> Result<(), IdempotencyStoreError> {
    prepare_store_directory(root)?;
    let contents =
        serde_json::to_vec_pretty(record).map_err(|error| IdempotencyStoreError::EncodeRecord {
            key: record.key.clone(),
            error: error.to_string(),
        })?;
    let temp_path = temporary_record_path(root, &record.runtime_id, &record.operation, &record.key);
    write_temp_record(&temp_path, &contents)
        .and_then(|()| rename_temp_record(&temp_path, final_path))
        .and_then(|()| sync_directory(root))
}

pub(super) fn is_store_temp_record_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|file_name| file_name.to_str())
        .is_some_and(is_store_temp_record_file_name)
}

pub(super) fn record_file_name(
    runtime_id: &AgentRuntimeId,
    operation: &IdempotencyOperation,
    key: &str,
) -> String {
    format!("{}.json", record_file_stem(runtime_id, operation, key))
}

fn write_temp_record(path: &Path, contents: &[u8]) -> Result<(), IdempotencyStoreError> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| IdempotencyStoreError::CreateTempRecord {
            path: path.to_path_buf(),
            error: error.to_string(),
        })?;
    file.write_all(contents)
        .map_err(|error| IdempotencyStoreError::WriteTempRecord {
            path: path.to_path_buf(),
            error: error.to_string(),
        })?;
    file.sync_all()
        .map_err(|error| IdempotencyStoreError::SyncTempRecord {
            path: path.to_path_buf(),
            error: error.to_string(),
        })
}

fn rename_temp_record(temp_path: &Path, final_path: &Path) -> Result<(), IdempotencyStoreError> {
    fs::rename(temp_path, final_path).map_err(|error| IdempotencyStoreError::RenameTempRecord {
        temp_path: temp_path.to_path_buf(),
        final_path: final_path.to_path_buf(),
        error: error.to_string(),
    })
}

fn sync_directory(path: &Path) -> Result<(), IdempotencyStoreError> {
    File::open(path)
        .map_err(|error| IdempotencyStoreError::SyncDirectory {
            path: path.to_path_buf(),
            error: error.to_string(),
        })?
        .sync_all()
        .map_err(|error| IdempotencyStoreError::SyncDirectory {
            path: path.to_path_buf(),
            error: error.to_string(),
        })
}

fn temporary_record_path(
    root: &Path,
    runtime_id: &AgentRuntimeId,
    operation: &IdempotencyOperation,
    key: &str,
) -> PathBuf {
    let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    root.join(format!(
        ".{}.{}.tmp",
        record_file_stem(runtime_id, operation, key),
        counter
    ))
}

fn is_store_temp_record_file_name(file_name: &str) -> bool {
    let Some(without_dot) = file_name.strip_prefix('.') else {
        return false;
    };
    let Some(without_suffix) = without_dot.strip_suffix(".tmp") else {
        return false;
    };
    let Some((record_stem, counter)) = without_suffix.rsplit_once('.') else {
        return false;
    };

    !counter.is_empty()
        && counter.chars().all(|character| character.is_ascii_digit())
        && is_record_file_stem(record_stem)
}

fn is_record_file_stem(stem: &str) -> bool {
    let Some((runtime, rest)) = stem.split_once('-') else {
        return false;
    };
    matches!(runtime, "codex" | "opencode" | "pi")
        && rest
            .strip_prefix("create-conversation-")
            .or_else(|| rest.strip_prefix("submit-payload-"))
            .is_some_and(is_lower_hex_sha256)
}

fn is_lower_hex_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .chars()
            .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase())
}

fn record_file_stem(
    runtime_id: &AgentRuntimeId,
    operation: &IdempotencyOperation,
    key: &str,
) -> String {
    format!(
        "{}-{}-{}",
        runtime_file_prefix(runtime_id),
        operation_file_prefix(operation),
        hex_lower(&Sha256::digest(key.as_bytes()))
    )
}

fn runtime_file_prefix(runtime_id: &AgentRuntimeId) -> &'static str {
    match runtime_id {
        AgentRuntimeId::Codex => "codex",
        AgentRuntimeId::OpenCode => "opencode",
        AgentRuntimeId::Pi => "pi",
    }
}

fn operation_file_prefix(operation: &IdempotencyOperation) -> &'static str {
    match operation {
        IdempotencyOperation::CreateConversation => "create-conversation",
        IdempotencyOperation::SubmitPayload => "submit-payload",
    }
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";

    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let high = usize::from(byte >> 4);
        let low = usize::from(byte & 0x0f);
        output.push(char::from(HEX[high]));
        output.push(char::from(HEX[low]));
    }
    output
}
