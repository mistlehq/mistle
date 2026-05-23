use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

mod error;
mod files;

pub use error::IdempotencyStoreError;

use crate::idempotency::{
    AcceptIdempotencyOperation, CURRENT_IDEMPOTENCY_RECORD_VERSION, CompleteIdempotencyOperation,
    IdempotencyOperation, IdempotencyRecord, StartIdempotencyOperation,
};

use files::{
    is_store_temp_record_path, prepare_store_directory, record_file_name, remove_temp_record,
    write_record_atomically,
};

pub const DEFAULT_IDEMPOTENCY_STORE_DIR: &str = "/var/lib/mistle/sandboxd/idempotency";

#[derive(Debug, Clone)]
pub struct IdempotencyStore {
    root: PathBuf,
    records: BTreeMap<IdempotencyStoreKey, IdempotencyRecord>,
}

impl IdempotencyStore {
    pub fn load_default() -> Result<Self, IdempotencyStoreError> {
        Self::load_all(Path::new(DEFAULT_IDEMPOTENCY_STORE_DIR))
    }

    pub fn load_all(root: impl AsRef<Path>) -> Result<Self, IdempotencyStoreError> {
        let root = root.as_ref().to_path_buf();
        prepare_store_directory(&root)?;

        let mut records = BTreeMap::new();
        for entry in fs::read_dir(&root).map_err(|error| IdempotencyStoreError::ReadDirectory {
            path: root.clone(),
            error: error.to_string(),
        })? {
            let entry = entry.map_err(|error| IdempotencyStoreError::ReadDirectory {
                path: root.clone(),
                error: error.to_string(),
            })?;
            let path = entry.path();
            let file_type =
                entry
                    .file_type()
                    .map_err(|error| IdempotencyStoreError::ReadDirectoryEntry {
                        path: path.clone(),
                        error: error.to_string(),
                    })?;
            if !file_type.is_file() {
                return Err(IdempotencyStoreError::UnexpectedDirectoryEntry { path });
            }
            if is_store_temp_record_path(&path) {
                remove_temp_record(&root, &path)?;
                continue;
            }
            if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
                return Err(IdempotencyStoreError::UnexpectedDirectoryEntry { path });
            }

            let record = load_record(&path)?;
            validate_record_path(&root, &path, &record)?;

            let key = IdempotencyStoreKey::from_record(&record);
            if records.insert(key.clone(), record).is_some() {
                return Err(IdempotencyStoreError::DuplicateRecord {
                    operation: key.operation,
                    key: key.key,
                });
            }
        }

        Ok(Self { root, records })
    }

    pub fn start_operation(
        &mut self,
        input: StartIdempotencyOperation,
    ) -> Result<IdempotencyRecord, IdempotencyStoreError> {
        let key = IdempotencyStoreKey {
            operation: input.operation.clone(),
            key: input.key.clone(),
        };
        if let Some(existing) = self.records.get(&key) {
            existing
                .classify_repeated_request(&input.request_fingerprint)
                .map_err(IdempotencyStoreError::Record)?;
            return Ok(existing.clone());
        }

        let record = IdempotencyRecord::started(input);
        self.write_and_index_record(record)
    }

    pub fn mark_accepted(
        &mut self,
        operation: IdempotencyOperation,
        key: &str,
        input: AcceptIdempotencyOperation,
    ) -> Result<IdempotencyRecord, IdempotencyStoreError> {
        let existing = self.get_existing_record(operation, key)?;
        let record = existing
            .mark_accepted(input)
            .map_err(IdempotencyStoreError::Record)?;
        self.write_and_index_record(record)
    }

    pub fn mark_completed(
        &mut self,
        operation: IdempotencyOperation,
        key: &str,
        input: CompleteIdempotencyOperation,
    ) -> Result<IdempotencyRecord, IdempotencyStoreError> {
        let existing = self.get_existing_record(operation, key)?;
        let record = existing
            .mark_completed(input)
            .map_err(IdempotencyStoreError::Record)?;
        self.write_and_index_record(record)
    }

    pub fn get_by_key(
        &self,
        operation: IdempotencyOperation,
        key: &str,
    ) -> Result<&IdempotencyRecord, IdempotencyStoreError> {
        let store_key = IdempotencyStoreKey {
            operation,
            key: key.to_string(),
        };
        self.records
            .get(&store_key)
            .ok_or(IdempotencyStoreError::MissingRecord {
                operation: store_key.operation,
                key: store_key.key,
            })
    }

    pub fn record_path(&self, operation: &IdempotencyOperation, key: &str) -> PathBuf {
        self.root.join(record_file_name(operation, key))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn get_existing_record(
        &self,
        operation: IdempotencyOperation,
        key: &str,
    ) -> Result<IdempotencyRecord, IdempotencyStoreError> {
        self.get_by_key(operation, key).cloned()
    }

    fn write_and_index_record(
        &mut self,
        record: IdempotencyRecord,
    ) -> Result<IdempotencyRecord, IdempotencyStoreError> {
        let path = self.record_path(&record.operation, &record.key);
        write_record_atomically(&self.root, &path, &record)?;
        self.records
            .insert(IdempotencyStoreKey::from_record(&record), record.clone());
        Ok(record)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct IdempotencyStoreKey {
    operation: IdempotencyOperation,
    key: String,
}

impl IdempotencyStoreKey {
    fn from_record(record: &IdempotencyRecord) -> Self {
        Self {
            operation: record.operation.clone(),
            key: record.key.clone(),
        }
    }
}

fn load_record(path: &Path) -> Result<IdempotencyRecord, IdempotencyStoreError> {
    let bytes = fs::read(path).map_err(|error| IdempotencyStoreError::ReadRecord {
        path: path.to_path_buf(),
        error: error.to_string(),
    })?;
    let record = serde_json::from_slice::<IdempotencyRecord>(&bytes).map_err(|error| {
        IdempotencyStoreError::DecodeRecord {
            path: path.to_path_buf(),
            error: error.to_string(),
        }
    })?;
    validate_record_version(path, &record)?;
    Ok(record)
}

fn validate_record_version(
    path: &Path,
    record: &IdempotencyRecord,
) -> Result<(), IdempotencyStoreError> {
    if record.version == CURRENT_IDEMPOTENCY_RECORD_VERSION {
        return Ok(());
    }

    Err(IdempotencyStoreError::UnsupportedRecordVersion {
        path: path.to_path_buf(),
        version: record.version,
        supported_version: CURRENT_IDEMPOTENCY_RECORD_VERSION,
    })
}

fn validate_record_path(
    root: &Path,
    path: &Path,
    record: &IdempotencyRecord,
) -> Result<(), IdempotencyStoreError> {
    let expected_path = root.join(record_file_name(&record.operation, &record.key));
    if path == expected_path {
        return Ok(());
    }

    Err(IdempotencyStoreError::RecordPathMismatch {
        path: path.to_path_buf(),
        expected_path,
    })
}
