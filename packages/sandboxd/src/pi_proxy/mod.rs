//! Pi RPC proxying for `sandboxd`.
//!
//! Pi exposes a JSONL RPC protocol over stdio. This proxy owns one Pi child
//! process and exposes a websocket JSON-RPC endpoint compatible with the
//! existing sandbox agent stream transport.

use std::collections::BTreeMap;
use std::fmt;
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use crate::idempotency::store::IdempotencyStore;
use crate::keepalive::KeepaliveManager;
use crate::pi_proxy::idempotency::SharedIdempotencyStore;
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};

mod idempotency;
mod json_rpc;
mod rpc_process;
mod server;
mod session;
mod state;

use server::{parse_pi_proxy_listener_address, run_pi_proxy_listener};
use state::PiProxyState;

pub const DEFAULT_PI_PROXY_LISTEN_URL: &str = "ws://127.0.0.1:4520";

#[derive(Debug)]
pub enum PiProxyError {
    ParseListenUrl(String),
    ListenUrlMustUseWebSocket {
        url: String,
    },
    ListenUrlMissingHost {
        url: String,
    },
    ListenUrlMissingPort {
        url: String,
    },
    BindListener {
        address: String,
        error: std::io::Error,
    },
    ConfigureListener(std::io::Error),
    AcceptClient(std::io::Error),
    AcceptHandshake(String),
    InvalidRequest(String),
    MissingPiCliPath,
    MissingSessionDir,
    SpawnPi(std::io::Error),
    MissingPiStdin,
    MissingPiStdout,
    MissingSessionFile,
    WritePi(std::io::Error),
    ReadPi(std::io::Error),
    PiResponseTimeout(String),
    RuntimePanicked,
}

impl fmt::Display for PiProxyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ParseListenUrl(error) => {
                write!(f, "failed to parse Pi proxy listen URL: {error}")
            }
            Self::ListenUrlMustUseWebSocket { url } => {
                write!(f, "Pi proxy listen URL must use ws scheme: {url}")
            }
            Self::ListenUrlMissingHost { url } => {
                write!(f, "Pi proxy listen URL must include a host: {url}")
            }
            Self::ListenUrlMissingPort { url } => {
                write!(f, "Pi proxy listen URL must include a port: {url}")
            }
            Self::BindListener { address, error } => {
                write!(f, "failed to bind Pi proxy listener {address}: {error}")
            }
            Self::ConfigureListener(error) => {
                write!(f, "failed to configure Pi proxy listener: {error}")
            }
            Self::AcceptClient(error) => write!(f, "failed to accept Pi proxy client: {error}"),
            Self::AcceptHandshake(error) => {
                write!(f, "failed to accept Pi proxy websocket handshake: {error}")
            }
            Self::InvalidRequest(error) => write!(f, "Pi proxy received invalid request: {error}"),
            Self::MissingPiCliPath => {
                write!(f, "Pi runtime client setup must define MISTLE_PI_CLI_PATH")
            }
            Self::MissingSessionDir => {
                write!(
                    f,
                    "Pi runtime client setup must define PI_CODING_AGENT_SESSION_DIR"
                )
            }
            Self::SpawnPi(error) => write!(f, "failed to spawn Pi RPC process: {error}"),
            Self::MissingPiStdin => write!(f, "spawned Pi RPC process did not expose stdin"),
            Self::MissingPiStdout => write!(f, "spawned Pi RPC process did not expose stdout"),
            Self::MissingSessionFile => write!(f, "Pi did not report sessionFile"),
            Self::WritePi(error) => write!(f, "failed to write Pi RPC command: {error}"),
            Self::ReadPi(error) => write!(f, "failed to read Pi RPC output: {error}"),
            Self::PiResponseTimeout(id) => {
                write!(f, "timed out waiting for Pi RPC response '{id}'")
            }
            Self::RuntimePanicked => write!(f, "Pi proxy runtime thread panicked"),
        }
    }
}

impl std::error::Error for PiProxyError {}

#[derive(Debug, Clone)]
pub struct PiProxyConfig {
    pub pi_cli_path: String,
    pub env: BTreeMap<String, String>,
}

pub struct PiProxy {
    listen_url: String,
    shutdown_requested: Arc<AtomicBool>,
    runtime_thread: Option<JoinHandle<Result<(), PiProxyError>>>,
    rpc_monitor_thread: Option<JoinHandle<()>>,
    state: Arc<PiProxyState>,
    supervisor_handle: SandboxdSupervisorHandle,
}

impl PiProxy {
    pub fn listen_url(&self) -> &str {
        &self.listen_url
    }

    pub fn close(mut self) -> Result<(), PiProxyError> {
        self.shutdown_requested.store(true, Ordering::Relaxed);
        self.state.shutdown_child();
        let close_result = match self.runtime_thread.take() {
            Some(runtime_thread) => match runtime_thread.join() {
                Ok(result) => result,
                Err(_) => Err(PiProxyError::RuntimePanicked),
            },
            None => Ok(()),
        };
        if let Some(rpc_monitor_thread) = self.rpc_monitor_thread.take() {
            let _ = rpc_monitor_thread.join();
        }
        self.supervisor_handle
            .mark_component_stopped(SupervisedComponent::PiProxy);
        close_result
    }
}

