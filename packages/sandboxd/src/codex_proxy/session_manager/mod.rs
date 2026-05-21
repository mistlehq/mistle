mod command;
mod logging;
mod request;
mod retention;
mod updates;

use std::sync::{Arc, Mutex, MutexGuard};

use futures_util::StreamExt;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;
use tokio_tungstenite::connect_async;

use crate::codex_proxy::message::parse_thread_status_changed_message;
use crate::codex_proxy::session_manager::command::handle_command;
use crate::codex_proxy::session_manager::logging::emit_session_manager_session_end_log;
use crate::codex_proxy::session_manager::request::{
    initialize_session, mark_all_retained_threads_requested, read_loaded_thread_ids,
    read_loaded_threads,
};
use crate::codex_proxy::session_manager::retention::replay_retained_threads;
use crate::codex_proxy::session_manager::updates::{
    ThreadStatusUpdate, ThreadStatusUpdateSource, apply_pending_updates,
};
use crate::codex_proxy::types::{
    CodexSessionManagerCommand, CodexSessionManagerError, CodexSessionManagerHealthState,
    CodexSessionManagerState, RetainReason,
};
use crate::codex_proxy::{CodexMonitor, CodexProxyError, DEFAULT_CODEX_MONITOR_RECONNECT_INTERVAL};
use crate::keepalive::KeepaliveManager;

#[derive(Clone)]
pub struct CodexSessionManagerHandle {
    command_sender: mpsc::Sender<CodexSessionManagerCommand>,
}

impl CodexSessionManagerHandle {
    pub async fn retain_thread(
        &self,
        thread_id: String,
        reason: RetainReason,
    ) -> Result<(), CodexSessionManagerError> {
        let (reply_sender, reply_receiver) = oneshot::channel();
        self.command_sender
            .send(CodexSessionManagerCommand::RetainThread {
                thread_id,
                reason,
                reply: reply_sender,
            })
            .await
            .map_err(|_| CodexSessionManagerError::CommandChannelClosed)?;
        reply_receiver
            .await
            .map_err(|_| CodexSessionManagerError::CommandChannelClosed)?
    }

    pub async fn release_thread(
        &self,
        thread_id: String,
        reason: RetainReason,
    ) -> Result<(), CodexSessionManagerError> {
        let (reply_sender, reply_receiver) = oneshot::channel();
        self.command_sender
            .send(CodexSessionManagerCommand::ReleaseThread {
                thread_id,
                reason,
                reply: reply_sender,
            })
            .await
            .map_err(|_| CodexSessionManagerError::CommandChannelClosed)?;
        reply_receiver
            .await
            .map_err(|_| CodexSessionManagerError::CommandChannelClosed)?
    }
}

pub fn spawn_codex_session_manager(
    raw_app_server_url: String,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    shutdown_receiver: watch::Receiver<bool>,
) -> (
    CodexSessionManagerHandle,
    JoinHandle<Result<(), CodexProxyError>>,
    watch::Receiver<CodexSessionManagerHealthState>,
) {
    let (command_sender, command_receiver) = mpsc::channel(32);
    let (health_state_sender, health_state_receiver) =
        watch::channel(CodexSessionManagerHealthState::Starting);
    let handle = CodexSessionManagerHandle { command_sender };
    let task = tokio::spawn(async move {
        run_codex_session_manager_loop(
            &raw_app_server_url,
            &keepalive_manager,
            shutdown_receiver,
            command_receiver,
            health_state_sender,
        )
        .await
    });

    (handle, task, health_state_receiver)
}

struct SessionManagerStatusSinks<'a> {
    health_state_sender: &'a watch::Sender<CodexSessionManagerHealthState>,
}

#[derive(Debug)]
struct SessionManagerSessionEnd {
    reason: SessionManagerSessionEndReason,
    error: Option<CodexProxyError>,
}

impl SessionManagerSessionEnd {
    fn completed(reason: SessionManagerSessionEndReason) -> Self {
        Self {
            reason,
            error: None,
        }
    }

    fn failed(reason: SessionManagerSessionEndReason, error: CodexProxyError) -> Self {
        Self {
            reason,
            error: Some(error),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionManagerSessionEndReason {
    ShutdownRequested,
    CommandChannelClosed,
    RawSocketClosed,
    InitializeFailed,
    ReadLoadedThreadIdsFailed,
    ReadLoadedThreadsFailed,
    ApplyInitialUpdatesFailed,
    ReplayRetainedThreadsFailed,
    HandleCommandFailed,
    ReadSocketFailed,
    ApplyStatusUpdateFailed,
}

impl SessionManagerSessionEndReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::ShutdownRequested => "shutdown_requested",
            Self::CommandChannelClosed => "command_channel_closed",
            Self::RawSocketClosed => "raw_socket_closed",
            Self::InitializeFailed => "initialize_failed",
            Self::ReadLoadedThreadIdsFailed => "read_loaded_thread_ids_failed",
            Self::ReadLoadedThreadsFailed => "read_loaded_threads_failed",
            Self::ApplyInitialUpdatesFailed => "apply_initial_updates_failed",
            Self::ReplayRetainedThreadsFailed => "replay_retained_threads_failed",
            Self::HandleCommandFailed => "handle_command_failed",
            Self::ReadSocketFailed => "read_socket_failed",
            Self::ApplyStatusUpdateFailed => "apply_status_update_failed",
        }
    }

