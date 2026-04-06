use std::net::TcpListener;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, mpsc};
use std::thread;

use serde_json::{Value, json};
use tungstenite::{Message, WebSocket, accept, connect};

use sandboxd::codex_proxy::start_codex_proxy;
use sandboxd::keepalive::KeepaliveManager;
use sandboxd::time::{Duration, Sleeper, ThreadSleeper};

static REQUEST_ID_COUNTER: AtomicU64 = AtomicU64::new(100);

#[test]
fn proxy_relays_json_rpc_and_monitor_tracks_active_threads() {
    let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
    let raw_port = raw_listener
        .local_addr()
        .expect("raw listener should expose an address")
        .port();
    let raw_url = format!("ws://127.0.0.1:{raw_port}/raw");

    let (server_ready_sender, server_ready_receiver) = mpsc::channel();
    let raw_server_thread = thread::spawn(move || {
        server_ready_sender
            .send(())
            .expect("raw server ready signal should send");

        let (monitor_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the monitor connection");
        let mut monitor_socket = accept(monitor_stream).expect("monitor handshake should succeed");

        assert_eq!(
            read_json_text_message(&mut monitor_socket)["method"],
            Value::String("initialize".to_string())
        );
        monitor_socket
            .send(Message::Text(
                json!({
                    "id": 1,
                    "result": {
                        "userAgent": "codex-app-server",
                        "codexHome": "/tmp/codex-home",
                        "platformFamily": "linux",
                        "platformOs": "linux"
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("initialize response should send");

        assert_eq!(
            read_json_text_message(&mut monitor_socket)["method"],
            Value::String("initialized".to_string())
        );

        let thread_loaded_list_request = read_json_text_message(&mut monitor_socket);
        assert_eq!(
            thread_loaded_list_request["method"],
            Value::String("thread/loaded/list".to_string())
        );
        monitor_socket
            .send(Message::Text(
                json!({
                    "id": thread_loaded_list_request["id"],
                    "result": {
                        "data": ["thr_123"],
                        "nextCursor": null
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("thread/loaded/list response should send");

        let thread_read_request = read_json_text_message(&mut monitor_socket);
        assert_eq!(
            thread_read_request["method"],
            Value::String("thread/read".to_string())
        );
        monitor_socket
            .send(Message::Text(
                json!({
                    "id": thread_read_request["id"],
                    "result": {
                        "thread": {
                            "id": "thr_123",
                            "status": {
                                "type": "active",
                                "activeFlags": []
                            }
                        }
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("thread/read response should send");

        let (client_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the proxied client connection");
        let mut client_socket = accept(client_stream).expect("proxied client handshake should succeed");
        let proxied_request = read_json_text_message(&mut client_socket);
        client_socket
            .send(Message::Text(
                json!({
                    "id": proxied_request["id"],
                    "result": {
                        "data": []
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("proxied response should send");

        monitor_socket
            .send(Message::Text(
                json!({
                    "method": "thread/status/changed",
                    "params": {
                        "threadId": "thr_123",
                        "status": {
                            "type": "idle"
                        }
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("thread/status/changed notification should send");
    });

    server_ready_receiver
        .recv()
        .expect("raw server should report readiness");

    let keepalive_manager = Arc::new(std::sync::Mutex::new(KeepaliveManager::default()));
    let proxy = start_codex_proxy(
        "ws://127.0.0.1:0/codex",
        &raw_url,
        keepalive_manager.clone(),
        Arc::new(ThreadSleeper),
    )
    .expect("Codex proxy should start");

    wait_for_keepalive_state(&keepalive_manager, true);

    let (mut proxy_client, _) =
        connect(proxy.listen_url()).expect("client should connect through the Codex proxy");
    let request_id = REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    proxy_client
        .send(Message::Text(
            json!({
                "id": request_id,
                "method": "thread/loaded/list",
                "params": {}
            })
            .to_string()
            .into(),
        ))
        .expect("client request should send through proxy");

    let proxied_response = read_json_text_message(&mut proxy_client);
    assert_eq!(proxied_response["id"], json!(request_id));
    assert_eq!(proxied_response["result"]["data"], json!([]));

    wait_for_keepalive_state(&keepalive_manager, false);

    proxy_client.close(None).expect("proxy client should close cleanly");
    proxy.close().expect("Codex proxy should close cleanly");
    raw_server_thread
        .join()
        .expect("raw server thread should exit cleanly");
}

fn wait_for_keepalive_state(
    keepalive_manager: &Arc<std::sync::Mutex<KeepaliveManager>>,
    expected_active: bool,
) {
    for _ in 0..100 {
        if keepalive_manager
            .lock()
            .expect("keepalive manager lock should not be poisoned")
            .active()
            == expected_active
        {
            return;
        }

        ThreadSleeper.sleep(Duration::from_millis(10));
    }

    panic!("timed out waiting for keepalive.active == {expected_active}");
}

fn read_json_text_message<S>(socket: &mut WebSocket<S>) -> Value
where
    S: std::io::Read + std::io::Write,
{
    let Message::Text(payload) = socket
        .read()
        .expect("websocket should receive one text message")
    else {
        panic!("expected websocket text message");
    };

    serde_json::from_str(payload.as_str()).expect("text payload should be valid JSON")
}
