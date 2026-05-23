use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::codex_proxy::CodexProxyError;
use crate::idempotency::store::{IdempotencyStore, IdempotencyStoreError};
use crate::idempotency::{
    AgentRuntimeId, CompleteIdempotencyOperation, IdempotencyOperation, IdempotencyRecord,
    IdempotencyRecordStatus, RepeatedRequestOutcome, RequestFingerprint, StartIdempotencyOperation,
};
use crate::time::{Clock, SystemClock, format_rfc3339_timestamp};

pub(super) type SharedIdempotencyStore = Arc<Mutex<IdempotencyStore>>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CodexProxyIdempotency {
    key: String,
    operation: CodexProxyIdempotencyOperation,
    request_fingerprint: RequestFingerprint,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
enum CodexProxyIdempotencyOperation {
    CreateConversation,
    SubmitPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StoredCodexProxyResponse {
    pub(super) payload: Value,
}

#[derive(Debug, Clone)]
pub(super) struct StartedCodexOperation {
    idempotency: CodexProxyIdempotency,
    operation: IdempotencyOperation,
    method: String,
}

impl StartedCodexOperation {
    pub(super) fn method(&self) -> &str {
        &self.method
    }
}

pub(super) enum CodexIdempotencyAction {
    Disabled,
    Forward(StartedCodexOperation),
    Replay(StoredCodexProxyResponse),
    Reject { message: String },
}

pub(super) fn prepare_codex_idempotency(
    payload: &mut Value,
    store: Option<&SharedIdempotencyStore>,
) -> CodexIdempotencyAction {
    let idempotency = match take_idempotency(payload) {
        Ok(Some(idempotency)) => idempotency,
        Ok(None) => return CodexIdempotencyAction::Disabled,
        Err(message) => return CodexIdempotencyAction::Reject { message },
    };
    let Some(method) = payload.get("method").and_then(Value::as_str) else {
        return CodexIdempotencyAction::Reject {
            message: "Codex proxy idempotency requires a JSON-RPC method.".to_string(),
        };
    };
    let operation = match (idempotency.operation, method) {
        (CodexProxyIdempotencyOperation::CreateConversation, "thread/start") => {
            IdempotencyOperation::CreateConversation
        }
        (CodexProxyIdempotencyOperation::SubmitPayload, "turn/start" | "turn/steer") => {
            IdempotencyOperation::SubmitPayload
        }
        (CodexProxyIdempotencyOperation::CreateConversation, _) => {
            return CodexIdempotencyAction::Reject {
                message: "Codex createConversation idempotency requires thread/start.".to_string(),
            };
        }
        (CodexProxyIdempotencyOperation::SubmitPayload, _) => {
            return CodexIdempotencyAction::Reject {
                message: "Codex submitPayload idempotency requires turn/start or turn/steer."
                    .to_string(),
            };
        }
    };

    let Some(store) = store else {
        return CodexIdempotencyAction::Reject {
            message: "Codex idempotency store is not configured.".to_string(),
        };
    };
    let now = match now_timestamp() {
        Ok(now) => now,
        Err(error) => {
            return CodexIdempotencyAction::Reject {
                message: error.to_string(),
            };
        }
    };
    let start_result = match lock_store(store).and_then(|mut store| {
        match store.get_by_key(AgentRuntimeId::Codex, operation.clone(), &idempotency.key) {
            Ok(record) => Ok(CodexStartResult::Existing(record.clone())),
            Err(IdempotencyStoreError::MissingRecord { .. }) => store
                .start_operation(StartIdempotencyOperation {
                    key: idempotency.key.clone(),
                    runtime_id: AgentRuntimeId::Codex,
                    operation: operation.clone(),
                    request_fingerprint: idempotency.request_fingerprint.clone(),
                    now,
                })
                .map(CodexStartResult::Created)
                .map_err(map_store_error),
            Err(error) => Err(map_store_error(error)),
        }
    }) {
        Ok(result) => result,
        Err(error) => {
            return CodexIdempotencyAction::Reject {
                message: error.to_string(),
            };
        }
    };

    match start_result {
        CodexStartResult::Created(record) => {
            if record.status != IdempotencyRecordStatus::Started {
                return CodexIdempotencyAction::Reject {
                    message: format!(
                        "Codex idempotency key '{}' did not start in started status.",
                        record.key
                    ),
                };
            }
            CodexIdempotencyAction::Forward(StartedCodexOperation {
                idempotency,
                operation,
                method: method.to_string(),
            })
        }
        CodexStartResult::Existing(record) => {
            let outcome = match record.classify_repeated_request(&idempotency.request_fingerprint) {
                Ok(outcome) => outcome,
                Err(error) => {
                    return CodexIdempotencyAction::Reject {
                        message: error.to_string(),
                    };
                }
            };
            if outcome == RepeatedRequestOutcome::Completed {
                return match record.response {
                    Some(response) => {
                        match serde_json::from_value::<StoredCodexProxyResponse>(response) {
                            Ok(response) => CodexIdempotencyAction::Replay(response),
                            Err(error) => CodexIdempotencyAction::Reject {
                                message: format!("Codex idempotency response is invalid: {error}"),
                            },
                        }
                    }
                    None => CodexIdempotencyAction::Reject {
                        message: format!(
                            "Codex idempotency key '{}' completed without a response.",
                            record.key
                        ),
                    },
                };
            }
            CodexIdempotencyAction::Reject {
                message: format!(
                    "Codex idempotency key '{}' has unresolved status {:?}.",
                    record.key, record.status
                ),
            }
        }
    }
}

enum CodexStartResult {
    Created(IdempotencyRecord),
    Existing(IdempotencyRecord),
}

pub(super) fn complete_codex_idempotency(
    store: &SharedIdempotencyStore,
    started: StartedCodexOperation,
    response: StoredCodexProxyResponse,
    provider_conversation_id: Option<String>,
    provider_execution_id: Option<String>,
) -> Result<(), CodexProxyError> {
    let now = now_timestamp()?;
    let response_value = serde_json::to_value(response)
        .map_err(|error| CodexProxyError::ConfigureRuntime(error.to_string()))?;
    let mut store = lock_store(store)?;
    store
        .mark_completed(
            AgentRuntimeId::Codex,
            started.operation,
            &started.idempotency.key,
            CompleteIdempotencyOperation {
                request_fingerprint: started.idempotency.request_fingerprint,
                provider_conversation_id,
                provider_execution_id,
                runtime_artifact_hint: Some(json!({
                    "method": started.method,
                })),
                response: response_value,
                now,
            },
        )
        .map(|_| ())
        .map_err(map_store_error)
}

fn take_idempotency(payload: &mut Value) -> Result<Option<CodexProxyIdempotency>, String> {
    let Some(object) = payload.as_object_mut() else {
        return Ok(None);
    };
    let Some(value) = object.remove("idempotency") else {
        return Ok(None);
    };
    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| format!("Codex idempotency envelope is invalid: {error}"))
}

fn lock_store(
    store: &SharedIdempotencyStore,
) -> Result<std::sync::MutexGuard<'_, IdempotencyStore>, CodexProxyError> {
    store.lock().map_err(|error| {
        CodexProxyError::ConfigureRuntime(format!(
            "Codex idempotency store lock is poisoned: {error}"
        ))
    })
}

fn map_store_error(error: IdempotencyStoreError) -> CodexProxyError {
    CodexProxyError::ConfigureRuntime(error.to_string())
}

fn now_timestamp() -> Result<String, CodexProxyError> {
    format_rfc3339_timestamp(SystemClock.now_system_time())
        .map_err(|error| CodexProxyError::ConfigureRuntime(error.to_string()))
}