    fn level(self) -> &'static str {
        match self {
            Self::ShutdownRequested | Self::CommandChannelClosed => "info",
            Self::RawSocketClosed => "warn",
            Self::InitializeFailed
            | Self::ReadLoadedThreadIdsFailed
            | Self::ReadLoadedThreadsFailed
            | Self::ApplyInitialUpdatesFailed
            | Self::ReplayRetainedThreadsFailed
            | Self::HandleCommandFailed
            | Self::ReadSocketFailed
            | Self::ApplyStatusUpdateFailed => "error",
        }
    }
}

async fn run_codex_session_manager_loop(
    raw_app_server_url: &str,
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
    mut shutdown_receiver: watch::Receiver<bool>,
    mut command_receiver: mpsc::Receiver<CodexSessionManagerCommand>,
    health_state_sender: watch::Sender<CodexSessionManagerHealthState>,
) -> Result<(), CodexProxyError> {
    let mut monitor = CodexMonitor::default();
    let mut manager_state = CodexSessionManagerState::default();

    loop {
        if *shutdown_receiver.borrow() {
            return Ok(());
        }

        let _ = health_state_sender.send(CodexSessionManagerHealthState::Starting);
        let status_sinks = SessionManagerStatusSinks {
            health_state_sender: &health_state_sender,
        };
        let session_end = run_codex_session_manager_session(
            raw_app_server_url,
            &mut monitor,
            &mut manager_state,
            keepalive_manager,
            &status_sinks,
            &mut shutdown_receiver,
            &mut command_receiver,
        )
        .await;
        emit_session_manager_session_end_log(raw_app_server_url, &manager_state, &session_end);

        if let Ok(mut keepalive_manager) = keepalive_manager.lock() {
            monitor.clear(&mut keepalive_manager);
        }
        let _ = health_state_sender.send(CodexSessionManagerHealthState::Disconnected);
        manager_state.initialized = false;
        manager_state.retention_replay_in_progress = false;
        mark_all_retained_threads_requested(&mut manager_state);

        if *shutdown_receiver.borrow() {
            return Ok(());
        }

        tokio::select! {
            _ = shutdown_receiver.changed() => return Ok(()),
            _ = tokio::time::sleep(DEFAULT_CODEX_MONITOR_RECONNECT_INTERVAL) => {}
        }

        if let Some(error) = session_end.error {
            let _ = error;
        }
    }
}

