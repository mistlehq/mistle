//! Shared mutable state for the Pi proxy runtime.
//!
//! The state serializes commands to the stdio RPC child, fans out Pi events to
//! websocket clients, and projects agent activity into sandbox keepalive.

use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use crate::cgroups::{attach_pid_to_scope, kill_scope};
use crate::keepalive::KeepaliveManager;
use crate::pi_proxy::idempotency::SharedIdempotencyStore;
use crate::pi_proxy::json_rpc::render_pi_event_json_rpc_notification;
use crate::pi_proxy::rpc_process::{PiRpcChild, PiRpcOutput};
use crate::pi_proxy::{PiProxyConfig, PiProxyError, PiProxyPlatformScope};
use crate::supervision::SandboxdSupervisorHandle;

const PI_RPC_RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);

pub(super) struct PiProxyState {
    pub(super) config: PiProxyConfig,
    pub(super) child: Mutex<Option<PiRpcChild>>,
    pub(super) command_lock: Mutex<()>,
    pub(super) event_subscribers: Mutex<Vec<Sender<String>>>,
    pub(super) keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    pub(super) active: AtomicBool,
    pub(super) activity_monitor_running: AtomicBool,
    pub(super) next_id: AtomicU64,
    pub(super) idempotency_store: Option<SharedIdempotencyStore>,
    pub(super) supervisor_handle: SandboxdSupervisorHandle,
    pub(super) platform_scope: Option<PiProxyPlatformScope>,
}

impl PiProxyState {
    fn next_pi_request_id(&self) -> String {
        let next = self.next_id.fetch_add(1, Ordering::Relaxed);
        format!("mistle_pi_{next}")
    }

    pub(super) fn send_pi_command(&self, command: Value) -> Result<Value, PiProxyError> {
        self.send_pi_command_with_events(command, None)
    }

    pub(super) fn send_pi_command_with_captured_events(
        &self,
        command: Value,
        captured_events: &mut Vec<Value>,
    ) -> Result<Value, PiProxyError> {
        self.send_pi_command_with_events(command, Some(captured_events))
    }

