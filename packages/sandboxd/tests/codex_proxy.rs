use std::collections::BTreeMap;
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;

use serde_json::{Value, json};
use tokio::runtime::Runtime;
use tokio::sync::watch;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket, accept, connect};

use sandboxd::codex_proxy::{
    CODEX_INITIALIZE_CLIENT_NAME, CodexSessionManagerError, RetainReason,
    spawn_codex_session_manager, start_codex_proxy, start_codex_proxy_with_idempotency_store,
};
use sandboxd::idempotency::store::IdempotencyStore;
use sandboxd::idempotency::{AgentRuntimeId, IdempotencyOperation, RequestFingerprint};
use sandboxd::keepalive::KeepaliveManager;
use sandboxd::runtime::readiness::RuntimeReadinessManager;
use sandboxd::time::{Duration, Sleeper, ThreadSleeper};

static REQUEST_ID_COUNTER: AtomicU64 = AtomicU64::new(100);
const LIVE_RETAIN_FAILURE_ATTEMPTS: usize = 200;

fn assert_metadata_only_thread_resume_request(request: &Value, thread_id: &str) {
    assert_eq!(
        request["method"],
        Value::String("thread/resume".to_string())
    );
    assert_eq!(
        request["params"]["threadId"],
        Value::String(thread_id.to_string())
    );
    assert_eq!(request["params"]["excludeTurns"], Value::Bool(true));
}

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

        respond_to_manager_bootstrap(&mut monitor_socket, vec![json!("thr_123")]);

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

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let proxy = start_codex_proxy(
        "ws://127.0.0.1:0/codex",
        &raw_url,
        keepalive_manager.clone(),
        runtime_readiness_manager.clone(),
    )
    .expect("Codex proxy should start");

    wait_for_keepalive_state(&keepalive_manager, true);

    let (mut proxy_client, _) = connect_to_proxy_with_retry(proxy.listen_url());
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

    proxy_client
        .close(None)
        .expect("proxy client should close cleanly");
    proxy.close().expect("Codex proxy should close cleanly");
    raw_server_thread
        .join()
        .expect("raw server thread should exit cleanly");
}

