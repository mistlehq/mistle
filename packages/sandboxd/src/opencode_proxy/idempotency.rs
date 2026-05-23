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
pub(super) struct StartedOpenCodeOperation {
    pub(super) idempotency: OpenCodeProxyIdempotency,
    pub(super) message_id: Option<String>,
    pub(super) operation: IdempotencyOperation,
    pub(super) provider_conversation_id: Option<String>,
}

pub(super) enum OpenCodeIdempotencyAction {
    Disabled,
    Forward(StartedOpenCodeOperation),
    Replay(StoredOpenCodeProxyResponse),
    Reject { status: u16, message: String },
}

pub(super) fn prepare_opencode_idempotency(
    input: PrepareSubmitIdempotencyInput<'_>,
) -> OpenCodeIdempotencyAction {
    let Some(idempotency) = input.idempotency else {
        return OpenCodeIdempotencyAction::Disabled;
    };

    match idempotency.operation {
        OpenCodeProxyIdempotencyOperation::CreateConversation => {
            prepare_create_conversation_idempotency(input)
        }
        OpenCodeProxyIdempotencyOperation::SubmitPayload => prepare_submit_idempotency(input),
    }
}

fn prepare_create_conversation_idempotency(
    input: PrepareSubmitIdempotencyInput<'_>,
) -> OpenCodeIdempotencyAction {
    let Some(idempotency) = input.idempotency.cloned() else {
        return OpenCodeIdempotencyAction::Disabled;
    };
    if idempotency.operation != OpenCodeProxyIdempotencyOperation::CreateConversation {
        return OpenCodeIdempotencyAction::Reject {
            status: 400,
            message:
                "OpenCode createConversation idempotency requires a createConversation operation."
                    .to_string(),
        };
    }
    if input.method != "POST" {
        return OpenCodeIdempotencyAction::Reject {
            status: 400,
            message: "OpenCode createConversation idempotency requires a POST request.".to_string(),
        };
    }
    if !is_create_session_path(input.path) {
        return OpenCodeIdempotencyAction::Reject {
            status: 400,
            message: "OpenCode createConversation idempotency requires a /session request."
                .to_string(),
        };
    }
    if input.body.is_some_and(|body| !body.is_object()) {
        return OpenCodeIdempotencyAction::Reject {
            status: 400,
            message: "OpenCode createConversation idempotency requires a JSON object request body."
                .to_string(),
        };
    }

    prepare_started_idempotency(
        PrepareStartedIdempotencyInput {
            idempotency,
            operation: IdempotencyOperation::CreateConversation,
            provider_conversation_id: None,
            message_id: None,
            store: input.store,
        },
        "OpenCode createConversation",
    )
}