pub fn start_pi_proxy_with_supervisor(
    listen_url: &str,
    config: PiProxyConfig,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    supervisor_handle: SandboxdSupervisorHandle,
) -> Result<PiProxy, PiProxyError> {
    let idempotency_store = IdempotencyStore::load_default()
        .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
    start_pi_proxy_inner(
        listen_url,
        config,
        keepalive_manager,
        supervisor_handle,
        Some(Arc::new(Mutex::new(idempotency_store))),
    )
}

pub fn start_pi_proxy_with_idempotency_store(
    listen_url: &str,
    config: PiProxyConfig,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    supervisor_handle: SandboxdSupervisorHandle,
    idempotency_store: IdempotencyStore,
) -> Result<PiProxy, PiProxyError> {
    start_pi_proxy_inner(
        listen_url,
        config,
        keepalive_manager,
        supervisor_handle,
        Some(Arc::new(Mutex::new(idempotency_store))),
    )
}

fn start_pi_proxy_inner(
    listen_url: &str,
    config: PiProxyConfig,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    supervisor_handle: SandboxdSupervisorHandle,
    idempotency_store: Option<SharedIdempotencyStore>,
) -> Result<PiProxy, PiProxyError> {
    if config.pi_cli_path.trim().is_empty() {
        return Err(PiProxyError::MissingPiCliPath);
    }
    if listen_url.trim().is_empty() {
        return Err(PiProxyError::ParseListenUrl(
            "Pi proxy listen URL must not be empty".to_string(),
        ));
    }
    let listen_url = listen_url.to_string();
    let listener_address = parse_pi_proxy_listener_address(&listen_url)?;
    let listener =
        TcpListener::bind(listener_address).map_err(|error| PiProxyError::BindListener {
            address: listener_address.to_string(),
            error,
        })?;
    listener
        .set_nonblocking(true)
        .map_err(PiProxyError::ConfigureListener)?;

    supervisor_handle.mark_component_starting(SupervisedComponent::PiProxy);
    let shutdown_requested = Arc::new(AtomicBool::new(false));
    let state = Arc::new(PiProxyState {
        config,
        child: Mutex::new(None),
        command_lock: Mutex::new(()),
        event_subscribers: Mutex::new(Vec::new()),
        keepalive_manager,
        active: AtomicBool::new(false),
        activity_monitor_running: AtomicBool::new(false),
        next_id: AtomicU64::new(1),
        idempotency_store,
        supervisor_handle: supervisor_handle.clone(),
    });
    if let Err(error) = state.ensure_child(None) {
        supervisor_handle
            .mark_component_restarting(SupervisedComponent::PiProxy, error.to_string());
        return Err(error);
    }
    let rpc_monitor_thread =
        rpc_process::spawn_pi_rpc_process_monitor(state.clone(), shutdown_requested.clone());
    let runtime_shutdown = shutdown_requested.clone();
    let runtime_state = state.clone();
    let runtime_supervisor = supervisor_handle.clone();
    let runtime_thread = thread::spawn(move || {
        runtime_supervisor.mark_component_healthy(SupervisedComponent::PiProxy);
        run_pi_proxy_listener(listener, runtime_state, runtime_shutdown)
    });

    Ok(PiProxy {
        listen_url,
        shutdown_requested,
        runtime_thread: Some(runtime_thread),
        rpc_monitor_thread: Some(rpc_monitor_thread),
        state,
        supervisor_handle,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::Duration;

    use serde_json::{Value, json};
    use tempfile::tempdir;

    use crate::idempotency::store::IdempotencyStore;
    use crate::idempotency::{AgentRuntimeId, IdempotencyOperation, RequestFingerprint};
    use crate::keepalive::KeepaliveManager;
    use crate::pi_proxy::{
        PiProxyConfig, PiProxyState, json_rpc::handle_json_rpc_request,
        start_pi_proxy_with_idempotency_store,
    };
    use crate::supervision::{ComponentHealthState, SandboxdSupervisorHandle, SupervisedComponent};
    use crate::time::SystemClock;

    fn test_supervisor_handle() -> SandboxdSupervisorHandle {
        SandboxdSupervisorHandle::new(
            "pi-proxy-test",
            Arc::new(SystemClock),
            BTreeSet::from([
                SupervisedComponent::PiProxy,
                SupervisedComponent::PiRpcProcess,
            ]),
        )
    }

    fn reserve_pi_proxy_listen_url() -> String {
        "ws://127.0.0.1:0".to_string()
    }

    fn pi_rpc_process_pid(supervisor_handle: &SandboxdSupervisorHandle) -> u32 {
        supervisor_handle
            .component_snapshot(SupervisedComponent::PiRpcProcess)
            .expect("Pi RPC process should be tracked")
            .details
            .get("pid")
            .expect("Pi RPC process snapshot should expose pid")
            .parse::<u32>()
            .expect("Pi RPC process pid should be numeric")
    }

    fn wait_for_pi_rpc_process_replacement(
        supervisor_handle: &SandboxdSupervisorHandle,
        original_pid: u32,
        timeout: Duration,
    ) {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            let snapshot = supervisor_handle
                .component_snapshot(SupervisedComponent::PiRpcProcess)
                .expect("Pi RPC process should be tracked");
            let replacement_pid = snapshot
                .details
                .get("pid")
                .and_then(|pid| pid.parse::<u32>().ok());
            if snapshot.state == ComponentHealthState::Healthy
                && replacement_pid.is_some_and(|pid| pid != original_pid)
            {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "expected Pi RPC process to restart before timeout, got {snapshot:?}"
            );
            thread::sleep(Duration::from_millis(25));
        }
    }

    #[test]
    fn starts_pi_rpc_process_before_reporting_proxy_startup_success() {
        let simulated_pi = SimulatedPiRpcProcess::start();
        let supervisor_handle = test_supervisor_handle();
        let idempotency_store_dir = tempdir().expect("idempotency store dir should be created");
        let idempotency_store =
            IdempotencyStore::load_all(idempotency_store_dir.path().join("idempotency"))
                .expect("idempotency store should load");
        let proxy = start_pi_proxy_with_idempotency_store(
            &reserve_pi_proxy_listen_url(),
            PiProxyConfig {
                pi_cli_path: simulated_pi.path(),
                env: BTreeMap::new(),
            },
            Arc::new(Mutex::new(KeepaliveManager::default())),
            supervisor_handle.clone(),
            idempotency_store,
        )
        .expect("Pi proxy should start with a runnable Pi RPC process");

        let rpc_process_snapshot = supervisor_handle
            .component_snapshot(SupervisedComponent::PiRpcProcess)
            .expect("Pi RPC process should be tracked");
        assert_eq!(rpc_process_snapshot.state, ComponentHealthState::Healthy);
        assert_eq!(
            rpc_process_snapshot.details.get("cliPath"),
            Some(&simulated_pi.path())
        );
        assert!(
            rpc_process_snapshot
                .details
                .get("pid")
                .is_some_and(|pid| pid.parse::<u32>().is_ok()),
            "healthy Pi RPC process snapshot should expose its pid"
        );

        proxy.close().expect("Pi proxy should close cleanly");
        let stopped_rpc_process_snapshot = supervisor_handle
            .component_snapshot(SupervisedComponent::PiRpcProcess)
            .expect("Pi RPC process should remain tracked after close");
        assert_eq!(
            stopped_rpc_process_snapshot.state,
            ComponentHealthState::Stopped
        );
    }

    #[test]
    fn restarts_pi_rpc_process_after_exit() {
        let simulated_pi = SimulatedPiRpcProcess::start();
        let supervisor_handle = test_supervisor_handle();
        let idempotency_store_dir = tempdir().expect("idempotency store dir should be created");
        let idempotency_store =
            IdempotencyStore::load_all(idempotency_store_dir.path().join("idempotency"))
                .expect("idempotency store should load");
        let proxy = start_pi_proxy_with_idempotency_store(
            &reserve_pi_proxy_listen_url(),
            PiProxyConfig {
                pi_cli_path: simulated_pi.path(),
                env: BTreeMap::new(),
            },
            Arc::new(Mutex::new(KeepaliveManager::default())),
            supervisor_handle.clone(),
            idempotency_store,
        )
        .expect("Pi proxy should start with a runnable Pi RPC process");
        let original_pid = pi_rpc_process_pid(&supervisor_handle);

        {
            let mut guard = proxy
                .state
                .child
                .lock()
                .expect("Pi child lock should not be poisoned");
            guard
                .as_mut()
                .expect("Pi RPC process should be running")
                .child
                .kill()
                .expect("Pi RPC process should be killable");
        }

        wait_for_pi_rpc_process_replacement(
            &supervisor_handle,
            original_pid,
            Duration::from_secs(5),
        );

        proxy.close().expect("Pi proxy should close cleanly");
    }

    #[test]
    fn replaces_eager_no_cwd_rpc_process_with_requested_conversation_cwd() {
        let simulated_pi = SimulatedPiRpcProcess::start();
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: simulated_pi.path(),
                env: BTreeMap::new(),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager: Arc::new(Mutex::new(KeepaliveManager::default())),
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(false),
            next_id: AtomicU64::new(1),
            idempotency_store: None,
            supervisor_handle: test_supervisor_handle(),
        });

        state
            .ensure_child(None)
            .expect("eager Pi RPC process should start without a cwd");
        state
            .ensure_child(Some(simulated_pi.cwd()))
            .expect("requested conversation cwd should replace the eager child");
        state
            .send_pi_command(json!({ "type": "new_session" }))
            .expect("new session command should be sent to Pi");

        let reported_cwd = fs::read_to_string(simulated_pi.cwd_report_file())
            .expect("simulated Pi process should report its working directory");
        let reported_cwd =
            fs::canonicalize(reported_cwd.trim()).expect("reported Pi cwd should canonicalize");
        let expected_cwd =
            fs::canonicalize(simulated_pi.cwd()).expect("expected Pi cwd should canonicalize");
        assert_eq!(reported_cwd, expected_cwd);

        state.shutdown_child();
    }

    #[test]
    fn fans_out_pi_events_before_json_rpc_response_and_settles_activity() {
        let simulated_pi = SimulatedPiRpcProcess::start();
        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: simulated_pi.path(),
                env: BTreeMap::new(),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager: keepalive_manager.clone(),
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(false),
            next_id: AtomicU64::new(1),
            idempotency_store: None,
            supervisor_handle: test_supervisor_handle(),
        });

        let create_responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "create",
                "method": "pi/createConversation",
                "params": { "cwd": simulated_pi.cwd() }
            })
            .to_string(),
        );
        let create_response = parse_json_rpc_message(
            create_responses
                .last()
                .expect("create conversation should produce a response"),
        );
        assert_eq!(
            create_response["result"]["providerConversationId"],
            json!(simulated_pi.session_id())
        );
        assert_eq!(
            create_response["result"]["sessionFile"],
            json!(simulated_pi.session_file())
        );

        let event_receiver = state.subscribe_pi_events();
        let prompt_responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "prompt",
                "method": "pi/prompt",
                "params": {
                    "sessionFile": simulated_pi.session_file(),
                    "message": "hello"
                }
            })
            .to_string(),
        );

        assert!(
            keepalive_manager
                .lock()
                .expect("keepalive lock should not be poisoned")
                .active(),
            "prompt activity should keep the sandbox alive after the client response"
        );

        let pi_event = parse_json_rpc_message(
            prompt_responses
                .first()
                .expect("prompt should fan out Pi events before its response"),
        );
        assert_eq!(pi_event["method"], json!("pi/event"));
        assert_eq!(pi_event["params"]["type"], json!("agent_start"));

        let prompt_response = parse_json_rpc_message(
            prompt_responses
                .last()
                .expect("prompt should produce a JSON-RPC response"),
        );
        assert_eq!(prompt_response["id"], json!("prompt"));
        assert_eq!(prompt_response["result"], json!({ "accepted": true }));

        thread::sleep(Duration::from_millis(1_300));
        assert!(
            !keepalive_manager
                .lock()
                .expect("keepalive lock should not be poisoned")
                .active(),
            "activity monitor should observe agent_end/get_state and settle after client work returns"
        );
        let broadcast_event = parse_json_rpc_message(
            &event_receiver
                .try_recv()
                .expect("activity monitor should broadcast Pi completion events"),
        );
        assert_eq!(broadcast_event["method"], json!("pi/event"));
        assert_eq!(broadcast_event["params"]["type"], json!("agent_end"));

        state.shutdown_child();
    }

    #[test]
    fn replays_completed_idempotent_pi_create_without_requiring_live_child() {
        let simulated_pi = SimulatedPiRpcProcess::start();
        let temp_dir = tempdir().expect("temp dir should be created");
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: simulated_pi.path(),
                env: BTreeMap::new(),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager: Arc::new(Mutex::new(KeepaliveManager::default())),
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(false),
            next_id: AtomicU64::new(1),
            idempotency_store: Some(Arc::new(Mutex::new(
                IdempotencyStore::load_all(temp_dir.path().join("idempotency"))
                    .expect("idempotency store should load"),
            ))),
            supervisor_handle: test_supervisor_handle(),
        });
        let fingerprint = pi_fingerprint(IdempotencyOperation::CreateConversation, "create");
        let first_response = parse_json_rpc_message(
            handle_json_rpc_request(
                &state,
                &json!({
                    "jsonrpc": "2.0",
                    "id": "create-1",
                    "method": "pi/createConversation",
                    "params": { "cwd": simulated_pi.cwd() },
                    "idempotency": {
                        "key": "create-key",
                        "operation": "createConversation",
                        "requestFingerprint": fingerprint.value()
                    }
                })
                .to_string(),
            )
            .last()
            .expect("create should produce response"),
        );
        assert_eq!(
            first_response["result"]["providerConversationId"],
            json!(simulated_pi.session_id())
        );

        state.shutdown_child();

        let replay_response = parse_json_rpc_message(
            handle_json_rpc_request(
                &state,
                &json!({
                    "jsonrpc": "2.0",
                    "id": "create-2",
                    "method": "pi/createConversation",
                    "params": { "cwd": simulated_pi.cwd() },
                    "idempotency": {
                        "key": "create-key",
                        "operation": "createConversation",
                        "requestFingerprint": fingerprint.value()
                    }
                })
                .to_string(),
            )
            .last()
            .expect("replay should produce response"),
        );
        assert_eq!(replay_response["id"], json!("create-2"));
        assert_eq!(
            replay_response["result"]["providerConversationId"],
            json!(simulated_pi.session_id())
        );
    }

    #[test]
    fn rejects_pi_idempotency_key_reused_with_different_fingerprint() {
        let simulated_pi = SimulatedPiRpcProcess::start();
        let temp_dir = tempdir().expect("temp dir should be created");
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: simulated_pi.path(),
                env: BTreeMap::new(),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager: Arc::new(Mutex::new(KeepaliveManager::default())),
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(false),
            next_id: AtomicU64::new(1),
            idempotency_store: Some(Arc::new(Mutex::new(
                IdempotencyStore::load_all(temp_dir.path().join("idempotency"))
                    .expect("idempotency store should load"),
            ))),
            supervisor_handle: test_supervisor_handle(),
        });
        let first_fingerprint = pi_fingerprint(IdempotencyOperation::CreateConversation, "create");
        let _ = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "create-1",
                "method": "pi/createConversation",
                "params": { "cwd": simulated_pi.cwd() },
                "idempotency": {
                    "key": "create-key",
                    "operation": "createConversation",
                    "requestFingerprint": first_fingerprint.value()
                }
            })
            .to_string(),
        );

        state.shutdown_child();

        let conflicting_fingerprint =
            pi_fingerprint(IdempotencyOperation::CreateConversation, "different");
        let conflict_response = parse_json_rpc_message(
            handle_json_rpc_request(
                &state,
                &json!({
                    "jsonrpc": "2.0",
                    "id": "create-2",
                    "method": "pi/createConversation",
                    "params": { "cwd": simulated_pi.cwd() },
                    "idempotency": {
                        "key": "create-key",
                        "operation": "createConversation",
                        "requestFingerprint": conflicting_fingerprint.value()
                    }
                })
                .to_string(),
            )
            .last()
            .expect("conflict should produce response"),
        );
        assert!(
            conflict_response["error"]["message"]
                .as_str()
                .expect("conflict message should be a string")
                .contains("different request fingerprint")
        );
    }

    #[test]
    fn malformed_pi_idempotency_envelope_preserves_json_rpc_id() {
        let simulated_pi = SimulatedPiRpcProcess::start();
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: simulated_pi.path(),
                env: BTreeMap::new(),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager: Arc::new(Mutex::new(KeepaliveManager::default())),
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(false),
            next_id: AtomicU64::new(1),
            idempotency_store: None,
            supervisor_handle: test_supervisor_handle(),
        });

        let response = parse_json_rpc_message(
            handle_json_rpc_request(
                &state,
                &json!({
                    "jsonrpc": "2.0",
                    "id": "prompt-1",
                    "method": "pi/prompt",
                    "params": {
                        "sessionFile": simulated_pi.session_file(),
                        "message": "hello"
                    },
                    "idempotency": {
                        "operation": "bad"
                    }
                })
                .to_string(),
            )
            .last()
            .expect("malformed idempotency should produce response"),
        );

        assert_eq!(response["id"], json!("prompt-1"));
        assert_eq!(response["error"]["code"], json!(-32_001));
        assert!(
            response["error"]["message"]
                .as_str()
                .expect("error message should be a string")
                .contains("Pi idempotency envelope is invalid")
        );
    }

    #[test]
    fn replays_completed_idempotent_pi_prompt_without_requiring_live_child() {
        let simulated_pi = SimulatedPiRpcProcess::start();
        let temp_dir = tempdir().expect("temp dir should be created");
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: simulated_pi.path(),
                env: BTreeMap::new(),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager: Arc::new(Mutex::new(KeepaliveManager::default())),
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(false),
            next_id: AtomicU64::new(1),
            idempotency_store: Some(Arc::new(Mutex::new(
                IdempotencyStore::load_all(temp_dir.path().join("idempotency"))
                    .expect("idempotency store should load"),
            ))),
            supervisor_handle: test_supervisor_handle(),
        });
        let fingerprint = pi_fingerprint(IdempotencyOperation::SubmitPayload, "prompt");

        let first_responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "prompt-1",
                "method": "pi/prompt",
                "params": {
                    "sessionFile": simulated_pi.session_file(),
                    "message": "hello"
                },
                "idempotency": {
                    "key": "prompt-key",
                    "operation": "submitPayload",
                    "requestFingerprint": fingerprint.value()
                }
            })
            .to_string(),
        );
        let first_response = parse_json_rpc_message(
            first_responses
                .last()
                .expect("prompt should produce response"),
        );
        assert_eq!(first_response["id"], json!("prompt-1"));
        assert_eq!(first_response["result"], json!({ "accepted": true }));

        state.shutdown_child();

        let replay_response = parse_json_rpc_message(
            handle_json_rpc_request(
                &state,
                &json!({
                    "jsonrpc": "2.0",
                    "id": "prompt-2",
                    "method": "pi/prompt",
                    "params": {
                        "sessionFile": simulated_pi.session_file(),
                        "message": "hello"
                    },
                    "idempotency": {
                        "key": "prompt-key",
                        "operation": "submitPayload",
                        "requestFingerprint": fingerprint.value()
                    }
                })
                .to_string(),
            )
            .last()
            .expect("prompt replay should produce response"),
        );
        assert_eq!(replay_response["id"], json!("prompt-2"));
        assert_eq!(replay_response["result"], json!({ "accepted": true }));
    }

    #[test]
    fn resume_active_pi_conversation_starts_activity_monitor() {
        let simulated_pi = SimulatedPiRpcProcess::start_active_session();
        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: simulated_pi.path(),
                env: simulated_pi.session_env(),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager: keepalive_manager.clone(),
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(false),
            next_id: AtomicU64::new(1),
            idempotency_store: None,
            supervisor_handle: test_supervisor_handle(),
        });

        let event_receiver = state.subscribe_pi_events();
        let resume_responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "resume",
                "method": "pi/resumeConversation",
                "params": {
                    "providerConversationId": simulated_pi.session_id()
                }
            })
            .to_string(),
        );

        let resume_response = parse_json_rpc_message(
            resume_responses
                .last()
                .expect("resume conversation should produce a response"),
        );
        assert_eq!(resume_response["id"], json!("resume"));
        assert_eq!(
            resume_response["result"]["sessionFile"],
            json!(simulated_pi.session_file())
        );
        assert!(
            keepalive_manager
                .lock()
                .expect("keepalive lock should not be poisoned")
                .active(),
            "resuming active Pi work should keep the sandbox alive"
        );

        thread::sleep(Duration::from_millis(1_300));
        let broadcast_event = parse_json_rpc_message(
            &event_receiver
                .try_recv()
                .expect("activity monitor should drain and broadcast resumed Pi events"),
        );
        assert_eq!(broadcast_event["method"], json!("pi/event"));
        assert_eq!(broadcast_event["params"]["type"], json!("agent_end"));
        assert!(
            !keepalive_manager
                .lock()
                .expect("keepalive lock should not be poisoned")
                .active(),
            "activity monitor should settle after resumed Pi work ends"
        );

        state.shutdown_child();
    }

    #[test]
    fn activity_monitor_has_single_owner() {
        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: "/bin/false".to_string(),
                env: BTreeMap::new(),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager,
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(true),
            next_id: AtomicU64::new(1),
            idempotency_store: None,
            supervisor_handle: test_supervisor_handle(),
        });

        state.set_active(true);

        assert!(
            !PiProxyState::start_activity_monitor(state.clone()),
            "a running activity monitor should own Pi activity polling"
        );

        state.set_active(false);
        state
            .activity_monitor_running
            .store(false, Ordering::Release);
    }

    #[test]
    fn resume_pi_conversation_switches_without_initial_state() {
        let simulated_pi = SimulatedPiRpcProcess::start_without_initial_session();
        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: simulated_pi.path(),
                env: simulated_pi.session_env(),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager,
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(false),
            next_id: AtomicU64::new(1),
            idempotency_store: None,
            supervisor_handle: test_supervisor_handle(),
        });

        let resume_responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "resume",
                "method": "pi/resumeConversation",
                "params": {
                    "providerConversationId": simulated_pi.session_id()
                }
            })
            .to_string(),
        );

        let resume_response = parse_json_rpc_message(
            resume_responses
                .last()
                .expect("resume conversation should produce a response"),
        );
        assert_eq!(resume_response["id"], json!("resume"));
        assert_eq!(
            resume_response["result"]["sessionFile"],
            json!(simulated_pi.session_file())
        );

        state.shutdown_child();
    }

    #[test]
    fn forwards_pi_model_catalog_and_selection_for_session() {
        let simulated_pi = SimulatedPiRpcProcess::start_without_initial_session();
        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: simulated_pi.path(),
                env: BTreeMap::new(),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager,
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(false),
            next_id: AtomicU64::new(1),
            idempotency_store: None,
            supervisor_handle: test_supervisor_handle(),
        });

        let catalog_responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "models",
                "method": "pi/getAvailableModels",
                "params": {
                    "sessionFile": simulated_pi.session_file()
                }
            })
            .to_string(),
        );
        let catalog_response = parse_json_rpc_message(
            catalog_responses
                .last()
                .expect("model catalog request should produce a response"),
        );
        assert_eq!(
            catalog_response["result"]["models"][0]["id"],
            json!("gpt-5")
        );

        let set_model_responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "set-model",
                "method": "pi/setModel",
                "params": {
                    "sessionFile": simulated_pi.session_file(),
                    "provider": "openai",
                    "modelId": "gpt-5"
                }
            })
            .to_string(),
        );
        let set_model_response = parse_json_rpc_message(
            set_model_responses
                .last()
                .expect("set model request should produce a response"),
        );
        assert_eq!(set_model_response["result"]["provider"], json!("openai"));
        assert_eq!(set_model_response["result"]["id"], json!("gpt-5"));

        let set_thinking_level_responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "set-thinking-level",
                "method": "pi/setThinkingLevel",
                "params": {
                    "sessionFile": simulated_pi.session_file(),
                    "level": "high"
                }
            })
            .to_string(),
        );
        let set_thinking_level_response = parse_json_rpc_message(
            set_thinking_level_responses
                .last()
                .expect("set thinking level request should produce a response"),
        );
        assert_eq!(set_thinking_level_response["result"], json!({}));

        state.shutdown_child();
    }

    #[test]
    fn finds_recent_pi_conversation_from_configured_session_dir() {
        let directory = tempdir().expect("temporary directory should be created");
        let session_dir = directory.path().join("sessions");
        let project_session_dir = session_dir.join("--workspace-project--");
        let other_session_dir = session_dir.join("--workspace-other--");
        fs::create_dir_all(&project_session_dir).expect("project session directory should exist");
        fs::create_dir_all(&other_session_dir).expect("other session directory should exist");
        let old_session = project_session_dir.join("old.jsonl");
        let recent_session = project_session_dir.join("recent.jsonl");
        let other_cwd_session = other_session_dir.join("other.jsonl");
        write_session_file(&old_session, "old", "/workspace/project");
        thread::sleep(Duration::from_millis(10));
        write_session_file(&recent_session, "recent", "/workspace/project");
        thread::sleep(Duration::from_millis(10));
        write_session_file(&other_cwd_session, "other", "/workspace/other");
        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: "/bin/false".to_string(),
                env: BTreeMap::from([(
                    "PI_CODING_AGENT_SESSION_DIR".to_string(),
                    session_dir
                        .to_str()
                        .expect("session dir should be UTF-8")
                        .to_string(),
                )]),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager,
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(false),
            next_id: AtomicU64::new(1),
            idempotency_store: None,
            supervisor_handle: test_supervisor_handle(),
        });

        let responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "recent",
                "method": "pi/findRecentConversation",
                "params": { "cwd": "/workspace/project" }
            })
            .to_string(),
        );

        let response = parse_json_rpc_message(
            responses
                .last()
                .expect("recent conversation lookup should produce a response"),
        );
        assert_eq!(
            response["result"]["providerConversationId"],
            json!("recent")
        );
    }

    #[test]
    fn lists_pi_conversations_from_configured_session_dir() {
        let directory = tempdir().expect("temporary directory should be created");
        let session_dir = directory.path().join("sessions");
        let project_session_dir = session_dir.join("--workspace-project--");
        let other_session_dir = session_dir.join("--workspace-other--");
        fs::create_dir_all(&project_session_dir).expect("project session directory should exist");
        fs::create_dir_all(&other_session_dir).expect("other session directory should exist");
        let older_session = project_session_dir.join("older.jsonl");
        let newer_session = project_session_dir.join("newer.jsonl");
        let other_session = other_session_dir.join("other.jsonl");
        write_session_file_with_timestamp(
            &older_session,
            "older",
            "/workspace/project",
            "2026-05-18T00:00:00.000Z",
        );
        thread::sleep(Duration::from_millis(10));
        write_session_file_with_timestamp(
            &newer_session,
            "newer",
            "/workspace/project",
            "2026-05-19T00:00:00.000Z",
        );
        thread::sleep(Duration::from_millis(10));
        write_session_file_with_timestamp(
            &other_session,
            "other",
            "/workspace/other",
            "2026-05-20T00:00:00.000Z",
        );
        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let state = Arc::new(PiProxyState {
            config: PiProxyConfig {
                pi_cli_path: "/bin/false".to_string(),
                env: BTreeMap::from([(
                    "PI_CODING_AGENT_SESSION_DIR".to_string(),
                    session_dir
                        .to_str()
                        .expect("session dir should be UTF-8")
                        .to_string(),
                )]),
            },
            child: Mutex::new(None),
            command_lock: Mutex::new(()),
            event_subscribers: Mutex::new(Vec::new()),
            keepalive_manager,
            active: std::sync::atomic::AtomicBool::new(false),
            activity_monitor_running: std::sync::atomic::AtomicBool::new(false),
            next_id: AtomicU64::new(1),
            idempotency_store: None,
            supervisor_handle: test_supervisor_handle(),
        });

        let responses = handle_json_rpc_request(
            &state,
            &json!({
                "jsonrpc": "2.0",
                "id": "list",
                "method": "pi/listConversations",
                "params": { "cwd": "/workspace/project", "limit": 1 }
            })
            .to_string(),
        );

        let response = parse_json_rpc_message(
            responses
                .last()
                .expect("conversation list lookup should produce a response"),
        );
        assert_eq!(response["result"]["hasMore"], json!(true));
        assert_eq!(response["result"]["conversations"][0]["id"], json!("newer"));
        assert_eq!(
            response["result"]["conversations"][0]["sessionFile"],
            json!(
                newer_session
                    .to_str()
                    .expect("newer session path should be UTF-8")
            )
        );
        assert_eq!(
            response["result"]["conversations"][0]["cwd"],
            json!("/workspace/project")
        );
        assert_eq!(
            response["result"]["conversations"][0]["createdAt"],
            json!("2026-05-19T00:00:00.000Z")
        );
        assert!(
            response["result"]["conversations"][0]["updatedAt"]
                .as_u64()
                .is_some(),
            "listed Pi conversation should include file modified time"
        );
    }

    fn parse_json_rpc_message(message: &str) -> Value {
        serde_json::from_str(message).expect("JSON-RPC message should be valid JSON")
    }

    fn pi_fingerprint(operation: IdempotencyOperation, scenario: &str) -> RequestFingerprint {
        let mut fields = BTreeMap::new();
        fields.insert("scenario".to_string(), json!(scenario));
        RequestFingerprint::from_fields(AgentRuntimeId::Pi, operation, fields)
            .expect("fingerprint should encode")
    }

    fn write_session_file(path: &std::path::Path, id: &str, cwd: &str) {
        write_session_file_with_timestamp(path, id, cwd, "2026-05-19T00:00:00.000Z");
    }

    fn write_session_file_with_timestamp(
        path: &std::path::Path,
        id: &str,
        cwd: &str,
        timestamp: &str,
    ) {
        fs::write(
            path,
            format!(
                "{}\n",
                json!({
                    "type": "session",
                    "version": 1,
                    "id": id,
                    "timestamp": timestamp,
                    "cwd": cwd
                })
            ),
        )
        .expect("session file should be written");
    }

    struct SimulatedPiRpcProcess {
        _directory: tempfile::TempDir,
        script_path: String,
        cwd: String,
        cwd_report_file: String,
        session_dir: String,
        session_file: String,
        session_id: String,
    }

    impl SimulatedPiRpcProcess {
        fn start() -> Self {
            Self::start_with_session_state(false, true)
        }

        fn start_active_session() -> Self {
            Self::start_with_session_state(true, true)
        }

        fn start_without_initial_session() -> Self {
            Self::start_with_session_state(false, false)
        }

        fn start_with_session_state(active_session: bool, has_initial_session: bool) -> Self {
            let directory = tempdir().expect("temporary directory should be created");
            let script_path = directory.path().join("simulated-pi-rpc");
            let cwd = directory.path().join("workspace");
            fs::create_dir(&cwd).expect("workspace directory should be created");
            let session_dir = directory.path().join("sessions");
            fs::create_dir(&session_dir).expect("session directory should be created");
            let cwd_report_file = directory.path().join("cwd-report");
            let session_file = session_dir.join("session.jsonl");
            let session_id = "simulated-session";
            write_session_file(
                &session_file,
                session_id,
                cwd.to_str().expect("cwd should be UTF-8"),
            );
            let active_marker = directory.path().join("active");
            let no_initial_session_marker = directory.path().join("no-initial-session");
            if active_session {
                fs::write(&active_marker, "").expect("active marker should be written");
            }
            if !has_initial_session {
                fs::write(&no_initial_session_marker, "")
                    .expect("no initial session marker should be written");
            }
            let script = format!(
                r#"#!/bin/sh
active_marker="{}"
no_initial_session_marker="{}"
cwd_report_file="{}"
while IFS= read -r line; do
  id="$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
  case "$line" in
    *'"type":"new_session"'*)
      pwd > "$cwd_report_file"
      printf '{{"type":"response","command":"new_session","id":"%s","success":true,"data":{{}}}}\n' "$id"
      ;;
    *'"type":"get_state"'*)
      if [ -f "$no_initial_session_marker" ]; then
        printf '{{"type":"response","command":"get_state","id":"%s","success":false,"error":"no active session"}}\n' "$id"
      elif [ -f "$active_marker" ]; then
        rm "$active_marker"
        printf '{{"type":"response","command":"get_state","id":"%s","success":true,"data":{{"sessionFile":"{}","sessionId":"{}","sessionName":"Simulated session","isStreaming":true,"isCompacting":false,"model":null,"messageCount":0,"pendingMessageCount":0,"thinkingLevel":"high"}}}}\n' "$id"
        sleep 0.1
        printf '{{"type":"agent_end"}}\n'
      else
        printf '{{"type":"response","command":"get_state","id":"%s","success":true,"data":{{"sessionFile":"{}","sessionId":"{}","sessionName":"Simulated session","isStreaming":false,"isCompacting":false,"model":null,"messageCount":0,"pendingMessageCount":0,"thinkingLevel":"high"}}}}\n' "$id"
      fi
      ;;
    *'"type":"switch_session"'*)
      rm -f "$no_initial_session_marker"
      printf '{{"type":"response","command":"switch_session","id":"%s","success":true,"data":{{}}}}\n' "$id"
      ;;
    *'"type":"get_available_models"'*)
      printf '{{"type":"response","command":"get_available_models","id":"%s","success":true,"data":{{"models":[{{"provider":"openai","id":"gpt-5","name":"GPT-5","reasoning":true,"input":["text","image"]}}]}}}}\n' "$id"
      ;;
    *'"type":"set_model"'*)
      case "$line" in
        *'"provider":"openai"'*)
          case "$line" in
            *'"modelId":"gpt-5"'*)
              printf '{{"type":"response","command":"set_model","id":"%s","success":true,"data":{{"provider":"openai","id":"gpt-5","name":"GPT-5","reasoning":true,"input":["text","image"]}}}}\n' "$id"
              ;;
            *)
              printf '{{"type":"response","command":"set_model","id":"%s","success":false,"error":"unexpected model selection"}}\n' "$id"
              ;;
          esac
          ;;
        *)
          printf '{{"type":"response","command":"set_model","id":"%s","success":false,"error":"unexpected model selection"}}\n' "$id"
          ;;
      esac
      ;;
    *'"type":"set_thinking_level"'*)
      case "$line" in
        *'"level":"high"'*)
          printf '{{"type":"response","command":"set_thinking_level","id":"%s","success":true,"data":{{}}}}\n' "$id"
          ;;
        *)
          printf '{{"type":"response","command":"set_thinking_level","id":"%s","success":false,"error":"unexpected thinking level"}}\n' "$id"
          ;;
      esac
      ;;
    *'"type":"prompt"'*)
      printf '{{"type":"agent_start"}}\n'
      printf '{{"type":"response","command":"prompt","id":"%s","success":true,"data":{{"accepted":true}}}}\n' "$id"
      sleep 0.1
      printf '{{"type":"agent_end"}}\n'
      ;;
    *)
      printf '{{"type":"response","command":"unknown","id":"%s","success":false,"error":"unsupported command"}}\n' "$id"
      ;;
  esac
