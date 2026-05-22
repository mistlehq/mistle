//! Raw Codex JSON-RPC request helpers used by the session manager.
//!
//! These helpers keep request ids, response validation, and Codex method names
//! close to the only code that issues background thread-management calls.

use serde_json::{Value, json};
use tokio::sync::watch;

use crate::codex_proxy::message::{
    RawCodexSocket, parse_thread_loaded_list_response, parse_thread_read_response,
    send_json_message, wait_for_response,
};
use crate::codex_proxy::session_manager::updates::{ThreadStatusUpdate, ThreadStatusUpdateSource};
use crate::codex_proxy::types::CodexSessionManagerState;
use crate::codex_proxy::{CODEX_INITIALIZE_CLIENT_NAME, CodexProxyError, CodexThreadStatus};

const INITIALIZE_CLIENT_TITLE: &str = "Mistle sandboxd Codex session manager";
const INITIALIZE_CLIENT_VERSION: &str = "0.0.0";
const INITIALIZE_REQUEST_ID: u64 = 1;
const THREAD_LOADED_LIST_REQUEST_ID: u64 = 2;
const RELEASE_SUCCESS_MESSAGES: [&str; 2] = ["notsubscribed", "notloaded"];
const MISSING_THREAD_MESSAGES: [&str; 4] = [
    "no rollout found for thread id",
    "thread not found",
    "references missing provider conversation",
    "invalid thread id",
];
// Codex can acknowledge turn/start before a second subscriber can resume the new
// thread, and the live rollout can take several seconds to become resumable to a
// second connection.
const LIVE_RETAIN_RETRY_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);
const LIVE_RETAIN_MAX_ATTEMPTS: usize = 200;

pub(super) const THREAD_RESUME_METHOD: &str = "thread/resume";
pub(super) const THREAD_UNSUBSCRIBE_METHOD: &str = "thread/unsubscribe";

pub(super) async fn initialize_session(
    socket: &mut RawCodexSocket,
    shutdown_receiver: &mut watch::Receiver<bool>,
) -> Result<(), CodexProxyError> {
    let mut pending_updates = Vec::new();
    send_json_message(
        socket,
        json!({
            "method": "initialize",
            "id": INITIALIZE_REQUEST_ID,
            "params": {
                "clientInfo": {
                    "name": CODEX_INITIALIZE_CLIENT_NAME,
                    "title": INITIALIZE_CLIENT_TITLE,
                    "version": INITIALIZE_CLIENT_VERSION
                },
                "capabilities": {
                    "experimentalApi": true
                }
            }
        }),
    )
    .await?;
    let _ = wait_for_response(
        socket,
        INITIALIZE_REQUEST_ID,
        &mut pending_updates,
        shutdown_receiver,
    )
    .await?;
    send_json_message(
        socket,
        json!({
            "method": "initialized",
            "params": {}
        }),
    )
    .await
}

pub(super) async fn read_loaded_thread_ids(
    socket: &mut RawCodexSocket,
    shutdown_receiver: &mut watch::Receiver<bool>,
    pending_updates: &mut Vec<(String, CodexThreadStatus)>,
) -> Result<Vec<String>, CodexProxyError> {
    send_json_message(
        socket,
        json!({
            "method": "thread/loaded/list",
            "id": THREAD_LOADED_LIST_REQUEST_ID,
            "params": {}
        }),
    )
    .await?;
    let loaded_response = wait_for_response(
        socket,
        THREAD_LOADED_LIST_REQUEST_ID,
        pending_updates,
        shutdown_receiver,
    )
    .await?;
    parse_thread_loaded_list_response(&loaded_response)
}

pub(super) async fn read_loaded_threads(
    socket: &mut RawCodexSocket,
    manager_state: &mut CodexSessionManagerState,
    shutdown_receiver: &mut watch::Receiver<bool>,
    loaded_thread_ids: &[String],
    pending_updates: &mut Vec<(String, CodexThreadStatus)>,
) -> Result<Vec<(String, CodexThreadStatus)>, CodexProxyError> {
    let mut next_request_id = manager_state.next_request_id.max(3);
    let mut threads = Vec::with_capacity(loaded_thread_ids.len());

    for thread_id in loaded_thread_ids {
        send_json_message(
            socket,
            json!({
                "method": "thread/read",
                "id": next_request_id,
                "params": {
                    "threadId": thread_id
                }
            }),
        )
        .await?;
        let thread_response =
            wait_for_response(socket, next_request_id, pending_updates, shutdown_receiver).await?;
        let status = parse_thread_read_response(&thread_response)?;
        let thread_id = thread_response["result"]["thread"]["id"]
            .as_str()
            .ok_or_else(|| {
                CodexProxyError::InvalidThreadRead(
                    "thread/read response was missing result.thread.id".to_string(),
                )
            })?
            .to_string();
        threads.push((thread_id, status));
        next_request_id += 1;
    }

    manager_state.next_request_id = next_request_id;
    Ok(threads)
}

pub(super) async fn issue_thread_resume_with_live_retain_retry(
    socket: &mut RawCodexSocket,
    manager_state: &mut CodexSessionManagerState,
    shutdown_receiver: &mut watch::Receiver<bool>,
    thread_id: &str,
) -> Result<(CodexThreadStatus, Vec<ThreadStatusUpdate>), CommandRequestError> {
    for attempt in 0..LIVE_RETAIN_MAX_ATTEMPTS {
        match resume_thread_subscription(socket, manager_state, shutdown_receiver, thread_id).await
        {
            Ok(result) => return Ok(result),
            Err(error)
                if should_retry_live_retain_thread_resume(&error)
                    && attempt + 1 < LIVE_RETAIN_MAX_ATTEMPTS
                    && !*shutdown_receiver.borrow() =>
            {
                tokio::select! {
                    _ = shutdown_receiver.changed() => {
                        return Err(CommandRequestError::Rejected {
                            message: "shutdown requested during live retain retry".to_string(),
                        });
                    }
                    _ = tokio::time::sleep(LIVE_RETAIN_RETRY_INTERVAL) => {}
                }
            }
            Err(error) => return Err(error),
        }
    }

    Err(CommandRequestError::Transport(
        CodexProxyError::ConfigureRuntime(
            "live retain retry exhausted attempts without returning".to_string(),
        ),
    ))
}

