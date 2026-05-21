use std::sync::{Arc, Mutex};

use tokio::sync::{oneshot, watch};

use crate::codex_proxy::message::RawCodexSocket;
use crate::codex_proxy::session_manager::logging::emit_replay_resume_status_log;
use crate::codex_proxy::session_manager::request::{
    CommandRequestError, THREAD_RESUME_METHOD, THREAD_UNSUBSCRIBE_METHOD,
    is_release_success_message, issue_thread_resume_with_live_retain_retry, unsubscribe_thread,
};
use crate::codex_proxy::session_manager::updates::{
    ThreadStatusUpdate, ThreadStatusUpdateSource, apply_pending_updates,
};
use crate::codex_proxy::types::{
    CodexSessionManagerCommand, CodexSessionManagerError, CodexSessionManagerState, RetainReason,
    ThreadSubscriptionState,
};
use crate::codex_proxy::{CodexMonitor, CodexProxyError};
use crate::keepalive::KeepaliveManager;

pub(super) async fn handle_command(
    command: CodexSessionManagerCommand,
    socket: &mut RawCodexSocket,
    manager_state: &mut CodexSessionManagerState,
    monitor: &mut CodexMonitor,
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
    shutdown_receiver: &mut watch::Receiver<bool>,
) -> Result<bool, CodexProxyError> {
    match command {
        CodexSessionManagerCommand::RetainThread {
            thread_id,
            reason,
            reply,
        } => {
            let result = handle_retain_thread(
                socket,
                manager_state,
                monitor,
                keepalive_manager,
                shutdown_receiver,
                &thread_id,
                reason,
            )
            .await;
            reply_with_command_result(reply, THREAD_RESUME_METHOD, result)?;
            Ok(false)
        }
        CodexSessionManagerCommand::ReleaseThread {
            thread_id,
            reason,
            reply,
        } => {
            let result = handle_release_thread(
                socket,
                manager_state,
                monitor,
                keepalive_manager,
                shutdown_receiver,
                &thread_id,
                reason,
            )
            .await;
            reply_with_command_result(reply, THREAD_UNSUBSCRIBE_METHOD, result)?;
            Ok(false)
        }
        CodexSessionManagerCommand::Shutdown => Ok(true),
    }
}

fn reply_with_command_result(
    reply: oneshot::Sender<Result<(), CodexSessionManagerError>>,
    method: &'static str,
    result: Result<(), CommandExecutionError>,
) -> Result<(), CodexProxyError> {
    match result {
        Ok(()) => {
            let _ = reply.send(Ok(()));
            Ok(())
        }
        Err(CommandExecutionError::Command(command_error)) => {
            let _ = reply.send(Err(command_error));
            Ok(())
        }
        Err(CommandExecutionError::Transport(transport_error)) => {
            let _ = reply.send(Err(CodexSessionManagerError::RequestFailed {
                method,
                message: transport_error.to_string(),
            }));
            Err(transport_error)
        }
    }
}

async fn handle_retain_thread(
    socket: &mut RawCodexSocket,
    manager_state: &mut CodexSessionManagerState,
    monitor: &mut CodexMonitor,
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
    shutdown_receiver: &mut watch::Receiver<bool>,
    thread_id: &str,
    reason: RetainReason,
) -> Result<(), CommandExecutionError> {
    let already_subscribed = manager_state
        .retained_threads
        .get(thread_id)
        .map(|state| {
            state.retain_reasons.contains(&reason)
                && matches!(
                    state.subscription_state,
                    ThreadSubscriptionState::Subscribed
                )
        })
        .unwrap_or(false);
    if already_subscribed {
        return Ok(());
    }

    let retained_thread = manager_state
        .retained_threads
        .entry(thread_id.to_string())
        .or_default();
    retained_thread.retain_reasons.insert(reason);
    retained_thread.subscription_state = ThreadSubscriptionState::Requested;

    match issue_thread_resume_with_live_retain_retry(
        socket,
        manager_state,
        shutdown_receiver,
        thread_id,
    )
    .await
    {
        Ok((status, mut pending_updates)) => {
            emit_replay_resume_status_log(
                "codex_session_manager_live_resume_status",
                thread_id,
                &status,
                ThreadStatusUpdateSource::LiveResume,
            );
            if let Some(retained_thread) = manager_state.retained_threads.get_mut(thread_id) {
                retained_thread.last_status = Some(status.clone());
                retained_thread.subscription_state = ThreadSubscriptionState::Subscribed;
            }
            pending_updates.insert(
                0,
                ThreadStatusUpdate::new(
                    thread_id.to_string(),
                    status,
                    ThreadStatusUpdateSource::LiveResume,
                ),
            );
            apply_pending_updates(
                socket,
                manager_state,
                monitor,
                keepalive_manager,
                &mut pending_updates,
                shutdown_receiver,
            )
            .await
            .map_err(CommandExecutionError::Transport)?;
            Ok(())
        }
        Err(CommandRequestError::Rejected { message }) => {
            manager_state.retained_threads.remove(thread_id);
            Err(CommandExecutionError::Command(
                CodexSessionManagerError::RequestRejected {
                    method: THREAD_RESUME_METHOD,
                    message,
                },
            ))
        }
        Err(CommandRequestError::Transport(error)) => Err(CommandExecutionError::Transport(error)),
    }
}

