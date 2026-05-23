//! Pure idempotency record semantics for sandboxd-owned runtime proxy operations.
//!
//! This module intentionally does not perform filesystem I/O or proxy dispatch.
//! The file-backed store and runtime integrations build on these record and
//! transition rules.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const CURRENT_IDEMPOTENCY_RECORD_VERSION: u8 = 1;
pub const CURRENT_REQUEST_FINGERPRINT_VERSION: u8 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRuntimeId {
    Codex,
    #[serde(rename = "opencode")]
    OpenCode,
    Pi,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IdempotencyOperation {
    CreateConversation,
    SubmitPayload,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IdempotencyRecordStatus {
    Started,
    Accepted,
    Completed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RequestFingerprint(String);

impl RequestFingerprint {
    pub fn from_fields(
        runtime_id: AgentRuntimeId,
        operation: IdempotencyOperation,
        fields: BTreeMap<String, Value>,
    ) -> Result<Self, IdempotencyRecordError> {
        let payload = RequestFingerprintPayload {
            version: CURRENT_REQUEST_FINGERPRINT_VERSION,
            runtime_id,
            operation,
            fields,
        };
        let bytes = serde_json::to_vec(&payload)
            .map_err(|error| IdempotencyRecordError::EncodeFingerprint(error.to_string()))?;
        Ok(Self(format!(
            "sha256:{}",
            hex_lower(&Sha256::digest(bytes))
        )))
    }

    pub fn value(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Serialize)]
struct RequestFingerprintPayload {
    version: u8,
    runtime_id: AgentRuntimeId,
    operation: IdempotencyOperation,
    fields: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdempotencyRecord {
    pub version: u8,
    pub key: String,
    pub runtime_id: AgentRuntimeId,
    pub operation: IdempotencyOperation,
    pub request_fingerprint: RequestFingerprint,
    pub status: IdempotencyRecordStatus,
    pub provider_conversation_id: Option<String>,
    pub provider_execution_id: Option<String>,
    pub runtime_artifact_hint: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
    pub response: Option<Value>,
}

impl IdempotencyRecord {
    pub fn started(input: StartIdempotencyOperation) -> Self {
        Self {
            version: CURRENT_IDEMPOTENCY_RECORD_VERSION,
            key: input.key,
            runtime_id: input.runtime_id,
            operation: input.operation,
            request_fingerprint: input.request_fingerprint,
            status: IdempotencyRecordStatus::Started,
            provider_conversation_id: None,
            provider_execution_id: None,
            runtime_artifact_hint: None,
            created_at: input.now.clone(),
            updated_at: input.now,
            response: None,
        }
    }

    pub fn classify_repeated_request(
        &self,
        request_fingerprint: &RequestFingerprint,
    ) -> Result<RepeatedRequestOutcome, IdempotencyRecordError> {
        self.ensure_same_fingerprint(request_fingerprint)?;
        Ok(match self.status {
            IdempotencyRecordStatus::Started => RepeatedRequestOutcome::Started,
            IdempotencyRecordStatus::Accepted => RepeatedRequestOutcome::Accepted,
            IdempotencyRecordStatus::Completed => RepeatedRequestOutcome::Completed,
        })
    }

    pub fn mark_accepted(
        &self,
        input: AcceptIdempotencyOperation,
    ) -> Result<Self, IdempotencyRecordError> {
        self.ensure_same_fingerprint(&input.request_fingerprint)?;
        if self.status != IdempotencyRecordStatus::Started {
            return Err(IdempotencyRecordError::InvalidTransition {
                from: self.status.clone(),
                to: IdempotencyRecordStatus::Accepted,
            });
        }
        let mut next = self.clone();
        next.status = IdempotencyRecordStatus::Accepted;
        next.provider_conversation_id = input.provider_conversation_id;
        next.provider_execution_id = input.provider_execution_id;
        next.runtime_artifact_hint = input.runtime_artifact_hint;
        next.updated_at = input.now;
        Ok(next)
    }

    pub fn mark_completed(
        &self,
        input: CompleteIdempotencyOperation,
    ) -> Result<Self, IdempotencyRecordError> {
        self.ensure_same_fingerprint(&input.request_fingerprint)?;
        if self.status == IdempotencyRecordStatus::Completed {
            return Err(IdempotencyRecordError::InvalidTransition {
                from: self.status.clone(),
                to: IdempotencyRecordStatus::Completed,
            });
        }
        if self.status == IdempotencyRecordStatus::Accepted {
            self.ensure_completion_metadata_matches_accepted(&input)?;
        }
        let mut next = self.clone();
        next.status = IdempotencyRecordStatus::Completed;
        if self.status == IdempotencyRecordStatus::Started {
            next.provider_conversation_id = input.provider_conversation_id;
            next.provider_execution_id = input.provider_execution_id;
            next.runtime_artifact_hint = input.runtime_artifact_hint;
        }
        next.response = Some(input.response);
        next.updated_at = input.now;
        Ok(next)
    }

    fn ensure_same_fingerprint(
        &self,
        request_fingerprint: &RequestFingerprint,
    ) -> Result<(), IdempotencyRecordError> {
        if self.request_fingerprint == *request_fingerprint {
            return Ok(());
        }

        Err(IdempotencyRecordError::FingerprintConflict {
            key: self.key.clone(),
            existing: self.request_fingerprint.clone(),
            received: request_fingerprint.clone(),
        })
    }

    fn ensure_completion_metadata_matches_accepted(
        &self,
        input: &CompleteIdempotencyOperation,
    ) -> Result<(), IdempotencyRecordError> {
        if self.provider_conversation_id != input.provider_conversation_id {
            return Err(IdempotencyRecordError::ProviderMetadataConflict {
                field: "provider_conversation_id",
            });
        }
        if self.provider_execution_id != input.provider_execution_id {
            return Err(IdempotencyRecordError::ProviderMetadataConflict {
                field: "provider_execution_id",
            });
        }
        if self.runtime_artifact_hint != input.runtime_artifact_hint {
            return Err(IdempotencyRecordError::ProviderMetadataConflict {
                field: "runtime_artifact_hint",
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RepeatedRequestOutcome {
    Started,
    Accepted,
    Completed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartIdempotencyOperation {
    pub key: String,
    pub runtime_id: AgentRuntimeId,
    pub operation: IdempotencyOperation,
    pub request_fingerprint: RequestFingerprint,
    pub now: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AcceptIdempotencyOperation {
    pub request_fingerprint: RequestFingerprint,
    pub provider_conversation_id: Option<String>,
    pub provider_execution_id: Option<String>,
    pub runtime_artifact_hint: Option<Value>,
    pub now: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CompleteIdempotencyOperation {
    pub request_fingerprint: RequestFingerprint,
    pub provider_conversation_id: Option<String>,
    pub provider_execution_id: Option<String>,
    pub runtime_artifact_hint: Option<Value>,
    pub response: Value,
    pub now: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdempotencyRecordError {
    EncodeFingerprint(String),
    FingerprintConflict {
        key: String,
        existing: RequestFingerprint,
        received: RequestFingerprint,
    },
    InvalidTransition {
        from: IdempotencyRecordStatus,
        to: IdempotencyRecordStatus,
    },
    ProviderMetadataConflict {
        field: &'static str,
    },
}

impl fmt::Display for IdempotencyRecordError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EncodeFingerprint(error) => {
                write!(
                    f,
                    "failed to encode idempotency request fingerprint: {error}"
                )
            }
            Self::FingerprintConflict {
                key,
                existing,
                received,
            } => {
                write!(
                    f,
                    "idempotency key '{key}' was reused with a different request fingerprint: existing={}, received={}",
                    existing.value(),
                    received.value()
                )
            }
            Self::InvalidTransition { from, to } => {
                write!(
                    f,
                    "invalid idempotency record transition from {from:?} to {to:?}"
                )
            }
            Self::ProviderMetadataConflict { field } => {
                write!(
                    f,
                    "completion metadata field '{field}' conflicts with accepted idempotency record metadata"
                )
            }
        }
    }
}

impl std::error::Error for IdempotencyRecordError {}

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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn request_fingerprint_is_stable_for_the_same_ordered_fields() {
        let mut first_fields = BTreeMap::new();
        first_fields.insert("inputText".to_string(), json!("hello"));
        first_fields.insert("providerConversationId".to_string(), json!("thread_123"));

        let mut second_fields = BTreeMap::new();
        second_fields.insert("providerConversationId".to_string(), json!("thread_123"));
        second_fields.insert("inputText".to_string(), json!("hello"));

        let first = RequestFingerprint::from_fields(
            AgentRuntimeId::Codex,
            IdempotencyOperation::SubmitPayload,
            first_fields,
        )
        .expect("fingerprint should encode");
        let second = RequestFingerprint::from_fields(
            AgentRuntimeId::Codex,
            IdempotencyOperation::SubmitPayload,
            second_fields,
        )
        .expect("fingerprint should encode");

        assert_eq!(first, second);
        assert_eq!(
            first.value(),
            "sha256:2835e969c9ccd2fd86c82e5738bcafdd9cb3c6b8620542811cf02baa7364e6e6"
        );
        assert!(first.value().starts_with("sha256:"));
        assert_eq!(first.value().len(), "sha256:".len() + 64);
    }

    #[test]
    fn request_fingerprint_changes_when_logical_operation_changes() {
        let mut fields = BTreeMap::new();
        fields.insert("conversationId".to_string(), json!("cnv_123"));

        let create = RequestFingerprint::from_fields(
            AgentRuntimeId::Pi,
            IdempotencyOperation::CreateConversation,
            fields.clone(),
        )
        .expect("fingerprint should encode");
        let submit = RequestFingerprint::from_fields(
            AgentRuntimeId::Pi,
            IdempotencyOperation::SubmitPayload,
            fields,
        )
        .expect("fingerprint should encode");

        assert_ne!(create, submit);
    }

    #[test]
    fn started_record_contains_initial_state_and_timestamps() {
        let fingerprint = submit_fingerprint("payload");

        let record = IdempotencyRecord::started(StartIdempotencyOperation {
            key: "key_1".to_string(),
            runtime_id: AgentRuntimeId::OpenCode,
            operation: IdempotencyOperation::SubmitPayload,
            request_fingerprint: fingerprint.clone(),
            now: "2026-05-23T00:00:00Z".to_string(),
        });

        assert_eq!(record.version, CURRENT_IDEMPOTENCY_RECORD_VERSION);
        assert_eq!(record.key, "key_1");
        assert_eq!(record.runtime_id, AgentRuntimeId::OpenCode);
        assert_eq!(record.operation, IdempotencyOperation::SubmitPayload);
        assert_eq!(record.request_fingerprint, fingerprint);
        assert_eq!(record.status, IdempotencyRecordStatus::Started);
        assert_eq!(record.created_at, "2026-05-23T00:00:00Z");
        assert_eq!(record.updated_at, "2026-05-23T00:00:00Z");
        assert_eq!(record.provider_conversation_id, None);
        assert_eq!(record.provider_execution_id, None);
        assert_eq!(record.runtime_artifact_hint, None);
        assert_eq!(record.response, None);
    }

    #[test]
    fn repeated_request_classification_rejects_fingerprint_conflicts() {
        let original = submit_fingerprint("payload");
        let different = submit_fingerprint("different payload");
        let record = started_record(original);

        let error = record
            .classify_repeated_request(&different)
            .expect_err("different fingerprint should conflict");

        assert_eq!(
            error,
            IdempotencyRecordError::FingerprintConflict {
                key: "delivery_key".to_string(),
                existing: submit_fingerprint("payload"),
                received: submit_fingerprint("different payload"),
            }
        );
    }

    #[test]
    fn repeated_request_classification_reflects_current_status() {
        let fingerprint = submit_fingerprint("payload");
        let started = started_record(fingerprint.clone());
        assert_eq!(
            started
                .classify_repeated_request(&fingerprint)
                .expect("same fingerprint should classify"),
            RepeatedRequestOutcome::Started
        );

        let accepted = started
            .mark_accepted(AcceptIdempotencyOperation {
                request_fingerprint: fingerprint.clone(),
                provider_conversation_id: Some("thread_123".to_string()),
                provider_execution_id: Some("turn_123".to_string()),
                runtime_artifact_hint: Some(json!({ "rollout": "path" })),
                now: "2026-05-23T00:00:01Z".to_string(),
            })
            .expect("started record should accept");
        assert_eq!(
            accepted
                .classify_repeated_request(&fingerprint)
                .expect("same fingerprint should classify"),
            RepeatedRequestOutcome::Accepted
        );

        let completed = accepted
            .mark_completed(CompleteIdempotencyOperation {
                request_fingerprint: fingerprint.clone(),
                provider_conversation_id: Some("thread_123".to_string()),
                provider_execution_id: Some("turn_123".to_string()),
                runtime_artifact_hint: Some(json!({ "rollout": "path" })),
                response: json!({ "providerConversationId": "thread_123" }),
                now: "2026-05-23T00:00:02Z".to_string(),
            })
            .expect("accepted record should complete");
        assert_eq!(
            completed
                .classify_repeated_request(&fingerprint)
                .expect("same fingerprint should classify"),
            RepeatedRequestOutcome::Completed
        );
    }

    #[test]
    fn accepting_record_sets_provider_identifiers_without_mutating_original() {
        let fingerprint = submit_fingerprint("payload");
        let started = started_record(fingerprint.clone());

        let accepted = started
            .mark_accepted(AcceptIdempotencyOperation {
                request_fingerprint: fingerprint,
                provider_conversation_id: Some("thread_123".to_string()),
                provider_execution_id: Some("turn_123".to_string()),
                runtime_artifact_hint: Some(json!({ "rolloutPath": "/root/.codex/session.jsonl" })),
                now: "2026-05-23T00:00:01Z".to_string(),
            })
            .expect("started record should accept");

        assert_eq!(started.status, IdempotencyRecordStatus::Started);
        assert_eq!(started.provider_conversation_id, None);
        assert_eq!(accepted.status, IdempotencyRecordStatus::Accepted);
        assert_eq!(
            accepted.provider_conversation_id,
            Some("thread_123".to_string())
        );
        assert_eq!(accepted.provider_execution_id, Some("turn_123".to_string()));
        assert_eq!(accepted.updated_at, "2026-05-23T00:00:01Z");
    }

    #[test]
    fn completing_record_persists_replay_response() {
        let fingerprint = submit_fingerprint("payload");
        let started = started_record(fingerprint.clone());

        let completed = started
            .mark_completed(CompleteIdempotencyOperation {
                request_fingerprint: fingerprint,
                provider_conversation_id: Some("session_123".to_string()),
                provider_execution_id: None,
                runtime_artifact_hint: None,
                response: json!({
                    "providerConversationId": "session_123",
                    "providerExecutionId": null
                }),
                now: "2026-05-23T00:00:03Z".to_string(),
            })
            .expect("started record should complete");

        assert_eq!(completed.status, IdempotencyRecordStatus::Completed);
        assert_eq!(
            completed.response,
            Some(json!({
                "providerConversationId": "session_123",
                "providerExecutionId": null
            }))
        );
        assert_eq!(completed.updated_at, "2026-05-23T00:00:03Z");
    }

    #[test]
    fn completing_accepted_record_preserves_provider_metadata() {
        let fingerprint = submit_fingerprint("payload");
        let accepted = started_record(fingerprint.clone())
            .mark_accepted(AcceptIdempotencyOperation {
                request_fingerprint: fingerprint.clone(),
                provider_conversation_id: Some("thread_123".to_string()),
                provider_execution_id: Some("turn_123".to_string()),
                runtime_artifact_hint: Some(json!({ "rolloutPath": "/root/.codex/session.jsonl" })),
                now: "2026-05-23T00:00:01Z".to_string(),
            })
            .expect("record should accept");

        let completed = accepted
            .mark_completed(CompleteIdempotencyOperation {
                request_fingerprint: fingerprint,
                provider_conversation_id: Some("thread_123".to_string()),
                provider_execution_id: Some("turn_123".to_string()),
                runtime_artifact_hint: Some(json!({ "rolloutPath": "/root/.codex/session.jsonl" })),
                response: json!({ "providerConversationId": "thread_123" }),
                now: "2026-05-23T00:00:02Z".to_string(),
            })
            .expect("accepted record should complete");

        assert_eq!(
            completed.provider_conversation_id,
            Some("thread_123".to_string())
        );
        assert_eq!(
            completed.provider_execution_id,
            Some("turn_123".to_string())
        );
        assert_eq!(
            completed.runtime_artifact_hint,
            Some(json!({ "rolloutPath": "/root/.codex/session.jsonl" }))
        );
    }

    #[test]
    fn completing_accepted_record_rejects_provider_metadata_conflicts() {
        let fingerprint = submit_fingerprint("payload");
        let accepted = started_record(fingerprint.clone())
            .mark_accepted(AcceptIdempotencyOperation {
                request_fingerprint: fingerprint.clone(),
                provider_conversation_id: Some("thread_123".to_string()),
                provider_execution_id: Some("turn_123".to_string()),
                runtime_artifact_hint: None,
                now: "2026-05-23T00:00:01Z".to_string(),
            })
            .expect("record should accept");

        let error = accepted
            .mark_completed(CompleteIdempotencyOperation {
                request_fingerprint: fingerprint,
                provider_conversation_id: Some("thread_456".to_string()),
                provider_execution_id: Some("turn_123".to_string()),
                runtime_artifact_hint: None,
                response: json!({ "providerConversationId": "thread_456" }),
                now: "2026-05-23T00:00:02Z".to_string(),
            })
            .expect_err("accepted record should reject mismatched completion metadata");

        assert_eq!(
            error,
            IdempotencyRecordError::ProviderMetadataConflict {
                field: "provider_conversation_id",
            }
        );
    }

    #[test]
    fn completed_record_cannot_regress_to_accepted() {
        let fingerprint = submit_fingerprint("payload");
        let completed = started_record(fingerprint.clone())
            .mark_completed(CompleteIdempotencyOperation {
                request_fingerprint: fingerprint.clone(),
                provider_conversation_id: Some("session_123".to_string()),
                provider_execution_id: None,
                runtime_artifact_hint: None,
                response: json!({ "ok": true }),
                now: "2026-05-23T00:00:01Z".to_string(),
            })
            .expect("record should complete");

        let error = completed
            .mark_accepted(AcceptIdempotencyOperation {
                request_fingerprint: fingerprint,
                provider_conversation_id: Some("session_123".to_string()),
                provider_execution_id: None,
                runtime_artifact_hint: None,
                now: "2026-05-23T00:00:02Z".to_string(),
            })
            .expect_err("completed record should not regress");

        assert_eq!(
            error,
            IdempotencyRecordError::InvalidTransition {
                from: IdempotencyRecordStatus::Completed,
                to: IdempotencyRecordStatus::Accepted,
            }
        );
    }

    #[test]
    fn accepted_record_cannot_be_accepted_again() {
        let fingerprint = submit_fingerprint("payload");
        let accepted = started_record(fingerprint.clone())
            .mark_accepted(AcceptIdempotencyOperation {
                request_fingerprint: fingerprint.clone(),
                provider_conversation_id: Some("session_123".to_string()),
                provider_execution_id: None,
                runtime_artifact_hint: None,
                now: "2026-05-23T00:00:01Z".to_string(),
            })
            .expect("record should accept");

        let error = accepted
            .mark_accepted(AcceptIdempotencyOperation {
                request_fingerprint: fingerprint,
                provider_conversation_id: Some("session_456".to_string()),
                provider_execution_id: None,
                runtime_artifact_hint: None,
                now: "2026-05-23T00:00:02Z".to_string(),
            })
            .expect_err("accepted record should not overwrite accepted details");

        assert_eq!(
            error,
            IdempotencyRecordError::InvalidTransition {
                from: IdempotencyRecordStatus::Accepted,
                to: IdempotencyRecordStatus::Accepted,
            }
        );
    }

    #[test]
    fn completed_record_cannot_be_completed_again() {
        let fingerprint = submit_fingerprint("payload");
        let completed = started_record(fingerprint.clone())
            .mark_completed(CompleteIdempotencyOperation {
                request_fingerprint: fingerprint.clone(),
                provider_conversation_id: Some("session_123".to_string()),
                provider_execution_id: None,
                runtime_artifact_hint: None,
                response: json!({ "ok": true }),
                now: "2026-05-23T00:00:01Z".to_string(),
            })
            .expect("record should complete");

        let error = completed
            .mark_completed(CompleteIdempotencyOperation {
                request_fingerprint: fingerprint,
                provider_conversation_id: Some("session_456".to_string()),
                provider_execution_id: None,
                runtime_artifact_hint: None,
                response: json!({ "ok": false }),
                now: "2026-05-23T00:00:02Z".to_string(),
            })
            .expect_err("completed record should not overwrite replay response");

        assert_eq!(
            error,
            IdempotencyRecordError::InvalidTransition {
                from: IdempotencyRecordStatus::Completed,
                to: IdempotencyRecordStatus::Completed,
            }
        );
    }

    #[test]
    fn record_serializes_with_camel_case_fields_and_snake_case_values() {
        let record = IdempotencyRecord::started(StartIdempotencyOperation {
            key: "key_1".to_string(),
            runtime_id: AgentRuntimeId::Codex,
            operation: IdempotencyOperation::CreateConversation,
            request_fingerprint: create_fingerprint("/root"),
            now: "2026-05-23T00:00:00Z".to_string(),
        });

        let serialized = serde_json::to_value(record).expect("record should serialize");

        assert_eq!(
            serialized,
            json!({
                "version": 1,
                "key": "key_1",
                "runtimeId": "codex",
                "operation": "create_conversation",
                "requestFingerprint": create_fingerprint("/root"),
                "status": "started",
                "providerConversationId": null,
                "providerExecutionId": null,
                "runtimeArtifactHint": null,
                "createdAt": "2026-05-23T00:00:00Z",
                "updatedAt": "2026-05-23T00:00:00Z",
                "response": null
            })
        );
    }

    fn started_record(request_fingerprint: RequestFingerprint) -> IdempotencyRecord {
        IdempotencyRecord::started(StartIdempotencyOperation {
            key: "delivery_key".to_string(),
            runtime_id: AgentRuntimeId::Codex,
            operation: IdempotencyOperation::SubmitPayload,
            request_fingerprint,
            now: "2026-05-23T00:00:00Z".to_string(),
        })
    }

    fn create_fingerprint(cwd: &str) -> RequestFingerprint {
        let mut fields = BTreeMap::new();
        fields.insert("cwd".to_string(), json!(cwd));
        RequestFingerprint::from_fields(
            AgentRuntimeId::Codex,
            IdempotencyOperation::CreateConversation,
            fields,
        )
        .expect("fingerprint should encode")
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
}