#[test]
fn session_manager_retain_and_release_manage_subscriptions() {
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

        let (manager_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the session manager connection");
        let mut manager_socket = accept(manager_stream).expect("manager handshake should succeed");

        respond_to_manager_bootstrap(&mut manager_socket, Vec::new());

        let retain_request = read_json_text_message(&mut manager_socket);
        assert_metadata_only_thread_resume_request(&retain_request, "thr_123");
        manager_socket
            .send(Message::Text(
                json!({
                    "id": retain_request["id"],
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
            .expect("thread/resume success should send");

        let release_request = read_json_text_message(&mut manager_socket);
        assert_eq!(
            release_request["method"],
            Value::String("thread/unsubscribe".to_string())
        );
        assert_eq!(
            release_request["params"]["threadId"],
            Value::String("thr_123".to_string())
        );
        manager_socket
            .send(Message::Text(
                json!({
                    "id": release_request["id"],
                    "result": {
                        "status": "unsubscribed"
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("thread/unsubscribe success should send");
    });

    server_ready_receiver
        .recv()
        .expect("raw server should report readiness");

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime = build_runtime();
    let (shutdown_sender, handle, task) = runtime.block_on(async {
        let (shutdown_sender, shutdown_receiver) = watch::channel(false);
        let (handle, task, _health_state_receiver) =
            spawn_codex_session_manager(raw_url, keepalive_manager, shutdown_receiver);
        (shutdown_sender, handle, task)
    });
    runtime.block_on(async {
        handle
            .retain_thread(
                "thr_123".to_string(),
                RetainReason::MistleAgentBackgroundExecution,
            )
            .await
            .expect("retain command should succeed");
        handle
            .release_thread(
                "thr_123".to_string(),
                RetainReason::MistleAgentBackgroundExecution,
            )
            .await
            .expect("release command should succeed");
        shutdown_sender
            .send(true)
            .expect("shutdown should notify the session manager");
        task.await
            .expect("session manager task should join")
            .expect("session manager should exit cleanly");
    });
    raw_server_thread
        .join()
        .expect("raw server thread should exit cleanly");
}

#[test]
fn session_manager_auto_releases_when_resume_returns_non_active_status() {
    let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
    let raw_port = raw_listener
        .local_addr()
        .expect("raw listener should expose an address")
        .port();
    let raw_url = format!("ws://127.0.0.1:{raw_port}/raw");

    let (server_ready_sender, server_ready_receiver) = mpsc::channel();
    let (auto_release_sender, auto_release_receiver) = mpsc::channel();
    let raw_server_thread = thread::spawn(move || {
        server_ready_sender
            .send(())
            .expect("raw server ready signal should send");

        let (manager_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the session manager connection");
        let mut manager_socket = accept(manager_stream).expect("manager handshake should succeed");

        respond_to_manager_bootstrap(&mut manager_socket, Vec::new());

        let retain_request = read_json_text_message(&mut manager_socket);
        assert_metadata_only_thread_resume_request(&retain_request, "thr_idle");
        manager_socket
            .send(Message::Text(
                json!({
                    "id": retain_request["id"],
                    "result": {
                        "thread": {
                            "id": "thr_idle",
                            "status": {
                                "type": "idle"
                            }
                        }
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("thread/resume idle response should send");

        let release_request = read_json_text_message(&mut manager_socket);
        assert_eq!(
            release_request["method"],
            Value::String("thread/unsubscribe".to_string())
        );
        assert_eq!(
            release_request["params"]["threadId"],
            Value::String("thr_idle".to_string())
        );
        manager_socket
            .send(Message::Text(
                json!({
                    "id": release_request["id"],
                    "result": {
                        "status": "unsubscribed"
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("thread/unsubscribe success should send");
        auto_release_sender
            .send(())
            .expect("auto-release signal should send");
    });

    server_ready_receiver
        .recv()
        .expect("raw server should report readiness");

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime = build_runtime();
    let (shutdown_sender, handle, task) = runtime.block_on(async {
        let (shutdown_sender, shutdown_receiver) = watch::channel(false);
        let (handle, task, _health_state_receiver) =
            spawn_codex_session_manager(raw_url, keepalive_manager, shutdown_receiver);
        (shutdown_sender, handle, task)
    });
    runtime.block_on(async {
        handle
            .retain_thread(
                "thr_idle".to_string(),
                RetainReason::MistleAgentBackgroundExecution,
            )
            .await
            .expect("retain command should succeed");
    });
    auto_release_receiver
        .recv()
        .expect("auto-release should be observed");
    runtime.block_on(async {
        shutdown_sender
            .send(true)
            .expect("shutdown should notify the session manager");
        task.await
            .expect("session manager task should join")
            .expect("session manager should exit cleanly");
    });
    raw_server_thread
        .join()
        .expect("raw server thread should exit cleanly");
}

#[test]
fn session_manager_preserves_retained_state_when_release_unsubscribe_fails() {
    let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
    let raw_port = raw_listener
        .local_addr()
        .expect("raw listener should expose an address")
        .port();
    let raw_url = format!("ws://127.0.0.1:{raw_port}/raw");

    let (server_ready_sender, server_ready_receiver) = mpsc::channel();
    let (replay_ready_sender, replay_ready_receiver) = mpsc::channel();
    let raw_server_thread = thread::spawn(move || {
        server_ready_sender
            .send(())
            .expect("raw server ready signal should send");

        let (first_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the first manager connection");
        let mut first_socket = accept(first_stream).expect("first handshake should succeed");
        respond_to_manager_bootstrap(&mut first_socket, Vec::new());

        let retain_request = read_json_text_message(&mut first_socket);
        assert_metadata_only_thread_resume_request(&retain_request, "thr_release_error");
        first_socket
            .send(Message::Text(
                json!({
                    "id": retain_request["id"],
                    "result": {
                        "thread": {
                            "id": "thr_release_error",
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
            .expect("retain success should send");

        let release_request = read_json_text_message(&mut first_socket);
        assert_eq!(
            release_request["method"],
            Value::String("thread/unsubscribe".to_string())
        );
        first_socket
            .send(Message::Text(
                json!({
                    "id": release_request["id"],
                    "error": {
                        "code": -32600,
                        "message": "permission denied"
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("unsubscribe failure should send");
        drop(first_socket);

        let (second_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the replay manager connection");
        let mut second_socket = accept(second_stream).expect("second handshake should succeed");
        respond_to_manager_bootstrap(&mut second_socket, Vec::new());

        let replay_request = read_json_text_message(&mut second_socket);
        assert_metadata_only_thread_resume_request(&replay_request, "thr_release_error");
        second_socket
            .send(Message::Text(
                json!({
                    "id": replay_request["id"],
                    "result": {
                        "thread": {
                            "id": "thr_release_error",
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
            .expect("replay success should send");
        replay_ready_sender
            .send(())
            .expect("replay ready signal should send");
    });

    server_ready_receiver
        .recv()
        .expect("raw server should report readiness");

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime = build_runtime();
    let (shutdown_sender, handle, task) = runtime.block_on(async {
        let (shutdown_sender, shutdown_receiver) = watch::channel(false);
        let (handle, task, _health_state_receiver) =
            spawn_codex_session_manager(raw_url, keepalive_manager, shutdown_receiver);
        (shutdown_sender, handle, task)
    });
    runtime.block_on(async {
        handle
            .retain_thread(
                "thr_release_error".to_string(),
                RetainReason::MistleAgentBackgroundExecution,
            )
            .await
            .expect("retain command should succeed");
        let error = handle
            .release_thread(
                "thr_release_error".to_string(),
                RetainReason::MistleAgentBackgroundExecution,
            )
            .await
            .expect_err("release should fail when unsubscribe is rejected");
        match error {
            CodexSessionManagerError::RequestRejected { method, message } => {
                assert_eq!(method, "thread/unsubscribe");
                assert_eq!(message, "permission denied");
            }
            other => panic!("unexpected release error: {other}"),
        }
    });
    replay_ready_receiver
        .recv()
        .expect("replay should occur after release failure");
    runtime.block_on(async {
        shutdown_sender
            .send(true)
            .expect("shutdown should notify the session manager");
        task.await
            .expect("session manager task should join")
            .expect("session manager should exit cleanly");
    });
    raw_server_thread
        .join()
        .expect("raw server thread should exit cleanly");
}

#[test]
fn session_manager_reconnect_replay_removes_missing_rollout_and_allows_retain_again() {
    let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
    let raw_port = raw_listener
        .local_addr()
        .expect("raw listener should expose an address")
        .port();
    let raw_url = format!("ws://127.0.0.1:{raw_port}/raw");

    let (server_ready_sender, server_ready_receiver) = mpsc::channel();
    let (second_connection_ready_sender, second_connection_ready_receiver) = mpsc::channel();
    let raw_server_thread = thread::spawn(move || {
        server_ready_sender
            .send(())
            .expect("raw server ready signal should send");

        let (first_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the first manager connection");
        let mut first_socket = accept(first_stream).expect("first handshake should succeed");
        respond_to_manager_bootstrap(&mut first_socket, Vec::new());

        let first_retain = read_json_text_message(&mut first_socket);
        assert_metadata_only_thread_resume_request(&first_retain, "thr_missing");
        first_socket
            .send(Message::Text(
                json!({
                    "id": first_retain["id"],
                    "result": {
                        "thread": {
                            "id": "thr_missing",
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
            .expect("first thread/resume success should send");
        drop(first_socket);

        let (second_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the replay manager connection");
        let mut second_socket = accept(second_stream).expect("second handshake should succeed");
        respond_to_manager_bootstrap(&mut second_socket, Vec::new());

        let replay_request = read_json_text_message(&mut second_socket);
        assert_metadata_only_thread_resume_request(&replay_request, "thr_missing");
        second_socket
            .send(Message::Text(
                json!({
                    "id": replay_request["id"],
                    "error": {
                        "code": -32600,
                        "message": "no rollout found for thread id thr_missing"
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("replay failure should send");
        second_connection_ready_sender
            .send(())
            .expect("second connection ready signal should send");

        let second_retain = read_json_text_message(&mut second_socket);
        assert_metadata_only_thread_resume_request(&second_retain, "thr_missing");
        second_socket
            .send(Message::Text(
                json!({
                    "id": second_retain["id"],
                    "result": {
                        "thread": {
                            "id": "thr_missing",
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
            .expect("second thread/resume success should send");
    });

    server_ready_receiver
        .recv()
        .expect("raw server should report readiness");

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime = build_runtime();
    let (shutdown_sender, handle, task) = runtime.block_on(async {
        let (shutdown_sender, shutdown_receiver) = watch::channel(false);
        let (handle, task, _health_state_receiver) =
            spawn_codex_session_manager(raw_url, keepalive_manager, shutdown_receiver);
        (shutdown_sender, handle, task)
    });
    runtime.block_on(async {
        handle
            .retain_thread(
                "thr_missing".to_string(),
                RetainReason::MistleAgentBackgroundExecution,
            )
            .await
            .expect("initial retain should succeed");
    });
    second_connection_ready_receiver
        .recv()
        .expect("second connection should become ready");
    runtime.block_on(async {
        handle
            .retain_thread(
                "thr_missing".to_string(),
                RetainReason::MistleAgentBackgroundExecution,
            )
            .await
            .expect("retain should succeed again after replay removed the stale entry");
        shutdown_sender
            .send(true)
            .expect("shutdown should notify the session manager");
        task.await
            .expect("session manager task should join")
            .expect("session manager should exit cleanly");
    });
    raw_server_thread
        .join()
        .expect("raw server thread should exit cleanly");
}

#[test]
fn session_manager_auto_releases_retained_threads_on_non_active_status() {
    let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
    let raw_port = raw_listener
        .local_addr()
        .expect("raw listener should expose an address")
        .port();
    let raw_url = format!("ws://127.0.0.1:{raw_port}/raw");

    let (server_ready_sender, server_ready_receiver) = mpsc::channel();
    let (auto_release_sender, auto_release_receiver) = mpsc::channel();
    let raw_server_thread = thread::spawn(move || {
        server_ready_sender
            .send(())
            .expect("raw server ready signal should send");

        let (manager_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the session manager connection");
        let mut manager_socket = accept(manager_stream).expect("manager handshake should succeed");

        respond_to_manager_bootstrap(&mut manager_socket, Vec::new());

        let retain_request = read_json_text_message(&mut manager_socket);
        assert_metadata_only_thread_resume_request(&retain_request, "thr_456");
        manager_socket
            .send(Message::Text(
                json!({
                    "id": retain_request["id"],
                    "result": {
                        "thread": {
                            "id": "thr_456",
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
            .expect("thread/resume success should send");

        manager_socket
            .send(Message::Text(
                json!({
                    "method": "thread/status/changed",
                    "params": {
                        "threadId": "thr_456",
                        "status": {
                            "type": "idle"
                        }
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("idle status change should send");

        let release_request = read_json_text_message(&mut manager_socket);
        assert_eq!(
            release_request["method"],
            Value::String("thread/unsubscribe".to_string())
        );
        assert_eq!(
            release_request["params"]["threadId"],
            Value::String("thr_456".to_string())
        );
        manager_socket
            .send(Message::Text(
                json!({
                    "id": release_request["id"],
                    "result": {
                        "status": "unsubscribed"
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("thread/unsubscribe success should send");
        auto_release_sender
            .send(())
            .expect("auto-release signal should send");
    });

    server_ready_receiver
        .recv()
        .expect("raw server should report readiness");

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime = build_runtime();
    let (shutdown_sender, handle, task) = runtime.block_on(async {
        let (shutdown_sender, shutdown_receiver) = watch::channel(false);
        let (handle, task, _health_state_receiver) =
            spawn_codex_session_manager(raw_url, keepalive_manager, shutdown_receiver);
        (shutdown_sender, handle, task)
    });
    runtime.block_on(async {
        handle
            .retain_thread(
                "thr_456".to_string(),
                RetainReason::MistleAgentBackgroundExecution,
            )
            .await
            .expect("retain command should succeed");
    });
    auto_release_receiver
        .recv()
        .expect("auto-release should be observed");
    runtime.block_on(async {
        shutdown_sender
            .send(true)
            .expect("shutdown should notify the session manager");
        task.await
            .expect("session manager task should join")
            .expect("session manager should exit cleanly");
    });
    raw_server_thread
        .join()
        .expect("raw server thread should exit cleanly");
}

#[test]
fn trigger_turn_start_buffers_success_until_retention_succeeds() {
    let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
    let raw_port = raw_listener
        .local_addr()
        .expect("raw listener should expose an address")
        .port();
    let raw_url = format!("ws://127.0.0.1:{raw_port}/raw");

    let (server_ready_sender, server_ready_receiver) = mpsc::channel();
    let (release_retention_sender, release_retention_receiver) = mpsc::channel();
    let (server_shutdown_sender, server_shutdown_receiver) = mpsc::channel();
    let raw_server_thread = thread::spawn(move || {
        server_ready_sender
            .send(())
            .expect("raw server ready signal should send");

        let (manager_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the manager connection");
        let mut manager_socket = accept(manager_stream).expect("manager handshake should succeed");
        respond_to_manager_bootstrap(&mut manager_socket, Vec::new());

        let (client_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the proxied client connection");
        let mut client_socket =
            accept(client_stream).expect("proxied client handshake should succeed");

        let initialize_request = read_json_text_message(&mut client_socket);
        assert_eq!(
            initialize_request["method"],
            Value::String("initialize".to_string())
        );
        client_socket
            .send(Message::Text(
                json!({
                    "id": initialize_request["id"],
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

        let turn_start_request = read_json_text_message(&mut client_socket);
        assert_eq!(
            turn_start_request["method"],
            Value::String("turn/start".to_string())
        );
        assert_eq!(
            turn_start_request["params"]["threadId"],
            Value::String("thr_trigger".to_string())
        );
        client_socket
            .send(Message::Text(
                json!({
                    "id": turn_start_request["id"],
                    "result": {
                        "turn": {
                            "id": "turn_trigger",
                            "status": "inProgress"
                        }
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("turn/start success should send");
        client_socket
            .send(Message::Text(
                json!({
                    "method": "turn/started",
                    "params": {
                        "turnId": "turn_trigger"
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("notification should send");

        let retain_request = read_json_text_message(&mut manager_socket);
        assert_metadata_only_thread_resume_request(&retain_request, "thr_trigger");

        release_retention_receiver
            .recv()
            .expect("test should release retained success forwarding");

        manager_socket
            .send(Message::Text(
                json!({
                    "id": retain_request["id"],
                    "result": {
                        "thread": {
                            "id": "thr_trigger",
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
            .expect("manager retain response should send");
        server_shutdown_receiver
            .recv()
            .expect("test should signal raw server shutdown");
    });

    server_ready_receiver
        .recv()
        .expect("raw server should report readiness");

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let proxy = start_codex_proxy(
        "ws://127.0.0.1:0/codex",
        &raw_url,
        keepalive_manager,
        runtime_readiness_manager.clone(),
    )
    .expect("Codex proxy should start");

    let (mut proxy_client, _) = connect_to_proxy_with_retry(proxy.listen_url());
    send_initialize_request(
        &mut proxy_client,
        REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed),
        Some("Mistle Agent Client"),
    );
    let _ = read_json_text_message(&mut proxy_client);

    let turn_start_id = REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    proxy_client
        .send(Message::Text(
            json!({
                "id": turn_start_id,
                "method": "turn/start",
                "params": {
                    "threadId": "thr_trigger",
                    "input": []
                }
            })
            .to_string()
            .into(),
        ))
        .expect("turn/start request should send");

    let first_message = read_json_text_message(&mut proxy_client);
    assert_eq!(first_message["method"], json!("turn/started"));

    release_retention_sender
        .send(())
        .expect("retention release signal should send");

    let success_response = read_json_text_message(&mut proxy_client);
    assert_eq!(success_response["id"], json!(turn_start_id));
    assert_eq!(
        success_response["result"]["turn"]["id"],
        json!("turn_trigger")
    );

    server_shutdown_sender
        .send(())
        .expect("raw server shutdown signal should send");
    proxy_client
        .close(None)
        .expect("proxy client should close cleanly");
    proxy.close().expect("Codex proxy should close cleanly");
    raw_server_thread
        .join()
        .expect("raw server thread should exit cleanly");
}

#[test]
fn trigger_turn_start_returns_proxy_error_when_retention_fails() {
    let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
    let raw_port = raw_listener
        .local_addr()
        .expect("raw listener should expose an address")
        .port();
    let raw_url = format!("ws://127.0.0.1:{raw_port}/raw");

    let (server_ready_sender, server_ready_receiver) = mpsc::channel();
    let (server_shutdown_sender, server_shutdown_receiver) = mpsc::channel();
    let raw_server_thread = thread::spawn(move || {
        server_ready_sender
            .send(())
            .expect("raw server ready signal should send");

        let (manager_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the manager connection");
        let mut manager_socket = accept(manager_stream).expect("manager handshake should succeed");
        respond_to_manager_bootstrap(&mut manager_socket, Vec::new());

        let (client_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the proxied client connection");
        let mut client_socket =
            accept(client_stream).expect("proxied client handshake should succeed");

        let initialize_request = read_json_text_message(&mut client_socket);
        client_socket
            .send(Message::Text(
                json!({
                    "id": initialize_request["id"],
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

        let turn_start_request = read_json_text_message(&mut client_socket);
        client_socket
            .send(Message::Text(
                json!({
                    "id": turn_start_request["id"],
                    "result": {
                        "turn": {
                            "id": "turn_failure",
                            "status": "inProgress"
                        }
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("turn/start success should send");

        for _ in 0..LIVE_RETAIN_FAILURE_ATTEMPTS {
            let retain_request = read_json_text_message(&mut manager_socket);
            assert_metadata_only_thread_resume_request(&retain_request, "thr_failure");
            manager_socket
                .send(Message::Text(
                    json!({
                        "id": retain_request["id"],
                        "error": {
                            "code": -32600,
                            "message": "no rollout found for thread id thr_failure"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("manager retain failure should send");
        }
        server_shutdown_receiver
            .recv()
            .expect("test should signal raw server shutdown");
    });

    server_ready_receiver
        .recv()
        .expect("raw server should report readiness");

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let proxy = start_codex_proxy(
        "ws://127.0.0.1:0/codex",
        &raw_url,
        keepalive_manager,
        runtime_readiness_manager.clone(),
    )
    .expect("Codex proxy should start");

    let (mut proxy_client, _) = connect_to_proxy_with_retry(proxy.listen_url());
    send_initialize_request(
        &mut proxy_client,
        REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed),
        Some("Mistle Agent Client"),
    );
    let _ = read_json_text_message(&mut proxy_client);

    let turn_start_id = REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    proxy_client
        .send(Message::Text(
            json!({
                "id": turn_start_id,
                "method": "turn/start",
                "params": {
                    "threadId": "thr_failure",
                    "input": []
                }
            })
            .to_string()
            .into(),
        ))
        .expect("turn/start request should send");

    let error_response = read_json_text_message(&mut proxy_client);
    assert_eq!(error_response["id"], json!(turn_start_id));
    assert_eq!(error_response["error"]["code"], json!(-32000));
    assert_eq!(
        error_response["error"]["message"],
        json!("sandboxd failed to retain Codex thread subscription for background execution")
    );
    assert_eq!(error_response.get("result"), None);

    server_shutdown_sender
        .send(())
        .expect("raw server shutdown signal should send");
    proxy_client
        .close(None)
        .expect("proxy client should close cleanly");
    proxy.close().expect("Codex proxy should close cleanly");
    raw_server_thread
        .join()
        .expect("raw server thread should exit cleanly");
}

#[test]
fn trigger_turn_steer_buffers_success_until_retention_succeeds() {
    let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
    let raw_port = raw_listener
        .local_addr()
        .expect("raw listener should expose an address")
        .port();
    let raw_url = format!("ws://127.0.0.1:{raw_port}/raw");

    let (server_ready_sender, server_ready_receiver) = mpsc::channel();
    let (release_retention_sender, release_retention_receiver) = mpsc::channel();
    let (server_shutdown_sender, server_shutdown_receiver) = mpsc::channel();
    let raw_server_thread = thread::spawn(move || {
        server_ready_sender
            .send(())
            .expect("raw server ready signal should send");

        let (manager_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the manager connection");
        let mut manager_socket = accept(manager_stream).expect("manager handshake should succeed");
        respond_to_manager_bootstrap(&mut manager_socket, Vec::new());

        let (client_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the proxied client connection");
        let mut client_socket =
            accept(client_stream).expect("proxied client handshake should succeed");

        let initialize_request = read_json_text_message(&mut client_socket);
        client_socket
            .send(Message::Text(
                json!({
                    "id": initialize_request["id"],
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

        let turn_steer_request = read_json_text_message(&mut client_socket);
        assert_eq!(
            turn_steer_request["method"],
            Value::String("turn/steer".to_string())
        );
        assert_eq!(
            turn_steer_request["params"]["threadId"],
            Value::String("thr_steer".to_string())
        );
        client_socket
            .send(Message::Text(
                json!({
                    "id": turn_steer_request["id"],
                    "result": {
                        "turnId": "turn_steered"
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("turn/steer success should send");
        client_socket
            .send(Message::Text(
                json!({
                    "method": "turn/updated",
                    "params": {
                        "turnId": "turn_steered"
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("notification should send");

        let retain_request = read_json_text_message(&mut manager_socket);
        assert_metadata_only_thread_resume_request(&retain_request, "thr_steer");

        release_retention_receiver
            .recv()
            .expect("test should release retained success forwarding");

        manager_socket
            .send(Message::Text(
                json!({
                    "id": retain_request["id"],
                    "result": {
                        "thread": {
                            "id": "thr_steer",
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
            .expect("manager retain response should send");
        server_shutdown_receiver
            .recv()
            .expect("test should signal raw server shutdown");
    });

    server_ready_receiver
        .recv()
        .expect("raw server should report readiness");

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let proxy = start_codex_proxy(
        "ws://127.0.0.1:0/codex",
        &raw_url,
        keepalive_manager,
        runtime_readiness_manager.clone(),
    )
    .expect("Codex proxy should start");

    let (mut proxy_client, _) = connect_to_proxy_with_retry(proxy.listen_url());
    send_initialize_request(
        &mut proxy_client,
        REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed),
        Some("Mistle Agent Client"),
    );
    let _ = read_json_text_message(&mut proxy_client);

    let turn_steer_id = REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    proxy_client
        .send(Message::Text(
            json!({
                "id": turn_steer_id,
                "method": "turn/steer",
                "params": {
                    "threadId": "thr_steer",
                    "input": []
                }
            })
            .to_string()
            .into(),
        ))
        .expect("turn/steer request should send");

    let first_message = read_json_text_message(&mut proxy_client);
    assert_eq!(first_message["method"], json!("turn/updated"));

    release_retention_sender
        .send(())
        .expect("retention release signal should send");

    let success_response = read_json_text_message(&mut proxy_client);
    assert_eq!(success_response["id"], json!(turn_steer_id));
    assert_eq!(success_response["result"]["turnId"], json!("turn_steered"));

    server_shutdown_sender
        .send(())
        .expect("raw server shutdown signal should send");
    proxy_client
        .close(None)
        .expect("proxy client should close cleanly");
    proxy.close().expect("Codex proxy should close cleanly");
    raw_server_thread
        .join()
        .expect("raw server thread should exit cleanly");
}

#[test]
fn non_trigger_turn_start_remains_passthrough() {
    let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
    let raw_port = raw_listener
        .local_addr()
        .expect("raw listener should expose an address")
        .port();
    let raw_url = format!("ws://127.0.0.1:{raw_port}/raw");

    let (server_ready_sender, server_ready_receiver) = mpsc::channel();
    let (server_shutdown_sender, server_shutdown_receiver) = mpsc::channel();
    let raw_server_thread = thread::spawn(move || {
        server_ready_sender
            .send(())
            .expect("raw server ready signal should send");

        let (manager_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the manager connection");
        let mut manager_socket = accept(manager_stream).expect("manager handshake should succeed");
        respond_to_manager_bootstrap(&mut manager_socket, Vec::new());
        set_plain_websocket_read_timeout(&mut manager_socket, Duration::from_millis(50));

        let (client_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the proxied client connection");
        let mut client_socket =
            accept(client_stream).expect("proxied client handshake should succeed");

        let initialize_request = read_json_text_message(&mut client_socket);
        client_socket
            .send(Message::Text(
                json!({
                    "id": initialize_request["id"],
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

        let turn_start_request = read_json_text_message(&mut client_socket);
        client_socket
            .send(Message::Text(
                json!({
                    "id": turn_start_request["id"],
                    "result": {
                        "turn": {
                            "id": "turn_passthrough",
                            "status": "inProgress"
                        }
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("turn/start success should send");

        match manager_socket.read() {
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(tungstenite::Error::Protocol(
                tungstenite::error::ProtocolError::ResetWithoutClosingHandshake,
            ))
            | Err(tungstenite::Error::ConnectionClosed)
            | Err(tungstenite::Error::AlreadyClosed) => {}
            other => panic!("manager should not receive a retain request: {other:?}"),
        }
        server_shutdown_receiver
            .recv()
            .expect("test should signal raw server shutdown");
    });

    server_ready_receiver
        .recv()
        .expect("raw server should report readiness");

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let proxy = start_codex_proxy(
        "ws://127.0.0.1:0/codex",
        &raw_url,
        keepalive_manager,
        runtime_readiness_manager.clone(),
    )
    .expect("Codex proxy should start");

    let (mut proxy_client, _) = connect_to_proxy_with_retry(proxy.listen_url());
    send_initialize_request(
        &mut proxy_client,
        REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed),
        Some("Mistle Dashboard"),
    );
    let _ = read_json_text_message(&mut proxy_client);

    let turn_start_id = REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    proxy_client
        .send(Message::Text(
            json!({
                "id": turn_start_id,
                "method": "turn/start",
                "params": {
                    "threadId": "thr_passthrough",
                    "input": []
                }
            })
            .to_string()
            .into(),
        ))
        .expect("turn/start request should send");

    let success_response = read_json_text_message(&mut proxy_client);
    assert_eq!(success_response["id"], json!(turn_start_id));
    assert_eq!(
        success_response["result"]["turn"]["id"],
        json!("turn_passthrough")
    );

    server_shutdown_sender
        .send(())
        .expect("raw server shutdown signal should send");
    proxy_client
        .close(None)
        .expect("proxy client should close cleanly");
    proxy.close().expect("Codex proxy should close cleanly");
    raw_server_thread
        .join()
        .expect("raw server thread should exit cleanly");
}

#[test]
fn replays_completed_idempotent_thread_start_without_forwarding_again() {
    let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
    let raw_port = raw_listener
        .local_addr()
        .expect("raw listener should expose an address")
        .port();
    let raw_url = format!("ws://127.0.0.1:{raw_port}/raw");

    let (server_ready_sender, server_ready_receiver) = mpsc::channel();
    let (server_shutdown_sender, server_shutdown_receiver) = mpsc::channel();
    let raw_server_thread = thread::spawn(move || {
        server_ready_sender
            .send(())
            .expect("raw server ready signal should send");

        let (manager_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the manager connection");
        let mut manager_socket = accept(manager_stream).expect("manager handshake should succeed");
        respond_to_manager_bootstrap(&mut manager_socket, Vec::new());

        let (client_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the proxied client connection");
        let mut client_socket =
            accept(client_stream).expect("proxied client handshake should succeed");

        let thread_start_request = read_json_text_message(&mut client_socket);
        assert_eq!(thread_start_request["method"], json!("thread/start"));
        assert_eq!(thread_start_request.get("idempotency"), None);
        client_socket
            .send(Message::Text(
                json!({
                    "id": thread_start_request["id"],
                    "result": {
                        "thread": {
                            "id": "thr_idempotent",
                            "cwd": "/workspace"
                        }
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("thread/start response should send");

        set_plain_websocket_read_timeout(&mut client_socket, Duration::from_millis(150));
        match client_socket.read() {
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Ok(Message::Close(_))
            | Err(tungstenite::Error::Protocol(
                tungstenite::error::ProtocolError::ResetWithoutClosingHandshake,
            ))
            | Err(tungstenite::Error::ConnectionClosed)
            | Err(tungstenite::Error::AlreadyClosed) => {}
            other => panic!("raw Codex should not receive a duplicate thread/start: {other:?}"),
        }
        server_shutdown_receiver
            .recv()
            .expect("test should signal raw server shutdown");
    });

    server_ready_receiver
        .recv()
        .expect("raw server should report readiness");

    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let store = IdempotencyStore::load_all(temp_dir.path().join("idempotency"))
        .expect("idempotency store should load");
    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let proxy = start_codex_proxy_with_idempotency_store(
        "ws://127.0.0.1:0/codex",
        &raw_url,
        keepalive_manager,
        runtime_readiness_manager,
        store,
    )
    .expect("Codex proxy should start");

    let (mut proxy_client, _) = connect_to_proxy_with_retry(proxy.listen_url());
    let fingerprint = codex_fingerprint(IdempotencyOperation::CreateConversation, "thread/start");
    send_idempotent_codex_request(
        &mut proxy_client,
        10_001,
        "thread/start",
        json!({ "cwd": "/workspace" }),
        "create-key",
        "createConversation",
        fingerprint.value(),
    );
    let first_response = read_json_text_message(&mut proxy_client);
    assert_eq!(first_response["id"], json!(10_001));
    assert_eq!(
        first_response["result"]["thread"]["id"],
        json!("thr_idempotent")
    );

    send_idempotent_codex_request(
        &mut proxy_client,
        10_002,
        "thread/start",
        json!({ "cwd": "/workspace" }),
        "create-key",
        "createConversation",
        fingerprint.value(),
    );
    let replay_response = read_json_text_message(&mut proxy_client);
    assert_eq!(replay_response["id"], json!(10_002));
    assert_eq!(
        replay_response["result"]["thread"]["id"],
        json!("thr_idempotent")
    );

    server_shutdown_sender
        .send(())
        .expect("raw server shutdown signal should send");
    proxy_client
        .close(None)
        .expect("proxy client should close cleanly");
    proxy.close().expect("Codex proxy should close cleanly");
    raw_server_thread
        .join()
        .expect("raw server thread should exit cleanly");
}

#[test]
fn rejects_codex_idempotency_key_reused_with_different_fingerprint() {
    let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
    let raw_port = raw_listener
        .local_addr()
        .expect("raw listener should expose an address")
        .port();
    let raw_url = format!("ws://127.0.0.1:{raw_port}/raw");

    let (server_ready_sender, server_ready_receiver) = mpsc::channel();
    let (server_shutdown_sender, server_shutdown_receiver) = mpsc::channel();
    let raw_server_thread = thread::spawn(move || {
        server_ready_sender
            .send(())
            .expect("raw server ready signal should send");

        let (manager_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the manager connection");
        let mut manager_socket = accept(manager_stream).expect("manager handshake should succeed");
        respond_to_manager_bootstrap(&mut manager_socket, Vec::new());

        let (client_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the proxied client connection");
        let mut client_socket =
            accept(client_stream).expect("proxied client handshake should succeed");
        let thread_start_request = read_json_text_message(&mut client_socket);
        client_socket
            .send(Message::Text(
                json!({
                    "id": thread_start_request["id"],
                    "result": {
                        "thread": {
                            "id": "thr_idempotent",
                            "cwd": "/workspace"
                        }
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("thread/start response should send");

        set_plain_websocket_read_timeout(&mut client_socket, Duration::from_millis(150));
        match client_socket.read() {
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Ok(Message::Close(_))
            | Err(tungstenite::Error::Protocol(
                tungstenite::error::ProtocolError::ResetWithoutClosingHandshake,
            ))
            | Err(tungstenite::Error::ConnectionClosed)
            | Err(tungstenite::Error::AlreadyClosed) => {}
            other => panic!("raw Codex should not receive a conflicting retry: {other:?}"),
        }
        server_shutdown_receiver
            .recv()
            .expect("test should signal raw server shutdown");
    });

    server_ready_receiver
        .recv()
        .expect("raw server should report readiness");

    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let store = IdempotencyStore::load_all(temp_dir.path().join("idempotency"))
        .expect("idempotency store should load");
    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let proxy = start_codex_proxy_with_idempotency_store(
        "ws://127.0.0.1:0/codex",
        &raw_url,
        keepalive_manager,
        runtime_readiness_manager,
        store,
    )
    .expect("Codex proxy should start");

    let (mut proxy_client, _) = connect_to_proxy_with_retry(proxy.listen_url());
    let first_fingerprint =
        codex_fingerprint(IdempotencyOperation::CreateConversation, "thread/start");
    send_idempotent_codex_request(
        &mut proxy_client,
        10_101,
        "thread/start",
        json!({ "cwd": "/workspace" }),
        "create-key",
        "createConversation",
        first_fingerprint.value(),
    );
    assert_eq!(
        read_json_text_message(&mut proxy_client)["id"],
        json!(10_101)
    );

    let conflicting_fingerprint = codex_fingerprint(
        IdempotencyOperation::CreateConversation,
        "thread/start-conflict",
    );
    send_idempotent_codex_request(
        &mut proxy_client,
        10_102,
        "thread/start",
        json!({ "cwd": "/workspace" }),
        "create-key",
        "createConversation",
        conflicting_fingerprint.value(),
    );
    let conflict_response = read_json_text_message(&mut proxy_client);
    assert_eq!(conflict_response["id"], json!(10_102));
    assert!(
        conflict_response["error"]["message"]
            .as_str()
            .expect("conflict message should be a string")
            .contains("different request fingerprint")
    );

    server_shutdown_sender
        .send(())
        .expect("raw server shutdown signal should send");
    proxy_client
        .close(None)
        .expect("proxy client should close cleanly");
    proxy.close().expect("Codex proxy should close cleanly");
    raw_server_thread
        .join()
        .expect("raw server thread should exit cleanly");
}

#[test]
fn idempotent_codex_request_without_usable_id_does_not_start_record() {
    let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
    let raw_port = raw_listener
        .local_addr()
        .expect("raw listener should expose an address")
        .port();
    let raw_url = format!("ws://127.0.0.1:{raw_port}/raw");

    let (server_ready_sender, server_ready_receiver) = mpsc::channel();
    let (server_shutdown_sender, server_shutdown_receiver) = mpsc::channel();
    let raw_server_thread = thread::spawn(move || {
        server_ready_sender
            .send(())
            .expect("raw server ready signal should send");

        let (manager_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the manager connection");
        let mut manager_socket = accept(manager_stream).expect("manager handshake should succeed");
        respond_to_manager_bootstrap(&mut manager_socket, Vec::new());

        let (client_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the proxied client connection");
        let mut client_socket =
            accept(client_stream).expect("proxied client handshake should succeed");
        let thread_start_request = read_json_text_message(&mut client_socket);
        assert_eq!(thread_start_request["method"], json!("thread/start"));
        assert_eq!(thread_start_request["id"], json!(10_202));
        client_socket
            .send(Message::Text(
                json!({
                    "id": thread_start_request["id"],
                    "result": {
                        "thread": {
                            "id": "thr_after_valid_id",
                            "cwd": "/workspace"
                        }
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("thread/start response should send");

        server_shutdown_receiver
            .recv()
            .expect("test should signal raw server shutdown");
    });

    server_ready_receiver
        .recv()
        .expect("raw server should report readiness");

    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let store = IdempotencyStore::load_all(temp_dir.path().join("idempotency"))
        .expect("idempotency store should load");
    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let proxy = start_codex_proxy_with_idempotency_store(
        "ws://127.0.0.1:0/codex",
        &raw_url,
        keepalive_manager,
        runtime_readiness_manager,
        store,
    )
    .expect("Codex proxy should start");

    let (mut proxy_client, _) = connect_to_proxy_with_retry(proxy.listen_url());
    let fingerprint = codex_fingerprint(IdempotencyOperation::CreateConversation, "thread/start");
    proxy_client
        .send(Message::Text(
            json!({
                "id": null,
                "method": "thread/start",
                "params": { "cwd": "/workspace" },
                "idempotency": {
                    "key": "create-key",
                    "operation": "createConversation",
                    "requestFingerprint": fingerprint.value()
                }
            })
            .to_string()
            .into(),
        ))
        .expect("invalid idempotent Codex request should send");
    let invalid_id_response = read_json_text_message(&mut proxy_client);
    assert_eq!(invalid_id_response["id"], Value::Null);
    assert!(
        invalid_id_response["error"]["message"]
            .as_str()
            .expect("invalid id message should be a string")
            .contains("requires a JSON-RPC request id")
    );

    send_idempotent_codex_request(
        &mut proxy_client,
        10_202,
        "thread/start",
        json!({ "cwd": "/workspace" }),
        "create-key",
        "createConversation",
        fingerprint.value(),
    );
    let response = read_json_text_message(&mut proxy_client);
    assert_eq!(response["id"], json!(10_202));
    assert_eq!(
        response["result"]["thread"]["id"],
        json!("thr_after_valid_id")
    );

    server_shutdown_sender
        .send(())
        .expect("raw server shutdown signal should send");
    proxy_client
        .close(None)
        .expect("proxy client should close cleanly");
    proxy.close().expect("Codex proxy should close cleanly");
    raw_server_thread
        .join()
        .expect("raw server thread should exit cleanly");
}

#[test]
fn replays_completed_non_retained_idempotent_turn_start_without_forwarding_again() {
    let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
    let raw_port = raw_listener
        .local_addr()
        .expect("raw listener should expose an address")
        .port();
    let raw_url = format!("ws://127.0.0.1:{raw_port}/raw");

    let (server_ready_sender, server_ready_receiver) = mpsc::channel();
    let (server_shutdown_sender, server_shutdown_receiver) = mpsc::channel();
    let raw_server_thread = thread::spawn(move || {
        server_ready_sender
            .send(())
            .expect("raw server ready signal should send");

        let (manager_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the manager connection");
        let mut manager_socket = accept(manager_stream).expect("manager handshake should succeed");
        respond_to_manager_bootstrap(&mut manager_socket, Vec::new());

        let (client_stream, _) = raw_listener
            .accept()
            .expect("raw server should accept the proxied client connection");
        let mut client_socket =
            accept(client_stream).expect("proxied client handshake should succeed");
        let turn_start_request = read_json_text_message(&mut client_socket);
        assert_eq!(turn_start_request["method"], json!("turn/start"));
        assert_eq!(turn_start_request.get("idempotency"), None);
        client_socket
            .send(Message::Text(
                json!({
                    "id": turn_start_request["id"],
                    "result": {
                        "turn": {
                            "id": "turn_non_retained",
                            "threadId": "thr_non_retained"
                        }
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("turn/start response should send");

        set_plain_websocket_read_timeout(&mut client_socket, Duration::from_millis(150));
        match client_socket.read() {
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Ok(Message::Close(_))
            | Err(tungstenite::Error::Protocol(
                tungstenite::error::ProtocolError::ResetWithoutClosingHandshake,
            ))
            | Err(tungstenite::Error::ConnectionClosed)
            | Err(tungstenite::Error::AlreadyClosed) => {}
            other => panic!("raw Codex should not receive a duplicate turn/start: {other:?}"),
        }
        server_shutdown_receiver
            .recv()
            .expect("test should signal raw server shutdown");
    });

    server_ready_receiver
        .recv()
        .expect("raw server should report readiness");

    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let store = IdempotencyStore::load_all(temp_dir.path().join("idempotency"))
        .expect("idempotency store should load");
    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let proxy = start_codex_proxy_with_idempotency_store(
        "ws://127.0.0.1:0/codex",
        &raw_url,
        keepalive_manager,
        runtime_readiness_manager,
        store,
    )
    .expect("Codex proxy should start");

    let (mut proxy_client, _) = connect_to_proxy_with_retry(proxy.listen_url());
    let fingerprint = codex_fingerprint(IdempotencyOperation::SubmitPayload, "turn/start");
    send_idempotent_codex_request(
        &mut proxy_client,
        10_301,
        "turn/start",
        json!({ "threadId": "thr_non_retained", "prompt": "hello" }),
        "submit-key",
        "submitPayload",
        fingerprint.value(),
    );
    let first_response = read_json_text_message(&mut proxy_client);
    assert_eq!(first_response["id"], json!(10_301));
    assert_eq!(
        first_response["result"]["turn"]["id"],
        json!("turn_non_retained")
    );

    send_idempotent_codex_request(
        &mut proxy_client,
        10_302,
        "turn/start",
        json!({ "threadId": "thr_non_retained", "prompt": "hello" }),
        "submit-key",
        "submitPayload",
        fingerprint.value(),
    );
    let replay_response = read_json_text_message(&mut proxy_client);
    assert_eq!(replay_response["id"], json!(10_302));
    assert_eq!(
        replay_response["result"]["turn"]["id"],
        json!("turn_non_retained")
    );

    server_shutdown_sender
        .send(())
        .expect("raw server shutdown signal should send");
    proxy_client
        .close(None)
        .expect("proxy client should close cleanly");
    proxy.close().expect("Codex proxy should close cleanly");
    raw_server_thread
        .join()
        .expect("raw server thread should exit cleanly");
}

fn build_runtime() -> Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("test runtime should build")
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

fn respond_to_manager_bootstrap<S>(manager_socket: &mut WebSocket<S>, loaded_threads: Vec<Value>)
where
    S: std::io::Read + std::io::Write,
{
    let initialize_request = read_json_text_message(manager_socket);
    assert_eq!(
        initialize_request["method"],
        Value::String("initialize".to_string())
    );
    assert_eq!(
        initialize_request["params"]["clientInfo"]["name"],
        Value::String(CODEX_INITIALIZE_CLIENT_NAME.to_string())
    );
    assert_eq!(
        initialize_request["params"]["capabilities"]["experimentalApi"],
        Value::Bool(true)
    );
    manager_socket
        .send(Message::Text(
            json!({
                "id": initialize_request["id"],
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
        read_json_text_message(manager_socket)["method"],
        Value::String("initialized".to_string())
    );

    let thread_loaded_list_request = read_json_text_message(manager_socket);
    assert_eq!(
        thread_loaded_list_request["method"],
        Value::String("thread/loaded/list".to_string())
    );
    manager_socket
        .send(Message::Text(
            json!({
                "id": thread_loaded_list_request["id"],
                "result": {
                    "data": loaded_threads,
                    "nextCursor": null
                }
            })
            .to_string()
            .into(),
        ))
        .expect("thread/loaded/list response should send");
}

fn connect_to_proxy_with_retry(
    url: &str,
) -> (
    WebSocket<MaybeTlsStream<TcpStream>>,
    tungstenite::handshake::client::Response,
) {
    let mut last_error = None;

    for _ in 0..50 {
        match connect(url) {
            Ok(connection) => return connection,
            Err(error) => {
                last_error = Some(error);
                ThreadSleeper.sleep(Duration::from_millis(10));
            }
        }
    }

    panic!(
        "client should connect through the Codex proxy: {}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "unknown connection error".to_string())
    );
}

fn send_initialize_request(
    proxy_client: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    request_id: u64,
    client_title: Option<&str>,
) {
    let mut client_info = json!({
        "name": CODEX_INITIALIZE_CLIENT_NAME,
        "version": "0.1.0"
    });
    if let Some(client_title) = client_title {
        client_info["title"] = json!(client_title);
    }

    proxy_client
        .send(Message::Text(
            json!({
                "id": request_id,
                "method": "initialize",
                "params": {
                    "clientInfo": client_info
                }
            })
            .to_string()
            .into(),
        ))
        .expect("initialize request should send");
}

fn send_idempotent_codex_request(
    proxy_client: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    request_id: u64,
    method: &str,
    params: Value,
    idempotency_key: &str,
    operation: &str,
    request_fingerprint: &str,
) {
    proxy_client
        .send(Message::Text(
            json!({
                "id": request_id,
                "method": method,
                "params": params,
                "idempotency": {
                    "key": idempotency_key,
                    "operation": operation,
                    "requestFingerprint": request_fingerprint
                }
            })
            .to_string()
            .into(),
        ))
        .expect("idempotent Codex request should send");
}

fn codex_fingerprint(operation: IdempotencyOperation, scenario: &str) -> RequestFingerprint {
    let mut fields = BTreeMap::new();
    fields.insert("scenario".to_string(), json!(scenario));
    RequestFingerprint::from_fields(AgentRuntimeId::Codex, operation, fields)
        .expect("fingerprint should encode")
}

fn set_plain_websocket_read_timeout(socket: &mut WebSocket<TcpStream>, timeout: Duration) {
    socket
        .get_mut()
        .set_read_timeout(Some(timeout))
        .expect("websocket read timeout should configure");
}
