use std::collections::BTreeMap;
use std::fs;

use sandboxd::idempotency::store::{IdempotencyStore, IdempotencyStoreError};
use sandboxd::idempotency::{
    AcceptIdempotencyOperation, AgentRuntimeId, CompleteIdempotencyOperation, IdempotencyOperation,
    IdempotencyRecordError, IdempotencyRecordStatus, RequestFingerprint, StartIdempotencyOperation,
};
use serde_json::json;

#[test]
fn start_operation_persists_record_and_load_all_rehydrates_index() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let root = temp_dir.path().join("var/lib/mistle/sandboxd/idempotency");
    let mut store = IdempotencyStore::load_all(&root).expect("store should load");
    let fingerprint = submit_fingerprint("hello");

    let started = store
        .start_operation(StartIdempotencyOperation {
            key: "delivery_key".to_string(),
            runtime_id: AgentRuntimeId::Codex,
            operation: IdempotencyOperation::SubmitPayload,
            request_fingerprint: fingerprint.clone(),
            now: "2026-05-23T00:00:00Z".to_string(),
        })
        .expect("operation should start");

    assert_eq!(started.status, IdempotencyRecordStatus::Started);
    assert!(
        store
            .record_path(
                &AgentRuntimeId::Codex,
                &IdempotencyOperation::SubmitPayload,
                "delivery_key"
            )
            .exists(),
        "started record should be persisted"
    );

    let reloaded = IdempotencyStore::load_all(&root).expect("store should reload");
    let record = reloaded
        .get_by_key(
            AgentRuntimeId::Codex,
            IdempotencyOperation::SubmitPayload,
            "delivery_key",
        )
        .expect("record should exist after reload");

    assert_eq!(record.key, "delivery_key");
    assert_eq!(record.request_fingerprint, fingerprint);
    assert_eq!(record.status, IdempotencyRecordStatus::Started);
}

#[test]
fn repeated_start_with_same_fingerprint_returns_existing_record_without_overwrite() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let root = temp_dir.path().join("idempotency");
    let mut store = IdempotencyStore::load_all(&root).expect("store should load");
    let fingerprint = submit_fingerprint("hello");

    store
        .start_operation(StartIdempotencyOperation {
            key: "delivery_key".to_string(),
            runtime_id: AgentRuntimeId::Codex,
            operation: IdempotencyOperation::SubmitPayload,
            request_fingerprint: fingerprint.clone(),
            now: "2026-05-23T00:00:00Z".to_string(),
        })
        .expect("operation should start");
    let repeated = store
        .start_operation(StartIdempotencyOperation {
            key: "delivery_key".to_string(),
            runtime_id: AgentRuntimeId::Codex,
            operation: IdempotencyOperation::SubmitPayload,
            request_fingerprint: fingerprint,
            now: "2026-05-23T00:01:00Z".to_string(),
        })
        .expect("same request should return existing record");

    assert_eq!(repeated.created_at, "2026-05-23T00:00:00Z");
    assert_eq!(repeated.updated_at, "2026-05-23T00:00:00Z");
}

#[test]
fn repeated_start_with_different_fingerprint_fails_with_conflict() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let root = temp_dir.path().join("idempotency");
    let mut store = IdempotencyStore::load_all(&root).expect("store should load");

    store
        .start_operation(StartIdempotencyOperation {
            key: "delivery_key".to_string(),
            runtime_id: AgentRuntimeId::Codex,
            operation: IdempotencyOperation::SubmitPayload,
            request_fingerprint: submit_fingerprint("hello"),
            now: "2026-05-23T00:00:00Z".to_string(),
        })
        .expect("operation should start");

    let error = store
        .start_operation(StartIdempotencyOperation {
            key: "delivery_key".to_string(),
            runtime_id: AgentRuntimeId::Codex,
            operation: IdempotencyOperation::SubmitPayload,
            request_fingerprint: submit_fingerprint("different"),
            now: "2026-05-23T00:01:00Z".to_string(),
        })
        .expect_err("different fingerprint should conflict");

    assert!(matches!(
        error,
        IdempotencyStoreError::Record(IdempotencyRecordError::FingerprintConflict { .. })
    ));
}