fn prepare_submit_idempotency(
    input: PrepareSubmitIdempotencyInput<'_>,
) -> OpenCodeIdempotencyAction {
    let Some(idempotency) = input.idempotency.cloned() else {
        return OpenCodeIdempotencyAction::Disabled;
    };
    if idempotency.operation != OpenCodeProxyIdempotencyOperation::SubmitPayload {
        return OpenCodeIdempotencyAction::Reject {
            status: 400,
            message: "OpenCode submitPayload idempotency requires a submitPayload operation."
                .to_string(),
        };
    }
    if input.method != "POST" {
        return OpenCodeIdempotencyAction::Reject {
            status: 400,
            message: "OpenCode submitPayload idempotency requires a POST request.".to_string(),
        };
    }
    let Some(provider_conversation_id) = parse_submit_session_id(input.path) else {
        return OpenCodeIdempotencyAction::Reject {
            status: 400,
            message: "OpenCode submitPayload idempotency requires a /session/{sessionId}/message or /session/{sessionId}/prompt_async request.".to_string(),
        };
    };
    let Some(body) = input.body else {
        return OpenCodeIdempotencyAction::Reject {
            status: 400,
            message: "OpenCode submitPayload idempotency requires a JSON object request body."
                .to_string(),
        };
    };
    let Some(body_object) = body.as_object_mut() else {
        return OpenCodeIdempotencyAction::Reject {
            status: 400,
            message: "OpenCode submitPayload idempotency requires a JSON object request body."
                .to_string(),
        };
    };

    let message_id = deterministic_message_id(&idempotency.key);
    match body_object.get("messageID") {
        Some(Value::String(existing_message_id)) if existing_message_id == &message_id => {}
        Some(Value::String(_)) => {
            return OpenCodeIdempotencyAction::Reject {
                status: 409,
                message: "OpenCode submitPayload idempotency messageID conflicts with the deterministic idempotency messageID.".to_string(),
            };
        }
        Some(_) => {
            return OpenCodeIdempotencyAction::Reject {
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

    prepare_started_idempotency(
        PrepareStartedIdempotencyInput {
            idempotency,
            operation: IdempotencyOperation::SubmitPayload,
            provider_conversation_id: Some(provider_conversation_id),
            message_id: Some(message_id),
            store: input.store,
        },
        "OpenCode submitPayload",
    )
}

struct PrepareStartedIdempotencyInput<'a> {
    idempotency: OpenCodeProxyIdempotency,
    message_id: Option<String>,
    operation: IdempotencyOperation,
    provider_conversation_id: Option<String>,
    store: Option<&'a SharedIdempotencyStore>,
}

fn prepare_started_idempotency(
    input: PrepareStartedIdempotencyInput<'_>,
    label: &str,
) -> OpenCodeIdempotencyAction {
    let Some(store) = input.store else {
        return OpenCodeIdempotencyAction::Reject {
            status: 500,
            message: format!("{label} idempotency store is not configured."),
        };
    };
    let now = match now_timestamp() {
        Ok(now) => now,
        Err(error) => {
            return OpenCodeIdempotencyAction::Reject {
                status: 500,
                message: error.to_string(),
            };
        }
    };
    let start_result = match lock_store(store).and_then(|mut store| {
        match store.get_by_key(
            AgentRuntimeId::OpenCode,
            input.operation.clone(),
            &input.idempotency.key,
        ) {
            Ok(record) => Ok(OpenCodeSubmitStartResult::Existing(record.clone())),
            Err(IdempotencyStoreError::MissingRecord { .. }) => {
                start_opencode_record(&mut store, &input.idempotency, input.operation.clone(), now)
            }
            Err(error) => Err(error),
        }
    }) {
        Ok(result) => result,
        Err(error) => {
            return OpenCodeIdempotencyAction::Reject {
                status: store_error_status(&error),
                message: error.to_string(),
            };
        }
    };

    match start_result {
        OpenCodeSubmitStartResult::Created(record) => {
            if record.status != IdempotencyRecordStatus::Started {
                return OpenCodeIdempotencyAction::Reject {
                    status: 500,
                    message: format!(
                        "{label} idempotency key '{}' did not start in started status.",
                        record.key,
                    ),
                };
            }
            OpenCodeIdempotencyAction::Forward(StartedOpenCodeOperation {
                idempotency: input.idempotency,
                message_id: input.message_id,
                operation: input.operation,
                provider_conversation_id: input.provider_conversation_id,
            })
        }
        OpenCodeSubmitStartResult::Existing(record) => {
            let outcome =
                match record.classify_repeated_request(&input.idempotency.request_fingerprint) {
                    Ok(outcome) => outcome,
                    Err(error) => {
                        return OpenCodeIdempotencyAction::Reject {
                            status: 409,
                            message: error.to_string(),
                        };
                    }
                };
            if outcome == RepeatedRequestOutcome::Completed {
                return match record.response {
                    Some(response) => {
                        match serde_json::from_value::<StoredOpenCodeProxyResponse>(response) {
                            Ok(response) => OpenCodeIdempotencyAction::Replay(response),
                            Err(error) => OpenCodeIdempotencyAction::Reject {
                                status: 500,
                                message: format!(
                                    "{label} idempotency response is invalid: {error}"
                                ),
                            },
                        }
                    }
                    None => OpenCodeIdempotencyAction::Reject {
                        status: 500,
                        message: format!(
                            "{label} idempotency key '{}' completed without a response.",
                            record.key
                        ),
                    },
                };
            }
            OpenCodeIdempotencyAction::Reject {
                status: 409,
                message: format!(
                    "{label} idempotency key '{}' has unresolved status {:?}.",
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

fn start_opencode_record(
    store: &mut IdempotencyStore,
    idempotency: &OpenCodeProxyIdempotency,
    operation: IdempotencyOperation,
    now: String,
) -> Result<OpenCodeSubmitStartResult, IdempotencyStoreError> {
    store
        .start_operation(StartIdempotencyOperation {
            key: idempotency.key.clone(),
            runtime_id: AgentRuntimeId::OpenCode,
            operation,
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
    started: StartedOpenCodeOperation,
    response: StoredOpenCodeProxyResponse,
) -> Result<(), OpenCodeProxyError> {
    let now = now_timestamp()?;
    let provider_conversation_id = match started.operation {
        IdempotencyOperation::CreateConversation => {
            extract_created_session_id(&response)?.or(started.provider_conversation_id.clone())
        }
        IdempotencyOperation::SubmitPayload => started.provider_conversation_id.clone(),
    };
    let provider_execution_id = match started.operation {
        IdempotencyOperation::CreateConversation => None,
        IdempotencyOperation::SubmitPayload => provider_conversation_id
            .as_ref()
            .map(|id| format!("{OPENCODE_PROVIDER_EXECUTION_ID_PREFIX}:{id}")),
    };
    let runtime_artifact_hint = started.message_id.as_ref().map(|message_id| {
        json!({
            "messageId": message_id,
        })
    });
    let response_value = serde_json::to_value(response)
        .map_err(|error| OpenCodeProxyError::ConfigureRuntime(error.to_string()))?;
    let mut store = lock_store(store).map_err(map_store_error)?;
    store
        .mark_completed(
            AgentRuntimeId::OpenCode,
            started.operation,
            &started.idempotency.key,
            CompleteIdempotencyOperation {
                request_fingerprint: started.idempotency.request_fingerprint,
                provider_conversation_id,
                provider_execution_id,
                runtime_artifact_hint,
                response: response_value,
                now,
            },
        )
        .map(|_| ())
        .map_err(map_store_error)
}

pub(super) fn delete_started_submit_idempotency(
    store: &SharedIdempotencyStore,
    started: &StartedOpenCodeOperation,
) -> Result<(), OpenCodeProxyError> {
    let mut store = lock_store(store).map_err(map_store_error)?;
    store
        .delete_started(
            AgentRuntimeId::OpenCode,
            started.operation.clone(),
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

fn is_create_session_path(path: &str) -> bool {
    let path_without_query = path.split_once('?').map_or(path, |(path, _)| path);
    let mut parts = path_without_query
        .split('/')
        .filter(|part| !part.is_empty());
    parts.next() == Some("session") && parts.next().is_none()
}

fn parse_submit_session_id(path: &str) -> Option<String> {
    let path_without_query = path.split_once('?').map_or(path, |(path, _)| path);
    let mut parts = path_without_query
        .split('/')
        .filter(|part| !part.is_empty());
    if parts.next()? != "session" {
        return None;
    }
    let session_id = parts.next()?;
    let submit_endpoint = parts.next()?;
    if session_id.is_empty()
        || (submit_endpoint != "message" && submit_endpoint != "prompt_async")
        || parts.next().is_some()
    {
        return None;
    }
    Some(session_id.to_string())
}

fn extract_created_session_id(
    response: &StoredOpenCodeProxyResponse,
) -> Result<Option<String>, OpenCodeProxyError> {
    if !(200..300).contains(&response.status) {
        return Ok(None);
    }
    let body = serde_json::from_str::<Value>(&response.body)
        .map_err(|error| OpenCodeProxyError::ConfigureRuntime(error.to_string()))?;
    let Some(id) = body.get("id").and_then(Value::as_str) else {
        return Err(OpenCodeProxyError::ConfigureRuntime(
            "OpenCode createConversation idempotency requires successful /session responses to include a string id.".to_string(),
        ));
    };
    Ok(Some(id.to_string()))
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
