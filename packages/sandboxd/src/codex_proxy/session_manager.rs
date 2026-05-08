use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde_json::{Map, Value, json};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;
use tokio_tungstenite::connect_async;

use crate::codex_proxy::types::{
    CodexSessionManagerCommand, CodexSessionManagerError, CodexSessionManagerHealthState,
    CodexSessionManagerState, RetainReason, ThreadSubscriptionState,
};
use crate::codex_proxy::{
    CODEX_INITIALIZE_CLIENT_NAME, CodexMonitor, CodexProxyError, CodexThreadStatus,
    DEFAULT_CODEX_MONITOR_RECONNECT_INTERVAL, RawCodexSocket, parse_thread_loaded_list_response,
    parse_thread_read_response, parse_thread_status_changed_message, send_json_message,
    wait_for_response,
};
use crate::keepalive::KeepaliveManager;
use crate::time::{Clock, SystemClock, format_rfc3339_timestamp};

const INITIALIZE_CLIENT_TITLE: &str = "Mistle sandboxd Codex session manager";
const INITIALIZE_CLIENT_VERSION: &str = "0.0.0";
const INITIALIZE_REQUEST_ID: u64 = 1;
const THREAD_LOADED_LIST_REQUEST_ID: u64 = 2;
const THREAD_RESUME_METHOD: &str = "thread/resume";
const THREAD_UNSUBSCRIBE_METHOD: &str = "thread/unsubscribe";
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ThreadStatusUpdateSource {
    LiveResume,
    ReplayResume,
    StatusChanged,
}

impl ThreadStatusUpdateSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::LiveResume => "live_resume",
            Self::ReplayResume => "replay_resume",
            Self::StatusChanged => "status_changed",
        }
    }
}

#[derive(Debug, Clone)]
struct ThreadStatusUpdate {
    thread_id: String,
    status: CodexThreadStatus,
    source: ThreadStatusUpdateSource,
}

