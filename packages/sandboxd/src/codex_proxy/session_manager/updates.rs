//! Thread status update handling for the Codex session manager.
//!
//! This module normalizes raw monitor notifications and retained-thread replay
//! results into subscription-state updates, auto-release decisions, and
//! keepalive activity.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use tokio::sync::watch;

use crate::codex_proxy::message::RawCodexSocket;
use crate::codex_proxy::session_manager::lock_keepalive_manager;
use crate::codex_proxy::session_manager::logging::emit_auto_release_triggered_log;
use crate::codex_proxy::session_manager::request::{
    CommandRequestError, is_release_success_message, unsubscribe_thread,
};
use crate::codex_proxy::types::{CodexSessionManagerState, RetainReason, ThreadSubscriptionState};
use crate::codex_proxy::{CodexMonitor, CodexProxyError, CodexThreadStatus};
use crate::keepalive::KeepaliveManager;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ThreadStatusUpdateSource {
    LiveResume,
    ReplayResume,
    StatusChanged,
}

impl ThreadStatusUpdateSource {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::LiveResume => "live_resume",
            Self::ReplayResume => "replay_resume",
            Self::StatusChanged => "status_changed",
        }
    }
}

#[derive(Debug, Clone)]
pub(super) struct ThreadStatusUpdate {
    thread_id: String,
    status: CodexThreadStatus,
    source: ThreadStatusUpdateSource,
}

impl ThreadStatusUpdate {
    pub(super) fn new(
        thread_id: String,
        status: CodexThreadStatus,
        source: ThreadStatusUpdateSource,
    ) -> Self {
        Self {
            thread_id,
            status,
            source,
        }
    }
}

pub(super) async fn apply_pending_updates(
    socket: &mut RawCodexSocket,
    manager_state: &mut CodexSessionManagerState,
    monitor: &mut CodexMonitor,
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
    pending_updates: &mut Vec<ThreadStatusUpdate>,
    shutdown_receiver: &mut watch::Receiver<bool>,
) -> Result<(), CodexProxyError> {
    let mut queued_updates = VecDeque::from(std::mem::take(pending_updates));
    while let Some(update) = queued_updates.pop_front() {
        let additional_updates = apply_one_thread_status_update(
            socket,
            manager_state,
            monitor,
            keepalive_manager,
            shutdown_receiver,
            update,
        )
        .await?;
        queued_updates.extend(additional_updates);
    }
    Ok(())
}

async fn apply_one_thread_status_update(
    socket: &mut RawCodexSocket,
    manager_state: &mut CodexSessionManagerState,
    monitor: &mut CodexMonitor,
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
    shutdown_receiver: &mut watch::Receiver<bool>,
    update: ThreadStatusUpdate,
) -> Result<Vec<ThreadStatusUpdate>, CodexProxyError> {
    let ThreadStatusUpdate {
        thread_id,
        status,
        source,
    } = update;
    {
        let mut keepalive_manager = lock_keepalive_manager(keepalive_manager)?;
        monitor.apply_thread_status(&thread_id, &status, &mut keepalive_manager);
    }

    let Some(retained_thread) = manager_state.retained_threads.get_mut(&thread_id) else {
        return Ok(Vec::new());
    };
    retained_thread.last_status = Some(status.clone());
    if status.is_active() {
        return Ok(Vec::new());
    }

    let Some(mut retained_thread) = manager_state.retained_threads.remove(&thread_id) else {
        return Err(CodexProxyError::ConfigureRuntime(
            "retained thread disappeared while applying status update".to_string(),
        ));
    };
    retained_thread
        .retain_reasons
        .remove(&RetainReason::MistleAgentBackgroundExecution);

    if !retained_thread.retain_reasons.is_empty() {
        manager_state
            .retained_threads
            .insert(thread_id, retained_thread);
        return Ok(Vec::new());
    }

    if matches!(
        retained_thread.subscription_state,
        ThreadSubscriptionState::Subscribed
    ) {
        emit_auto_release_triggered_log(
            &thread_id,
            &status,
            source,
            manager_state.retention_replay_in_progress,
            &retained_thread.subscription_state,
        );
        match unsubscribe_thread(socket, manager_state, shutdown_receiver, &thread_id).await {
            Ok(pending_updates) => return Ok(pending_updates),
            Err(CommandRequestError::Rejected { message })
                if is_release_success_message(&message) => {}
            Err(CommandRequestError::Rejected { message }) => {
                eprintln!(
                    "sandboxd Codex session manager auto-release failed for thread {thread_id}: {message}"
                );
            }
            Err(CommandRequestError::Transport(error)) => return Err(error),
        }
    }

    Ok(Vec::new())
}
