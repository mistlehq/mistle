use std::collections::BTreeMap;
use std::net::TcpListener;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;

use serde_json::{Value, json};
use tungstenite::{Message, WebSocket, accept, connect};

use sandboxd::keepalive::KeepaliveManager;
use sandboxd::protocol::startup::{StartupInput, StartupMode};
use sandboxd::runtime::adapters::RuntimeAdapterRegistry;
use sandboxd::runtime::readiness::RuntimeReadinessManager;
use sandboxd::time::{Duration, Sleeper, ThreadSleeper};

static REQUEST_ID_COUNTER: AtomicU64 = AtomicU64::new(400);

#[test]
fn runtime_adapter_registry_starts_codex_proxy_adapter() {
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
        let mut client_socket =
            accept(client_stream).expect("proxied client handshake should succeed");
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

    let startup_input = StartupInput {
        startup_mode: StartupMode::New,
        execution_mode: sandboxd::protocol::startup::StartupExecutionMode::Session,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: "ws://127.0.0.1:5000/tunnel/sandbox".to_string(),
        runtime_plan: serde_json::json!({
            "sandboxProfileId": "sbp_123",
            "version": 1,
            "image": {
                "source": "base",
                "imageRef": sandboxd::test_support::local_prepared_runtime_sandbox_base_image_ref()
            },
            "egressRoutes": [],
            "artifacts": [],
            "runtimeClients": [
                {
                    "clientId": "codex-cli",
                    "setup": {
                        "env": {},
                        "files": []
                    },
                    "processes": [
                        {
                            "processKey": "codex-app-server",
                            "command": {
                                "args": ["codex", "app-server"]
                            },
                            "readiness": {
                                "type": "ws",
                                "url": raw_url,
                                "timeoutMs": 5000
                            },
                            "stop": {
                                "signal": "sigterm",
                                "timeoutMs": 10000,
                                "gracePeriodMs": 2000
                            }
                        }
                    ],
                    "endpoints": [
                        {
                            "endpointKey": "app-server",
                            "processKey": "codex-app-server",
                            "transport": {
                                "type": "ws",
                                "url": "ws://127.0.0.1:0/codex"
                            },
                            "connectionMode": "dedicated"
                        }
                    ]
                }
            ],
            "workspaceSources": [],
            "agentRuntimes": [
                {
                    "bindingId": "arb_123",
                    "runtimeId": "codex",
                    "runtimeKey": "codex-app-server",
                    "clientId": "codex-cli",
                    "endpointKey": "app-server",
                    "ptyLaunch": {
                        "runtimeId": "codex",
                        "displayName": "Codex",
                        "newLaunch": {
                            "ptySessionId": "pty_new",
                            "cols": 80,
                            "rows": 24,
                            "command": "codex",
                            "args": []
                        },
                        "resumeLaunch": {
                            "ptySessionId": "pty_resume",
                            "cols": 80,
                            "rows": 24,
                            "command": "codex",
                            "args": []
                        }
                    }
                }
            ]
        }),
        egress_grant_by_rule_id: BTreeMap::new(),
        git_identity: None,
    };

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let registry = RuntimeAdapterRegistry;
    let adapters = registry
        .start(
            &startup_input,
            keepalive_manager.clone(),
            runtime_readiness_manager.clone(),
        )
        .expect("runtime adapter registry should start the codex adapter");

    assert_eq!(adapters.adapters().len(), 1);
    assert_eq!(adapters.adapters()[0].runtime_id(), "codex");

    wait_for_keepalive_state(&keepalive_manager, true);
    wait_for_runtime_readiness(&runtime_readiness_manager, true);

    let (mut proxy_client, _) = connect(adapters.adapters()[0].listen_url())
        .expect("client should connect through the codex runtime adapter");
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
    wait_for_runtime_readiness(&runtime_readiness_manager, false);

    proxy_client
        .close(None)
        .expect("proxy client should close cleanly");
    adapters
        .close()
        .expect("runtime adapter registry should close the codex adapter");
    raw_server_thread
        .join()
        .expect("raw server thread should exit cleanly");
}

fn wait_for_runtime_readiness(
    runtime_readiness_manager: &Arc<Mutex<RuntimeReadinessManager>>,
    expected_ready: bool,
) {
    for _ in 0..100 {
        if runtime_readiness_manager
            .lock()
            .expect("runtime readiness manager lock should not be poisoned")
            .ready()
            == expected_ready
        {
            return;
        }

        ThreadSleeper.sleep(Duration::from_millis(10));
    }

    panic!("timed out waiting for runtime.ready == {expected_ready}");
}

fn wait_for_keepalive_state(
    keepalive_manager: &Arc<Mutex<KeepaliveManager>>,
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
