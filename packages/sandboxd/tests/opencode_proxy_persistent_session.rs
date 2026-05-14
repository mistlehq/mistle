use std::env;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration as StdDuration;

use serde_json::{Value, json};
use tempfile::TempDir;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket, connect};

use sandboxd::keepalive::KeepaliveManager;
use sandboxd::opencode_proxy::{OpenCodeProxy, start_opencode_proxy};
use sandboxd::runtime::readiness::RuntimeReadinessManager;
use sandboxd::time::{Duration, Sleeper, ThreadSleeper};

#[test]
fn shell_command_survives_client_disconnect_after_proxy_activity_retention() {
    let raw_port = reserve_available_port();
    let raw_url = format!("http://127.0.0.1:{raw_port}");
    let _server = start_opencode_server(raw_port);

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let proxy = OpenCodeProxyGuard::new(
        start_opencode_proxy(
            "ws://127.0.0.1:0/opencode",
            &raw_url,
            keepalive_manager.clone(),
            runtime_readiness_manager.clone(),
        )
        .expect("OpenCode proxy should start"),
    );

    wait_for_runtime_readiness(&runtime_readiness_manager, true);
    wait_for_keepalive_activity(&keepalive_manager, false);

    let (mut worker_client, _) =
        connect_to_proxy_with_retry(proxy.listen_url(), &ThreadSleeper, Duration::from_secs(5));
    let session_response = call_proxy_json_request(
        &mut worker_client,
        json!({
            "id": "create-session",
            "method": "POST",
            "path": "/session",
            "body": {
                "title": "persistent shell test"
            }
        }),
    );
    let session_id = session_response["id"]
        .as_str()
        .expect("OpenCode session create response should include an id")
        .to_string();
    let marker = format!("opencode-persistent-session-{}", std::process::id());

    worker_client
        .send(Message::Text(
            json!({
                "id": "shell-command",
                "method": "POST",
                "path": format!("/session/{session_id}/shell"),
                "body": {
                    "agent": "build",
                    "command": format!("sh -lc 'sleep 2; printf {marker}'")
                }
            })
            .to_string()
            .into(),
        ))
        .expect("shell command request should send through proxy");

    wait_for_raw_session_status(&raw_url, &session_id, "busy");

    drop(worker_client);

    wait_for_shell_output(&raw_url, &session_id, &marker);
    wait_for_raw_session_idle(&raw_url, &session_id);
    wait_for_keepalive_activity(&keepalive_manager, false);

    proxy.close();
}

