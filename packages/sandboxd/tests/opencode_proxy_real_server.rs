use std::env;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use tempfile::TempDir;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket, connect};

use sandboxd::keepalive::KeepaliveManager;
use sandboxd::opencode_proxy::start_opencode_proxy;
use sandboxd::runtime::readiness::RuntimeReadinessManager;
use sandboxd::time::{Duration, Sleeper, ThreadSleeper};

#[test]
fn proxy_and_activity_monitor_talk_to_real_opencode_server() {
    let raw_port = reserve_available_port();
    let raw_url = format!("http://127.0.0.1:{raw_port}");
    let _server = start_opencode_server(raw_port);

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let proxy = start_opencode_proxy(
        "ws://127.0.0.1:0/opencode",
        &raw_url,
        keepalive_manager.clone(),
        runtime_readiness_manager.clone(),
    )
    .expect("OpenCode proxy should start");

    wait_for_runtime_readiness(&runtime_readiness_manager, true);
    wait_for_keepalive_activity(&keepalive_manager, false);

    let (mut client, _) =
        connect_to_proxy_with_retry(proxy.listen_url(), &ThreadSleeper, Duration::from_secs(5));
    client
        .send(Message::Text(
            json!({
                "id": "health",
                "method": "GET",
                "path": "/global/health"
            })
            .to_string()
            .into(),
        ))
        .expect("health request should send through proxy");

    let health_response = read_json_text_message(&mut client);
    assert_eq!(health_response["id"], json!("health"));
    assert_eq!(health_response["type"], json!("response"));
    assert_eq!(health_response["status"], json!(200));
    let health_body = health_response["body"]
        .as_str()
        .expect("OpenCode health response body should be a string");
    let health_value: Value =
        serde_json::from_str(health_body).expect("OpenCode health body should be JSON");
    assert_eq!(health_value["healthy"], json!(true));
    assert_eq!(health_value["version"], json!("1.14.50"));

    client
        .send(Message::Text(
            json!({
                "id": "status",
                "method": "GET",
                "path": "/session/status"
            })
            .to_string()
            .into(),
        ))
        .expect("session status request should send through proxy");
    let status_response = read_json_text_message(&mut client);
    assert_eq!(status_response["id"], json!("status"));
    assert_eq!(status_response["type"], json!("response"));
    assert_eq!(status_response["status"], json!(200));
    assert_eq!(status_response["body"], json!("{}"));

    client
        .close(None)
        .expect("proxy client should close cleanly");
    proxy.close().expect("OpenCode proxy should close cleanly");
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
