use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::idempotency::store::{IdempotencyStore, IdempotencyStoreError};
use crate::idempotency::{
    AgentRuntimeId, CompleteIdempotencyOperation, IdempotencyOperation, IdempotencyRecord,
    IdempotencyRecordError, IdempotencyRecordStatus, RepeatedRequestOutcome, RequestFingerprint,
    StartIdempotencyOperation,
};
use crate::opencode_proxy::OpenCodeProxyError;
use crate::time::{Clock, SystemClock, format_rfc3339_timestamp};

const OPENCODE_PROVIDER_EXECUTION_ID_PREFIX: &str = "opencode-session";

pub(super) type SharedIdempotencyStore = Arc<Mutex<IdempotencyStore>>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct OpenCodeProxyIdempotency {
    pub(super) key: String,
    pub(super) operation: OpenCodeProxyIdempotencyOperation,
    pub(super) request_fingerprint: RequestFingerprint,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum OpenCodeProxyIdempotencyOperation {
    CreateConversation,
    SubmitPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StoredOpenCodeProxyResponse {
    pub(super) status: u16,
    pub(super) headers: BTreeMap<String, String>,
    pub(super) body: String,
}

#[derive(Debug, Clone)]
pub(super) struct StartedOpenCodeSubmit {
    pub(super) idempotency: OpenCodeProxyIdempotency,
    pub(super) message_id: String,
    pub(super) provider_conversation_id: String,
}

pub(super) enum OpenCodeSubmitIdempotencyAction {
    Disabled,
    Forward(StartedOpenCodeSubmit),
    Replay(StoredOpenCodeProxyResponse),
    Reject { status: u16, message: String },
}

pub(super) fn prepare_submit_idempotency(
    input: PrepareSubmitIdempotencyInput<'_>,
) -> OpenCodeSubmitIdempotencyAction {
    let Some(idempotency) = input.idempotency.cloned() else {
        return OpenCodeSubmitIdempotencyAction::Disabled;
    };
    if idempotency.operation != OpenCodeProxyIdempotencyOperation::SubmitPayload {
        return OpenCodeSubmitIdempotencyAction::Reject {
            status: 400,
            message: "OpenCode proxy idempotency currently supports only submitPayload operations."
                .to_string(),
        };
    }
    if input.method != "POST" {
        return OpenCodeSubmitIdempotencyAction::Reject {
            status: 400,
            message: "OpenCode submitPayload idempotency requires a POST request.".to_string(),
        };
    }
    let Some(provider_conversation_id) = parse_message_submit_session_id(input.path) else {
        return OpenCodeSubmitIdempotencyAction::Reject {
            status: 400,
            message: "OpenCode submitPayload idempotency requires a /session/{sessionId}/message request.".to_string(),
        };
    };
    let Some(body) = input.body else {
        return OpenCodeSubmitIdempotencyAction::Reject {
            status: 400,
            message: "OpenCode submitPayload idempotency requires a JSON object request body."
                .to_string(),
        };
    };
    let Some(body_object) = body.as_object_mut() else {
        return OpenCodeSubmitIdempotencyAction::Reject {
            status: 400,
            message: "OpenCode submitPayload idempotency requires a JSON object request body."
                .to_string(),
        };
    };

    let message_id = deterministic_message_id(&idempotency.key);
    match body_object.get("messageID") {
        Some(Value::String(existing_message_id)) if existing_message_id == &message_id => {}
        Some(Value::String(_)) => {
            return OpenCodeSubmitIdempotencyAction::Reject {
                status: 409,
                message: "OpenCode submitPayload idempotency messageID conflicts with the deterministic idempotency messageID.".to_string(),
            };
        }
        Some(_) => {
            return OpenCodeSubmitIdempotencyAction::Reject {
                status: 400,
                message:
                    "OpenCode submitPayload idempotency messageID must be a string when provided."
                        .to_string(),
            };
        }
        None => {
            body_object.insert("messageID".to_string(), Value::String(message_id.clone()));
        }
    }

    let Some(store) = input.store else {
        return OpenCodeSubmitIdempotencyAction::Reject {
            status: 500,
            message: "OpenCode submitPayload idempotency store is not configured.".to_string(),
        };
    };
    let now = match now_timestamp() {
        Ok(now) => now,
        Err(error) => {
            return OpenCodeSubmitIdempotencyAction::Reject {
                status: 500,
                message: error.to_string(),
            };
        }
    };
    let start_result = match lock_store(store).and_then(|mut store| {
        match store.get_by_key(
            AgentRuntimeId::OpenCode,
            IdempotencyOperation::SubmitPayload,
            &idempotency.key,
        ) {
            Ok(record) => Ok(OpenCodeSubmitStartResult::Existing(record.clone())),
            Err(IdempotencyStoreError::MissingRecord { .. }) => {
                start_opencode_submit_record(&mut store, &idempotency, now)
            }
            Err(error) => Err(error),
        }
    }) {
        Ok(result) => result,
        Err(error) => {
            return OpenCodeSubmitIdempotencyAction::Reject {
                status: store_error_status(&error),
                message: error.to_string(),
            };
        }
    };

    match start_result {
        OpenCodeSubmitStartResult::Created(record) => {
            if record.status != IdempotencyRecordStatus::Started {
                return OpenCodeSubmitIdempotencyAction::Reject {
                    status: 500,
                    message: format!(
                        "OpenCode submitPayload idempotency key '{}' did not start in started status.",
                        record.key
                    ),
                };
            }
            OpenCodeSubmitIdempotencyAction::Forward(StartedOpenCodeSubmit {
                idempotency,
                message_id,
                provider_conversation_id,
            })
        }
        OpenCodeSubmitStartResult::Existing(record) => {
            let outcome = match record.classify_repeated_request(&idempotency.request_fingerprint) {
                Ok(outcome) => outcome,
                Err(error) => {
                    return OpenCodeSubmitIdempotencyAction::Reject {
                        status: 409,
                        message: error.to_string(),
                    };
                }
            };
            if outcome == RepeatedRequestOutcome::Completed {
                return match record.response {
                    Some(response) => {
                        match serde_json::from_value::<StoredOpenCodeProxyResponse>(response) {
                            Ok(response) => OpenCodeSubmitIdempotencyAction::Replay(response),
                            Err(error) => OpenCodeSubmitIdempotencyAction::Reject {
                                status: 500,
                                message: format!(
                                    "OpenCode submitPayload idempotency response is invalid: {error}"
                                ),
                            },
                        }
                    }
                    None => OpenCodeSubmitIdempotencyAction::Reject {
                        status: 500,
                        message: format!(
                            "OpenCode submitPayload idempotency key '{}' completed without a response.",
                            record.key
                        ),
                    },
                };
            }
            OpenCodeSubmitIdempotencyAction::Reject {
                status: 409,
                message: format!(
                    "OpenCode submitPayload idempotency key '{}' has unresolved status {:?}.",
                    record.key, record.status
                ),
            }
        }
    }
}

enum OpenCodeSubmitStartResult {
    Created(IdempotencyRecord),
    Existing(IdempotencyRecord),
}

fn start_opencode_submit_record(
    store: &mut IdempotencyStore,
    idempotency: &OpenCodeProxyIdempotency,
    now: String,
) -> Result<OpenCodeSubmitStartResult, IdempotencyStoreError> {
    store
        .start_operation(StartIdempotencyOperation {
            key: idempotency.key.clone(),
            runtime_id: AgentRuntimeId::OpenCode,
            operation: IdempotencyOperation::SubmitPayload,
            request_fingerprint: idempotency.request_fingerprint.clone(),
            now,
        })
        .map(OpenCodeSubmitStartResult::Created)
}

pub(super) struct PrepareSubmitIdempotencyInput<'a> {
    pub(super) body: Option<&'a mut Value>,
    pub(super) idempotency: Option<&'a OpenCodeProxyIdempotency>,
    pub(super) method: &'a str,
    pub(super) path: &'a str,
    pub(super) store: Option<&'a SharedIdempotencyStore>,
}

pub(super) fn complete_submit_idempotency(
    store: &SharedIdempotencyStore,
    started: StartedOpenCodeSubmit,
    response: StoredOpenCodeProxyResponse,
) -> Result<(), OpenCodeProxyError> {
    let now = now_timestamp()?;
    let response_value = serde_json::to_value(response)
        .map_err(|error| OpenCodeProxyError::ConfigureRuntime(error.to_string()))?;
    let mut store = lock_store(store).map_err(map_store_error)?;
    store
        .mark_completed(
            AgentRuntimeId::OpenCode,
            IdempotencyOperation::SubmitPayload,
            &started.idempotency.key,
            CompleteIdempotencyOperation {
                request_fingerprint: started.idempotency.request_fingerprint,
                provider_conversation_id: Some(started.provider_conversation_id.clone()),
                provider_execution_id: Some(format!(
                    "{OPENCODE_PROVIDER_EXECUTION_ID_PREFIX}:{}",
                    started.provider_conversation_id
                )),
                runtime_artifact_hint: Some(json!({
                    "messageId": started.message_id,
                })),
                response: response_value,
                now,
            },
        )
        .map(|_| ())
        .map_err(map_store_error)
}

pub(super) fn delete_started_submit_idempotency(
    store: &SharedIdempotencyStore,
    started: &StartedOpenCodeSubmit,
) -> Result<(), OpenCodeProxyError> {
    let mut store = lock_store(store).map_err(map_store_error)?;
    store
        .delete_started(
            AgentRuntimeId::OpenCode,
            IdempotencyOperation::SubmitPayload,
            &started.idempotency.key,
            &started.idempotency.request_fingerprint,
        )
        .map_err(map_store_error)
}

fn lock_store(
    store: &SharedIdempotencyStore,
) -> Result<std::sync::MutexGuard<'_, IdempotencyStore>, IdempotencyStoreError> {
    store
        .lock()
        .map_err(|error| IdempotencyStoreError::LockPoisoned {
            error: error.to_string(),
        })
}

fn map_store_error(error: IdempotencyStoreError) -> OpenCodeProxyError {
    OpenCodeProxyError::ConfigureRuntime(error.to_string())
}

fn store_error_status(error: &IdempotencyStoreError) -> u16 {
    match error {
        IdempotencyStoreError::Record(IdempotencyRecordError::FingerprintConflict { .. }) => 409,
        _ => 500,
    }
}

fn now_timestamp() -> Result<String, OpenCodeProxyError> {
    format_rfc3339_timestamp(SystemClock.now_system_time())
        .map_err(|error| OpenCodeProxyError::ConfigureRuntime(error.to_string()))
}

fn parse_message_submit_session_id(path: &str) -> Option<String> {
    let path_without_query = path.split_once('?').map_or(path, |(path, _)| path);
    let mut parts = path_without_query
        .split('/')
        .filter(|part| !part.is_empty());
    if parts.next()? != "session" {
        return None;
    }
    let session_id = parts.next()?;
    if session_id.is_empty() || parts.next()? != "message" || parts.next().is_some() {
        return None;
    }
    Some(session_id.to_string())
}

fn deterministic_message_id(key: &str) -> String {
    format!("msg_mistle_{}", hex_lower(&Sha256::digest(key.as_bytes())))
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