#[test]
fn same_operation_and_key_are_scoped_by_runtime_id() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let root = temp_dir.path().join("idempotency");
    let mut store = IdempotencyStore::load_all(&root).expect("store should load");

    let codex_record = store
        .start_operation(StartIdempotencyOperation {
            key: "shared_key".to_string(),
            runtime_id: AgentRuntimeId::Codex,
            operation: IdempotencyOperation::SubmitPayload,
            request_fingerprint: submit_fingerprint("codex"),
            now: "2026-05-23T00:00:00Z".to_string(),
        })
        .expect("codex operation should start");
    let opencode_record = store
        .start_operation(StartIdempotencyOperation {
            key: "shared_key".to_string(),
            runtime_id: AgentRuntimeId::OpenCode,
            operation: IdempotencyOperation::SubmitPayload,
            request_fingerprint: opencode_submit_fingerprint("opencode"),
            now: "2026-05-23T00:00:01Z".to_string(),
        })
        .expect("opencode operation should start");

    assert_ne!(
        store.record_path(
            &AgentRuntimeId::Codex,
            &IdempotencyOperation::SubmitPayload,
            "shared_key"
        ),
        store.record_path(
            &AgentRuntimeId::OpenCode,
            &IdempotencyOperation::SubmitPayload,
            "shared_key"
        )
    );
    assert_eq!(codex_record.runtime_id, AgentRuntimeId::Codex);
    assert_eq!(opencode_record.runtime_id, AgentRuntimeId::OpenCode);
    assert_eq!(
        store
            .get_by_key(
                AgentRuntimeId::Codex,
                IdempotencyOperation::SubmitPayload,
                "shared_key"
            )
            .expect("codex record should exist")
            .request_fingerprint,
        submit_fingerprint("codex")
    );
    assert_eq!(
        store
            .get_by_key(
                AgentRuntimeId::OpenCode,
                IdempotencyOperation::SubmitPayload,
                "shared_key"
            )
            .expect("opencode record should exist")
            .request_fingerprint,
        opencode_submit_fingerprint("opencode")
    );
}

#[test]
fn delete_started_removes_only_matching_started_record() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let root = temp_dir.path().join("idempotency");
    let mut store = IdempotencyStore::load_all(&root).expect("store should load");
    let fingerprint = submit_fingerprint("hello");

    store
        .start_operation(StartIdempotencyOperation {
            key: "delivery_key".to_string(),
            runtime_id: AgentRuntimeId::Codex,
            operation: IdempotencyOperation::SubmitPayload,
            request_fingerprint: fingerprint.clone(),
            now: "2026-05-23T00:00:00Z".to_string(),
        })
        .expect("operation should start");
    store
        .delete_started(
            AgentRuntimeId::Codex,
            IdempotencyOperation::SubmitPayload,
            "delivery_key",
            &fingerprint,
        )
        .expect("started record should be deleted");

    assert!(
        store
            .get_by_key(
                AgentRuntimeId::Codex,
                IdempotencyOperation::SubmitPayload,
                "delivery_key"
            )
            .is_err(),
        "deleted started record should not remain indexed"
    );
    assert!(
        !store
            .record_path(
                &AgentRuntimeId::Codex,
                &IdempotencyOperation::SubmitPayload,
                "delivery_key"
            )
            .exists(),
        "deleted started record should be removed from disk"
    );
}

