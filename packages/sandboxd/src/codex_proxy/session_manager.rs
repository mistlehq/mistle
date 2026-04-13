use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;
use tokio_tungstenite::connect_async;

use crate::codex_proxy::{
    CODEX_INITIALIZE_CLIENT_NAME, CodexMonitor, CodexProxyError, CodexThreadStatus,
    DEFAULT_CODEX_MONITOR_RECONNECT_INTERVAL, RawCodexSocket, parse_thread_loaded_list_response,
    parse_thread_read_response, parse_thread_status_changed_message, send_json_message,
    wait_for_response,
};
use crate::keepalive::KeepaliveManager;
use crate::runtime::readiness::RuntimeReadinessManager;

const INITIALIZE_CLIENT_TITLE: &str = "Mistle sandboxd Codex session manager";
const INITIALIZE_CLIENT_VERSION: &str = "0.0.0";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RetainReason {
    AutomationBackgroundExecution,
}

type CommandReply = oneshot::Sender<Result<(), CodexSessionManagerError>>;

#[derive(Debug)]
pub enum CodexSessionManagerCommand {
    RetainThread {
        thread_id: String,
        reason: RetainReason,
        reply: CommandReply,
    },
    ReleaseThread {
        thread_id: String,
        reason: RetainReason,
        reply: CommandReply,
    },
    Shutdown,
}

#[derive(Debug)]
pub enum CodexSessionManagerError {
    CommandChannelClosed,
    UnsupportedUntilPr2 { command_name: &'static str },
}

impl std::fmt::Display for CodexSessionManagerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CommandChannelClosed => {
                write!(f, "Codex session manager command channel is closed")
            }
            Self::UnsupportedUntilPr2 { command_name } => {
                write!(
                    f,
                    "Codex session manager command '{command_name}' is unsupported until PR 2"
                )
            }
        }
    }
}

impl std::error::Error for CodexSessionManagerError {}

#[derive(Clone)]
pub struct CodexSessionManagerHandle {
    command_sender: mpsc::Sender<CodexSessionManagerCommand>,
}

impl CodexSessionManagerHandle {
    pub async fn retain_thread(
        &self,
        _thread_id: String,
        _reason: RetainReason,
    ) -> Result<(), CodexSessionManagerError> {
        let _ = self.command_sender.is_closed();
        Err(CodexSessionManagerError::UnsupportedUntilPr2 {
            command_name: "RetainThread",
        })
    }

    pub async fn release_thread(
        &self,
        _thread_id: String,
        _reason: RetainReason,
    ) -> Result<(), CodexSessionManagerError> {
        let _ = self.command_sender.is_closed();
        Err(CodexSessionManagerError::UnsupportedUntilPr2 {
            command_name: "ReleaseThread",
        })
    }
}

pub fn spawn_codex_session_manager(
    raw_app_server_url: String,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    shutdown_receiver: watch::Receiver<bool>,
) -> (
    CodexSessionManagerHandle,
    JoinHandle<Result<(), CodexProxyError>>,
) {
    let (command_sender, command_receiver) = mpsc::channel(32);
    let handle = CodexSessionManagerHandle { command_sender };
    let task = tokio::spawn(async move {
        run_codex_session_manager_loop(
            &raw_app_server_url,
            &keepalive_manager,
            &runtime_readiness_manager,
            shutdown_receiver,
            command_receiver,
        )
        .await
    });

    (handle, task)
}

async fn run_codex_session_manager_loop(
    raw_app_server_url: &str,
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: &Arc<Mutex<RuntimeReadinessManager>>,
    mut shutdown_receiver: watch::Receiver<bool>,
    mut command_receiver: mpsc::Receiver<CodexSessionManagerCommand>,
) -> Result<(), CodexProxyError> {
    let mut monitor = CodexMonitor::default();

    loop {
        if *shutdown_receiver.borrow() {
            return Ok(());
        }

        while let Ok(command) = command_receiver.try_recv() {
            if handle_unsupported_command(command) {
                return Ok(());
            }
        }

        let session_result = run_codex_session_manager_session(
            raw_app_server_url,
            &mut monitor,
            keepalive_manager,
            runtime_readiness_manager,
            &mut shutdown_receiver,
            &mut command_receiver,
        )
        .await;

        if let Ok(mut keepalive_manager) = keepalive_manager.lock() {
            monitor.clear(&mut keepalive_manager);
        }
        if let Ok(mut runtime_readiness_manager) = runtime_readiness_manager.lock() {
            runtime_readiness_manager.set_ready(false);
        }

        if *shutdown_receiver.borrow() {
            return Ok(());
        }

        tokio::select! {
            _ = shutdown_receiver.changed() => return Ok(()),
            _ = tokio::time::sleep(DEFAULT_CODEX_MONITOR_RECONNECT_INTERVAL.into()) => {}
            command = command_receiver.recv() => {
                match command {
                    Some(command) => {
                        if handle_unsupported_command(command) {
                            return Ok(());
                        }
                    }
                    None => return Ok(()),
                }
            }
        }

        if let Err(error) = session_result {
            let _ = error;
        }
    }
}

