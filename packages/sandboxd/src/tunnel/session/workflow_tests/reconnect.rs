use super::*;

#[test]
fn bootstrap_disconnect_leaves_publish_managers_disconnected_until_explicit_close() {
    let bootstrap_listener =
        TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
    let bootstrap_url = format!(
        "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
        bootstrap_listener
            .local_addr()
            .expect("bootstrap listener should expose an address")
            .port()
    );
    let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
    let gateway_thread = thread::spawn(move || {
        let (stream, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the bootstrap tunnel");
        let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

        let mut saw_keepalive_state = false;
        let mut saw_runtime_ready = false;
        for _ in 0..4 {
            let message = read_json_text_message(&mut websocket);
            let message_type = message["type"]
                .as_str()
                .expect("tunnel text message should expose a type");
            if message_type == "keepalive.state" {
                saw_keepalive_state = true;
            }
            if message_type == "runtime.ready" {
                saw_runtime_ready = true;
            }
            if saw_keepalive_state && saw_runtime_ready {
                break;
            }
        }
        assert!(
            saw_keepalive_state,
            "connected session should publish keepalive state after startup"
        );
        assert!(
            saw_runtime_ready,
            "connected session should publish runtime readiness after startup"
        );

        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
        gateway_done_sender
            .send(())
            .expect("gateway should signal the bootstrap disconnect");
    });

    let startup_input = SessionRuntimeInput {
        operation_kind: crate::protocol::startup::ActivationOperationKind::Start,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: bootstrap_url,
        acting_user_id: None,
        runtime_plan: serde_json::json!({
            "sandboxProfileId": "sbp_123",
            "version": 1,
            "image": {
                "source": "base",
                "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
            },
            "egressRoutes": [],
            "artifacts": [],
            "workspaceSources": [],
            "runtimeClients": [],
            "agentRuntimes": []
        }),
        git_identity: None,
        transparent_proxy: None,
    };

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let tunnel_session = TunnelSession::start(
        &startup_input,
        keepalive_manager.clone(),
        runtime_readiness_manager.clone(),
        None,
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");

    gateway_done_receiver
        .recv()
        .expect("gateway should complete the bootstrap disconnect");
    std::thread::sleep(std::time::Duration::from_millis(50));

    {
        let mut keepalive_manager = keepalive_manager
            .lock()
            .expect("keepalive manager lock should not be poisoned");
        keepalive_manager.set_platform_active(true);
        assert!(
            keepalive_manager
                .take_publishable_state(&SystemClock)
                .is_none(),
            "disconnected tunnel should suppress keepalive publication"
        );
    }
    {
        let mut runtime_readiness_manager = runtime_readiness_manager
            .lock()
            .expect("runtime readiness manager lock should not be poisoned");
        runtime_readiness_manager.set_ready(true);
        assert!(
            runtime_readiness_manager.take_publishable_state().is_none(),
            "disconnected tunnel should suppress runtime readiness publication"
        );
    }

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
}

#[test]
fn start_returns_error_when_initial_bootstrap_session_never_establishes() {
    let bootstrap_listener =
        TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
    let bootstrap_url = format!(
        "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
        bootstrap_listener
            .local_addr()
            .expect("bootstrap listener should expose an address")
            .port()
    );
    let gateway_thread = thread::spawn(move || {
        let (stream, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the initial bootstrap socket");
        drop(stream);
    });

    let startup_input = SessionRuntimeInput {
        operation_kind: crate::protocol::startup::ActivationOperationKind::Start,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: bootstrap_url,
        acting_user_id: None,
        runtime_plan: serde_json::json!({
            "sandboxProfileId": "sbp_123",
            "version": 1,
            "image": {
                "source": "base",
                "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
            },
            "egressRoutes": [],
            "artifacts": [],
            "workspaceSources": [],
            "runtimeClients": [],
            "agentRuntimes": []
        }),
        git_identity: None,
        transparent_proxy: None,
    };

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let error = match TunnelSession::start(
        &startup_input,
        keepalive_manager,
        runtime_readiness_manager,
        None,
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    ) {
        Ok(_) => panic!("initial bootstrap websocket failure should fail start()"),
        Err(error) => error,
    };

    assert!(
        error
            .to_string()
            .contains("failed to configure bootstrap tunnel socket: bootstrap websocket failed to connect to any resolved address"),
        "start() should surface the initial websocket establishment failure"
    );
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
}

#[test]
fn reconnects_after_gateway_service_restart_close_and_rolls_exchange_token_forward() {
    let bootstrap_listener =
        TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
    let bootstrap_port = bootstrap_listener
        .local_addr()
        .expect("bootstrap listener should expose an address")
        .port();
    let bootstrap_url = format!(
        "ws://127.0.0.1:{bootstrap_port}/tunnel/sandbox/sbi_tunnel_session?x-mistle-test-environment-id=test_env_reconnect"
    );
    let (gateway_ready_sender, gateway_ready_receiver) = mpsc::channel();
    let gateway_thread = thread::spawn(move || {
        let (initial_stream, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the initial bootstrap websocket");
        let (mut initial_websocket, initial_request_uri) =
            accept_bootstrap_websocket(initial_stream);
        assert!(
            initial_request_uri.contains("bootstrap_token=bootstrap-token-initial"),
            "initial bootstrap websocket should include the startup bootstrap token"
        );
        assert!(
            initial_request_uri.contains("x-mistle-test-environment-id=test_env_reconnect"),
            "initial bootstrap websocket should preserve gateway query parameters"
        );
        expect_tunnel_connected_publications(&mut initial_websocket);
        initial_websocket
            .close(Some(CloseFrame {
                code: CloseCode::Library(4001),
                reason: "service_restart".into(),
            }))
            .expect("gateway should close the initial websocket for service restart");

        let (mut first_exchange_stream, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the first token exchange request");
        let first_exchange_request = read_http_request(&mut first_exchange_stream);
        assert!(
            first_exchange_request.starts_with(
                "POST /tunnel/sandbox/sbi_tunnel_session/token-exchange?x-mistle-test-environment-id=test_env_reconnect HTTP/1.1",
            )
        );
        assert_http_bearer_token(&first_exchange_request, "exchange-token-initial");
        assert_http_header(&first_exchange_request, "content-length", "0");
        write_http_json_response(
            &mut first_exchange_stream,
            200,
            &json!({
                "bootstrapToken": "bootstrap-token-reconnect-1",
                "tunnelExchangeToken": "exchange-token-reconnect-1"
            }),
        );

        let (reconnect_stream_one, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the first reconnect websocket");
        let (mut reconnect_websocket_one, reconnect_request_uri_one) =
            accept_bootstrap_websocket(reconnect_stream_one);
        assert!(
            reconnect_request_uri_one.contains("bootstrap_token=bootstrap-token-reconnect-1"),
            "first reconnect websocket should use the exchanged bootstrap token"
        );
        assert!(
            reconnect_request_uri_one.contains("x-mistle-test-environment-id=test_env_reconnect"),
            "first reconnect websocket should preserve gateway query parameters"
        );
        expect_tunnel_connected_publications(&mut reconnect_websocket_one);
        gateway_ready_sender
            .send(())
            .expect("gateway should report the reconnect is established");

        loop {
            match reconnect_websocket_one.read() {
                Ok(Message::Text(payload)) => {
                    let message: Value = serde_json::from_str(payload.as_str())
                        .expect("shutdown control payload should be valid json");
                    assert_eq!(message["type"], "telemetry.close");
                }
                Ok(Message::Binary(payload))
                    if decode_telemetry_data_frame(payload.as_ref()).is_ok() => {}
                Ok(Message::Close(_))
                | Err(WebSocketError::ConnectionClosed)
                | Err(WebSocketError::Protocol(_)) => break,
                Ok(other) => panic!(
                    "expected tunnel_session.close() to end the reconnect websocket, got {other:?}"
                ),
                Err(error) => panic!(
                    "expected tunnel_session.close() to end the reconnect websocket: {error}"
                ),
            }
        }
    });

    let startup_input = SessionRuntimeInput {
        operation_kind: crate::protocol::startup::ActivationOperationKind::Start,
        bootstrap_token: "bootstrap-token-initial".to_string(),
        tunnel_exchange_token: "exchange-token-initial".to_string(),
        tunnel_gateway_ws_url: bootstrap_url,
        acting_user_id: None,
        runtime_plan: serde_json::json!({
            "sandboxProfileId": "sbp_123",
            "version": 1,
            "image": {
                "source": "base",
                "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
            },
            "egressRoutes": [],
            "artifacts": [],
            "workspaceSources": [],
            "runtimeClients": [],
            "agentRuntimes": []
        }),
        git_identity: None,
        transparent_proxy: None,
    };

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let tunnel_session = TunnelSession::start(
        &startup_input,
        keepalive_manager,
        runtime_readiness_manager,
        None,
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");

    gateway_ready_receiver
        .recv()
        .expect("gateway should observe the reconnect");

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
}

#[test]
fn does_not_reconnect_after_near_miss_bootstrap_service_restart_close() {
    let bootstrap_listener =
        TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
    let bootstrap_port = bootstrap_listener
        .local_addr()
        .expect("bootstrap listener should expose an address")
        .port();
    let bootstrap_url = format!(
        "ws://127.0.0.1:{bootstrap_port}/tunnel/sandbox/sbi_tunnel_session?x-mistle-test-environment-id=test_env_reconnect_near_miss"
    );
    let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
    let gateway_thread = thread::spawn(move || {
        let (initial_stream, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the initial bootstrap websocket");
        let (mut initial_websocket, initial_request_uri) =
            accept_bootstrap_websocket(initial_stream);
        assert!(
            initial_request_uri.contains("bootstrap_token=bootstrap-token-initial"),
            "initial bootstrap websocket should include the startup bootstrap token"
        );
        expect_tunnel_connected_publications(&mut initial_websocket);
        initial_websocket
            .close(Some(CloseFrame {
                code: CloseCode::Away,
                reason: "service_restart".into(),
            }))
            .expect("gateway should close with a near-miss service restart frame");
        loop {
            match initial_websocket.read() {
                Ok(Message::Text(_)) | Ok(Message::Binary(_)) | Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
                Ok(Message::Close(_))
                | Err(WebSocketError::ConnectionClosed)
                | Err(WebSocketError::Protocol(
                    tokio_tungstenite::tungstenite::error::ProtocolError::ResetWithoutClosingHandshake,
                )) => break,
                Ok(other_message) => panic!(
                    "expected near-miss bootstrap close handshake to complete before reconnect observation, got {other_message:?}"
                ),
                Err(error) => panic!(
                    "near-miss bootstrap close handshake should complete before reconnect observation: {error}"
                ),
            }
        }
        bootstrap_listener
            .set_nonblocking(true)
            .expect("bootstrap listener should support nonblocking accept");
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(250);
        while std::time::Instant::now() < deadline {
            match bootstrap_listener.accept() {
                Ok((_stream, _)) => {
                    panic!(
                        "near-miss bootstrap close should not request token exchange or reconnect"
                    )
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(error) => {
                    panic!("bootstrap listener failed while checking for reconnect: {error}")
                }
            }
        }
        gateway_done_sender
            .send(())
            .expect("gateway should report near-miss observation completion");
    });

    let startup_input = SessionRuntimeInput {
        operation_kind: crate::protocol::startup::ActivationOperationKind::Start,
        bootstrap_token: "bootstrap-token-initial".to_string(),
        tunnel_exchange_token: "exchange-token-initial".to_string(),
        tunnel_gateway_ws_url: bootstrap_url,
        acting_user_id: None,
        runtime_plan: serde_json::json!({
            "sandboxProfileId": "sbp_123",
            "version": 1,
            "image": {
                "source": "base",
                "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
            },
            "egressRoutes": [],
            "artifacts": [],
            "workspaceSources": [],
            "runtimeClients": [],
            "agentRuntimes": []
        }),
        git_identity: None,
        transparent_proxy: None,
    };

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let tunnel_session = TunnelSession::start(
        &startup_input,
        keepalive_manager,
        runtime_readiness_manager,
        None,
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");

    gateway_done_receiver
        .recv()
        .expect("gateway should complete near-miss reconnect observation");

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
}

#[test]
fn post_startup_panic_marks_restart_required_and_startup_completed() {
    let bootstrap_listener =
        TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
    let bootstrap_port = bootstrap_listener
        .local_addr()
        .expect("bootstrap listener should expose an address")
        .port();
    let bootstrap_url =
        format!("ws://127.0.0.1:{bootstrap_port}/tunnel/sandbox/sbi_tunnel_session");
    let (initial_connected_sender, initial_connected_receiver) = mpsc::channel();
    let gateway_thread = thread::spawn(move || {
        let (initial_stream, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the initial bootstrap websocket");
        let (mut initial_websocket, _) = accept_bootstrap_websocket(initial_stream);
        expect_tunnel_connected_publications(&mut initial_websocket);
        initial_connected_sender
            .send(())
            .expect("gateway should report the initial connected session is established");
        initial_websocket
            .get_mut()
            .set_read_timeout(Some(std::time::Duration::from_millis(250)))
            .expect("bootstrap websocket should accept a read timeout");
        match initial_websocket.read() {
            Ok(Message::Close(_))
            | Err(WebSocketError::ConnectionClosed)
            | Err(WebSocketError::Protocol(_)) => {}
            Err(WebSocketError::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Ok(other) => panic!(
                "expected the post-startup panic session to end the bootstrap websocket, got {other:?}"
            ),
            Err(error) => panic!(
                "expected the post-startup panic session to end the bootstrap websocket: {error}"
            ),
        }
    });

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let panic_clock = Arc::new(PanicClock::default());
    let shutdown_requested = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let supervisor_handle =
        test_tunnel_supervisor_handle("sbi_tunnel_session", panic_clock.clone());
    let runtime = TunnelSessionRuntime {
        keepalive_manager,
        runtime_readiness_manager,
        connection_state: Arc::new(RwLock::new(TunnelSessionRuntimeConnectionState {
            agent_endpoint_url: None,
            runtime_env: BTreeMap::new(),
        })),
        cgroup_root: PathBuf::from(crate::cgroups::DEFAULT_CGROUP_ROOT),
        attachment_root: PathBuf::from(DEFAULT_ATTACHMENT_ROOT),
        sandbox_instance_id: "sbi_tunnel_session".to_string(),
        gateway_ws_url: bootstrap_url.clone(),
        operation_id: None,
        operation_kind: "start",
        transparent_passthrough_socket_mark: None,
        shutdown_requested,
        clock: panic_clock.clone(),
        sleeper: Arc::new(ThreadSleeper),
        supervisor_handle,
    };
    let connected_url = resolve_bootstrap_tunnel_url(&bootstrap_url, "bootstrap-token-initial")
        .expect("bootstrap websocket URL should be derivable");
    let runtime_builder = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test tokio runtime should build");
    let (startup_result_sender, startup_result_receiver) =
        std::sync::mpsc::channel::<Result<(), TunnelSessionError>>();
    let session_result = runtime_builder.block_on(async {
        let (bootstrap_socket, _) = connect_bootstrap_websocket(connected_url.as_str(), None)
            .await
            .expect("bootstrap websocket should connect");
        let (_request_sender, mut request_receiver) = tokio::sync::mpsc::unbounded_channel();
        let panic_clock = panic_clock.clone();
        let ready_thread = thread::spawn(move || {
            initial_connected_receiver
                .recv()
                .expect("gateway should observe the initial connected session");
            panic_clock.request_panic();
        });
        let session_result = run_connected_tunnel_session_catching_panics(
            &runtime,
            bootstrap_socket,
            &mut request_receiver,
            Some(&startup_result_sender),
        )
        .await;
        ready_thread
            .join()
            .expect("ready-thread should exit cleanly");
        session_result
    });

    assert!(
        startup_result_receiver
            .recv()
            .expect("connected session should report the initial startup result")
            .is_ok(),
        "post-startup panic should not retroactively fail initial startup"
    );
    assert!(
        matches!(
            session_result.outcome,
            ConnectedTunnelSessionOutcome::RestartRequired
        ),
        "post-startup panic should request a reconnect"
    );
    assert!(
        session_result.startup_completed,
        "post-startup panic should preserve the successful startup completion signal"
    );
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
}

#[test]
fn retries_when_token_exchange_response_body_read_fails() {
    let bootstrap_listener =
        TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
    let bootstrap_port = bootstrap_listener
        .local_addr()
        .expect("bootstrap listener should expose an address")
        .port();
    let bootstrap_url =
        format!("ws://127.0.0.1:{bootstrap_port}/tunnel/sandbox/sbi_tunnel_session");
    let (gateway_ready_sender, gateway_ready_receiver) = mpsc::channel();
    let gateway_thread = thread::spawn(move || {
        let (initial_stream, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the initial bootstrap websocket");
        let (mut initial_websocket, _) = accept_bootstrap_websocket(initial_stream);
        expect_tunnel_connected_publications(&mut initial_websocket);
        initial_websocket
            .close(Some(CloseFrame {
                code: CloseCode::Library(4001),
                reason: "service_restart".into(),
            }))
            .expect("gateway should close the initial websocket for service restart");

        let (mut first_exchange_stream, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the first token exchange request");
        let first_exchange_request = read_http_request(&mut first_exchange_stream);
        assert_http_bearer_token(&first_exchange_request, "exchange-token-initial");
        assert_http_header(&first_exchange_request, "content-length", "0");
        first_exchange_stream
            .write_all(
                b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 64\r\nconnection: close\r\n\r\n{\"bootstrapToken\":\"bootstrap-token-reconnect\"",
            )
            .expect("gateway should write the truncated token exchange response");
        first_exchange_stream
            .flush()
            .expect("gateway should flush the truncated token exchange response");
        drop(first_exchange_stream);

        let (mut second_exchange_stream, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the retried token exchange request");
        let second_exchange_request = read_http_request(&mut second_exchange_stream);
        assert_http_bearer_token(&second_exchange_request, "exchange-token-initial");
        assert_http_header(&second_exchange_request, "content-length", "0");
        write_http_json_response(
            &mut second_exchange_stream,
            200,
            &json!({
                "bootstrapToken": "bootstrap-token-reconnect",
                "tunnelExchangeToken": "exchange-token-reconnect"
            }),
        );

        let (reconnect_stream, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the reconnect websocket");
        let (mut reconnect_websocket, reconnect_request_uri) =
            accept_bootstrap_websocket(reconnect_stream);
        assert!(
            reconnect_request_uri.contains("bootstrap_token=bootstrap-token-reconnect"),
            "reconnect websocket should use the exchanged bootstrap token after the retried token exchange"
        );
        expect_tunnel_connected_publications(&mut reconnect_websocket);
        gateway_ready_sender
            .send(())
            .expect("gateway should report the reconnect session is established");

        loop {
            match reconnect_websocket.read() {
                Ok(Message::Text(payload)) => {
                    let message: Value = serde_json::from_str(payload.as_str())
                        .expect("shutdown control payload should be valid json");
                    assert_eq!(message["type"], "telemetry.close");
                }
                Ok(Message::Binary(payload))
                    if decode_telemetry_data_frame(payload.as_ref()).is_ok() => {}
                Ok(Message::Close(_))
                | Err(WebSocketError::ConnectionClosed)
                | Err(WebSocketError::Protocol(_)) => break,
                Ok(other) => panic!(
                    "expected tunnel_session.close() to end the reconnect websocket after retrying the token exchange body read failure, got {other:?}"
                ),
                Err(error) => panic!(
                    "expected tunnel_session.close() to end the reconnect websocket after retrying the token exchange body read failure: {error}"
                ),
            }
        }
    });

    let startup_input = SessionRuntimeInput {
        operation_kind: crate::protocol::startup::ActivationOperationKind::Start,
        bootstrap_token: "bootstrap-token-initial".to_string(),
        tunnel_exchange_token: "exchange-token-initial".to_string(),
        tunnel_gateway_ws_url: bootstrap_url,
        acting_user_id: None,
        runtime_plan: serde_json::json!({
            "sandboxProfileId": "sbp_123",
            "version": 1,
            "image": {
                "source": "base",
                "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
            },
            "egressRoutes": [],
            "artifacts": [],
            "workspaceSources": [],
            "runtimeClients": [],
            "agentRuntimes": []
        }),
        git_identity: None,
        transparent_proxy: None,
    };

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let tunnel_session = TunnelSession::start(
        &startup_input,
        keepalive_manager,
        runtime_readiness_manager,
        None,
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");

    gateway_ready_receiver.recv().expect(
        "gateway should observe reconnect after retrying the token exchange body read failure",
    );

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
}

#[test]
fn stops_retrying_when_token_exchange_returns_terminal_status() {
    for status_code in [401_u16, 404_u16, 409_u16] {
        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_port = bootstrap_listener
            .local_addr()
            .expect("bootstrap listener should expose an address")
            .port();
        let bootstrap_url =
            format!("ws://127.0.0.1:{bootstrap_port}/tunnel/sandbox/sbi_tunnel_session");
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (initial_stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the initial bootstrap websocket");
            let (mut initial_websocket, initial_request_uri) =
                accept_bootstrap_websocket(initial_stream);
            assert!(
                initial_request_uri.contains("bootstrap_token=bootstrap-token-initial"),
                "initial bootstrap websocket should include the startup bootstrap token"
            );
            expect_tunnel_connected_publications(&mut initial_websocket);
            initial_websocket
                .close(Some(CloseFrame {
                    code: CloseCode::Library(4001),
                    reason: "service_restart".into(),
                }))
                .expect("gateway should close the initial websocket for service restart");

            let (mut exchange_stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the terminal token exchange request");
            let exchange_request = read_http_request(&mut exchange_stream);
            assert!(
                exchange_request
                    .starts_with("POST /tunnel/sandbox/sbi_tunnel_session/token-exchange HTTP/1.1")
            );
            assert_http_bearer_token(&exchange_request, "exchange-token-initial");
            assert_http_header(&exchange_request, "content-length", "0");
            write_http_json_response(
                &mut exchange_stream,
                status_code,
                &json!({
                    "error": format!("terminal-status-{status_code}")
                }),
            );

            bootstrap_listener
                .set_nonblocking(true)
                .expect("listener should allow nonblocking terminal assertions");
            thread::sleep(std::time::Duration::from_millis(150));
            match bootstrap_listener.accept() {
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                Ok(_) => panic!(
                    "terminal token exchange status {status_code} should prevent further reconnect attempts"
                ),
                Err(error) => panic!(
                    "listener should only stop further reconnects by becoming empty: {error}"
                ),
            }
            gateway_done_sender
                .send(())
                .expect("gateway should report the terminal exchange case finished");
        });

        let startup_input = SessionRuntimeInput {
            operation_kind: crate::protocol::startup::ActivationOperationKind::Start,
            bootstrap_token: "bootstrap-token-initial".to_string(),
            tunnel_exchange_token: "exchange-token-initial".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        gateway_done_receiver
            .recv()
            .expect("gateway should observe the terminal exchange response");

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
    }
}

#[test]
fn refresh_style_agent_open_cancels_slow_prior_dial() {
    let agent_listener =
        TcpListener::bind("127.0.0.1:0").expect("agent runtime listener should bind");
    let agent_url = format!(
        "ws://127.0.0.1:{}/agent",
        agent_listener
            .local_addr()
            .expect("agent listener should expose an address")
            .port()
    );
    let (first_accept_sender, first_accept_receiver) = mpsc::channel();
    let agent_server_thread = thread::spawn(move || {
        let (first_stream, _) = agent_listener
            .accept()
            .expect("agent listener should accept the first hanging connection");
        first_accept_sender
            .send(())
            .expect("agent listener should report the first accepted connection");
        let first_connection_thread = thread::spawn(move || {
            thread::sleep(std::time::Duration::from_millis(250));
            drop(first_stream);
        });

        let (second_stream, _) = agent_listener
            .accept()
            .expect("agent listener should accept the second connection");
        let mut second_socket =
            accept(second_stream).expect("second agent websocket handshake should succeed");
        match second_socket.read() {
            Ok(Message::Close(_))
            | Err(WebSocketError::ConnectionClosed)
            | Err(WebSocketError::Protocol(
                tokio_tungstenite::tungstenite::error::ProtocolError::ResetWithoutClosingHandshake,
            )) => {}
            Ok(other_message) => panic!(
                "expected second agent websocket to close after stream shutdown, got {other_message:?}"
            ),
            Err(error) => panic!(
                "second agent websocket should only end because the tunnel stream closed: {error}"
            ),
        }
        first_connection_thread
            .join()
            .expect("first hanging connection thread should exit cleanly");
    });

    let bootstrap_listener =
        TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
    let bootstrap_url = format!(
        "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
        bootstrap_listener
            .local_addr()
            .expect("bootstrap listener should expose an address")
            .port()
    );
    let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
    let gateway_thread = thread::spawn(move || {
        let (stream, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the bootstrap tunnel");
        let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

        let telemetry_open = read_json_text_message(&mut websocket);
        assert_eq!(telemetry_open["type"], "telemetry.open");
        websocket
            .send(Message::Text(
                json!({
                    "type": "telemetry.open.ok",
                    "streamId": telemetry_open["streamId"],
                    "initialWindowBytes": 1024
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should acknowledge telemetry.open");

        let mut saw_keepalive = false;
        while !saw_keepalive {
            let control_message = read_json_text_message(&mut websocket);
            if control_message["type"] == Value::String("keepalive.state".to_string()) {
                saw_keepalive = true;
            }
        }

        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.open",
                    "streamId": 7,
                    "channel": {
                        "kind": "agent"
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should open the first agent stream");

        first_accept_receiver
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("gateway should observe the first agent dial before simulating refresh");

        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.close",
                    "streamId": 7
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should close the first agent stream");

        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.open",
                    "streamId": 8,
                    "channel": {
                        "kind": "agent"
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should open the second agent stream");

        websocket
            .get_mut()
            .set_read_timeout(Some(std::time::Duration::from_secs(1)))
            .expect("gateway bootstrap socket should accept a read timeout");
        assert_eq!(
            read_stream_text_message(&mut websocket),
            json!({
                "type": "stream.open.ok",
                "streamId": 8
            })
        );

        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.close",
                    "streamId": 8
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should close the second agent stream");

        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
        gateway_done_sender
            .send(())
            .expect("gateway should signal the tunnel session finished");
    });

    let startup_input = SessionRuntimeInput {
        operation_kind: crate::protocol::startup::ActivationOperationKind::Start,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: bootstrap_url,
        acting_user_id: None,
        runtime_plan: serde_json::json!({
            "sandboxProfileId": "sbp_123",
            "version": 1,
            "image": {
                "source": "base",
                "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
            },
            "egressRoutes": [],
            "artifacts": [],
            "workspaceSources": [],
            "runtimeClients": [],
            "agentRuntimes": []
        }),
        git_identity: None,
        transparent_proxy: None,
    };

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let tunnel_session = TunnelSession::start(
        &startup_input,
        keepalive_manager,
        runtime_readiness_manager,
        Some(agent_url),
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");

    gateway_done_receiver
        .recv()
        .expect("gateway should complete the bootstrap interaction");

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
    agent_server_thread
        .join()
        .expect("agent server thread should exit cleanly");
}

#[test]
fn agent_dial_failure_returns_stream_open_error_without_dropping_tunnel() {
    let agent_listener =
        TcpListener::bind("127.0.0.1:0").expect("agent runtime listener should bind");
    let agent_url = format!(
        "ws://127.0.0.1:{}/agent",
        agent_listener
            .local_addr()
            .expect("agent listener should expose an address")
            .port()
    );
    let agent_server_thread = thread::spawn(move || {
        let (stream, _) = agent_listener
            .accept()
            .expect("agent listener should accept one failing connection");
        drop(stream);
    });

    let bootstrap_listener =
        TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
    let bootstrap_url = format!(
        "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
        bootstrap_listener
            .local_addr()
            .expect("bootstrap listener should expose an address")
            .port()
    );
    let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
    let gateway_thread = thread::spawn(move || {
        let (stream, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the bootstrap tunnel");
        let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

        let telemetry_open = read_json_text_message(&mut websocket);
        assert_eq!(telemetry_open["type"], "telemetry.open");
        websocket
            .send(Message::Text(
                json!({
                    "type": "telemetry.open.ok",
                    "streamId": telemetry_open["streamId"],
                    "initialWindowBytes": 1024
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should acknowledge telemetry.open");

        let mut saw_keepalive = false;
        while !saw_keepalive {
            let control_message = read_json_text_message(&mut websocket);
            if control_message["type"] == Value::String("keepalive.state".to_string()) {
                saw_keepalive = true;
            }
        }

        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.open",
                    "streamId": 7,
                    "channel": {
                        "kind": "agent"
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should open the agent stream");

        let agent_open_error = read_stream_text_message(&mut websocket);
        assert_eq!(
            agent_open_error["type"],
            Value::String("stream.open.error".to_string())
        );
        assert_eq!(agent_open_error["streamId"], Value::Number(7.into()));
        assert_eq!(
            agent_open_error["code"],
            Value::String("agent_endpoint_dial_failed".to_string())
        );

        send_websocket_ping_and_expect_pong(
            &mut websocket,
            b"bootstrap-still-open-after-agent-dial-failure",
        );

        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
        gateway_done_sender
            .send(())
            .expect("gateway should signal the tunnel session finished");
    });

    let startup_input = SessionRuntimeInput {
        operation_kind: crate::protocol::startup::ActivationOperationKind::Start,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: bootstrap_url,
        acting_user_id: None,
        runtime_plan: serde_json::json!({
            "sandboxProfileId": "sbp_123",
            "version": 1,
            "image": {
                "source": "base",
                "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
            },
            "egressRoutes": [],
            "artifacts": [],
            "workspaceSources": [],
            "runtimeClients": [],
            "agentRuntimes": []
        }),
        git_identity: None,
        transparent_proxy: None,
    };

    let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
    let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
    let tunnel_session = TunnelSession::start(
        &startup_input,
        keepalive_manager,
        runtime_readiness_manager,
        Some(agent_url),
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");

    gateway_done_receiver
        .recv()
        .expect("gateway should complete the bootstrap interaction");

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
    agent_server_thread
        .join()
        .expect("agent server thread should exit cleanly");
}