#[test]
fn accepted_and_completed_updates_are_persisted_across_reload() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let root = temp_dir.path().join("idempotency");
    let mut store = IdempotencyStore::load_all(&root).expect("store should load");
    let fingerprint = submit_fingerprint("hello");

    store
        .start_operation(StartIdempotencyOperation {
            key: "delivery_key".to_string(),
            runtime_id: AgentRuntimeId::Codex,
            operation: IdempotencyOperation::SubmitPayload,
            request_fingerprint: fingerprint.clone(),
            now: "2026-05-23T00:00:00Z".to_string(),
        })
        .expect("operation should start");
    store
        .mark_accepted(
            AgentRuntimeId::Codex,
            IdempotencyOperation::SubmitPayload,
            "delivery_key",
            AcceptIdempotencyOperation {
                request_fingerprint: fingerprint.clone(),
                provider_conversation_id: Some("thread_123".to_string()),
                provider_execution_id: Some("turn_123".to_string()),
                runtime_artifact_hint: Some(json!({ "rolloutPath": "/root/.codex/session.jsonl" })),
                now: "2026-05-23T00:00:01Z".to_string(),
            },
        )
        .expect("record should accept");
    store
        .mark_completed(
            AgentRuntimeId::Codex,
            IdempotencyOperation::SubmitPayload,
            "delivery_key",
            CompleteIdempotencyOperation {
                request_fingerprint: fingerprint,
                provider_conversation_id: Some("thread_123".to_string()),
                provider_execution_id: Some("turn_123".to_string()),
                runtime_artifact_hint: Some(json!({ "rolloutPath": "/root/.codex/session.jsonl" })),
                response: json!({ "accepted": true }),
                now: "2026-05-23T00:00:02Z".to_string(),
            },
        )
        .expect("record should complete");

    let reloaded = IdempotencyStore::load_all(&root).expect("store should reload");
    let record = reloaded
        .get_by_key(
            AgentRuntimeId::Codex,
            IdempotencyOperation::SubmitPayload,
            "delivery_key",
        )
        .expect("record should exist after reload");

    assert_eq!(record.status, IdempotencyRecordStatus::Completed);
    assert_eq!(
        record.provider_conversation_id,
        Some("thread_123".to_string())
    );
    assert_eq!(record.provider_execution_id, Some("turn_123".to_string()));
    assert_eq!(record.response, Some(json!({ "accepted": true })));
}

#[test]
fn mark_accepted_requires_existing_record() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let root = temp_dir.path().join("idempotency");
    let mut store = IdempotencyStore::load_all(&root).expect("store should load");

    let error = store
        .mark_accepted(
            AgentRuntimeId::Codex,
            IdempotencyOperation::SubmitPayload,
            "missing_key",
            AcceptIdempotencyOperation {
                request_fingerprint: submit_fingerprint("hello"),
                provider_conversation_id: None,
                provider_execution_id: None,
                runtime_artifact_hint: None,
                now: "2026-05-23T00:00:01Z".to_string(),
            },
        )
        .expect_err("accepted update should require existing record");

    assert_eq!(
        error,
        IdempotencyStoreError::MissingRecord {
            runtime_id: AgentRuntimeId::Codex,
            operation: IdempotencyOperation::SubmitPayload,
            key: "missing_key".to_string(),
        }
    );
}

#[test]
fn load_all_fails_on_corrupt_record_json() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let root = temp_dir.path().join("idempotency");
    fs::create_dir_all(&root).expect("store root should be created");
    fs::write(root.join("submit-payload-corrupt.json"), b"{")
        .expect("corrupt record should be written");

    let error = IdempotencyStore::load_all(&root).expect_err("corrupt record should fail load");

    assert!(matches!(error, IdempotencyStoreError::DecodeRecord { .. }));
}

#[test]
fn load_all_removes_interrupted_atomic_write_temp_files() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let root = temp_dir.path().join("idempotency");
    let mut store = IdempotencyStore::load_all(&root).expect("store should load");

    store
        .start_operation(StartIdempotencyOperation {
            key: "delivery_key".to_string(),
            runtime_id: AgentRuntimeId::Codex,
            operation: IdempotencyOperation::SubmitPayload,
            request_fingerprint: submit_fingerprint("hello"),
            now: "2026-05-23T00:00:00Z".to_string(),
        })
        .expect("operation should start");
    let record_path = store.record_path(
        &AgentRuntimeId::Codex,
        &IdempotencyOperation::SubmitPayload,
        "delivery_key",
    );
    let record_file_name = record_path
        .file_name()
        .and_then(|file_name| file_name.to_str())
        .expect("record path should expose utf-8 file name");
    let record_file_stem = record_file_name
        .strip_suffix(".json")
        .expect("record file should end in json");
    let temp_path = root.join(format!(".{record_file_stem}.99.tmp"));
    fs::write(&temp_path, b"partially written temp record").expect("temp record should be written");

    let reloaded = IdempotencyStore::load_all(&root).expect("store should ignore stale temp file");

    assert!(
        !temp_path.exists(),
        "stale store-owned temp file should be removed"
    );
    assert!(
        reloaded
            .get_by_key(
                AgentRuntimeId::Codex,
                IdempotencyOperation::SubmitPayload,
                "delivery_key"
            )
            .is_ok(),
        "valid record should still load"
    );
}

