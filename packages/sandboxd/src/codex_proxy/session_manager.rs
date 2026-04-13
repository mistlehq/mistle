use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread::{self, JoinHandle};

use serde_json::json;
use tungstenite::connect;

use crate::codex_proxy::{
    CODEX_INITIALIZE_CLIENT_NAME, CodexMonitor, CodexProxyError,
    DEFAULT_CODEX_MONITOR_RECONNECT_INTERVAL, DEFAULT_CODEX_PROXY_SOCKET_POLL_INTERVAL,
    configure_raw_socket_timeout, parse_thread_loaded_list_response, parse_thread_read_response,
    parse_thread_status_changed_message, send_json_message, wait_for_response,
};
use crate::keepalive::KeepaliveManager;
use crate::runtime::readiness::RuntimeReadinessManager;
use crate::time::{Duration, Sleeper};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RetainReason {
    AutomationBackgroundExecution,
}

type CommandReply = mpsc::Sender<Result<(), CodexSessionManagerError>>;

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
    SessionPanicked,
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
            Self::SessionPanicked => write!(f, "Codex session manager thread panicked"),
        }
    }
}

impl std::error::Error for CodexSessionManagerError {}

pub struct CodexSessionManager {
    command_sender: mpsc::Sender<CodexSessionManagerCommand>,
    thread: Option<JoinHandle<()>>,
}

impl CodexSessionManager {
    pub fn start(
        raw_app_server_url: &str,
        keepalive_manager: Arc<Mutex<KeepaliveManager>>,
        runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
        shutdown_requested: Arc<AtomicBool>,
        sleeper: Arc<dyn Sleeper>,
    ) -> Self {
        let (command_sender, command_receiver) = mpsc::channel();
        let manager_raw_url = raw_app_server_url.to_string();
        let manager_thread = thread::spawn(move || {
            run_codex_session_manager_loop(
                &manager_raw_url,
                &keepalive_manager,
                &runtime_readiness_manager,
                &shutdown_requested,
                sleeper.as_ref(),
                command_receiver,
            );
        });

        Self {
            command_sender,
            thread: Some(manager_thread),
        }
    }

    pub fn retain_thread(
        &self,
        _thread_id: String,
        _reason: RetainReason,
    ) -> Result<(), CodexSessionManagerError> {
        Err(CodexSessionManagerError::UnsupportedUntilPr2 {
            command_name: "RetainThread",
        })
    }

    pub fn release_thread(
        &self,
        _thread_id: String,
        _reason: RetainReason,
    ) -> Result<(), CodexSessionManagerError> {
        Err(CodexSessionManagerError::UnsupportedUntilPr2 {
            command_name: "ReleaseThread",
        })
    }

    pub fn close(mut self) -> Result<(), CodexSessionManagerError> {
        let _ = self
            .command_sender
            .send(CodexSessionManagerCommand::Shutdown);
        let manager_thread = self
            .thread
            .take()
            .expect("Codex session manager thread should exist");
        if manager_thread.join().is_err() {
            return Err(CodexSessionManagerError::SessionPanicked);
        }

        Ok(())
    }
}

fn run_codex_session_manager_loop(
    raw_app_server_url: &str,
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: &Arc<Mutex<RuntimeReadinessManager>>,
    shutdown_requested: &Arc<AtomicBool>,
    sleeper: &dyn Sleeper,
    command_receiver: mpsc::Receiver<CodexSessionManagerCommand>,
) {
    let mut monitor = CodexMonitor::default();

    while !shutdown_requested.load(Ordering::Relaxed) {
        drain_unsupported_commands(&command_receiver, shutdown_requested);

        let result = run_codex_session_manager_session(
            raw_app_server_url,
            &mut monitor,
            keepalive_manager,
            runtime_readiness_manager,
            DEFAULT_CODEX_PROXY_SOCKET_POLL_INTERVAL,
            shutdown_requested,
            &command_receiver,
        );

        if let Ok(mut keepalive_manager) = keepalive_manager.lock() {
            monitor.clear(&mut keepalive_manager);
        }
        if let Ok(mut runtime_readiness_manager) = runtime_readiness_manager.lock() {
            runtime_readiness_manager.set_ready(false);
        }

        if shutdown_requested.load(Ordering::Relaxed) {
            return;
        }

        if result.is_err() {
            sleep_with_command_drain(
                DEFAULT_CODEX_MONITOR_RECONNECT_INTERVAL,
                sleeper,
                shutdown_requested,
                &command_receiver,
            );
        }
    }
}