done
"#,
                active_marker.display(),
                no_initial_session_marker.display(),
                cwd_report_file.display(),
                session_file.display(),
                session_id,
                session_file.display(),
                session_id
            );
            fs::write(&script_path, script).expect("simulated Pi RPC script should be written");
            let mut permissions = fs::metadata(&script_path)
                .expect("simulated Pi RPC script metadata should be readable")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&script_path, permissions)
                .expect("simulated Pi RPC script should be executable");

            Self {
                _directory: directory,
                script_path: script_path
                    .to_str()
                    .expect("script path should be UTF-8")
                    .to_string(),
                cwd: cwd.to_str().expect("cwd path should be UTF-8").to_string(),
                cwd_report_file: cwd_report_file
                    .to_str()
                    .expect("cwd report file should be UTF-8")
                    .to_string(),
                session_dir: session_dir
                    .to_str()
                    .expect("session dir should be UTF-8")
                    .to_string(),
                session_file: session_file
                    .to_str()
                    .expect("session path should be UTF-8")
                    .to_string(),
                session_id: session_id.to_string(),
            }
        }

        fn path(&self) -> String {
            self.script_path.clone()
        }

        fn cwd(&self) -> &str {
            &self.cwd
        }

        fn cwd_report_file(&self) -> &str {
            &self.cwd_report_file
        }

        fn session_file(&self) -> &str {
            &self.session_file
        }

        fn session_id(&self) -> &str {
            &self.session_id
        }

        fn session_env(&self) -> BTreeMap<String, String> {
            BTreeMap::from([(
                "PI_CODING_AGENT_SESSION_DIR".to_string(),
                self.session_dir.clone(),
            )])
        }
    }
}
