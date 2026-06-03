use super::*;

#[test]
fn starts_live_tunnel_session_for_exec_streams() {
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
                    "streamId": 11,
                    "channel": {
                        "kind": "exec",
                        "command": "sh",
                        "args": ["-c", "cat"],
                        "stdin": "exec stdin\n",
                        "timeoutMs": 1000,
                        "maxOutputBytes": 4096
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should open the exec stream");

        let exec_open_ok = read_stream_text_message(&mut websocket);
        assert_eq!(
            exec_open_ok["type"],
            Value::String("stream.open.ok".to_string())
        );
        assert_eq!(exec_open_ok["streamId"], Value::Number(11.into()));

        let exec_result = read_stream_text_message(&mut websocket);
        assert_eq!(
            exec_result["type"],
            Value::String("stream.event".to_string())
        );
        assert_eq!(exec_result["streamId"], Value::Number(11.into()));
        assert_eq!(
            exec_result["event"]["type"],
            Value::String("exec.result".to_string())
        );
        assert_eq!(exec_result["event"]["exitCode"], Value::Number(0.into()));
        assert_eq!(exec_result["event"]["stderr"], Value::String(String::new()));
        assert_eq!(exec_result["event"]["truncated"], Value::Bool(false));
        assert_eq!(
            exec_result["event"]["stdout"],
            Value::String("exec stdin\n".to_string())
        );

        let exec_complete = read_stream_text_message(&mut websocket);
        assert_eq!(
            exec_complete["type"],
            Value::String("stream.complete".to_string())
        );
        assert_eq!(exec_complete["streamId"], Value::Number(11.into()));

        let large_stdin = "x".repeat(1024 * 1024);
        let background_exec_started = Instant::now();
        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.open",
                    "streamId": 12,
                    "channel": {
                        "kind": "exec",
                        "command": "sh",
                        "args": ["-c", "sleep 5 >/dev/null 2>/dev/null & exit 0"],
                        "stdin": large_stdin,
                        "timeoutMs": 1000,
                        "maxOutputBytes": 4096
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should open the background exec stream");

        let background_exec_open_ok = read_stream_text_message(&mut websocket);
        assert_eq!(
            background_exec_open_ok["type"],
            Value::String("stream.open.ok".to_string())
        );
        assert_eq!(
            background_exec_open_ok["streamId"],
            Value::Number(12.into())
        );

        let background_exec_result = read_stream_text_message(&mut websocket);
        assert_eq!(
            background_exec_result["type"],
            Value::String("stream.event".to_string())
        );
        assert_eq!(background_exec_result["streamId"], Value::Number(12.into()));
        assert_eq!(
            background_exec_result["event"]["type"],
            Value::String("exec.result".to_string())
        );
        assert_eq!(
            background_exec_result["event"]["exitCode"],
            Value::Number(0.into())
        );

        let background_exec_complete = read_stream_text_message(&mut websocket);
        assert_eq!(
            background_exec_complete["type"],
            Value::String("stream.complete".to_string())
        );
        assert_eq!(
            background_exec_complete["streamId"],
            Value::Number(12.into())
        );
        assert!(
            background_exec_started.elapsed() < Duration::from_secs(2),
            "exec stream should complete after the foreground command exits"
        );

        send_websocket_ping_and_expect_pong(&mut websocket, b"bootstrap-still-open-after-exec");

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

#[cfg(target_os = "linux")]
#[test]
fn starts_live_tunnel_session_for_processes_streams() {
    let listener_port = reserve_available_port();
    let server_marker = format!("mistle_processes_stream_server_{}", std::process::id());
    let idle_marker = format!("mistle_processes_stream_idle_{}", std::process::id());
    let mut server = spawn_node_fixture(
        "http-listener.js",
        &[&listener_port.to_string(), &server_marker, "0.0.0.0"],
    );
    let mut idle = spawn_node_fixture("idle-process.js", &[&idle_marker]);
    wait_until_listening(listener_port);

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
                    "streamId": 21,
                    "channel": {
                        "kind": "processes"
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should open the first processes stream");
        assert_eq!(
            read_stream_text_message(&mut websocket),
            json!({
                "type": "stream.open.ok",
                "streamId": 21
            })
        );
        let first_snapshot = read_processes_snapshot(&mut websocket);
        assert_eq!(first_snapshot.0, 21);
        assert_processes_snapshot_contains(
            &first_snapshot.1,
            &server_marker,
            &idle_marker,
            listener_port,
        );

        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.open",
                    "streamId": 22,
                    "channel": {
                        "kind": "processes"
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should open the second processes stream");
        assert_eq!(
            read_stream_text_message(&mut websocket),
            json!({
                "type": "stream.open.ok",
                "streamId": 22
            })
        );
        let second_snapshot = read_processes_snapshot_for_stream(&mut websocket, 22);
        assert_processes_snapshot_contains(
            &second_snapshot.1,
            &server_marker,
            &idle_marker,
            listener_port,
        );

        websocket
            .get_mut()
            .set_read_timeout(Some(std::time::Duration::from_secs(2)))
            .expect("gateway bootstrap socket should accept a read timeout");
        let periodic_snapshot_a = read_processes_snapshot(&mut websocket);
        let periodic_snapshot_b = read_processes_snapshot(&mut websocket);
        assert_eq!(
            stream_ids_from_snapshots(&[periodic_snapshot_a.0, periodic_snapshot_b.0]),
            vec![21, 22]
        );

        let refresh_payload = encode_stream_data_frame(
            21,
            PAYLOAD_KIND_WEBSOCKET_TEXT,
            json!({
                "type": "processes.refresh"
            })
            .to_string()
            .as_bytes(),
        )
        .expect("processes.refresh frame should encode");
        let refresh_payload_len = refresh_payload.len() - 6;
        websocket
            .send(Message::Binary(refresh_payload.into()))
            .expect("gateway should send processes.refresh");
        assert_eq!(
            read_stream_text_message(&mut websocket),
            json!({
                "type": "stream.window",
                "streamId": 21,
                "bytes": refresh_payload_len
            })
        );

        let refresh_snapshot_a = read_processes_snapshot(&mut websocket);
        let refresh_snapshot_b = read_processes_snapshot(&mut websocket);
        assert_eq!(
            stream_ids_from_snapshots(&[refresh_snapshot_a.0, refresh_snapshot_b.0]),
            vec![21, 22]
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
        None,
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");

    gateway_done_receiver
        .recv()
        .expect("gateway should complete the processes stream interaction");

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
    terminate_child(&mut server);
    terminate_child(&mut idle);
}

#[cfg(target_os = "linux")]
#[test]
fn starts_live_tunnel_session_for_ports_target_authorize() {
    let listener_port = reserve_available_port();
    let mut server = spawn_node_fixture(
        "http-ws-listener.js",
        &[&listener_port.to_string(), "authorize-http"],
    );
    wait_until_listening(listener_port);

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

        while read_json_text_message(&mut websocket)["type"]
            != Value::String("keepalive.state".to_string())
        {}

        websocket
            .send(Message::Text(
                json!({
                    "type": "ports.target.authorize",
                    "requestId": "req_port_access_1",
                    "target": {
                        "kind": "port",
                        "port": listener_port
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should request exact-port authorization");

        assert_eq!(
            read_stream_text_message(&mut websocket),
            json!({
                "type": "ports.target.authorize.result",
                "requestId": "req_port_access_1",
                "authorized": true,
                "upstreamProtocol": "http",
                "websocketCapable": true
            })
        );

        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
        gateway_done_sender
            .send(())
            .expect("gateway should signal the authorize interaction finished");
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
        None,
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");

    gateway_done_receiver
        .recv()
        .expect("gateway should complete the authorize interaction");

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
    terminate_child(&mut server);
}

#[cfg(target_os = "linux")]
#[test]
fn starts_live_tunnel_session_for_ports_http_transport() {
    let listener_port = reserve_available_port();
    let fixture_marker = format!("mistle_http_transport_{}", std::process::id());
    let mut server = spawn_node_fixture(
        "http-transport-listener.js",
        &[&listener_port.to_string(), &fixture_marker],
    );
    wait_until_listening(listener_port);

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

        while read_json_text_message(&mut websocket)["type"]
            != Value::String("keepalive.state".to_string())
        {}

        websocket
            .send(Message::Text(
                json!({
                    "type": "ports.http.open",
                    "streamId": 31,
                    "target": {
                        "kind": "port",
                        "port": listener_port
                    },
                    "upstreamProtocol": "http",
                    "request": {
                        "method": "POST",
                        "path": "/echo",
                        "query": "mode=full",
                        "headers": {
                            "host": [format!("127.0.0.1:{listener_port}")],
                            "content-type": ["text/plain; charset=utf-8"],
                            "x-forwarded-host": ["p-5173--sandbox.mistle.localhost"],
                            "x-forwarded-proto": ["https"],
                            "x-forwarded-port": ["443"],
                            "x-request-marker": [fixture_marker.clone()]
                        }
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should open the port access http stream");
        websocket
            .send(Message::Text(
                json!({
                    "type": "ports.http.body.chunk",
                    "streamId": 31,
                    "direction": "request",
                    "bytes": base64::engine::general_purpose::STANDARD.encode("hello from gateway"),
                    "encoding": "base64"
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should send the request body chunk");
        websocket
            .send(Message::Text(
                json!({
                    "type": "ports.http.body.end",
                    "streamId": 31,
                    "direction": "request"
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should send the request body end");

        let response_start = read_port_access_message_for_stream(&mut websocket, 31);
        assert_eq!(response_start["type"], "ports.http.response.start");
        assert_eq!(response_start["status"], 201);
        assert_eq!(
            response_start["headers"]["content-type"],
            json!(["application/json; charset=utf-8"])
        );
        assert_eq!(
            response_start["headers"]["x-fixture"],
            json!([fixture_marker.clone()])
        );
        assert_eq!(
            response_start["headers"].get("connection"),
            None,
            "hop-by-hop response headers must be stripped before tunneling",
        );

        let mut response_body = Vec::new();
        loop {
            let message = read_port_access_message_for_stream(&mut websocket, 31);
            match message["type"].as_str() {
                Some("ports.http.body.chunk") => {
                    response_body.extend_from_slice(&decode_port_access_body_chunk(&message));
                }
                Some("ports.http.body.end") => break,
                other => panic!("unexpected port access response message: {other:?}"),
            }
        }

        let echoed_request: Value =
            serde_json::from_slice(&response_body).expect("response body should be json");
        assert_eq!(echoed_request["method"], "POST");
        assert_eq!(echoed_request["url"], "/echo?mode=full");
        assert_eq!(echoed_request["body"], "hello from gateway");
        assert_eq!(
            echoed_request["headers"]["host"],
            format!("127.0.0.1:{listener_port}")
        );
        assert_eq!(
            echoed_request["headers"]["x-forwarded-host"],
            "p-5173--sandbox.mistle.localhost"
        );
        assert_eq!(echoed_request["headers"]["x-forwarded-proto"], "https");
        assert_eq!(echoed_request["headers"]["x-forwarded-port"], "443");
        assert_eq!(
            echoed_request["headers"]["x-request-marker"],
            fixture_marker
        );

        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
        gateway_done_sender
            .send(())
            .expect("gateway should signal the http transport interaction finished");
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
        None,
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");

    gateway_done_receiver
        .recv()
        .expect("gateway should complete the http transport interaction");

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
    terminate_child(&mut server);
}

#[cfg(target_os = "linux")]
#[test]
fn sends_ports_stream_error_when_http_transport_cannot_connect_upstream() {
    let listener_port = reserve_available_port();

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

        while read_json_text_message(&mut websocket)["type"]
            != Value::String("keepalive.state".to_string())
        {}

        websocket
            .send(Message::Text(
                json!({
                    "type": "ports.http.open",
                    "streamId": 32,
                    "target": {
                        "kind": "port",
                        "port": listener_port
                    },
                    "upstreamProtocol": "http",
                    "request": {
                        "method": "GET",
                        "path": "/echo",
                        "headers": {
                            "host": [format!("127.0.0.1:{listener_port}")]
                        }
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should open the port access http stream");
        websocket
            .send(Message::Text(
                json!({
                    "type": "ports.http.body.end",
                    "streamId": 32,
                    "direction": "request"
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should end the empty request body");

        let error_message = read_port_access_message_for_stream(&mut websocket, 32);
        assert_eq!(error_message["type"], "ports.stream.error");
        assert_eq!(error_message["streamId"], 32);
        assert_eq!(error_message["code"], "upstream_connect_failed");
        assert!(
            error_message["message"]
                .as_str()
                .is_some_and(|message| !message.is_empty()),
            "connect failures should surface a non-empty error message",
        );

        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
        gateway_done_sender
            .send(())
            .expect("gateway should signal the failed http transport interaction finished");
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
        None,
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");

    gateway_done_receiver
        .recv()
        .expect("gateway should complete the failed http transport interaction");

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
}

#[cfg(target_os = "linux")]
#[test]
fn sends_ports_stream_error_when_http_transport_upstream_closes_mid_response() {
    let listener_port = reserve_available_port();
    let fixture_marker = format!("mistle_http_transport_close_{}", std::process::id());
    let mut server = spawn_node_fixture(
        "http-transport-listener.js",
        &[&listener_port.to_string(), &fixture_marker],
    );
    wait_until_listening(listener_port);

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

        while read_json_text_message(&mut websocket)["type"]
            != Value::String("keepalive.state".to_string())
        {}

        websocket
            .send(Message::Text(
                json!({
                    "type": "ports.http.open",
                    "streamId": 33,
                    "target": {
                        "kind": "port",
                        "port": listener_port
                    },
                    "upstreamProtocol": "http",
                    "request": {
                        "method": "GET",
                        "path": "/close-early",
                        "headers": {
                            "host": [format!("127.0.0.1:{listener_port}")]
                        }
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should open the port access http stream");
        websocket
            .send(Message::Text(
                json!({
                    "type": "ports.http.body.end",
                    "streamId": 33,
                    "direction": "request"
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should end the empty request body");

        let response_start = read_port_access_message_for_stream(&mut websocket, 33);
        assert_eq!(response_start["type"], "ports.http.response.start");
        assert_eq!(response_start["status"], 200);

        loop {
            let message = read_port_access_message_for_stream(&mut websocket, 33);
            match message["type"].as_str() {
                Some("ports.http.body.chunk") => continue,
                Some("ports.stream.error") => {
                    assert_eq!(message["code"], "upstream_io_error");
                    break;
                }
                other => panic!("unexpected port access response message: {other:?}"),
            }
        }

        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
        gateway_done_sender
            .send(())
            .expect("gateway should signal the mid-response failure interaction finished");
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
        None,
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");

    gateway_done_receiver
        .recv()
        .expect("gateway should complete the mid-response failure interaction");

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
    terminate_child(&mut server);
}

#[cfg(target_os = "linux")]
#[test]
fn relays_port_access_tcp_bytes_and_directional_closes() {
    let upstream_listener =
        TcpListener::bind("127.0.0.1:0").expect("upstream tcp listener should bind");
    let listener_port = upstream_listener
        .local_addr()
        .expect("upstream tcp listener should expose an address")
        .port();
    let upstream_thread = thread::spawn(move || {
        let (mut stream, _) = upstream_listener
            .accept()
            .expect("upstream tcp listener should accept one connection");
        let mut request = [0u8; 4];
        stream
            .read_exact(&mut request)
            .expect("upstream should receive tcp request bytes");
        assert_eq!(&request, b"ping");
        stream
            .write_all(b"pong")
            .expect("upstream should write tcp response bytes");
        stream
            .shutdown(std::net::Shutdown::Write)
            .expect("upstream should close tcp response direction");
        let mut trailing = Vec::new();
        stream
            .read_to_end(&mut trailing)
            .expect("upstream should observe request direction close");
        assert!(
            trailing.is_empty(),
            "gateway should not send trailing bytes"
        );
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

        while read_json_text_message(&mut websocket)["type"]
            != Value::String("keepalive.state".to_string())
        {}

        websocket
            .send(Message::Text(
                json!({
                    "type": "ports.tcp.open",
                    "streamId": 51,
                    "target": {
                        "kind": "port",
                        "port": listener_port
                    },
                    "upstreamProtocol": "http"
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should open the port access tcp stream");

        let connected = read_port_access_message_for_stream(&mut websocket, 51);
        assert_eq!(connected["type"], "ports.tcp.connected");

        websocket
            .send(Message::Binary(
                encode_stream_data_frame(51, PAYLOAD_KIND_RAW_BYTES, b"ping")
                    .expect("tcp request data frame should encode")
                    .into(),
            ))
            .expect("gateway should send tcp request bytes");

        let mut saw_input_window = false;
        let mut saw_response_data = false;
        while !(saw_input_window && saw_response_data) {
            match read_tunnel_message_for_stream(&mut websocket, 51) {
                TunnelGatewayTestMessage::Text(message) => {
                    assert_eq!(message["type"], "stream.window");
                    assert_eq!(message["bytes"], 4);
                    saw_input_window = true;
                }
                TunnelGatewayTestMessage::Binary(frame) => {
                    assert_eq!(frame.payload_kind, PAYLOAD_KIND_RAW_BYTES);
                    assert_eq!(frame.payload, b"pong");
                    saw_response_data = true;
                }
            }
        }

        websocket
            .send(Message::Text(
                json!({
                    "type": "ports.tcp.close",
                    "streamId": 51,
                    "direction": "request"
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should close the tcp request direction");

        let mut saw_request_close = false;
        let mut saw_response_close = false;
        while !(saw_request_close && saw_response_close) {
            let message = read_port_access_message_for_stream(&mut websocket, 51);
            assert_eq!(message["type"], "ports.tcp.close");
            match message["direction"].as_str() {
                Some("request") => saw_request_close = true,
                Some("response") => saw_response_close = true,
                other => panic!("unexpected tcp close direction: {other:?}"),
            }
        }

        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
        gateway_done_sender
            .send(())
            .expect("gateway should signal the tcp transport interaction finished");
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
        None,
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");

    gateway_done_receiver
        .recv()
        .expect("gateway should complete the tcp transport interaction");

    tunnel_session.close();
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
    upstream_thread
        .join()
        .expect("upstream thread should exit cleanly");
}
