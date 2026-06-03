use super::*;

#[test]
fn starts_live_tunnel_session_for_agent_and_file_upload_streams() {
    let upload_thread_id = format!(
        "thread_{}",
        REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
    let raw_url = format!(
        "ws://127.0.0.1:{}/raw",
        raw_listener
            .local_addr()
            .expect("raw listener should expose an address")
            .port()
    );
    let raw_server_thread = thread::spawn(move || {
        let (monitor_stream, _) = raw_listener
            .accept()
            .expect("raw app-server should accept the monitor connection");
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
                        "data": [],
                        "nextCursor": null
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("thread/loaded/list response should send");

        let (client_stream, _) = raw_listener
            .accept()
            .expect("raw app-server should accept the proxied client connection");
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
        match client_socket.read() {
            Ok(Message::Close(_))
            | Err(WebSocketError::ConnectionClosed)
            | Err(WebSocketError::Protocol(_)) => {}
            Ok(other_message) => panic!(
                "expected proxied client websocket to close after tunnel stream shutdown, got {other_message:?}"
            ),
            Err(error) => panic!(
                "proxied client websocket should only end because the tunnel stream closed: {error}"
            ),
        }
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
    let upload_thread_id_for_gateway = upload_thread_id.clone();
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
        let mut saw_runtime_ready = false;
        while !saw_keepalive || !saw_runtime_ready {
            let control_message = read_json_text_message(&mut websocket);
            match control_message["type"].as_str() {
                Some("keepalive.state") => {
                    assert_eq!(control_message["active"], Value::Bool(false));
                    saw_keepalive = true;
                }
                Some("runtime.ready") => {
                    if control_message["ready"] == Value::Bool(true) {
                        saw_runtime_ready = true;
                    }
                }
                Some("operation.open") => {
                    acknowledge_operation_open(&mut websocket, &control_message);
                }
                other => {
                    panic!("unexpected bootstrap control message before streams: {other:?}")
                }
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
            .expect("gateway should open an agent stream");
        assert_eq!(
            read_stream_text_message(&mut websocket),
            json!({
                "type": "stream.open.ok",
                "streamId": 7
            })
        );

        let request_id = REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
        let encoded_request = encode_stream_data_frame(
            7,
            PAYLOAD_KIND_WEBSOCKET_TEXT,
            json!({
                "id": request_id,
                "method": "thread/loaded/list",
                "params": {}
            })
            .to_string()
            .as_bytes(),
        )
        .expect("agent request frame should encode");
        let request_payload_len = encoded_request.len() - 6;
        websocket
            .send(Message::Binary(encoded_request.into()))
            .expect("gateway should send agent request data");

        let request_window = read_stream_text_message(&mut websocket);
        assert_eq!(
            request_window,
            json!({
                "type": "stream.window",
                "streamId": 7,
                "bytes": request_payload_len
            })
        );

        let agent_response = read_non_telemetry_binary_frame(&mut websocket);
        assert_eq!(agent_response.stream_id, 7);
        assert_eq!(agent_response.payload_kind, PAYLOAD_KIND_WEBSOCKET_TEXT);
        assert_eq!(
            serde_json::from_slice::<Value>(&agent_response.payload)
                .expect("agent response should be json"),
            json!({
                "id": request_id,
                "result": {
                    "data": []
                }
            })
        );
        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.window",
                    "streamId": 7,
                    "bytes": agent_response.payload.len()
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should restore agent stream window credit");

        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.close",
                    "streamId": 7
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should close the agent stream");

        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.open",
                    "streamId": 9,
                    "channel": {
                        "kind": "fileUpload",
                        "threadId": upload_thread_id_for_gateway,
                        "mimeType": "image/png",
                        "originalFilename": "image.png",
                        "sizeBytes": 8
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should open a file upload stream");
        assert_eq!(
            read_stream_text_message(&mut websocket),
            json!({
                "type": "stream.open.ok",
                "streamId": 9
            })
        );

        let png_bytes = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        let encoded_upload = encode_stream_data_frame(9, PAYLOAD_KIND_RAW_BYTES, &png_bytes)
            .expect("file upload frame should encode");
        websocket
            .send(Message::Binary(encoded_upload.into()))
            .expect("gateway should send file upload bytes");

        let upload_window = read_stream_text_message(&mut websocket);
        assert_eq!(upload_window["type"], "stream.window");
        assert_eq!(upload_window["streamId"], Value::Number(9.into()));
        assert_eq!(upload_window["bytes"], Value::Number(8.into()));

        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.close",
                    "streamId": 9
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should close the file upload stream");

        let completion_event = read_stream_text_message(&mut websocket);
        assert_eq!(completion_event["type"], "stream.event");
        assert_eq!(completion_event["streamId"], Value::Number(9.into()));
        assert_eq!(completion_event["event"]["type"], "fileUpload.completed");
        assert_eq!(completion_event["event"]["kind"], "image");
        let persisted_path = completion_event["event"]["path"]
            .as_str()
            .expect("file upload completed event should expose a persisted path")
            .to_string();
        assert_eq!(
            fs::read(&persisted_path).expect("persisted upload should be readable"),
            png_bytes
        );

        let complete_message = read_stream_text_message(&mut websocket);
        assert_eq!(complete_message["type"], "stream.complete");
        assert_eq!(complete_message["streamId"], Value::Number(9.into()));

        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.open",
                    "streamId": 10,
                    "channel": {
                        "kind": "fileUpload",
                        "threadId": upload_thread_id_for_gateway,
                        "mimeType": "text/plain",
                        "originalFilename": "notes.txt",
                        "sizeBytes": 8
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should open a generic file upload stream");
        assert_eq!(
            read_stream_text_message(&mut websocket),
            json!({
                "type": "stream.open.ok",
                "streamId": 10
            })
        );

        let file_bytes = b"notimage".to_vec();
        let encoded_upload = encode_stream_data_frame(10, PAYLOAD_KIND_RAW_BYTES, &file_bytes)
            .expect("file upload frame should encode");
        websocket
            .send(Message::Binary(encoded_upload.into()))
            .expect("gateway should send generic file upload bytes");

        let upload_window = read_stream_text_message(&mut websocket);
        assert_eq!(upload_window["type"], "stream.window");
        assert_eq!(upload_window["streamId"], Value::Number(10.into()));
        assert_eq!(upload_window["bytes"], Value::Number(8.into()));

        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.close",
                    "streamId": 10
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should close the generic file upload stream");

        let completion_event = read_stream_text_message(&mut websocket);
        assert_eq!(completion_event["type"], "stream.event");
        assert_eq!(completion_event["streamId"], Value::Number(10.into()));
        assert_eq!(completion_event["event"]["type"], "fileUpload.completed");
        assert_eq!(completion_event["event"]["kind"], "file");
        let generic_persisted_path = completion_event["event"]["path"]
            .as_str()
            .expect("generic file upload completed event should expose a persisted path")
            .to_string();
        assert!(
            generic_persisted_path.ends_with(".txt"),
            "generic uploads should preserve safe filename extensions"
        );
        assert_eq!(
            fs::read(&generic_persisted_path).expect("generic persisted upload should be readable"),
            file_bytes
        );

        let complete_message = read_stream_text_message(&mut websocket);
        assert_eq!(complete_message["type"], "stream.complete");
        assert_eq!(complete_message["streamId"], Value::Number(10.into()));

        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.open",
                    "streamId": 11,
                    "channel": {
                        "kind": "fileUpload",
                        "threadId": upload_thread_id_for_gateway,
                        "mimeType": "image/png",
                        "originalFilename": "image.png",
                        "sizeBytes": 8
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should open a declared image upload stream");
        assert_eq!(
            read_stream_text_message(&mut websocket),
            json!({
                "type": "stream.open.ok",
                "streamId": 11
            })
        );

        let encoded_upload = encode_stream_data_frame(11, PAYLOAD_KIND_RAW_BYTES, &file_bytes)
            .expect("declared image upload frame should encode");
        websocket
            .send(Message::Binary(encoded_upload.into()))
            .expect("gateway should send invalid image upload bytes");

        let upload_window = read_stream_text_message(&mut websocket);
        assert_eq!(upload_window["type"], "stream.window");
        assert_eq!(upload_window["streamId"], Value::Number(11.into()));
        assert_eq!(upload_window["bytes"], Value::Number(8.into()));

        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.close",
                    "streamId": 11
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should close the invalid image upload stream");

        let reset_message = read_stream_text_message(&mut websocket);
        assert_eq!(reset_message["type"], "stream.reset");
        assert_eq!(reset_message["streamId"], Value::Number(11.into()));
        assert_eq!(reset_message["code"], "invalid_file_type");
        assert_eq!(
            reset_message["message"],
            "uploaded file is not a supported image"
        );

        websocket
            .close(None)
            .expect("gateway websocket should close cleanly");
        gateway_done_sender
            .send(persisted_path)
            .expect("gateway should report the persisted path");
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
                                "args": ["/bin/sh", "-lc", "sleep 30"]
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
                            "processKey": null,
                            "transport": {
                                "type": "ws",
                                "url": "ws://127.0.0.1:0/codex"
                            },
                            "connectionMode": "dedicated"
                        }
                    ]
                }
            ],
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
    let runtime_adapters = RuntimeAdapterRegistry
        .start(
            &startup_input,
            keepalive_manager.clone(),
            runtime_readiness_manager.clone(),
        )
        .expect("runtime adapters should start");
    let tunnel_session = TunnelSession::start(
        &startup_input,
        keepalive_manager,
        runtime_readiness_manager,
        Some(runtime_adapters.adapters()[0].listen_url().to_string()),
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");

    let persisted_path = gateway_done_receiver
        .recv()
        .expect("gateway should complete the live tunnel interaction");

    tunnel_session.close();
    runtime_adapters
        .close()
        .expect("runtime adapters should stop cleanly");
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
    raw_server_thread
        .join()
        .expect("raw codex app-server thread should exit cleanly");

    if let Some(thread_dir) = PathBuf::from(&persisted_path).parent() {
        let _ = fs::remove_dir_all(thread_dir);
    }
}

#[test]
fn keeps_large_agent_responses_open_when_the_response_fits_within_the_stream_window() {
    let large_response_payload = "x".repeat(std::cmp::min(
        1024 * 1024,
        AGENT_STREAM_WINDOW_BYTES.saturating_sub(2048),
    ));
    let large_response_payload_len = large_response_payload.len();

    let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
    let raw_url = format!(
        "ws://127.0.0.1:{}/raw",
        raw_listener
            .local_addr()
            .expect("raw listener should expose an address")
            .port()
    );
    let raw_server_thread = thread::spawn(move || {
        let (monitor_stream, _) = raw_listener
            .accept()
            .expect("raw app-server should accept the monitor connection");
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
                        "data": [],
                        "nextCursor": null
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("thread/loaded/list response should send");

        let (client_stream, _) = raw_listener
            .accept()
            .expect("raw app-server should accept the proxied client connection");
        let mut client_socket =
            accept(client_stream).expect("proxied client handshake should succeed");
        let proxied_request = read_json_text_message(&mut client_socket);
        client_socket
            .send(Message::Text(
                json!({
                    "id": proxied_request["id"],
                    "result": {
                        "data": large_response_payload
                    }
                })
                .to_string()
                .into(),
            ))
            .expect("proxied response should send");
        match client_socket.read() {
            Ok(Message::Close(_))
            | Err(WebSocketError::ConnectionClosed)
            | Err(WebSocketError::Protocol(_)) => {}
            Ok(other_message) => panic!(
                "expected proxied client websocket to close after tunnel stream shutdown, got {other_message:?}"
            ),
            Err(error) => panic!(
                "proxied client websocket should only end because the tunnel stream closed: {error}"
            ),
        }
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
        let mut saw_runtime_ready = false;
        while !saw_keepalive || !saw_runtime_ready {
            let control_message = read_json_text_message(&mut websocket);
            match control_message["type"].as_str() {
                Some("keepalive.state") => {
                    assert_eq!(control_message["active"], Value::Bool(false));
                    saw_keepalive = true;
                }
                Some("runtime.ready") => {
                    if control_message["ready"] == Value::Bool(true) {
                        saw_runtime_ready = true;
                    }
                }
                Some("operation.open") => {
                    acknowledge_operation_open(&mut websocket, &control_message);
                }
                other => {
                    panic!("unexpected bootstrap control message before streams: {other:?}")
                }
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
            .expect("gateway should open an agent stream");
        assert_eq!(
            read_stream_text_message(&mut websocket),
            json!({
                "type": "stream.open.ok",
                "streamId": 7
            })
        );

        let request_id = REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
        let encoded_request = encode_stream_data_frame(
            7,
            PAYLOAD_KIND_WEBSOCKET_TEXT,
            json!({
                "id": request_id,
                "method": "thread/loaded/list",
                "params": {}
            })
            .to_string()
            .as_bytes(),
        )
        .expect("agent request frame should encode");
        let request_payload_len = encoded_request.len() - 6;
        websocket
            .send(Message::Binary(encoded_request.into()))
            .expect("gateway should send agent request data");

        let request_window = read_stream_text_message(&mut websocket);
        assert_eq!(
            request_window,
            json!({
                "type": "stream.window",
                "streamId": 7,
                "bytes": request_payload_len
            })
        );

        let agent_response = read_non_telemetry_binary_frame(&mut websocket);
        assert_eq!(agent_response.stream_id, 7);
        assert_eq!(agent_response.payload_kind, PAYLOAD_KIND_WEBSOCKET_TEXT);
        let decoded_payload = serde_json::from_slice::<Value>(&agent_response.payload)
            .expect("agent response should be json");
        assert_eq!(decoded_payload["id"], Value::Number(request_id.into()));
        assert_eq!(
            decoded_payload["result"]["data"]
                .as_str()
                .expect("agent response should include the large string")
                .len(),
            large_response_payload_len
        );

        websocket
            .send(Message::Text(
                json!({
                    "type": "stream.close",
                    "streamId": 7
                })
                .to_string()
                .into(),
            ))
            .expect("gateway should close the agent stream");

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
                                "args": ["/bin/sh", "-lc", "sleep 30"]
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
                            "processKey": null,
                            "transport": {
                                "type": "ws",
                                "url": "ws://127.0.0.1:0/codex"
                            },
                            "connectionMode": "dedicated"
                        }
                    ]
                }
            ],
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
    let runtime_adapters = RuntimeAdapterRegistry
        .start(
            &startup_input,
            keepalive_manager.clone(),
            runtime_readiness_manager.clone(),
        )
        .expect("runtime adapters should start");
    let tunnel_session = TunnelSession::start(
        &startup_input,
        keepalive_manager,
        runtime_readiness_manager,
        Some(runtime_adapters.adapters()[0].listen_url().to_string()),
        BTreeMap::new(),
        Arc::new(SystemClock),
        Arc::new(ThreadSleeper),
    )
    .expect("tunnel session should start");

    gateway_done_receiver
        .recv()
        .expect("gateway should complete the large-response interaction");

    tunnel_session.close();
    runtime_adapters
        .close()
        .expect("runtime adapters should stop cleanly");
    gateway_thread
        .join()
        .expect("gateway thread should exit cleanly");
    raw_server_thread
        .join()
        .expect("raw codex app-server thread should exit cleanly");
}
