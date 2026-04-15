use std::env;
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket, connect};

use sandboxd::codex_proxy::start_codex_proxy;
use sandboxd::keepalive::KeepaliveManager;
use sandboxd::runtime::readiness::RuntimeReadinessManager;
use sandboxd::time::{Duration, Sleeper, ThreadSleeper};

static REQUEST_ID_COUNTER: AtomicU64 = AtomicU64::new(5_000);

#[test]
fn mistle_agent_turn_survives_client_disconnect_after_proxy_retention() {
    let raw_port = reserve_available_port();
    let raw_url = format!("ws://127.0.0.1:{raw_port}");
    let _app_server = start_codex_app_server(raw_port);

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let proxy = start_codex_proxy(
        "ws://127.0.0.1:0/codex",
        &raw_url,
        keepalive_manager,
        runtime_readiness_manager.clone(),
    )
    .expect("Codex proxy should start");

    wait_for_runtime_readiness(&runtime_readiness_manager, true);

    let (mut worker_client, _) =
        connect_to_proxy_with_retry(proxy.listen_url(), &ThreadSleeper, Duration::from_secs(5));
    initialize_client(&mut worker_client, "Mistle Agent Client");

    let thread_start_response = call_json_rpc(&mut worker_client, "thread/start", json!({}));
    let thread_id = thread_start_response["thread"]["id"]
        .as_str()
        .expect("thread/start should return a thread id")
        .to_string();

    let turn_start_response = call_json_rpc(
        &mut worker_client,
        "turn/start",
        json!({
            "threadId": thread_id,
            "input": [
                {
                    "type": "text",
                    "text": "Write a detailed explanation of monads. Continue until you have produced at least 5000 words with multiple sections and examples."
                }
            ]
        }),
    );
    let turn_id = turn_start_response["turn"]["id"]
        .as_str()
        .expect("turn/start should return a turn id")
        .to_string();

    worker_client
        .close(None)
        .expect("worker client should close cleanly");

    let (mut observer_client, _) =
        connect(&raw_url).expect("observer client should connect to the Codex app server");
    initialize_client(&mut observer_client, "Mistle branch 4 observer");
    let resumed_thread = wait_for_thread_resume(&mut observer_client, &thread_id);
    let resumed_thread_status = resumed_thread["thread"]["status"]["type"]
        .as_str()
        .expect("thread/resume should return thread.status.type");
    assert_eq!(
        resumed_thread_status, "active",
        "the thread should still be active immediately after the worker disconnects"
    );

    ThreadSleeper.sleep(Duration::from_millis(500));

    let observed_turn_status =
        wait_for_turn_status(&mut observer_client, &thread_id, &turn_id, Some(&resumed_thread));

    assert_ne!(
        observed_turn_status, "interrupted",
        "closing the Mistle agent client after the proxy forwards turn/start should not interrupt the turn"
    );

    observer_client
        .close(None)
        .expect("observer client should close cleanly");
    proxy.close().expect("Codex proxy should close cleanly");
}

fn wait_for_runtime_readiness(
    runtime_readiness_manager: &Arc<Mutex<RuntimeReadinessManager>>,
    expected_ready: bool,
) {
    for _ in 0..100 {
        let is_ready = runtime_readiness_manager
            .lock()
            .expect("runtime readiness manager lock should not be poisoned")
            .ready();
        if is_ready == expected_ready {
            return;
        }

        ThreadSleeper.sleep(Duration::from_millis(10));
    }

    panic!("timed out waiting for runtime readiness {expected_ready}");
}

fn connect_to_proxy_with_retry(
    proxy_url: &str,
    sleeper: &dyn Sleeper,
    timeout: Duration,
) -> (
    WebSocket<MaybeTlsStream<TcpStream>>,
    tungstenite::handshake::client::Response,
) {
    let attempts = (timeout.as_millis() / 20).max(1);
    let mut last_error = None;

    for _ in 0..attempts {
        match connect(proxy_url) {
            Ok(connection) => return connection,
            Err(error) => {
                last_error = Some(error);
                sleeper.sleep(Duration::from_millis(20));
            }
        }
    }

    panic!(
        "timed out connecting to proxy {proxy_url}: {}",
        last_error.expect("last proxy connection error should exist")
    );
}