async fn run_codex_session_manager_session(
    raw_app_server_url: &str,
    monitor: &mut CodexMonitor,
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: &Arc<Mutex<RuntimeReadinessManager>>,
    shutdown_receiver: &mut watch::Receiver<bool>,
    command_receiver: &mut mpsc::Receiver<CodexSessionManagerCommand>,
) -> Result<(), CodexProxyError> {
    let (mut socket, _) = connect_async(raw_app_server_url)
        .await
        .map_err(CodexProxyError::ConnectRaw)?;

    initialize_session(&mut socket, shutdown_receiver).await?;

    let mut pending_updates = Vec::new();
    let loaded_thread_ids =
        read_loaded_thread_ids(&mut socket, shutdown_receiver, &mut pending_updates).await?;
    let threads = read_loaded_threads(
        &mut socket,
        shutdown_receiver,
        &loaded_thread_ids,
        &mut pending_updates,
    )
    .await?;

    {
        let mut keepalive_manager = keepalive_manager
            .lock()
            .expect("Codex keepalive manager lock should not be poisoned");
        monitor.rebuild_from_threads(threads, &mut keepalive_manager);
        for (thread_id, status) in pending_updates.drain(..) {
            monitor.apply_thread_status(&thread_id, &status, &mut keepalive_manager);
        }
    }
    runtime_readiness_manager
        .lock()
        .expect("Codex runtime readiness manager lock should not be poisoned")
        .set_ready(true);

    loop {
        tokio::select! {
            _ = shutdown_receiver.changed() => return Ok(()),
            command = command_receiver.recv() => {
                match command {
                    Some(command) => {
                        if handle_unsupported_command(command) {
                            return Ok(());
                        }
                    }
                    None => return Ok(()),
                }
            }
            message = socket.next() => {
                let Some(message) = message else {
                    return Ok(());
                };
                let message = message.map_err(CodexProxyError::ReadSocket)?;
                if let Some((thread_id, status)) = parse_thread_status_changed_message(&message)? {
                    let mut keepalive_manager = keepalive_manager
                        .lock()
                        .expect("Codex keepalive manager lock should not be poisoned");
                    monitor.apply_thread_status(&thread_id, &status, &mut keepalive_manager);
                }
            }
        }
    }
}

async fn initialize_session(
    socket: &mut RawCodexSocket,
    shutdown_receiver: &mut watch::Receiver<bool>,
) -> Result<(), CodexProxyError> {
    let mut pending_updates = Vec::new();
    send_json_message(
        socket,
        serde_json::json!({
            "method": "initialize",
            "id": 1,
            "params": {
                "clientInfo": {
                    "name": CODEX_INITIALIZE_CLIENT_NAME,
                    "title": INITIALIZE_CLIENT_TITLE,
                    "version": INITIALIZE_CLIENT_VERSION
                }
            }
        }),
    )
    .await?;
    let _ = wait_for_response(socket, 1, &mut pending_updates, shutdown_receiver).await?;
    send_json_message(
        socket,
        serde_json::json!({
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
        serde_json::json!({
            "method": "thread/loaded/list",
            "id": 2,
            "params": {}
        }),
    )
    .await?;
    let loaded_response = wait_for_response(socket, 2, pending_updates, shutdown_receiver).await?;
    parse_thread_loaded_list_response(&loaded_response)
}

async fn read_loaded_threads(
    socket: &mut RawCodexSocket,
    shutdown_receiver: &mut watch::Receiver<bool>,
    loaded_thread_ids: &[String],
    pending_updates: &mut Vec<(String, CodexThreadStatus)>,
) -> Result<Vec<(String, CodexThreadStatus)>, CodexProxyError> {
    let mut next_request_id = 3;
    let mut threads = Vec::with_capacity(loaded_thread_ids.len());
    for thread_id in loaded_thread_ids {
        send_json_message(
            socket,
            serde_json::json!({
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
                    "thread/read response is missing thread.id".to_string(),
                )
            })?
            .to_string();
        threads.push((thread_id, status));
        next_request_id += 1;
    }

    Ok(threads)
}

fn handle_unsupported_command(command: CodexSessionManagerCommand) -> bool {
    match command {
        CodexSessionManagerCommand::RetainThread { reply, .. } => {
            let _ = reply.send(Err(CodexSessionManagerError::UnsupportedUntilPr2 {
                command_name: "RetainThread",
            }));
            false
        }
        CodexSessionManagerCommand::ReleaseThread { reply, .. } => {
            let _ = reply.send(Err(CodexSessionManagerError::UnsupportedUntilPr2 {
                command_name: "ReleaseThread",
            }));
            false
        }
        CodexSessionManagerCommand::Shutdown => true,
    }
}

#[cfg(test)]
mod tests {
    use tokio::sync::oneshot;

    use crate::codex_proxy::session_manager::{
        CodexSessionManagerCommand, CodexSessionManagerError, RetainReason,
        handle_unsupported_command,
    };

    #[test]
    fn unsupported_commands_reply_deterministically() {
        let (reply_sender, reply_receiver) = oneshot::channel();

        let should_shutdown =
            handle_unsupported_command(CodexSessionManagerCommand::RetainThread {
                thread_id: "thr_123".to_string(),
                reason: RetainReason::AutomationBackgroundExecution,
                reply: reply_sender,
            });

        assert!(!should_shutdown);
        match reply_receiver.blocking_recv() {
            Ok(Err(CodexSessionManagerError::UnsupportedUntilPr2 { command_name })) => {
                assert_eq!(command_name, "RetainThread");
            }
            other => panic!("unexpected reply: {other:?}"),
        }
    }
}