    fn send_pi_command_with_events(
        &self,
        mut command: Value,
        mut captured_events: Option<&mut Vec<Value>>,
    ) -> Result<Value, PiProxyError> {
        let _command_guard = self.command_lock.lock().map_err(|_| {
            PiProxyError::InvalidRequest("Pi command lock was poisoned".to_string())
        })?;
        let id = self.next_pi_request_id();
        command["id"] = Value::String(id.clone());
        let line = format!("{command}\n");
        let deadline = Instant::now() + PI_RPC_RESPONSE_TIMEOUT;
        {
            let mut guard = self.child.lock().map_err(|_| {
                PiProxyError::InvalidRequest("Pi child lock was poisoned".to_string())
            })?;
            let child = guard.as_mut().ok_or_else(|| {
                PiProxyError::InvalidRequest("Pi RPC process is not running".to_string())
            })?;
            if let Err(error) = child.stdin.write_all(line.as_bytes()) {
                self.mark_pi_rpc_process_restarting(error.to_string());
                return Err(PiProxyError::WritePi(error));
            }
            if let Err(error) = child.stdin.flush() {
                self.mark_pi_rpc_process_restarting(error.to_string());
                return Err(PiProxyError::WritePi(error));
            }
        }

        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(PiProxyError::PiResponseTimeout(id));
            }
            let output = {
                let guard = self.child.lock().map_err(|_| {
                    PiProxyError::InvalidRequest("Pi child lock was poisoned".to_string())
                })?;
                let child = guard.as_ref().ok_or_else(|| {
                    PiProxyError::InvalidRequest("Pi RPC process is not running".to_string())
                })?;
                child.receiver.recv_timeout(remaining)
            };
            match output {
                Ok(PiRpcOutput::Line(value)) => {
                    self.update_activity_from_pi_output(&value);
                    if value["type"] == "response" && value["id"] == id {
                        if value["success"] == true {
                            return Ok(value.get("data").cloned().unwrap_or(Value::Null));
                        }
                        let message = value["error"]
                            .as_str()
                            .unwrap_or("Pi RPC command failed")
                            .to_string();
                        return Err(PiProxyError::InvalidRequest(message));
                    }
                    if let Some(events) = captured_events.as_deref_mut() {
                        events.push(value);
                    } else {
                        self.broadcast_pi_event(value);
                    }
                }
                Ok(PiRpcOutput::Error(error)) => {
                    self.mark_pi_rpc_process_restarting(error.clone());
                    return Err(PiProxyError::InvalidRequest(error));
                }
                Ok(PiRpcOutput::Eof) => {
                    let message = "Pi RPC process stdout closed".to_string();
                    self.mark_pi_rpc_process_restarting(message.clone());
                    return Err(PiProxyError::InvalidRequest(message));
                }
                Err(RecvTimeoutError::Timeout) => return Err(PiProxyError::PiResponseTimeout(id)),
                Err(RecvTimeoutError::Disconnected) => {
                    let message = "Pi RPC reader disconnected".to_string();
                    self.mark_pi_rpc_process_restarting(message.clone());
                    return Err(PiProxyError::InvalidRequest(message));
                }
            }
        }
    }

    pub(super) fn subscribe_pi_events(&self) -> Receiver<String> {
        let (sender, receiver) = mpsc::channel();
        if let Ok(mut subscribers) = self.event_subscribers.lock() {
            subscribers.push(sender);
        }
        receiver
    }

    fn broadcast_pi_event(&self, event: Value) {
        let notification = render_pi_event_json_rpc_notification(event);
        if let Ok(mut subscribers) = self.event_subscribers.lock() {
            subscribers.retain(|sender| sender.send(notification.clone()).is_ok());
        }
    }

    pub(super) fn read_session_file(state_value: &Value) -> Result<&str, PiProxyError> {
        state_value["sessionFile"]
            .as_str()
            .ok_or(PiProxyError::MissingSessionFile)
    }

    pub(super) fn switch_session(
        &self,
        session_file: &str,
        captured_events: &mut Vec<Value>,
    ) -> Result<(), PiProxyError> {
        self.send_pi_command_with_captured_events(
            json!({ "type": "switch_session", "sessionPath": session_file }),
            captured_events,
        )?;
        Ok(())
    }

    fn update_activity_from_pi_output(&self, value: &Value) {
        if value["type"] == "agent_start" {
            self.set_active(true);
            return;
        }
        if value["type"] == "agent_end" {
            self.set_active(false);
            return;
        }
        if value["type"] == "response"
            && value["command"] == "get_state"
            && value["success"] == true
        {
            let state = &value["data"];
            let active = state["isStreaming"].as_bool().unwrap_or(false)
                || state["isCompacting"].as_bool().unwrap_or(false)
                || state["pendingMessageCount"].as_u64().unwrap_or(0) > 0;
            self.set_active(active);
        }
    }

    pub(super) fn set_active(&self, active: bool) {
        let previous = self.active.swap(active, Ordering::Relaxed);
        if previous == active {
            return;
        }
        if let Ok(mut keepalive_manager) = self.keepalive_manager.lock() {
            keepalive_manager.set_platform_active(active);
        }
    }

    pub(super) fn start_activity_monitor(state: Arc<Self>) -> bool {
        if state
            .activity_monitor_running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return false;
        }

        thread::spawn(move || {
            while state.active.load(Ordering::Relaxed) {
                if state
                    .send_pi_command(json!({ "type": "get_state" }))
                    .is_err()
                {
                    state.set_active(false);
                    break;
                }
                thread::sleep(Duration::from_secs(1));
            }
            state
                .activity_monitor_running
                .store(false, Ordering::Release);
            if state.active.load(Ordering::Relaxed) {
                Self::start_activity_monitor(state);
            }
        });
        true
    }

    pub(super) fn mark_active_and_start_activity_monitor(state: &Arc<Self>) {
        state.set_active(true);
        Self::start_activity_monitor(state.clone());
    }

    pub(super) fn register_pi_platform_root_pid(&self, pid: u32) -> Result<(), PiProxyError> {
        let Some(platform_scope) = &self.platform_scope else {
            return Ok(());
        };
        attach_pid_to_scope(&platform_scope.scope_paths, pid)
            .map_err(|error| PiProxyError::PlatformScope(error.to_string()))?;
        platform_scope
            .registry
            .replace_scope(
                platform_scope.registry_key.clone(),
                platform_scope.process_key.clone(),
                platform_scope.scope_paths.clone(),
                pid,
            )
            .map_err(PiProxyError::PlatformScope)
    }

    pub(super) fn kill_and_remove_pi_platform_scope(&self) -> Result<(), PiProxyError> {
        let Some(platform_scope) = &self.platform_scope else {
            return Ok(());
        };
        kill_scope(&platform_scope.scope_paths)
            .map_err(|error| PiProxyError::PlatformScope(error.to_string()))?;
        platform_scope
            .registry
            .remove_scope(&platform_scope.registry_key)
            .map_err(PiProxyError::PlatformScope)
    }
}