async fn handle_release_thread(
    socket: &mut RawCodexSocket,
    manager_state: &mut CodexSessionManagerState,
    monitor: &mut CodexMonitor,
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
    shutdown_receiver: &mut watch::Receiver<bool>,
    thread_id: &str,
    reason: RetainReason,
) -> Result<(), CommandExecutionError> {
    let Some(retained_thread) = manager_state.retained_threads.get(thread_id).cloned() else {
        return Ok(());
    };
    if !retained_thread.retain_reasons.contains(&reason) {
        return Ok(());
    }
    if retained_thread.retain_reasons.len() > 1 {
        let mut updated_retained_thread = retained_thread;
        updated_retained_thread.retain_reasons.remove(&reason);
        manager_state
            .retained_threads
            .insert(thread_id.to_string(), updated_retained_thread);
        return Ok(());
    }

    if matches!(
        retained_thread.subscription_state,
        ThreadSubscriptionState::Subscribed
    ) {
        match unsubscribe_thread(socket, manager_state, shutdown_receiver, thread_id).await {
            Ok(mut pending_updates) => {
                manager_state.retained_threads.remove(thread_id);
                apply_pending_updates(
                    socket,
                    manager_state,
                    monitor,
                    keepalive_manager,
                    &mut pending_updates,
                    shutdown_receiver,
                )
                .await
                .map_err(CommandExecutionError::Transport)?;
            }
            Err(CommandRequestError::Rejected { message })
                if is_release_success_message(&message) =>
            {
                manager_state.retained_threads.remove(thread_id);
            }
            Err(CommandRequestError::Rejected { message }) => {
                return Err(CommandExecutionError::Command(
                    CodexSessionManagerError::RequestRejected {
                        method: THREAD_UNSUBSCRIBE_METHOD,
                        message,
                    },
                ));
            }
            Err(CommandRequestError::Transport(error)) => {
                return Err(CommandExecutionError::Transport(error));
            }
        }
    } else {
        manager_state.retained_threads.remove(thread_id);
    }

    Ok(())
}

enum CommandExecutionError {
    Command(CodexSessionManagerError),
    Transport(CodexProxyError),
}

#[cfg(test)]
mod tests {
    use tokio::sync::oneshot;

    use crate::codex_proxy::session_manager::command::{
        CommandExecutionError, reply_with_command_result,
    };
    use crate::codex_proxy::session_manager::request::{
        THREAD_RESUME_METHOD, THREAD_UNSUBSCRIBE_METHOD,
    };
    use crate::codex_proxy::types::{
        CodexSessionManagerCommand, CodexSessionManagerError, RetainReason,
    };

    #[test]
    fn reply_with_transport_error_maps_to_request_failed() {
        let (reply_sender, reply_receiver) = oneshot::channel();
        let result = reply_with_command_result(
            reply_sender,
            THREAD_RESUME_METHOD,
            Err(CommandExecutionError::Transport(
                crate::codex_proxy::CodexProxyError::MissingResponseId { expected_id: 7 },
            )),
        );

        assert!(result.is_err());
        match reply_receiver.blocking_recv() {
            Ok(Err(CodexSessionManagerError::RequestFailed { method, .. })) => {
                assert_eq!(method, THREAD_RESUME_METHOD);
            }
            other => panic!("unexpected reply: {other:?}"),
        }
    }

    #[test]
    fn reply_with_command_error_returns_without_transport_failure() {
        let (reply_sender, reply_receiver) = oneshot::channel();
        let result = reply_with_command_result(
            reply_sender,
            THREAD_UNSUBSCRIBE_METHOD,
            Err(CommandExecutionError::Command(
                CodexSessionManagerError::RequestRejected {
                    method: THREAD_UNSUBSCRIBE_METHOD,
                    message: "permission denied".to_string(),
                },
            )),
        );

        assert!(result.is_ok());
        match reply_receiver.blocking_recv() {
            Ok(Err(CodexSessionManagerError::RequestRejected { method, .. })) => {
                assert_eq!(method, THREAD_UNSUBSCRIBE_METHOD);
            }
            other => panic!("unexpected reply: {other:?}"),
        }
    }

    #[test]
    fn command_variants_capture_retain_reason() {
        let (reply_sender, _reply_receiver) = oneshot::channel();
        let command = CodexSessionManagerCommand::RetainThread {
            thread_id: "thr_123".to_string(),
            reason: RetainReason::MistleAgentBackgroundExecution,
            reply: reply_sender,
        };

        match command {
            CodexSessionManagerCommand::RetainThread {
                thread_id, reason, ..
            } => {
                assert_eq!(thread_id, "thr_123");
                assert_eq!(reason, RetainReason::MistleAgentBackgroundExecution);
            }
            _ => panic!("expected retain thread command"),
        }
    }
}