async fn run_codex_session_manager_session(
    raw_app_server_url: &str,
    monitor: &mut CodexMonitor,
    manager_state: &mut CodexSessionManagerState,
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
    status_sinks: &SessionManagerStatusSinks<'_>,
    shutdown_receiver: &mut watch::Receiver<bool>,
    command_receiver: &mut mpsc::Receiver<CodexSessionManagerCommand>,
) -> SessionManagerSessionEnd {
    let (mut socket, _) =
        match (connect_async(raw_app_server_url).await).map_err(CodexProxyError::ConnectRaw) {
            Ok(value) => value,
            Err(error) => {
                return SessionManagerSessionEnd::failed(
                    SessionManagerSessionEndReason::InitializeFailed,
                    error,
                );
            }
        };

    if let Err(error) = initialize_session(&mut socket, shutdown_receiver).await {
        return SessionManagerSessionEnd::failed(
            SessionManagerSessionEndReason::InitializeFailed,
            error,
        );
    }

    let mut pending_updates = Vec::new();
    let loaded_thread_ids =
        match read_loaded_thread_ids(&mut socket, shutdown_receiver, &mut pending_updates).await {
            Ok(value) => value,
            Err(error) => {
                return SessionManagerSessionEnd::failed(
                    SessionManagerSessionEndReason::ReadLoadedThreadIdsFailed,
                    error,
                );
            }
        };
    let threads = match read_loaded_threads(
        &mut socket,
        manager_state,
        shutdown_receiver,
        &loaded_thread_ids,
        &mut pending_updates,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            return SessionManagerSessionEnd::failed(
                SessionManagerSessionEndReason::ReadLoadedThreadsFailed,
                error,
            );
        }
    };

    {
        let mut keepalive_manager = match lock_keepalive_manager(keepalive_manager) {
            Ok(value) => value,
            Err(error) => {
                return SessionManagerSessionEnd::failed(
                    SessionManagerSessionEndReason::ApplyInitialUpdatesFailed,
                    error,
                );
            }
        };
        monitor.rebuild_from_threads(threads.iter().cloned(), &mut keepalive_manager);
    }
    for (thread_id, status) in &threads {
        if let Some(retained_thread) = manager_state.retained_threads.get_mut(thread_id) {
            retained_thread.last_status = Some(status.clone());
        }
    }

    let mut pending_snapshot_updates = pending_updates
        .into_iter()
        .map(|(thread_id, status)| {
            ThreadStatusUpdate::new(thread_id, status, ThreadStatusUpdateSource::StatusChanged)
        })
        .collect::<Vec<_>>();
    if let Err(error) = apply_pending_updates(
        &mut socket,
        manager_state,
        monitor,
        keepalive_manager,
        &mut pending_snapshot_updates,
        shutdown_receiver,
    )
    .await
    {
        return SessionManagerSessionEnd::failed(
            SessionManagerSessionEndReason::ApplyInitialUpdatesFailed,
            error,
        );
    }

    manager_state.initialized = true;
    let _ = status_sinks
        .health_state_sender
        .send(CodexSessionManagerHealthState::Connected);

    if let Err(error) = replay_retained_threads(
        &mut socket,
        manager_state,
        monitor,
        keepalive_manager,
        shutdown_receiver,
    )
    .await
    {
        return SessionManagerSessionEnd::failed(
            SessionManagerSessionEndReason::ReplayRetainedThreadsFailed,
            error,
        );
    }

    loop {
        tokio::select! {
            _ = shutdown_receiver.changed() => {
                return SessionManagerSessionEnd::completed(SessionManagerSessionEndReason::ShutdownRequested);
            }
            command = command_receiver.recv() => {
                match command {
                    Some(command) => {
                        let should_shutdown = match handle_command(
                            command,
                            &mut socket,
                            manager_state,
                            monitor,
                            keepalive_manager,
                            shutdown_receiver,
                        )
                        .await {
                            Ok(should_shutdown) => should_shutdown,
                            Err(error) => {
                                return SessionManagerSessionEnd::failed(
                                    SessionManagerSessionEndReason::HandleCommandFailed,
                                    error,
                                );
                            }
                        };
                        if should_shutdown {
                            return SessionManagerSessionEnd::completed(SessionManagerSessionEndReason::ShutdownRequested);
                        }
                    }
                    None => {
                        return SessionManagerSessionEnd::completed(SessionManagerSessionEndReason::CommandChannelClosed);
                    }
                }
            }
            message = socket.next() => {
                let Some(message) = message else {
                    return SessionManagerSessionEnd::completed(SessionManagerSessionEndReason::RawSocketClosed);
                };
                let message = match message.map_err(CodexProxyError::ReadSocket) {
                    Ok(value) => value,
                    Err(error) => {
                        return SessionManagerSessionEnd::failed(
                            SessionManagerSessionEndReason::ReadSocketFailed,
                            error,
                        );
                    }
                };
                let status_update = match parse_thread_status_changed_message(&message) {
                    Ok(value) => value,
                    Err(error) => {
                        return SessionManagerSessionEnd::failed(
                            SessionManagerSessionEndReason::ReadSocketFailed,
                            error,
                        );
                    }
                };
                if let Some((thread_id, status)) = status_update {
                    let mut pending_updates = vec![ThreadStatusUpdate::new(
                        thread_id,
                        status,
                        ThreadStatusUpdateSource::StatusChanged,
                    )];
                    if let Err(error) = apply_pending_updates(
                        &mut socket,
                        manager_state,
                        monitor,
                        keepalive_manager,
                        &mut pending_updates,
                        shutdown_receiver,
                    )
                    .await
                    {
                        return SessionManagerSessionEnd::failed(
                            SessionManagerSessionEndReason::ApplyStatusUpdateFailed,
                            error,
                        );
                    }
                }
            }
        }
    }
}

fn lock_keepalive_manager(
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
) -> Result<MutexGuard<'_, KeepaliveManager>, CodexProxyError> {
    keepalive_manager.lock().map_err(|error| {
        CodexProxyError::ConfigureRuntime(format!(
            "failed to lock Codex keepalive manager: {error}"
        ))
    })
}

#[cfg(test)]
mod tests {
    use crate::codex_proxy::session_manager::SessionManagerSessionEndReason;

    #[test]
    fn session_end_reason_strings_and_levels_match_expected_values() {
        assert_eq!(
            SessionManagerSessionEndReason::RawSocketClosed.as_str(),
            "raw_socket_closed"
        );
        assert_eq!(
            SessionManagerSessionEndReason::RawSocketClosed.level(),
            "warn"
        );
        assert_eq!(
            SessionManagerSessionEndReason::HandleCommandFailed.as_str(),
            "handle_command_failed"
        );
        assert_eq!(
            SessionManagerSessionEndReason::HandleCommandFailed.level(),
            "error"
        );
    }
}