#[test]
fn load_all_still_fails_on_unexpected_non_json_files() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let root = temp_dir.path().join("idempotency");
    fs::create_dir_all(&root).expect("store root should be created");
    fs::write(root.join(".not-an-owned-temp-file.tmp"), b"unexpected")
        .expect("unexpected file should be written");

    let error = IdempotencyStore::load_all(&root).expect_err("unexpected file should fail load");

    assert!(matches!(
        error,
        IdempotencyStoreError::UnexpectedDirectoryEntry { .. }
    ));
}

#[test]
fn load_all_rejects_unsupported_record_versions() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let root = temp_dir.path().join("idempotency");
    let mut store = IdempotencyStore::load_all(&root).expect("store should load");

    store
        .start_operation(StartIdempotencyOperation {
            key: "delivery_key".to_string(),
            runtime_id: AgentRuntimeId::Codex,
            operation: IdempotencyOperation::SubmitPayload,
            request_fingerprint: submit_fingerprint("hello"),
            now: "2026-05-23T00:00:00Z".to_string(),
        })
        .expect("operation should start");
    let record_path = store.record_path(
        &AgentRuntimeId::Codex,
        &IdempotencyOperation::SubmitPayload,
        "delivery_key",
    );
    let mut record_json: serde_json::Value =
        serde_json::from_slice(&fs::read(&record_path).expect("record file should be readable"))
            .expect("record file should decode to json");
    record_json["version"] = json!(2);
    fs::write(
        &record_path,
        serde_json::to_vec_pretty(&record_json).expect("record json should encode"),
    )
    .expect("unsupported version record should be written");

    let error =
        IdempotencyStore::load_all(&root).expect_err("unsupported version should fail load");

    assert!(matches!(
        error,
        IdempotencyStoreError::UnsupportedRecordVersion { version: 2, .. }
    ));
}

#[test]
fn load_all_fails_when_record_is_stored_at_wrong_path() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let root = temp_dir.path().join("idempotency");
    let mut store = IdempotencyStore::load_all(&root).expect("store should load");
    let record = store
        .start_operation(StartIdempotencyOperation {
            key: "delivery_key".to_string(),
            runtime_id: AgentRuntimeId::Codex,
            operation: IdempotencyOperation::SubmitPayload,
            request_fingerprint: submit_fingerprint("hello"),
            now: "2026-05-23T00:00:00Z".to_string(),
        })
        .expect("operation should start");
    let wrong_root = temp_dir.path().join("wrong-idempotency");
    fs::create_dir_all(&wrong_root).expect("wrong root should be created");
    fs::write(
        wrong_root.join("submit-payload-wrong.json"),
        serde_json::to_vec_pretty(&record).expect("record should encode"),
    )
    .expect("wrong-path record should be written");

    let error =
        IdempotencyStore::load_all(&wrong_root).expect_err("wrong-path record should fail load");

    assert!(matches!(
        error,
        IdempotencyStoreError::RecordPathMismatch { .. }
    ));
}

fn submit_fingerprint(input_text: &str) -> RequestFingerprint {
    let mut fields = BTreeMap::new();
    fields.insert("inputText".to_string(), json!(input_text));
    fields.insert("logicalOperationKind".to_string(), json!("submitPayload"));
    RequestFingerprint::from_fields(
        AgentRuntimeId::Codex,
        IdempotencyOperation::SubmitPayload,
        fields,
    )
    .expect("fingerprint should encode")
}

fn opencode_submit_fingerprint(input_text: &str) -> RequestFingerprint {
    let mut fields = BTreeMap::new();
    fields.insert("inputText".to_string(), json!(input_text));
    RequestFingerprint::from_fields(
        AgentRuntimeId::OpenCode,
        IdempotencyOperation::SubmitPayload,
        fields,
    )
    .expect("fingerprint should encode")
}