pub(super) async fn resume_thread_subscription(
    socket: &mut RawCodexSocket,
    manager_state: &mut CodexSessionManagerState,
    shutdown_receiver: &mut watch::Receiver<bool>,
    thread_id: &str,
) -> Result<(CodexThreadStatus, Vec<ThreadStatusUpdate>), CommandRequestError> {
    let request_id = next_request_id(manager_state);
    let mut pending_updates = Vec::new();
    send_json_message(
        socket,
        json!({
            "method": THREAD_RESUME_METHOD,
            "id": request_id,
            "params": {
                "threadId": thread_id,
                "excludeTurns": true
            }
        }),
    )
    .await
    .map_err(CommandRequestError::Transport)?;
    let response = wait_for_response(socket, request_id, &mut pending_updates, shutdown_receiver)
        .await
        .map_err(CommandRequestError::Transport)?;
    if let Some(message) = parse_response_error_message(&response) {
        return Err(CommandRequestError::Rejected { message });
    }

    let status = parse_thread_read_response(&response).map_err(CommandRequestError::Transport)?;
    Ok((
        status,
        pending_updates
            .into_iter()
            .map(|(thread_id, status)| {
                ThreadStatusUpdate::new(thread_id, status, ThreadStatusUpdateSource::StatusChanged)
            })
            .collect(),
    ))
}

pub(super) async fn unsubscribe_thread(
    socket: &mut RawCodexSocket,
    manager_state: &mut CodexSessionManagerState,
    shutdown_receiver: &mut watch::Receiver<bool>,
    thread_id: &str,
) -> Result<Vec<ThreadStatusUpdate>, CommandRequestError> {
    let request_id = next_request_id(manager_state);
    let mut pending_updates = Vec::new();
    send_json_message(
        socket,
        json!({
            "method": THREAD_UNSUBSCRIBE_METHOD,
            "id": request_id,
            "params": {
                "threadId": thread_id
            }
        }),
    )
    .await
    .map_err(CommandRequestError::Transport)?;
    let response = wait_for_response(socket, request_id, &mut pending_updates, shutdown_receiver)
        .await
        .map_err(CommandRequestError::Transport)?;
    if let Some(message) = parse_response_error_message(&response) {
        return Err(CommandRequestError::Rejected { message });
    }

    Ok(pending_updates
        .into_iter()
        .map(|(thread_id, status)| {
            ThreadStatusUpdate::new(thread_id, status, ThreadStatusUpdateSource::StatusChanged)
        })
        .collect())
}

pub(super) fn mark_all_retained_threads_requested(manager_state: &mut CodexSessionManagerState) {
    for retained_thread in manager_state.retained_threads.values_mut() {
        retained_thread.subscription_state =
            crate::codex_proxy::types::ThreadSubscriptionState::Requested;
    }
}

fn next_request_id(manager_state: &mut CodexSessionManagerState) -> u64 {
    let request_id = manager_state.next_request_id.max(3);
    manager_state.next_request_id = request_id + 1;
    request_id
}

fn parse_response_error_message(response: &Value) -> Option<String> {
    response
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

pub(super) fn is_missing_thread_message(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    MISSING_THREAD_MESSAGES
        .iter()
        .any(|pattern| normalized.contains(pattern))
}

pub(super) fn is_release_success_message(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    RELEASE_SUCCESS_MESSAGES
        .iter()
        .any(|pattern| normalized.contains(pattern))
}

fn should_retry_live_retain_thread_resume(error: &CommandRequestError) -> bool {
    match error {
        CommandRequestError::Rejected { message } => {
            is_missing_thread_message(message)
                || (message.contains("rollout at ") && message.ends_with(" is empty"))
        }
        CommandRequestError::Transport(_) => false,
    }
}

pub(super) enum CommandRequestError {
    Rejected { message: String },
    Transport(CodexProxyError),
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::codex_proxy::session_manager::request::{
        is_missing_thread_message, is_release_success_message, next_request_id,
        parse_response_error_message,
    };
    use crate::codex_proxy::types::CodexSessionManagerState;

    #[test]
    fn next_request_id_starts_at_three() {
        let mut state = CodexSessionManagerState::default();
        assert_eq!(next_request_id(&mut state), 3);
        assert_eq!(next_request_id(&mut state), 4);
    }

    #[test]
    fn parse_response_error_message_reads_error_payload() {
        assert_eq!(
            parse_response_error_message(&json!({
                "error": {
                    "message": "thread not found"
                }
            })),
            Some("thread not found".to_string())
        );
    }

    #[test]
    fn detects_missing_thread_messages() {
        assert!(is_missing_thread_message(
            "no rollout found for thread id thr_123"
        ));
        assert!(is_missing_thread_message("thread not found: thr_123"));
        assert!(!is_missing_thread_message("permission denied"));
    }

    #[test]
    fn treats_not_subscribed_release_error_as_success() {
        assert!(is_release_success_message("notSubscribed"));
        assert!(is_release_success_message("notLoaded"));
        assert!(!is_release_success_message("permission denied"));
    }
}
