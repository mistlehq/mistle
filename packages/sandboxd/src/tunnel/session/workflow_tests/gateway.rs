use super::*;

#[test]
fn drops_invalid_bootstrap_messages_and_keeps_tunnel_alive() {
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
                    "type": "stream.reset",
                    "streamId": 99,
                    "code": "unexpected",
                    "message": "unexpected control"
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should send an unsupported bootstrap control message");
        let dropped_control_message =
            read_telemetry_log_line_with_event(&mut websocket, "bootstrap_control_message_dropped");
        assert_eq!(
            dropped_control_message["event"],
            "bootstrap_control_message_dropped"
        );
        assert_eq!(dropped_control_message["level"], "warn");
        assert_eq!(
            dropped_control_message["message"],
            "sandboxd dropped bootstrap control message: unsupported control message type 'stream.reset'"
        );
        assert_eq!(
            dropped_control_message["reason"],
            "unsupported control message type 'stream.reset'"
        );
        websocket
            .send(Message::Binary(vec![0x01, 0x02, 0x03].into()))
            .expect("gateway should send an invalid bootstrap data frame");
        let dropped_data_frame =
            read_telemetry_log_line_with_event(&mut websocket, "bootstrap_data_frame_dropped");
        assert_eq!(dropped_data_frame["event"], "bootstrap_data_frame_dropped");
        assert_eq!(dropped_data_frame["level"], "warn");
        assert_eq!(
            dropped_data_frame["message"],
            "sandboxd dropped bootstrap data frame: data frame must be at least 6 bytes long"
        );
        assert_eq!(
            dropped_data_frame["reason"],
            "data frame must be at least 6 bytes long"
        );

        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.open",
                    "streamId": 9,
                    "channel": {
                        "kind": "fileUpload",
                        "threadId": "thread_invalid_bootstrap",
                        "mimeType": "image/png",
                        "originalFilename": "image.png",
                        "sizeBytes": 8
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should open a file upload stream after invalid messages");
        assert_eq!(
            read_stream_text_message(&mut websocket),
            json!({
                "type": "stream.open.ok",
                "streamId": 9
            })
        );

        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
        gateway_done_sender
            .send(())
            .expect("gateway should signal the tunnel session finished");
    });

    let startup_input = StartupInput {
        startup_mode: StartupMode::New,
        operation_kind: crate::protocol::startup::StartupOperationKind::Start,
        execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
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
        None,
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
}