fn wait_for_thread_resume(
    client: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    thread_id: &str,
) -> Value {
    for _ in 0..60 {
        match call_json_rpc_allow_error(
            client,
            "thread/resume",
            json!({
                "threadId": thread_id
            }),
        ) {
            Ok(result) => return result,
            Err(error_message) if is_retryable_thread_resume_error(&error_message, thread_id) => {
                ThreadSleeper.sleep(Duration::from_millis(100));
            }
            Err(error_message) => {
                panic!("thread/resume should not fail unexpectedly: {error_message}");
            }
        }
    }

    panic!("timed out waiting for thread {thread_id} to become resumable");
}

fn is_retryable_thread_resume_error(error_message: &str, thread_id: &str) -> bool {
    error_message.starts_with("no rollout found for thread id ")
        || error_message.starts_with("thread not found: ")
        || error_message.contains(&format!("for thread {thread_id}: rollout at "))
            && error_message.ends_with(" is empty")
}

fn wait_for_turn_status(
    client: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    thread_id: &str,
    turn_id: &str,
    initial_thread: Option<&Value>,
) -> String {
    if let Some(initial_thread) = initial_thread
        && let Some(status) = find_turn_status(initial_thread, turn_id)
    {
        return status;
    }

    for _ in 0..100 {
        let resumed_thread = call_json_rpc(
            client,
            "thread/resume",
            json!({
                "threadId": thread_id
            }),
        );
        if let Some(status) = find_turn_status(&resumed_thread, turn_id) {
            return status;
        }

        ThreadSleeper.sleep(Duration::from_millis(100));
    }

    panic!("timed out waiting for turn {turn_id} to appear in thread/resume");
}

fn find_turn_status(thread_response: &Value, turn_id: &str) -> Option<String> {
    let turns = thread_response["thread"]["turns"].as_array()?;
    let turn = turns
        .iter()
        .find(|turn| turn["id"].as_str() == Some(turn_id))?;
    turn["status"]
        .as_str()
        .map(std::string::ToString::to_string)
}

fn initialize_client(client: &mut WebSocket<MaybeTlsStream<TcpStream>>, client_title: &str) {
    let _ = call_json_rpc(
        client,
        "initialize",
        json!({
            "clientInfo": {
                "name": "codex_cli_rs",
                "title": client_title,
                "version": "0.1.0"
            }
        }),
    );
    client
        .send(Message::Text(
            json!({
                "method": "initialized",
                "params": {}
            })
            .to_string()
            .into(),
        ))
        .expect("initialized notification should send");
}

fn call_json_rpc(
    client: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    method: &str,
    params: Value,
) -> Value {
    call_json_rpc_allow_error(client, method, params)
        .unwrap_or_else(|error_message| panic!("JSON-RPC request {method} should not fail: {error_message}"))
}

fn call_json_rpc_allow_error(
    client: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let request_id = REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    client
        .send(Message::Text(
            json!({
                "id": request_id,
                "method": method,
                "params": params
            })
            .to_string()
            .into(),
        ))
        .expect("JSON-RPC request should send");

    loop {
        let Message::Text(payload) = client
            .read()
            .expect("websocket should receive a text message while awaiting a response")
        else {
            continue;
        };
        let value: Value =
            serde_json::from_str(payload.as_str()).expect("JSON-RPC payload should parse");
        if value.get("id") != Some(&json!(request_id)) {
            continue;
        }

        if let Some(error_message) = value["error"]["message"].as_str() {
            return Err(error_message.to_string());
        }
        return Ok(value["result"].clone());
    }
}

fn start_codex_app_server(port: u16) -> CodexAppServerProcess {
    let codex_binary = resolve_codex_binary();
    let child = Command::new(&codex_binary)
        .args(["app-server", "--listen", &format!("ws://127.0.0.1:{port}")])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap_or_else(|error| {
            panic!(
                "codex app-server should start via {}: {error}",
                codex_binary.display()
            )
        });

    wait_for_port(port);

    CodexAppServerProcess { child }
}

fn resolve_codex_binary() -> PathBuf {
    env::var_os("MISTLE_TEST_CODEX_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("codex"))
}

fn wait_for_port(port: u16) {
    for _ in 0..100 {
        if TcpStream::connect(format!("127.0.0.1:{port}")).is_ok() {
            return;
        }

        ThreadSleeper.sleep(Duration::from_millis(50));
    }

    panic!("timed out waiting for codex app-server to listen on port {port}");
}

fn reserve_available_port() -> u16 {
    let listener =
        TcpListener::bind("127.0.0.1:0").expect("ephemeral port reservation should succeed");
    let port = listener
        .local_addr()
        .expect("listener local addr should exist")
        .port();
    drop(listener);
    port
}

struct CodexAppServerProcess {
    child: Child,
}

impl Drop for CodexAppServerProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
