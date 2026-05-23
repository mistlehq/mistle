use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::idempotency::store::{IdempotencyStore, IdempotencyStoreError};
use crate::idempotency::{
    AgentRuntimeId, CompleteIdempotencyOperation, IdempotencyOperation, IdempotencyRecord,
    IdempotencyRecordStatus, RepeatedRequestOutcome, RequestFingerprint, StartIdempotencyOperation,
};
use crate::pi_proxy::PiProxyError;
use crate::time::{Clock, SystemClock, format_rfc3339_timestamp};

pub(super) type SharedIdempotencyStore = Arc<Mutex<IdempotencyStore>>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PiProxyIdempotency {
    key: String,
    operation: PiProxyIdempotencyOperation,
    request_fingerprint: RequestFingerprint,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
enum PiProxyIdempotencyOperation {
    CreateConversation,
    SubmitPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StoredPiProxyResponse {
    pub(super) payload: Value,
}

#[derive(Debug, Clone)]
pub(super) struct StartedPiOperation {
    idempotency: PiProxyIdempotency,
    operation: IdempotencyOperation,
    method: String,
}

impl StartedPiOperation {
    pub(super) fn method(&self) -> &str {
        &self.method
    }
}

pub(super) enum PiIdempotencyAction {
    Disabled,
    Forward(StartedPiOperation),
    Replay(StoredPiProxyResponse),
    Reject { message: String },
}

pub(super) fn prepare_pi_idempotency(
    idempotency: Option<&PiProxyIdempotency>,
    method: &str,
    store: Option<&SharedIdempotencyStore>,
) -> PiIdempotencyAction {
    let Some(idempotency) = idempotency.cloned() else {
        return PiIdempotencyAction::Disabled;
    };
    let operation = match (idempotency.operation, method) {
        (PiProxyIdempotencyOperation::CreateConversation, "pi/createConversation") => {
            IdempotencyOperation::CreateConversation
        }
        (PiProxyIdempotencyOperation::SubmitPayload, "pi/prompt" | "pi/steer" | "pi/followUp") => {
            IdempotencyOperation::SubmitPayload
        }
        (PiProxyIdempotencyOperation::CreateConversation, _) => {
            return PiIdempotencyAction::Reject {
                message: "Pi createConversation idempotency requires pi/createConversation."
                    .to_string(),
            };
        }
        (PiProxyIdempotencyOperation::SubmitPayload, _) => {
            return PiIdempotencyAction::Reject {
                message:
                    "Pi submitPayload idempotency requires pi/prompt, pi/steer, or pi/followUp."
                        .to_string(),
            };
        }
    };
    let Some(store) = store else {
        return PiIdempotencyAction::Reject {
            message: "Pi idempotency store is not configured.".to_string(),
        };
    };
    let now = match now_timestamp() {
        Ok(now) => now,
        Err(error) => {
            return PiIdempotencyAction::Reject {
                message: error.to_string(),
            };
        }
    };
    let start_result = match lock_store(store).and_then(|mut store| {
        match store.get_by_key(AgentRuntimeId::Pi, operation.clone(), &idempotency.key) {
            Ok(record) => Ok(PiStartResult::Existing(record.clone())),
            Err(IdempotencyStoreError::MissingRecord { .. }) => store
                .start_operation(StartIdempotencyOperation {
                    key: idempotency.key.clone(),
                    runtime_id: AgentRuntimeId::Pi,
                    operation: operation.clone(),
                    request_fingerprint: idempotency.request_fingerprint.clone(),
                    now,
                })
                .map(PiStartResult::Created)
                .map_err(map_store_error),
            Err(error) => Err(map_store_error(error)),
        }
    }) {
        Ok(result) => result,
        Err(error) => {
            return PiIdempotencyAction::Reject {
                message: error.to_string(),
            };
        }
    };
    match start_result {
        PiStartResult::Created(record) => {
            if record.status != IdempotencyRecordStatus::Started {
                return PiIdempotencyAction::Reject {
                    message: format!(
                        "Pi idempotency key '{}' did not start in started status.",
                        record.key
                    ),
                };
            }
            PiIdempotencyAction::Forward(StartedPiOperation {
                idempotency,
                operation,
                method: method.to_string(),
            })
        }
        PiStartResult::Existing(record) => {
            let outcome = match record.classify_repeated_request(&idempotency.request_fingerprint) {
                Ok(outcome) => outcome,
                Err(error) => {
                    return PiIdempotencyAction::Reject {
                        message: error.to_string(),
                    };
                }
            };
            if outcome == RepeatedRequestOutcome::Completed {
                return match record.response {
                    Some(response) => {
                        match serde_json::from_value::<StoredPiProxyResponse>(response) {
                            Ok(response) => PiIdempotencyAction::Replay(response),
                            Err(error) => PiIdempotencyAction::Reject {
                                message: format!("Pi idempotency response is invalid: {error}"),
                            },
                        }
                    }
                    None => PiIdempotencyAction::Reject {
                        message: format!(
                            "Pi idempotency key '{}' completed without a response.",
                            record.key
                        ),
                    },
                };
            }
            PiIdempotencyAction::Reject {
                message: format!(
                    "Pi idempotency key '{}' has unresolved status {:?}.",
                    record.key, record.status
                ),
            }
        }
    }
}

enum PiStartResult {
    Created(IdempotencyRecord),
    Existing(IdempotencyRecord),
}

pub(super) fn complete_pi_idempotency(
    store: &SharedIdempotencyStore,
    started: StartedPiOperation,
    response: StoredPiProxyResponse,
    provider_conversation_id: Option<String>,
) -> Result<(), PiProxyError> {
    let now = now_timestamp()?;
    let response_value = serde_json::to_value(response)
        .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
    let mut store = lock_store(store)?;
    store
        .mark_completed(
            AgentRuntimeId::Pi,
            started.operation,
            &started.idempotency.key,
            CompleteIdempotencyOperation {
                request_fingerprint: started.idempotency.request_fingerprint,
                provider_conversation_id,
                provider_execution_id: None,
                runtime_artifact_hint: Some(json!({ "method": started.method })),
                response: response_value,
                now,
            },
        )
        .map(|_| ())
        .map_err(map_store_error)
}

fn lock_store(
    store: &SharedIdempotencyStore,
) -> Result<std::sync::MutexGuard<'_, IdempotencyStore>, PiProxyError> {
    store.lock().map_err(|error| {
        PiProxyError::InvalidRequest(format!("Pi idempotency store lock is poisoned: {error}"))
    })
}

fn map_store_error(error: IdempotencyStoreError) -> PiProxyError {
    PiProxyError::InvalidRequest(error.to_string())
}

fn now_timestamp() -> Result<String, PiProxyError> {
    format_rfc3339_timestamp(SystemClock.now_system_time())
        .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))
}