#[test]
fn forwards_signing_requests_over_the_bootstrap_tunnel_and_returns_gateway_results() {
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
    let (gateway_close_sender, gateway_close_receiver) = mpsc::channel::<()>();
    let gateway_thread = thread::spawn(move || {
        let (stream, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the bootstrap tunnel");
        let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

        expect_tunnel_connected_publications(&mut websocket);

        let signing_request = read_json_text_message(&mut websocket);
        assert_eq!(
            signing_request,
            json!({
                "type": "signing.request",
                "requestId": "sign_req_123",
                "organizationId": "org_123",
                "sandboxInstanceId": "sbi_tunnel_session",
                "actingUserId": "usr_123",
                "providerFamily": "github",
                "integrationConnectionId": "icn_github",
                "format": "ssh",
                "keyRef": "key::ssh-ed25519 AAAA",
                "grant": "grant-token",
                "payload": "c2lnbi1tZQ==",
                "encoding": "base64"
            })
        );

        websocket
            .send(Message::Text(
                json!({
                    "type": "signing.result",
                    "requestId": "sign_req_123",
                    "ok": false,
                    "code": "signing_backend_not_implemented",
                    "message": "Git signing backend is not implemented yet."
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should return a signing result");

        gateway_done_sender
            .send(())
            .expect("gateway should signal the signing result was sent");
        gateway_close_receiver
            .recv()
            .expect("gateway should wait until the signing result is observed");
        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
    });

    let startup_input = StartupInput {
        startup_mode: StartupMode::New,
        operation_kind: crate::protocol::startup::StartupOperationKind::Start,
        execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
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
        None,
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");

    let signing_result = tunnel_session
        .request_signing(TunnelSigningRequest {
            request_id: "sign_req_123".to_string(),
            organization_id: "org_123".to_string(),
            sandbox_instance_id: "sbi_tunnel_session".to_string(),
            acting_user_id: "usr_123".to_string(),
            provider_family: "github".to_string(),
            integration_connection_id: Some("icn_github".to_string()),
            format: "ssh".to_string(),
            key_ref: "key::ssh-ed25519 AAAA".to_string(),
            grant: "grant-token".to_string(),
            payload_base64: "c2lnbi1tZQ==".to_string(),
        })
        .expect("signing request should complete through the tunnel");

    assert_eq!(
        signing_result,
        TunnelSigningResponse::Failure {
            request_id: "sign_req_123".to_string(),
            code: "signing_backend_not_implemented".to_string(),
            message: "Git signing backend is not implemented yet.".to_string(),
        }
    );

    gateway_done_receiver
        .recv()
        .expect("gateway should complete the signing interaction");
    gateway_close_sender
        .send(())
        .expect("gateway should close after the signing response is observed");

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
}

#[test]
fn requests_and_caches_egress_tokens_over_the_bootstrap_tunnel() {
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
    let (gateway_close_sender, gateway_close_receiver) = mpsc::channel::<()>();
    let gateway_thread = thread::spawn(move || {
        let (stream, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the bootstrap tunnel");
        let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

        expect_tunnel_connected_publications(&mut websocket);

        let token_request = read_json_text_message(&mut websocket);
        assert_eq!(
            token_request,
            json!({
                "type": "egress.token.request",
                "requestId": "egress_token_req_1",
                "actingUserId": "usr_tunnel_session"
            })
        );

        websocket
            .send(Message::Text(
                json!({
                    "type": "egress.token.response",
                    "requestId": "egress_token_req_1",
                    "token": "short-lived-egress-jwt",
                    "expiresAt": "2100-01-01T00:00:00Z",
                    "ttlMs": 300000
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should return an egress token");

        gateway_done_sender
            .send(())
            .expect("gateway should signal the token response was sent");
        gateway_close_receiver
            .recv()
            .expect("gateway should wait until the cached token is observed");
        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
    });

    let startup_input = StartupInput {
        startup_mode: StartupMode::New,
        operation_kind: crate::protocol::startup::StartupOperationKind::Start,
        execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
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
    let clock = Arc::new(SystemClock);
    let tunnel_session = TunnelSession::start(
        &startup_input,
        keepalive_manager,
        runtime_readiness_manager,
        None,
        BTreeMap::new(),
        clock.clone(),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");
    let token_provider = GatewayEgressTokenProvider::new(
        "sbi_tunnel_session",
        Some("usr_tunnel_session".to_string()),
    );
    tunnel_session.attach_gateway_egress_token_provider(&token_provider);

    let token = token_provider
        .token()
        .expect("egress token request should complete through the tunnel");
    assert_eq!(token.token, "short-lived-egress-jwt");
    assert_eq!(token.expires_at, "2100-01-01T00:00:00Z");
    assert_eq!(token.ttl_ms, 300_000);
    gateway_done_receiver
        .recv()
        .expect("gateway should complete the egress token interaction");

    let cached_token = token_provider
        .token()
        .expect("valid cached egress token should be reused");
    assert_eq!(cached_token, token);
    gateway_close_sender
        .send(())
        .expect("gateway should close after the cached token is observed");

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
}

#[test]
fn updating_egress_token_provider_acting_user_clears_cached_token() {
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

        expect_tunnel_connected_publications(&mut websocket);

        for (token_number, acting_user_id) in [(1, "usr_initial"), (2, "usr_resumed")] {
            let token_request = read_json_text_message(&mut websocket);
            assert_eq!(
                token_request,
                json!({
                    "type": "egress.token.request",
                    "requestId": format!("egress_token_req_{token_number}"),
                    "actingUserId": acting_user_id
                })
            );

            websocket
                .send(Message::Text(
                    json!({
                        "type": "egress.token.response",
                        "requestId": format!("egress_token_req_{token_number}"),
                        "token": format!("egress-jwt-{acting_user_id}"),
                        "expiresAt": "2100-01-01T00:00:00Z",
                        "ttlMs": 300000
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should return an egress token");
        }

        gateway_done_sender
            .send(())
            .expect("gateway should signal both token responses were sent");
        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
    });

    let startup_input = StartupInput {
        startup_mode: StartupMode::New,
        operation_kind: crate::protocol::startup::StartupOperationKind::Start,
        execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
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
    let clock = Arc::new(SystemClock);
    let tunnel_session = TunnelSession::start(
        &startup_input,
        keepalive_manager,
        runtime_readiness_manager,
        None,
        BTreeMap::new(),
        clock.clone(),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");
    let token_provider =
        GatewayEgressTokenProvider::new("sbi_tunnel_session", Some("usr_initial".to_string()));
    tunnel_session.attach_gateway_egress_token_provider(&token_provider);

    let initial_token = token_provider
        .token()
        .expect("initial acting user token request should complete");
    assert_eq!(initial_token.token, "egress-jwt-usr_initial");

    token_provider
        .set_acting_user_id(Some("usr_resumed".to_string()))
        .expect("updating acting user should clear cached token");
    let resumed_token = token_provider
        .token()
        .expect("resumed acting user token request should complete");
    assert_eq!(resumed_token.token, "egress-jwt-usr_resumed");
    gateway_done_receiver
        .recv()
        .expect("gateway should complete both egress token interactions");

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
}

#[test]
fn refreshes_egress_tokens_from_relative_ttl_not_expires_at_wall_time() {
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

        expect_tunnel_connected_publications(&mut websocket);

        for token_number in 1..=2 {
            let token_request = read_json_text_message(&mut websocket);
            assert_eq!(
                token_request,
                json!({
                    "type": "egress.token.request",
                    "requestId": format!("egress_token_req_{token_number}")
                })
            );

            websocket
                .send(Message::Text(
                    json!({
                        "type": "egress.token.response",
                        "requestId": format!("egress_token_req_{token_number}"),
                        "token": format!("short-lived-egress-jwt-{token_number}"),
                        "expiresAt": "2100-01-01T00:00:00Z",
                        "ttlMs": 1
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should return an egress token");
        }

        gateway_done_sender
            .send(())
            .expect("gateway should signal both token responses were sent");
        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
    });

    let startup_input = StartupInput {
        startup_mode: StartupMode::New,
        operation_kind: crate::protocol::startup::StartupOperationKind::Start,
        execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
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
    let clock = Arc::new(SystemClock);
    let tunnel_session = TunnelSession::start(
        &startup_input,
        keepalive_manager,
        runtime_readiness_manager,
        None,
        BTreeMap::new(),
        clock.clone(),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");
    let token_provider = GatewayEgressTokenProvider::new("sbi_tunnel_session", None);
    tunnel_session.attach_gateway_egress_token_provider(&token_provider);

    let first_token = token_provider
        .token()
        .expect("first egress token request should complete");
    let second_token = token_provider
        .token()
        .expect("expired relative ttl should force a second token request");
    assert_eq!(first_token.token, "short-lived-egress-jwt-1");
    assert_eq!(second_token.token, "short-lived-egress-jwt-2");
    gateway_done_receiver
        .recv()
        .expect("gateway should complete both egress token interactions");

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
}

#[test]
fn operation_stream_opens_records_and_closes_over_the_reserved_stream() {
    let bootstrap_listener =
        TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
    let bootstrap_url = format!(
        "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session?operation_id=op_tunnel_session",
        bootstrap_listener
            .local_addr()
            .expect("bootstrap listener should expose an address")
            .port()
    );
    let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
    let (operation_open_sender, operation_open_receiver) = mpsc::channel::<()>();
    let (operation_record_sender, operation_record_receiver) = mpsc::channel::<()>();
    let (close_flush_sender, close_flush_receiver) = mpsc::channel::<()>();
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

        let operation_open = read_stream_text_message(&mut websocket);
        assert_eq!(
            operation_open,
            json!({
                "type": "operation.open",
                "streamId": SANDBOX_OPERATION_STREAM_ID,
                "operationId": "op_tunnel_session",
                "operationKind": "start",
                "format": SANDBOX_OPERATION_STREAM_FORMAT
            })
        );
        acknowledge_operation_open(&mut websocket, &operation_open);
        operation_open_sender
            .send(())
            .expect("gateway should signal operation open acknowledgement");

        let operation_record =
            read_binary_frame_for_stream(&mut websocket, SANDBOX_OPERATION_STREAM_ID);
        assert_eq!(operation_record.stream_id, SANDBOX_OPERATION_STREAM_ID);
        assert_eq!(operation_record.payload_kind, PAYLOAD_KIND_RAW_BYTES);
        let payload = std::str::from_utf8(&operation_record.payload)
            .expect("operation record payload should be utf8");
        assert!(payload.contains(r#""kind":"lifecycle""#));
        assert!(payload.contains(r#""phase":"operation_stream""#));
        operation_record_sender
            .send(())
            .expect("gateway should signal operation record receipt");

        let operation_close = read_stream_text_message(&mut websocket);
        assert_eq!(
            operation_close,
            json!({
                "type": "operation.close",
                "streamId": SANDBOX_OPERATION_STREAM_ID
            })
        );

        gateway_done_sender
            .send(())
            .expect("gateway should signal the operation stream was closed");
        close_flush_receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("test should wait for operation close flush before closing websocket");
        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
    });

    let startup_input = StartupInput {
        startup_mode: StartupMode::New,
        operation_kind: crate::protocol::startup::StartupOperationKind::Start,
        execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
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
    let tunnel_session = TunnelSession::start_minimal_with_supervisor(
        &startup_input,
        keepalive_manager,
        runtime_readiness_manager,
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
        test_tunnel_supervisor_handle("sbi_tunnel_session", Arc::new(PanicClock::default())),
    )
    .expect("minimal tunnel session should start");

    operation_open_receiver
        .recv()
        .expect("gateway should acknowledge the operation stream open");
    let operation_sender = tunnel_session.operation_record_sender();
    operation_sender
        .blocking_send(OperationStreamMessage::Record(
            json!({
                "kind": "lifecycle",
                "observedAt": "2026-05-13T00:00:00.000Z",
                "phase": "operation_stream",
                "status": "started",
                "source": "sandboxd",
                "message": "operation stream started",
                "attributes": {}
            })
            .to_string()
                + "\n",
        ))
        .expect("operation record should enqueue");
    operation_record_receiver
        .recv()
        .expect("gateway should observe the operation record");
    let (close_response_sender, close_response_receiver) = mpsc::channel();
    operation_sender
        .blocking_send(OperationStreamMessage::Close {
            response_sender: close_response_sender,
        })
        .expect("operation close should enqueue");

    gateway_done_receiver
        .recv()
        .expect("gateway should observe the operation stream close");
    let close_response = close_response_receiver
        .recv()
        .expect("operation close response should be sent");
    close_flush_sender
        .send(())
        .expect("test should release gateway websocket close");
    close_response.expect("operation close should flush");
    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
}

#[test]
fn operation_stream_flushes_pending_records_before_close_after_open_ack() {
    let bootstrap_listener =
        TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
    let bootstrap_url = format!(
        "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session?operation_id=op_tunnel_session",
        bootstrap_listener
            .local_addr()
            .expect("bootstrap listener should expose an address")
            .port()
    );
    let (operation_open_sender, operation_open_receiver) = mpsc::channel::<()>();
    let (ack_operation_open_sender, ack_operation_open_receiver) = mpsc::channel::<()>();
    let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
    let (close_flush_sender, close_flush_receiver) = mpsc::channel::<()>();
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

        let operation_open = read_stream_text_message(&mut websocket);
        assert_eq!(operation_open["type"], "operation.open");
        operation_open_sender
            .send(())
            .expect("gateway should signal operation open");
        ack_operation_open_receiver
            .recv()
            .expect("test should allow operation open acknowledgement");
        acknowledge_operation_open(&mut websocket, &operation_open);

        let operation_record =
            read_binary_frame_for_stream(&mut websocket, SANDBOX_OPERATION_STREAM_ID);
        let payload = std::str::from_utf8(&operation_record.payload)
            .expect("operation record payload should be utf8");
        assert!(payload.contains(r#""phase":"runtime_adapters""#));

        let operation_close = read_stream_text_message(&mut websocket);
        assert_eq!(
            operation_close,
            json!({
                "type": "operation.close",
                "streamId": SANDBOX_OPERATION_STREAM_ID
            })
        );

        gateway_done_sender
            .send(())
            .expect("gateway should signal operation stream close");
        close_flush_receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("test should wait for operation close flush before closing websocket");
        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
    });

    let startup_input = StartupInput {
        startup_mode: StartupMode::New,
        operation_kind: crate::protocol::startup::StartupOperationKind::Start,
        execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
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
    let tunnel_session = TunnelSession::start_minimal_with_supervisor(
        &startup_input,
        keepalive_manager,
        runtime_readiness_manager,
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
        test_tunnel_supervisor_handle("sbi_tunnel_session", Arc::new(PanicClock::default())),
    )
    .expect("minimal tunnel session should start");

    operation_open_receiver
        .recv()
        .expect("gateway should observe operation open");
    let operation_sender = tunnel_session.operation_record_sender();
    operation_sender
        .blocking_send(OperationStreamMessage::Record(
            json!({
                "kind": "lifecycle",
                "observedAt": "2026-05-13T00:00:00.000Z",
                "phase": "runtime_adapters",
                "status": "completed",
                "source": "sandboxd",
                "message": "start_runtime_adapters completed",
                "attributes": {}
            })
            .to_string()
                + "\n",
        ))
        .expect("operation record should enqueue before open acknowledgement");
    let (close_response_sender, close_response_receiver) = mpsc::channel();
    operation_sender
        .blocking_send(OperationStreamMessage::Close {
            response_sender: close_response_sender,
        })
        .expect("operation close should enqueue before open acknowledgement");
    ack_operation_open_sender
        .send(())
        .expect("test should allow operation open acknowledgement");

    gateway_done_receiver
        .recv()
        .expect("gateway should observe record before close");
    let close_response = close_response_receiver
        .recv()
        .expect("operation close response should be sent");
    close_flush_sender
        .send(())
        .expect("test should release gateway websocket close");
    close_response.expect("operation close should flush");
    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
}

#[test]
fn returns_authorization_failures_from_gateway_signing_results() {
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
    let (gateway_close_sender, gateway_close_receiver) = mpsc::channel::<()>();
    let gateway_thread = thread::spawn(move || {
        let (stream, _) = bootstrap_listener
            .accept()
            .expect("gateway should accept the bootstrap tunnel");
        let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

        expect_tunnel_connected_publications(&mut websocket);
        let _signing_request = read_json_text_message(&mut websocket);

        websocket
            .send(Message::Text(
                json!({
                    "type": "signing.result",
                    "requestId": "sign_req_123",
                    "ok": false,
                    "code": "invalid_grant",
                    "message": "Signing grant verification failed: token_invalid."
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should return an authorization failure");

        gateway_done_sender
            .send(())
            .expect("gateway should signal the signing result was sent");
        gateway_close_receiver
            .recv()
            .expect("gateway should wait until the signing result is observed");
        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
    });

    let startup_input = StartupInput {
        startup_mode: StartupMode::New,
        operation_kind: crate::protocol::startup::StartupOperationKind::Start,
        execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
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
        None,
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");

    let signing_result = tunnel_session
        .request_signing(TunnelSigningRequest {
            request_id: "sign_req_123".to_string(),
            organization_id: "org_123".to_string(),
            sandbox_instance_id: "sbi_tunnel_session".to_string(),
            acting_user_id: "usr_123".to_string(),
            provider_family: "github".to_string(),
            integration_connection_id: Some("icn_github".to_string()),
            format: "ssh".to_string(),
            key_ref: "key::ssh-ed25519 AAAA".to_string(),
            grant: "grant-token".to_string(),
            payload_base64: "c2lnbi1tZQ==".to_string(),
        })
        .expect("signing request should complete through the tunnel");

    assert_eq!(
        signing_result,
        TunnelSigningResponse::Failure {
            request_id: "sign_req_123".to_string(),
            code: "invalid_grant".to_string(),
            message: "Signing grant verification failed: token_invalid.".to_string(),
        }
    );

    gateway_done_receiver
        .recv()
        .expect("gateway should complete the signing interaction");
    gateway_close_sender
        .send(())
        .expect("gateway should close after the signing response is observed");

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
}