fn start_opencode_server(port: u16) -> OpenCodeServerProcess {
    let opencode_binary = resolve_opencode_binary();
    let data_dir = TempDir::new().expect("OpenCode test data dir should create");
    let home = data_dir.path();
    let port_string = port.to_string();
    let child = Command::new(&opencode_binary)
        .args([
            "serve",
            "--hostname",
            "127.0.0.1",
            "--port",
            &port_string,
            "--pure",
        ])
        .env("HOME", home)
        .env("XDG_CONFIG_HOME", home.join(".config"))
        .env("XDG_DATA_HOME", home.join(".local/share"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap_or_else(|error| {
            panic!(
                "opencode server should start via {}: {error}",
                opencode_binary.display()
            )
        });

    wait_for_opencode_health(port);

    OpenCodeServerProcess {
        child,
        _data_dir: data_dir,
    }
}

fn resolve_opencode_binary() -> PathBuf {
    env::var_os("MISTLE_TEST_OPENCODE_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("opencode"))
}

fn wait_for_opencode_health(port: u16) {
    for _ in 0..100 {
        if let Ok(mut stream) = TcpStream::connect(format!("127.0.0.1:{port}")) {
            stream
                .write_all(
                    b"GET /global/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
                )
                .expect("OpenCode health request should write");
            let mut response = String::new();
            stream
                .read_to_string(&mut response)
                .expect("OpenCode health response should read");
            if response.contains("200 OK") && response.contains("\"healthy\":true") {
                return;
            }
        }

        ThreadSleeper.sleep(Duration::from_millis(50));
    }

    panic!("timed out waiting for opencode server to listen on port {port}");
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

fn wait_for_keepalive_activity(
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
    expected_active: bool,
) {
    for _ in 0..100 {
        let active = keepalive_manager
            .lock()
            .expect("keepalive manager lock should not be poisoned")
            .active();
        if active == expected_active {
            return;
        }

        ThreadSleeper.sleep(Duration::from_millis(10));
    }

    panic!("timed out waiting for keepalive activity {expected_active}");
}

fn wait_for_raw_session_status(raw_url: &str, session_id: &str, expected_status: &str) {
    for _ in 0..100 {
        let statuses = raw_json_request("GET", &format!("{raw_url}/session/status"), None);
        if statuses[session_id]["type"] == json!(expected_status) {
            return;
        }

        ThreadSleeper.sleep(Duration::from_millis(50));
    }

    panic!("timed out waiting for OpenCode session {session_id} status {expected_status}");
}

fn wait_for_raw_session_idle(raw_url: &str, session_id: &str) {
    for _ in 0..100 {
        let statuses = raw_json_request("GET", &format!("{raw_url}/session/status"), None);
        if statuses.get(session_id).is_none() || statuses[session_id]["type"] == json!("idle") {
            return;
        }

        ThreadSleeper.sleep(Duration::from_millis(50));
    }

    panic!("timed out waiting for OpenCode session {session_id} to become idle");
}

fn wait_for_shell_output(raw_url: &str, session_id: &str, expected_output: &str) {
    for _ in 0..100 {
        let messages = raw_json_request(
            "GET",
            &format!("{raw_url}/session/{session_id}/message"),
            None,
        );
        if opencode_messages_include_tool_output(&messages, expected_output) {
            return;
        }

        ThreadSleeper.sleep(Duration::from_millis(50));
    }

    panic!("timed out waiting for OpenCode shell output {expected_output}");
}

fn opencode_messages_include_tool_output(messages: &Value, expected_output: &str) -> bool {
    let Some(messages) = messages.as_array() else {
        return false;
    };
    messages
        .iter()
        .filter_map(|message| message["parts"].as_array())
        .flatten()
        .any(|part| part["state"]["output"].as_str() == Some(expected_output))
}

fn call_proxy_json_request<S>(client: &mut WebSocket<S>, request: Value) -> Value
where
    S: Read + Write,
{
    let request_id = request["id"].clone();
    client
        .send(Message::Text(request.to_string().into()))
        .expect("proxy request should send");
    let response = read_json_text_message(client);
    assert_eq!(response["id"], request_id);
    assert_eq!(response["type"], json!("response"));
    assert_eq!(response["status"], json!(200));
    let body = response["body"]
        .as_str()
        .expect("proxy response body should be a string");
    serde_json::from_str(body).expect("proxy response body should be JSON")
}

fn raw_json_request(method: &str, url: &str, body: Option<Value>) -> Value {
    let client = reqwest::blocking::Client::builder()
        .timeout(StdDuration::from_secs(5))
        .build()
        .expect("raw OpenCode HTTP client should build");
    let request = match method {
        "GET" => client.get(url),
        "POST" => client.post(url),
        other => panic!("unsupported raw OpenCode request method {other}"),
    };
    let request = if let Some(body) = body {
        request.json(&body)
    } else {
        request
    };
    let response = request
        .send()
        .unwrap_or_else(|error| panic!("raw OpenCode request {method} {url} should send: {error}"));
    let status = response.status();
    let body_text = response
        .text()
        .unwrap_or_else(|error| panic!("raw OpenCode response body should read: {error}"));
    assert!(
        status.is_success(),
        "raw OpenCode request {method} {url} returned {status}: {body_text}"
    );
    serde_json::from_str(&body_text).expect("raw OpenCode response body should be JSON")
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
            Ok((mut client, response)) => {
                set_websocket_timeouts(&mut client, StdDuration::from_secs(10));
                return (client, response);
            }
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

fn set_websocket_timeouts(client: &mut WebSocket<MaybeTlsStream<TcpStream>>, timeout: StdDuration) {
    match client.get_mut() {
        MaybeTlsStream::Plain(stream) => {
            stream
                .set_read_timeout(Some(timeout))
                .expect("websocket read timeout should set");
            stream
                .set_write_timeout(Some(timeout))
                .expect("websocket write timeout should set");
        }
        _ => {
            panic!("OpenCode proxy tests should use plain localhost websocket connections");
        }
    }
}

fn read_json_text_message<S>(client: &mut WebSocket<S>) -> Value
where
    S: Read + Write,
{
    let message = client
        .read()
        .expect("websocket should receive a text message");
    let Message::Text(payload) = message else {
        panic!("expected websocket text message");
    };
    serde_json::from_str(payload.as_str()).expect("websocket payload should be json")
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

struct OpenCodeServerProcess {
    child: Child,
    _data_dir: TempDir,
}

impl Drop for OpenCodeServerProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct OpenCodeProxyGuard {
    proxy: Option<OpenCodeProxy>,
}

impl OpenCodeProxyGuard {
    fn new(proxy: OpenCodeProxy) -> Self {
        Self { proxy: Some(proxy) }
    }

    fn listen_url(&self) -> &str {
        self.proxy
            .as_ref()
            .expect("OpenCode proxy guard should still own proxy")
            .listen_url()
    }

    fn close(mut self) {
        if let Some(proxy) = self.proxy.take() {
            proxy.close().expect("OpenCode proxy should close cleanly");
        }
    }
}

impl Drop for OpenCodeProxyGuard {
    fn drop(&mut self) {
        if let Some(proxy) = self.proxy.take() {
            let _ = proxy.close();
        }
    }
}
