use std::sync::{Arc, Mutex};

use tokio::sync::watch;

use crate::codex_proxy::message::RawCodexSocket;
use crate::codex_proxy::session_manager::logging::emit_replay_resume_status_log;
use crate::codex_proxy::session_manager::request::{
    CommandRequestError, is_missing_thread_message, resume_thread_subscription,
};
use crate::codex_proxy::session_manager::updates::{
    ThreadStatusUpdate, ThreadStatusUpdateSource, apply_pending_updates,
};
use crate::codex_proxy::types::{CodexSessionManagerState, ThreadSubscriptionState};
use crate::codex_proxy::{CodexMonitor, CodexProxyError};
use crate::keepalive::KeepaliveManager;

pub(super) async fn replay_retained_threads(
    socket: &mut RawCodexSocket,
    manager_state: &mut CodexSessionManagerState,
    monitor: &mut CodexMonitor,
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
    shutdown_receiver: &mut watch::Receiver<bool>,
) -> Result<(), CodexProxyError> {
    manager_state.retention_replay_in_progress = true;
    let retained_thread_ids = manager_state
        .retained_threads
        .keys()
        .cloned()
        .collect::<Vec<_>>();

    for thread_id in retained_thread_ids {
        let should_replay = manager_state
            .retained_threads
            .get(&thread_id)
            .map(|retained_thread| {
                !retained_thread.retain_reasons.is_empty()
                    && matches!(
                        retained_thread.subscription_state,
                        ThreadSubscriptionState::Requested
                    )
            })
            .unwrap_or(false);
        if !should_replay {
            continue;
        }

        match resume_thread_subscription(socket, manager_state, shutdown_receiver, &thread_id).await
        {
            Ok((status, mut pending_updates)) => {
                emit_replay_resume_status_log(
                    "codex_session_manager_replay_resume_status",
                    &thread_id,
                    &status,
                    ThreadStatusUpdateSource::ReplayResume,
                );
                if let Some(retained_thread) = manager_state.retained_threads.get_mut(&thread_id) {
                    retained_thread.last_status = Some(status.clone());
                    retained_thread.subscription_state = ThreadSubscriptionState::Subscribed;
                }
                pending_updates.insert(
                    0,
                    ThreadStatusUpdate::new(
                        thread_id.clone(),
                        status,
                        ThreadStatusUpdateSource::ReplayResume,
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
                .await?;
            }
            Err(CommandRequestError::Rejected { message })
                if is_missing_thread_message(&message) =>
            {
                eprintln!(
                    "sandboxd Codex session manager removed stale retained thread {thread_id}: {message}"
                );
                manager_state.retained_threads.remove(&thread_id);
            }
            Err(CommandRequestError::Rejected { message }) => {
                eprintln!(
                    "sandboxd Codex session manager failed to replay retained thread {thread_id}: {message}"
                );
            }
            Err(CommandRequestError::Transport(error)) => {
                manager_state.retention_replay_in_progress = false;
                return Err(error);
            }
        }
    }

    manager_state.retention_replay_in_progress = false;
    Ok(())
}
