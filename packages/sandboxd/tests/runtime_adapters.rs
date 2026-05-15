use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
        operation_kind: sandboxd::protocol::startup::StartupOperationKind::Start,
        execution_mode: sandboxd::protocol::startup::StartupExecutionMode::Session,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: "ws://127.0.0.1:5000/tunnel/sandbox".to_string(),
        acting_user_id: None,
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
        git_identity: None,
        transparent_proxy: None,
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

#[test]
fn runtime_adapter_registry_starts_opencode_proxy_adapter() {
    let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
    let raw_address = raw_listener
        .local_addr()
        .expect("raw listener should expose an address");
    raw_listener
        .set_nonblocking(true)
        .expect("raw listener should become nonblocking");
    let raw_health_url = format!("http://{raw_address}/global/health");

    let (server_complete_sender, server_complete_receiver) = mpsc::channel();
    let shutdown_requested = Arc::new(AtomicBool::new(false));
    let thread_shutdown_requested = shutdown_requested.clone();
    let raw_server_thread = thread::spawn(move || {
        while !thread_shutdown_requested.load(Ordering::Relaxed) {
            match raw_listener.accept() {
                Ok((mut stream, _)) => {
                    let request_shutdown_requested = thread_shutdown_requested.clone();
                    let request_complete_sender = server_complete_sender.clone();
                    thread::spawn(move || {
                        let request = read_http_request(&mut stream);
                        match (request.method.as_str(), request.path.as_str()) {
                            ("GET", "/session/status") => {
                                stream
                                    .write_all(
                                        b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{\"ses_registry\":{\"type\":\"busy\"}}",
                                    )
                                    .expect("raw OpenCode status response should send");
                            }
                            ("GET", "/global/event") => {
                                stream
                                    .write_all(
                                        b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n\r\n",
                                    )
                                    .expect("raw OpenCode monitor stream should open");
                                while !request_shutdown_requested.load(Ordering::Relaxed) {
                                    thread::sleep(std::time::Duration::from_millis(25));
                                }
                            }
                            ("GET", "/event") => {
                                stream
                                    .write_all(
                                        b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\nevent: message\ndata: {\"type\":\"server.connected\"}\n\n",
                                    )
                                    .expect("raw OpenCode response should send");
                                request_complete_sender
                                    .send(())
                                    .expect("raw server completion should send");
                            }
                            _ => {
                                stream
                                    .write_all(
                                        b"HTTP/1.1 404 Not Found\r\ncontent-length: 9\r\n\r\nnot found",
                                    )
                                    .expect("raw OpenCode not-found response should send");
                            }
                        }
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(error) => panic!("raw OpenCode server accept failed: {error}"),
            }
        }
    });

    let startup_input = StartupInput {
        startup_mode: StartupMode::New,
        operation_kind: sandboxd::protocol::startup::StartupOperationKind::Start,
        execution_mode: sandboxd::protocol::startup::StartupExecutionMode::Session,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: "ws://127.0.0.1:5000/tunnel/sandbox".to_string(),
        acting_user_id: None,
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
                    "clientId": "opencode-cli",
                    "setup": {
                        "env": {},
                        "files": []
                    },
                    "processes": [
                        {
                            "processKey": "opencode-server",
                            "command": {
                                "args": ["opencode", "serve"]
                            },
                            "readiness": {
                                "type": "http",
                                "url": raw_health_url,
                                "expectedStatus": 200,
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
                            "endpointKey": "server",
                            "processKey": "opencode-server",
                            "transport": {
                                "type": "ws",
                                "url": "ws://127.0.0.1:0/opencode"
                            },
                            "connectionMode": "dedicated"
                        }
                    ]
                }
            ],
            "workspaceSources": [],
            "agentRuntimes": [
                {
                    "runtimeId": "opencode",
                    "runtimeKey": "opencode-server",
                    "clientId": "opencode-cli",
                    "endpointKey": "server",
                    "ptyLaunch": {
                        "runtimeId": "opencode",
                        "displayName": "OpenCode",
                        "newLaunch": {
                            "ptySessionId": "pty_new",
                            "cols": 80,
                            "rows": 24,
                            "command": "opencode",
                            "args": []
                        },
                        "resumeLaunch": {
                            "ptySessionId": "pty_resume",
                            "cols": 80,
                            "rows": 24,
                            "command": "opencode",
                            "args": []
                        }
                    }
                }
            ]
        }),
        git_identity: None,
        transparent_proxy: None,
    };

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let adapters = RuntimeAdapterRegistry
        .start(
            &startup_input,
            keepalive_manager.clone(),
            runtime_readiness_manager.clone(),
        )
        .expect("runtime adapter registry should start the OpenCode adapter");

    assert_eq!(adapters.adapters().len(), 1);
    assert_eq!(adapters.adapters()[0].runtime_id(), "opencode");
    wait_for_runtime_readiness(&runtime_readiness_manager, true);
    wait_for_keepalive_state(&keepalive_manager, true);

    let (mut proxy_client, _) = connect(adapters.adapters()[0].listen_url())
        .expect("client should connect through the OpenCode runtime adapter");
    proxy_client
        .send(Message::Text(
            json!({
                "id": "events",
                "method": "GET",
                "path": "/event"
            })
            .to_string()
            .into(),
        ))
        .expect("client event request should send through OpenCode proxy");

    let response = read_json_text_message(&mut proxy_client);
    assert_eq!(response["id"], json!("events"));
    assert_eq!(response["type"], json!("response"));
    assert_eq!(response["status"], json!(200));

    let event = read_json_text_message(&mut proxy_client);
    assert_eq!(event["id"], json!("events"));
    assert_eq!(event["type"], json!("sse"));
    assert_eq!(event["data"], json!("{\"type\":\"server.connected\"}"));

    proxy_client
        .close(None)
        .expect("proxy client should close cleanly");
    adapters
        .close()
        .expect("runtime adapter registry should close the OpenCode adapter");
    server_complete_receiver
        .recv()
        .expect("raw server should complete OpenCode request");
    shutdown_requested.store(true, Ordering::Relaxed);
    let _ = TcpStream::connect(raw_address);
    raw_server_thread
        .join()
        .expect("raw OpenCode server thread should exit cleanly");
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

struct HttpRequest {
    method: String,
    path: String,
}

fn read_http_request(stream: &mut TcpStream) -> HttpRequest {
    let mut buffer = Vec::new();
    let mut scratch = [0_u8; 1024];
    loop {
        let bytes_read = stream
            .read(&mut scratch)
            .expect("raw server request should read");
        if bytes_read == 0 {
            break;
        }
        buffer.extend_from_slice(&scratch[..bytes_read]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let request = String::from_utf8(buffer).expect("raw server request should be utf8");
    let request_line = request
        .lines()
        .next()
        .expect("raw server request should contain request line");
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .expect("raw server request should contain method")
        .to_string();
    let path = parts
        .next()
        .expect("raw server request should contain path")
        .to_string();

    HttpRequest { method, path }
}