fn run_codex_session_manager_session(
    raw_app_server_url: &str,
    monitor: &mut CodexMonitor,
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: &Arc<Mutex<RuntimeReadinessManager>>,
    socket_poll_interval: Duration,
    shutdown_requested: &Arc<AtomicBool>,
    command_receiver: &mpsc::Receiver<CodexSessionManagerCommand>,
) -> Result<(), CodexProxyError> {
    let (mut socket, _) = connect(raw_app_server_url).map_err(CodexProxyError::ConnectRaw)?;
    configure_raw_socket_timeout(&mut socket, socket_poll_interval)?;

    send_json_message(
        &mut socket,
        json!({
            "method": "initialize",
            "id": 1,
            "params": {
                "clientInfo": {
                    "name": CODEX_INITIALIZE_CLIENT_NAME,
                    "title": "Mistle sandboxd Codex session manager",
                    "version": "0.0.0"
                }
            }
        }),
    )?;
    let mut pending_updates = Vec::new();
    let _ = wait_for_response(&mut socket, 1, &mut pending_updates)?;
    send_json_message(
        &mut socket,
        json!({
            "method": "initialized",
            "params": {}
        }),
    )?;

    send_json_message(
        &mut socket,
        json!({
            "method": "thread/loaded/list",
            "id": 2,
            "params": {}
        }),
    )?;
    let loaded_response = wait_for_response(&mut socket, 2, &mut pending_updates)?;
    let loaded_thread_ids = parse_thread_loaded_list_response(&loaded_response)?;

    let mut threads = Vec::new();
    let mut next_request_id = 3;
    for thread_id in loaded_thread_ids {
        send_json_message(
            &mut socket,
            json!({
                "method": "thread/read",
                "id": next_request_id,
                "params": {
                    "threadId": thread_id
                }
            }),
        )?;
        let thread_response =
            wait_for_response(&mut socket, next_request_id, &mut pending_updates)?;
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
        if shutdown_requested.load(Ordering::Relaxed) {
            return Ok(());
        }
        drain_unsupported_commands(command_receiver, shutdown_requested);
        if shutdown_requested.load(Ordering::Relaxed) {
            return Ok(());
        }

        match socket.read() {
            Ok(message) => {
                if let Some((thread_id, status)) = parse_thread_status_changed_message(&message)? {
                    let mut keepalive_manager = keepalive_manager
                        .lock()
                        .expect("Codex keepalive manager lock should not be poisoned");
                    monitor.apply_thread_status(&thread_id, &status, &mut keepalive_manager);
                }
            }
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(error) if super::is_connection_termination_error(&error) => return Ok(()),
            Err(error) => return Err(CodexProxyError::ReadSocket(error)),
        }
    }
}

fn sleep_with_command_drain(
    total_sleep: Duration,
    sleeper: &dyn Sleeper,
    shutdown_requested: &Arc<AtomicBool>,
    command_receiver: &mpsc::Receiver<CodexSessionManagerCommand>,
) {
    let mut slept = Duration::from_millis(0);
    while slept < total_sleep && !shutdown_requested.load(Ordering::Relaxed) {
        drain_unsupported_commands(command_receiver, shutdown_requested);
        if shutdown_requested.load(Ordering::Relaxed) {
            return;
        }

        let step = std::cmp::min(
            DEFAULT_CODEX_PROXY_SOCKET_POLL_INTERVAL,
            total_sleep - slept,
        );
        sleeper.sleep(step);
        slept += step;
    }
}

fn drain_unsupported_commands(
    command_receiver: &mpsc::Receiver<CodexSessionManagerCommand>,
    shutdown_requested: &Arc<AtomicBool>,
) {
    while let Ok(command) = command_receiver.try_recv() {
        match command {
            CodexSessionManagerCommand::RetainThread {
                thread_id: _thread_id,
                reason: _reason,
                reply,
            } => {
                let _ = reply.send(Err(CodexSessionManagerError::UnsupportedUntilPr2 {
                    command_name: "RetainThread",
                }));
            }
            CodexSessionManagerCommand::ReleaseThread {
                thread_id: _thread_id,
                reason: _reason,
                reply,
            } => {
                let _ = reply.send(Err(CodexSessionManagerError::UnsupportedUntilPr2 {
                    command_name: "ReleaseThread",
                }));
            }
            CodexSessionManagerCommand::Shutdown => {
                shutdown_requested.store(true, Ordering::Relaxed);
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, mpsc};

    use crate::codex_proxy::session_manager::{
        CodexSessionManagerCommand, CodexSessionManagerError, RetainReason,
        drain_unsupported_commands,
    };

    #[test]
    fn unsupported_commands_reply_deterministically() {
        let (command_sender, command_receiver) = mpsc::channel();
        let (reply_sender, reply_receiver) = mpsc::channel();
        let shutdown_requested = Arc::new(AtomicBool::new(false));

        command_sender
            .send(CodexSessionManagerCommand::RetainThread {
                thread_id: "thr_123".to_string(),
                reason: RetainReason::AutomationBackgroundExecution,
                reply: reply_sender,
            })
            .expect("retain command should enqueue");

        drain_unsupported_commands(&command_receiver, &shutdown_requested);

        let reply = reply_receiver
            .recv()
            .expect("retain reply should be returned");
        match reply {
            Err(CodexSessionManagerError::UnsupportedUntilPr2 { command_name }) => {
                assert_eq!(command_name, "RetainThread");
            }
            other => panic!("unexpected reply: {other:?}"),
        }
    }
}