impl ThreadStatusUpdate {
    fn new(thread_id: String, status: CodexThreadStatus, source: ThreadStatusUpdateSource) -> Self {
        Self {
            thread_id,
            status,
            source,
        }
    }
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
        let mut keepalive_manager = keepalive_manager
            .lock()
            .expect("Codex keepalive manager lock should not be poisoned");
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

async fn handle_command(
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

async fn replay_retained_threads(
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

async fn apply_pending_updates(
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
        let mut keepalive_manager = keepalive_manager
            .lock()
            .expect("Codex keepalive manager lock should not be poisoned");
        monitor.apply_thread_status(&thread_id, &status, &mut keepalive_manager);
    }

    let Some(retained_thread) = manager_state.retained_threads.get_mut(&thread_id) else {
        return Ok(Vec::new());
    };
    retained_thread.last_status = Some(status.clone());
    if status.is_active() {
        return Ok(Vec::new());
    }

    let mut retained_thread = manager_state
        .retained_threads
        .remove(&thread_id)
        .expect("retained thread should still exist");
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

async fn initialize_session(
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

async fn read_loaded_thread_ids(
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

async fn read_loaded_threads(
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

async fn issue_thread_resume_with_live_retain_retry(
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

    unreachable!("live retain retry loop should return before exhausting attempts");
}

async fn resume_thread_subscription(
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

async fn unsubscribe_thread(
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

fn next_request_id(manager_state: &mut CodexSessionManagerState) -> u64 {
    let request_id = manager_state.next_request_id.max(3);
    manager_state.next_request_id = request_id + 1;
    request_id
}

fn mark_all_retained_threads_requested(manager_state: &mut CodexSessionManagerState) {
    for retained_thread in manager_state.retained_threads.values_mut() {
        retained_thread.subscription_state = ThreadSubscriptionState::Requested;
    }
}

fn parse_response_error_message(response: &Value) -> Option<String> {
    response
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn is_missing_thread_message(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    MISSING_THREAD_MESSAGES
        .iter()
        .any(|pattern| normalized.contains(pattern))
}

fn is_release_success_message(message: &str) -> bool {
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

enum CommandRequestError {
    Rejected { message: String },
    Transport(CodexProxyError),
}

enum CommandExecutionError {
    Command(CodexSessionManagerError),
    Transport(CodexProxyError),
}

fn emit_session_manager_session_end_log(
    raw_app_server_url: &str,
    manager_state: &CodexSessionManagerState,
    session_end: &SessionManagerSessionEnd,
) {
    let mut attributes = vec![
        ("component", Value::String("CodexProxy".to_string())),
        (
            "rawAppServerUrl",
            Value::String(raw_app_server_url.to_string()),
        ),
        (
            "reason",
            Value::String(session_end.reason.as_str().to_string()),
        ),
        (
            "retainedThreadCount",
            Value::from(manager_state.retained_threads.len() as u64),
        ),
        ("initialized", Value::Bool(manager_state.initialized)),
        (
            "retentionReplayInProgress",
            Value::Bool(manager_state.retention_replay_in_progress),
        ),
    ];
    if let Some(error) = &session_end.error {
        attributes.push(("error", Value::String(error.to_string())));
    }

    emit_session_manager_log(
        session_end.reason.level(),
        "codex_session_manager_session_ended",
        attributes,
    );
}

fn emit_replay_resume_status_log(
    event: &str,
    thread_id: &str,
    status: &CodexThreadStatus,
    source: ThreadStatusUpdateSource,
) {
    emit_session_manager_log(
        "info",
        event,
        vec![
            ("component", Value::String("CodexProxy".to_string())),
            ("threadId", Value::String(thread_id.to_string())),
            (
                "status",
                Value::String(thread_status_name(status).to_string()),
            ),
            ("statusSource", Value::String(source.as_str().to_string())),
        ],
    );
}

fn emit_auto_release_triggered_log(
    thread_id: &str,
    status: &CodexThreadStatus,
    source: ThreadStatusUpdateSource,
    retention_replay_in_progress: bool,
    subscription_state: &ThreadSubscriptionState,
) {
    emit_session_manager_log(
        "warn",
        "codex_session_manager_auto_release_triggered",
        vec![
            ("component", Value::String("CodexProxy".to_string())),
            ("threadId", Value::String(thread_id.to_string())),
            (
                "status",
                Value::String(thread_status_name(status).to_string()),
            ),
            ("statusSource", Value::String(source.as_str().to_string())),
            (
                "subscriptionState",
                Value::String(thread_subscription_state_name(subscription_state).to_string()),
            ),
            (
                "retentionReplayInProgress",
                Value::Bool(retention_replay_in_progress),
            ),
        ],
    );
}

fn emit_session_manager_log(level: &str, event: &str, attributes: Vec<(&str, Value)>) {
    let Some(line) = serialize_session_manager_log_line(&SystemClock, level, event, &attributes)
    else {
        return;
    };
    eprint!("{line}");
}

fn serialize_session_manager_log_line(
    clock: &dyn Clock,
    level: &str,
    event: &str,
    attributes: &[(&str, Value)],
) -> Option<String> {
    let timestamp = format_rfc3339_timestamp(clock.now_system_time()).ok()?;
    let mut payload = Map::new();
    payload.insert("timestamp".to_string(), Value::String(timestamp));
    payload.insert("level".to_string(), Value::String(level.to_string()));
    payload.insert("event".to_string(), Value::String(event.to_string()));

    for (key, value) in attributes {
        payload.insert((*key).to_string(), value.clone());
    }

    let mut line = serde_json::to_string(&Value::Object(payload)).ok()?;
    line.push('\n');
    Some(line)
}

fn thread_status_name(status: &CodexThreadStatus) -> &'static str {
    match status {
        CodexThreadStatus::NotLoaded => "NotLoaded",
        CodexThreadStatus::Idle => "Idle",
        CodexThreadStatus::SystemError => "SystemError",
        CodexThreadStatus::Active { .. } => "Active",
    }
}

fn thread_subscription_state_name(state: &ThreadSubscriptionState) -> &'static str {
    match state {
        ThreadSubscriptionState::Requested => "Requested",
        ThreadSubscriptionState::Subscribed => "Subscribed",
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;
    use serde_json::json;
    use tokio::sync::oneshot;

    use crate::codex_proxy::CodexThreadStatus;
    use crate::codex_proxy::session_manager::{
        CommandExecutionError, SessionManagerSessionEndReason, THREAD_RESUME_METHOD,
        THREAD_UNSUBSCRIBE_METHOD, ThreadStatusUpdateSource, is_missing_thread_message,
        is_release_success_message, next_request_id, parse_response_error_message,
        reply_with_command_result, serialize_session_manager_log_line,
    };
    use crate::codex_proxy::types::{
        CodexSessionManagerCommand, CodexSessionManagerError, CodexSessionManagerState,
        RetainReason,
    };
    use crate::time::testing::MutableClock;

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

    #[test]
    fn thread_status_update_source_strings_match_log_fields() {
        assert_eq!(ThreadStatusUpdateSource::LiveResume.as_str(), "live_resume");
        assert_eq!(
            ThreadStatusUpdateSource::ReplayResume.as_str(),
            "replay_resume"
        );
        assert_eq!(
            ThreadStatusUpdateSource::StatusChanged.as_str(),
            "status_changed"
        );
    }

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

    #[test]
    fn serialize_session_manager_log_line_emits_otel_compatible_jsonl() {
        let clock = MutableClock::new(1_650_000_000_000);
        let line = serialize_session_manager_log_line(
            &clock,
            "warn",
            "codex_session_manager_auto_release_triggered",
            &[
                ("component", Value::String("CodexProxy".to_string())),
                ("threadId", Value::String("thr_123".to_string())),
                ("status", Value::String("Idle".to_string())),
            ],
        )
        .expect("log line should serialize");

        let payload: Value = serde_json::from_str(&line).expect("line should parse as JSON");
        assert_eq!(payload["level"], Value::String("warn".to_string()));
        assert_eq!(
            payload["event"],
            Value::String("codex_session_manager_auto_release_triggered".to_string())
        );
        assert_eq!(
            payload["component"],
            Value::String("CodexProxy".to_string())
        );
        assert_eq!(payload["threadId"], Value::String("thr_123".to_string()));
        assert_eq!(payload["status"], Value::String("Idle".to_string()));
        assert_eq!(
            payload["timestamp"],
            Value::String("2022-04-15T05:20:00Z".to_string())
        );
    }

    #[test]
    fn thread_status_name_uses_codex_status_labels() {
        assert_eq!(
            super::thread_status_name(&CodexThreadStatus::NotLoaded),
            "NotLoaded"
        );
        assert_eq!(super::thread_status_name(&CodexThreadStatus::Idle), "Idle");
        assert_eq!(
            super::thread_status_name(&CodexThreadStatus::SystemError),
            "SystemError"
        );
        assert_eq!(
            super::thread_status_name(&CodexThreadStatus::Active {
                active_flags: Vec::new(),
            }),
            "Active"
        );
    }
}
