use super::*;

#[tokio::test]
async fn file_search_stream_returns_results_from_open_cwd() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    fs::create_dir(temp_dir.path().join("src")).expect("src directory should be created");
    fs::write(temp_dir.path().join("src").join("protocol.rs"), "")
        .expect("protocol file should be written");

    let (tunnel_writer_sender, mut tunnel_writer_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (event_sender, mut event_receiver) = tokio::sync::mpsc::unbounded_channel();
    let clock = SystemClock;
    let supervisor_handle = test_tunnel_supervisor_handle("sbi_test", Arc::new(SystemClock));
    let context = TunnelSessionLoopContext {
        attachment_root: std::path::Path::new("/tmp"),
        cgroup_root: std::path::Path::new("/tmp"),
        sandbox_instance_id: "sbi_test",
        gateway_ws_url: "ws://127.0.0.1:3300/bootstrap",
        clock: &clock,
        platform_process_registry: crate::process::PlatformProcessRegistry::default(),
        supervisor_handle: &supervisor_handle,
    };
    let mut session_state = empty_tunnel_session_state();
    let open_payload = json!({
        "type": "stream.open",
        "streamId": 31,
        "channel": {
            "kind": "fileSearch",
            "cwd": temp_dir.path(),
        }
    })
    .to_string();

    handle_tunnel_control_message(
        &tunnel_writer_sender,
        &event_sender,
        parse_stream_control_message(&open_payload).expect("file search stream.open should parse"),
        &context,
        &mut session_state,
    )
    .await
    .expect("file search stream should open");
    assert_eq!(
        read_writer_text_json(&mut tunnel_writer_receiver).await,
        json!({
            "type": "stream.open.ok",
            "streamId": 31,
        }),
    );

    let query_payload = json!({
        "type": "fileSearch.query",
        "requestId": "file_search_req_1",
        "query": "protocol",
        "limit": 10,
    })
    .to_string();
    handle_tunnel_binary_frame(
        &tunnel_writer_sender,
        StreamDataFrame {
            stream_id: 31,
            payload_kind: PAYLOAD_KIND_WEBSOCKET_TEXT,
            payload: query_payload.as_bytes().to_vec(),
        },
        &mut session_state,
        &clock,
    )
    .expect("file search query should route to worker");
    assert_eq!(
        read_writer_text_json(&mut tunnel_writer_receiver).await,
        json!({
            "type": "stream.window",
            "streamId": 31,
            "bytes": query_payload.len(),
        }),
    );

    let event = timeout(Duration::from_secs(2), event_receiver.recv())
        .await
        .expect("file search worker should emit an event")
        .expect("file search worker event channel should stay open");
    handle_tunnel_session_event(
        event,
        &tunnel_writer_sender,
        &event_sender,
        &context,
        &mut session_state,
    )
    .await
    .expect("file search results should be written");
    let frame = read_writer_binary_frame(&mut tunnel_writer_receiver).await;
    assert_eq!(frame.stream_id, 31);
    assert_eq!(frame.payload_kind, PAYLOAD_KIND_WEBSOCKET_TEXT);
    let results: Value =
        serde_json::from_slice(&frame.payload).expect("file search results should be json");
    assert_eq!(results["type"], "fileSearch.results");
    assert_eq!(results["requestId"], "file_search_req_1");
    assert!(
        results["items"]
            .as_array()
            .expect("file search results should include items")
            .iter()
            .any(|item| item
                == &json!({
                    "path": "src/protocol.rs",
                    "kind": "file",
                }))
    );

    terminate_file_search_stream(&mut session_state, 31);
}

#[tokio::test]
async fn restores_agent_stream_window_credit_after_runtime_writes_complete() {
    let (tunnel_writer_sender, mut tunnel_writer_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (event_sender, _event_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (agent_sender, _agent_receiver) = tokio::sync::mpsc::unbounded_channel();
    let clock = SystemClock;
    let mut session_state = TunnelSessionMutableState {
        agent_endpoint_url: None,
        runtime_env: BTreeMap::new(),
        telemetry_relay: TelemetryRelay::default(),
        pending_signing_requests: BTreeMap::new(),
        pending_egress_token_requests: BTreeMap::new(),
        pending_agent_opens: BTreeMap::new(),
        pending_exec_opens: BTreeMap::new(),
        agent_streams: BTreeMap::from([(
            7,
            AgentStreamState {
                sender: agent_sender,
                send_window: StreamSendWindow::new(AGENT_STREAM_WINDOW_BYTES),
                stats: AgentStreamStats::new(0),
            },
        )]),
        port_access_http_streams: BTreeMap::new(),
        port_access_tcp_streams: BTreeMap::new(),
        process_streams: ProcessStreamState::default(),
        file_search_streams: BTreeMap::new(),
        operation_stream_requested: false,
        operation_stream_close_requested: false,
        operation_stream_close_response_sender: None,
        operation_stream_send_window: None,
        pending_operation_records: Default::default(),
        file_uploads: BTreeMap::new(),
    };
    let supervisor_handle = test_tunnel_supervisor_handle("sbi_test", Arc::new(SystemClock));
    let context = TunnelSessionLoopContext {
        attachment_root: std::path::Path::new("/tmp"),
        cgroup_root: std::path::Path::new("/tmp"),
        sandbox_instance_id: "sbi_test",
        gateway_ws_url: "ws://127.0.0.1:3300/bootstrap",
        clock: &clock,
        platform_process_registry: crate::process::PlatformProcessRegistry::default(),
        supervisor_handle: &supervisor_handle,
    };

    handle_tunnel_session_event(
        TunnelSessionEvent::AgentWriteCompleted {
            stream_id: 7,
            bytes: 512,
        },
        &tunnel_writer_sender,
        &event_sender,
        &context,
        &mut session_state,
    )
    .await
    .expect("agent write completion should restore send credit");

    let writer_message = tunnel_writer_receiver
        .recv()
        .await
        .expect("window update should be queued");
    let TunnelWriterMessage::Text(payload) = writer_message else {
        panic!("expected a text stream.window update");
    };
    assert_eq!(
        serde_json::from_str::<Value>(&payload).expect("window payload should be json"),
        json!({
            "type": "stream.window",
            "streamId": 7,
            "bytes": 512
        })
    );
}

#[tokio::test]
async fn serializes_port_access_tcp_events_to_tunnel_frames() {
    let (tunnel_writer_sender, mut tunnel_writer_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (event_sender, _event_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (tcp_sender, _tcp_receiver) =
        tokio::sync::mpsc::unbounded_channel::<PortAccessTcpCommand>();
    let clock = SystemClock;
    let mut session_state = TunnelSessionMutableState {
        agent_endpoint_url: None,
        runtime_env: BTreeMap::new(),
        telemetry_relay: TelemetryRelay::default(),
        pending_signing_requests: BTreeMap::new(),
        pending_egress_token_requests: BTreeMap::new(),
        pending_agent_opens: BTreeMap::new(),
        pending_exec_opens: BTreeMap::new(),
        agent_streams: BTreeMap::new(),
        port_access_http_streams: BTreeMap::new(),
        port_access_tcp_streams: BTreeMap::from([(
            55,
            PortAccessTcpStreamState {
                sender: tcp_sender,
                request_window: StreamSendWindow::new(0),
                request_closed: true,
                response_closed: false,
            },
        )]),
        process_streams: ProcessStreamState::default(),
        file_search_streams: BTreeMap::new(),
        operation_stream_requested: false,
        operation_stream_close_requested: false,
        operation_stream_close_response_sender: None,
        operation_stream_send_window: None,
        pending_operation_records: Default::default(),
        file_uploads: BTreeMap::new(),
    };
    let supervisor_handle = test_tunnel_supervisor_handle("sbi_test", Arc::new(SystemClock));
    let context = TunnelSessionLoopContext {
        attachment_root: std::path::Path::new("/tmp"),
        cgroup_root: std::path::Path::new("/tmp"),
        sandbox_instance_id: "sbi_test",
        gateway_ws_url: "ws://127.0.0.1:3300/bootstrap",
        clock: &clock,
        platform_process_registry: crate::process::PlatformProcessRegistry::default(),
        supervisor_handle: &supervisor_handle,
    };

    handle_tunnel_session_event(
        TunnelSessionEvent::PortAccessTransport(PortAccessTransportEvent::TcpConnected(
            PortsTcpConnected {
                message_type: "ports.tcp.connected".to_string(),
                stream_id: 55,
            },
        )),
        &tunnel_writer_sender,
        &event_sender,
        &context,
        &mut session_state,
    )
    .await
    .expect("tcp connected event should serialize");
    assert_eq!(
        read_writer_text_json(&mut tunnel_writer_receiver).await,
        json!({
            "type": "ports.tcp.connected",
            "streamId": 55
        })
    );

    handle_tunnel_session_event(
        TunnelSessionEvent::PortAccessTransport(PortAccessTransportEvent::TcpData {
            stream_id: 55,
            bytes: b"pong".to_vec(),
        }),
        &tunnel_writer_sender,
        &event_sender,
        &context,
        &mut session_state,
    )
    .await
    .expect("tcp data event should serialize");
    let writer_message = tunnel_writer_receiver
        .recv()
        .await
        .expect("tcp data frame should be queued");
    let TunnelWriterMessage::Binary(payload) = writer_message else {
        panic!("expected tcp data as tunnel binary frame");
    };
    let frame = decode_stream_data_frame(payload.as_ref())
        .expect("tcp data frame should decode successfully");
    assert_eq!(frame.stream_id, 55);
    assert_eq!(frame.payload_kind, PAYLOAD_KIND_RAW_BYTES);
    assert_eq!(frame.payload, b"pong");

    handle_tunnel_session_event(
        TunnelSessionEvent::PortAccessTransport(PortAccessTransportEvent::TcpInputWindow {
            stream_id: 55,
            bytes: 4,
        }),
        &tunnel_writer_sender,
        &event_sender,
        &context,
        &mut session_state,
    )
    .await
    .expect("tcp input window event should serialize");
    assert_eq!(
        read_writer_text_json(&mut tunnel_writer_receiver).await,
        json!({
            "type": "stream.window",
            "streamId": 55,
            "bytes": 4
        })
    );

    handle_tunnel_session_event(
        TunnelSessionEvent::PortAccessTransport(PortAccessTransportEvent::TcpClose(
            PortsTcpClose {
                message_type: "ports.tcp.close".to_string(),
                stream_id: 55,
                direction: "response".to_string(),
            },
        )),
        &tunnel_writer_sender,
        &event_sender,
        &context,
        &mut session_state,
    )
    .await
    .expect("tcp close event should serialize");
    assert_eq!(
        read_writer_text_json(&mut tunnel_writer_receiver).await,
        json!({
            "type": "ports.tcp.close",
            "streamId": 55,
            "direction": "response"
        })
    );
    assert!(
        !session_state.port_access_tcp_streams.contains_key(&55),
        "response close should release tcp stream state",
    );
}

#[test]
fn routes_raw_tunnel_binary_frames_to_active_port_access_tcp_streams() {
    let (tunnel_writer_sender, _tunnel_writer_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (tcp_sender, mut tcp_receiver) =
        tokio::sync::mpsc::unbounded_channel::<PortAccessTcpCommand>();
    let mut session_state = TunnelSessionMutableState {
        agent_endpoint_url: None,
        runtime_env: BTreeMap::new(),
        telemetry_relay: TelemetryRelay::default(),
        pending_signing_requests: BTreeMap::new(),
        pending_egress_token_requests: BTreeMap::new(),
        pending_agent_opens: BTreeMap::new(),
        pending_exec_opens: BTreeMap::new(),
        agent_streams: BTreeMap::new(),
        port_access_http_streams: BTreeMap::new(),
        port_access_tcp_streams: BTreeMap::from([(
            56,
            PortAccessTcpStreamState {
                sender: tcp_sender,
                request_window: StreamSendWindow::default(),
                request_closed: false,
                response_closed: false,
            },
        )]),
        process_streams: ProcessStreamState::default(),
        file_search_streams: BTreeMap::new(),
        operation_stream_requested: false,
        operation_stream_close_requested: false,
        operation_stream_close_response_sender: None,
        operation_stream_send_window: None,
        pending_operation_records: Default::default(),
        file_uploads: BTreeMap::new(),
    };

    handle_tunnel_binary_frame(
        &tunnel_writer_sender,
        StreamDataFrame {
            stream_id: 56,
            payload_kind: PAYLOAD_KIND_RAW_BYTES,
            payload: b"ping".to_vec(),
        },
        &mut session_state,
        &SystemClock,
    )
    .expect("tcp binary frame should route to tcp command channel");

    match tcp_receiver
        .try_recv()
        .expect("tcp command receiver should receive request bytes")
    {
        PortAccessTcpCommand::Data { bytes } => assert_eq!(bytes, b"ping"),
        command => panic!("unexpected tcp command: {command:?}"),
    }
}

#[test]
fn keeps_port_access_tcp_stream_active_until_both_directions_close() {
    let (tcp_sender, _tcp_receiver) =
        tokio::sync::mpsc::unbounded_channel::<PortAccessTcpCommand>();
    let mut session_state = TunnelSessionMutableState {
        agent_endpoint_url: None,
        runtime_env: BTreeMap::new(),
        telemetry_relay: TelemetryRelay::default(),
        pending_signing_requests: BTreeMap::new(),
        pending_egress_token_requests: BTreeMap::new(),
        pending_agent_opens: BTreeMap::new(),
        pending_exec_opens: BTreeMap::new(),
        agent_streams: BTreeMap::new(),
        port_access_http_streams: BTreeMap::new(),
        port_access_tcp_streams: BTreeMap::from([(
            57,
            PortAccessTcpStreamState {
                sender: tcp_sender,
                request_window: StreamSendWindow::default(),
                request_closed: false,
                response_closed: false,
            },
        )]),
        process_streams: ProcessStreamState::default(),
        file_search_streams: BTreeMap::new(),
        operation_stream_requested: false,
        operation_stream_close_requested: false,
        operation_stream_close_response_sender: None,
        operation_stream_send_window: None,
        pending_operation_records: Default::default(),
        file_uploads: BTreeMap::new(),
    };

    mark_port_access_tcp_direction_closed(&mut session_state, 57, "response");
    assert!(
        session_state.port_access_tcp_streams.contains_key(&57),
        "response half-close must not discard request direction state",
    );

    mark_port_access_tcp_direction_closed(&mut session_state, 57, "request");
    assert!(
        !session_state.port_access_tcp_streams.contains_key(&57),
        "tcp stream state should release only after both directions close",
    );
}

#[test]
fn rejects_port_access_tcp_open_when_stream_id_belongs_to_agent_stream() {
    let (event_sender, _event_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (agent_sender, _agent_receiver) = tokio::sync::mpsc::unbounded_channel();
    let mut session_state = TunnelSessionMutableState {
        agent_endpoint_url: None,
        runtime_env: BTreeMap::new(),
        telemetry_relay: TelemetryRelay::default(),
        pending_signing_requests: BTreeMap::new(),
        pending_egress_token_requests: BTreeMap::new(),
        pending_agent_opens: BTreeMap::new(),
        pending_exec_opens: BTreeMap::new(),
        agent_streams: BTreeMap::from([(
            58,
            AgentStreamState {
                sender: agent_sender,
                send_window: StreamSendWindow::new(AGENT_STREAM_WINDOW_BYTES),
                stats: AgentStreamStats::new(0),
            },
        )]),
        port_access_http_streams: BTreeMap::new(),
        port_access_tcp_streams: BTreeMap::new(),
        process_streams: ProcessStreamState::default(),
        file_search_streams: BTreeMap::new(),
        operation_stream_requested: false,
        operation_stream_close_requested: false,
        operation_stream_close_response_sender: None,
        operation_stream_send_window: None,
        pending_operation_records: Default::default(),
        file_uploads: BTreeMap::new(),
    };

    let error = handle_ports_transport_message(
        PortsTransportMessage::TcpOpen(PortsTcpOpen {
            message_type: "ports.tcp.open".to_string(),
            stream_id: 58,
            target: PortAccessTarget {
                kind: "port".to_string(),
                port: 5173,
            },
            upstream_protocol: "http".to_string(),
        }),
        &event_sender,
        &mut session_state,
    )
    .expect_err("tcp open must reject stream id owned by an agent stream");

    assert!(
        error
            .to_string()
            .contains("ports.tcp.open streamId 58 already exists"),
        "collision errors should identify the rejected stream id",
    );
    assert!(
        session_state.port_access_tcp_streams.is_empty(),
        "rejected tcp opens must not create tcp stream state",
    );
}

#[tokio::test]
async fn rejects_generic_stream_open_when_stream_id_belongs_to_tunnel_stream() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let clock = SystemClock;
    let supervisor_handle = test_tunnel_supervisor_handle("sbi_test", Arc::new(SystemClock));
    let context = TunnelSessionLoopContext {
        attachment_root: temp_dir.path(),
        cgroup_root: std::path::Path::new("/tmp"),
        sandbox_instance_id: "sbi_test",
        gateway_ws_url: "ws://127.0.0.1:3300/bootstrap",
        clock: &clock,
        platform_process_registry: crate::process::PlatformProcessRegistry::default(),
        supervisor_handle: &supervisor_handle,
    };

    let duplicate_open_payloads = [
        json!({
            "type": "stream.open",
            "streamId": 72,
            "channel": {
                "kind": "agent",
            },
        }),
        json!({
            "type": "stream.open",
            "streamId": 72,
            "channel": {
                "kind": "processes",
            },
        }),
        json!({
            "type": "stream.open",
            "streamId": 72,
            "channel": {
                "kind": "fileUpload",
                "threadId": "thread_72",
                "mimeType": "image/png",
                "originalFilename": "image.png",
                "sizeBytes": 1,
            },
        }),
        json!({
            "type": "stream.open",
            "streamId": 72,
            "channel": {
                "kind": "exec",
                "command": "true",
            },
        }),
        json!({
            "type": "stream.open",
            "streamId": 72,
            "channel": {
                "kind": "fileSearch",
                "cwd": temp_dir.path(),
            },
        }),
    ];

    for open_payload in duplicate_open_payloads {
        let (tunnel_writer_sender, mut tunnel_writer_receiver) =
            tokio::sync::mpsc::unbounded_channel();
        let (event_sender, _event_receiver) = tokio::sync::mpsc::unbounded_channel();
        let (agent_sender, _agent_receiver) = tokio::sync::mpsc::unbounded_channel();
        let mut session_state = empty_tunnel_session_state();
        session_state.agent_endpoint_url = Some("ws://127.0.0.1:12345/agent".to_string());
        session_state.agent_streams.insert(
            72,
            AgentStreamState {
                sender: agent_sender,
                send_window: StreamSendWindow::new(AGENT_STREAM_WINDOW_BYTES),
                stats: AgentStreamStats::new(0),
            },
        );

        handle_tunnel_control_message(
            &tunnel_writer_sender,
            &event_sender,
            parse_stream_control_message(&open_payload.to_string())
                .expect("duplicate stream.open should parse"),
            &context,
            &mut session_state,
        )
        .await
        .expect("duplicate stream.open should be rejected without failing the tunnel");

        assert_eq!(
            read_writer_text_json(&mut tunnel_writer_receiver).await,
            json!({
                "type": "stream.open.error",
                "streamId": 72,
                "code": "invalid_connect_request",
                "message": "stream.open streamId 72 already exists",
            }),
        );
        assert!(
            tunnel_writer_receiver.try_recv().is_err(),
            "duplicate stream.open should emit exactly one rejection frame",
        );
        assert!(
            session_state.agent_streams.contains_key(&72),
            "duplicate stream.open must leave existing stream state intact",
        );
        assert!(
            session_state.pending_agent_opens.is_empty()
                && session_state.pending_exec_opens.is_empty()
                && session_state.process_streams.is_empty()
                && session_state.file_uploads.is_empty()
                && session_state.file_search_streams.is_empty(),
            "duplicate stream.open must not create new stream state",
        );
    }
}

#[tokio::test]
async fn rejects_generic_stream_open_when_stream_id_belongs_to_port_access_stream() {
    let (tunnel_writer_sender, mut tunnel_writer_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (event_sender, _event_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (tcp_sender, _tcp_receiver) =
        tokio::sync::mpsc::unbounded_channel::<PortAccessTcpCommand>();
    let clock = SystemClock;
    let supervisor_handle = test_tunnel_supervisor_handle("sbi_test", Arc::new(SystemClock));
    let context = TunnelSessionLoopContext {
        attachment_root: std::path::Path::new("/tmp"),
        cgroup_root: std::path::Path::new("/tmp"),
        sandbox_instance_id: "sbi_test",
        gateway_ws_url: "ws://127.0.0.1:3300/bootstrap",
        clock: &clock,
        platform_process_registry: crate::process::PlatformProcessRegistry::default(),
        supervisor_handle: &supervisor_handle,
    };
    let mut session_state = empty_tunnel_session_state();
    session_state.port_access_tcp_streams.insert(
        73,
        PortAccessTcpStreamState {
            sender: tcp_sender,
            request_window: StreamSendWindow::default(),
            request_closed: false,
            response_closed: false,
        },
    );

    let open_payload = json!({
        "type": "stream.open",
        "streamId": 73,
        "channel": {
            "kind": "processes",
        },
    });
    handle_tunnel_control_message(
        &tunnel_writer_sender,
        &event_sender,
        parse_stream_control_message(&open_payload.to_string())
            .expect("duplicate stream.open should parse"),
        &context,
        &mut session_state,
    )
    .await
    .expect("duplicate stream.open should be rejected without failing the tunnel");

    assert_eq!(
        read_writer_text_json(&mut tunnel_writer_receiver).await,
        json!({
            "type": "stream.open.error",
            "streamId": 73,
            "code": "invalid_connect_request",
            "message": "stream.open streamId 73 already exists",
        }),
    );
    assert!(
        session_state.port_access_tcp_streams.contains_key(&73),
        "duplicate stream.open must leave existing port access state intact",
    );
    assert!(
        session_state.process_streams.is_empty(),
        "duplicate stream.open must not create processes stream state",
    );
}

#[tokio::test]
async fn rejects_port_access_tcp_request_bytes_beyond_stream_window() {
    let (tunnel_writer_sender, mut tunnel_writer_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (tcp_sender, mut tcp_receiver) =
        tokio::sync::mpsc::unbounded_channel::<PortAccessTcpCommand>();
    let mut session_state = TunnelSessionMutableState {
        agent_endpoint_url: None,
        runtime_env: BTreeMap::new(),
        telemetry_relay: TelemetryRelay::default(),
        pending_signing_requests: BTreeMap::new(),
        pending_egress_token_requests: BTreeMap::new(),
        pending_agent_opens: BTreeMap::new(),
        pending_exec_opens: BTreeMap::new(),
        agent_streams: BTreeMap::new(),
        port_access_http_streams: BTreeMap::new(),
        port_access_tcp_streams: BTreeMap::from([(
            59,
            PortAccessTcpStreamState {
                sender: tcp_sender,
                request_window: StreamSendWindow::new(4),
                request_closed: false,
                response_closed: false,
            },
        )]),
        process_streams: ProcessStreamState::default(),
        file_search_streams: BTreeMap::new(),
        operation_stream_requested: false,
        operation_stream_close_requested: false,
        operation_stream_close_response_sender: None,
        operation_stream_send_window: None,
        pending_operation_records: Default::default(),
        file_uploads: BTreeMap::new(),
    };

    handle_tunnel_binary_frame(
        &tunnel_writer_sender,
        StreamDataFrame {
            stream_id: 59,
            payload_kind: PAYLOAD_KIND_RAW_BYTES,
            payload: b"ping".to_vec(),
        },
        &mut session_state,
        &SystemClock,
    )
    .expect("first tcp frame should fit within request window");
    match tcp_receiver
        .try_recv()
        .expect("tcp command receiver should receive in-window bytes")
    {
        PortAccessTcpCommand::Data { bytes } => assert_eq!(bytes, b"ping"),
        command => panic!("unexpected tcp command: {command:?}"),
    }

    handle_tunnel_binary_frame(
        &tunnel_writer_sender,
        StreamDataFrame {
            stream_id: 59,
            payload_kind: PAYLOAD_KIND_RAW_BYTES,
            payload: b"!".to_vec(),
        },
        &mut session_state,
        &SystemClock,
    )
    .expect("exhausted tcp request window should reset the stream");

    let reset = read_writer_text_json(&mut tunnel_writer_receiver).await;
    assert_eq!(
        reset,
        json!({
            "type": "stream.reset",
            "streamId": 59,
            "code": "stream_window_exhausted",
            "message": "port access tcp request stream window is exhausted"
        })
    );
    assert!(
        !session_state.port_access_tcp_streams.contains_key(&59),
        "stream state should be released after request-window exhaustion",
    );
    match tcp_receiver
        .try_recv()
        .expect("tcp transport should be terminated after window exhaustion")
    {
        PortAccessTcpCommand::Terminate => {}
        command => panic!("unexpected tcp command: {command:?}"),
    }
}

#[tokio::test]
async fn bootstrap_disconnect_terminates_active_port_access_tcp_streams() {
    let (tunnel_writer_sender, _tunnel_writer_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (event_sender, _event_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (tcp_sender, mut tcp_receiver) =
        tokio::sync::mpsc::unbounded_channel::<PortAccessTcpCommand>();
    let clock = SystemClock;
    let mut session_state = TunnelSessionMutableState {
        agent_endpoint_url: None,
        runtime_env: BTreeMap::new(),
        telemetry_relay: TelemetryRelay::default(),
        pending_signing_requests: BTreeMap::new(),
        pending_egress_token_requests: BTreeMap::new(),
        pending_agent_opens: BTreeMap::new(),
        pending_exec_opens: BTreeMap::new(),
        agent_streams: BTreeMap::new(),
        port_access_http_streams: BTreeMap::new(),
        port_access_tcp_streams: BTreeMap::from([(
            60,
            PortAccessTcpStreamState {
                sender: tcp_sender,
                request_window: StreamSendWindow::default(),
                request_closed: false,
                response_closed: false,
            },
        )]),
        process_streams: ProcessStreamState::default(),
        file_search_streams: BTreeMap::new(),
        operation_stream_requested: false,
        operation_stream_close_requested: false,
        operation_stream_close_response_sender: None,
        operation_stream_send_window: None,
        pending_operation_records: Default::default(),
        file_uploads: BTreeMap::new(),
    };
    let supervisor_handle = test_tunnel_supervisor_handle("sbi_test", Arc::new(SystemClock));
    let context = TunnelSessionLoopContext {
        attachment_root: std::path::Path::new("/tmp"),
        cgroup_root: std::path::Path::new("/tmp"),
        sandbox_instance_id: "sbi_test",
        gateway_ws_url: "ws://127.0.0.1:3300/bootstrap",
        clock: &clock,
        platform_process_registry: crate::process::PlatformProcessRegistry::default(),
        supervisor_handle: &supervisor_handle,
    };

    let control_flow = handle_tunnel_session_event(
        TunnelSessionEvent::BootstrapClosed {
            is_gateway_service_restart: true,
            reason: Some("test bootstrap disconnect".to_string()),
        },
        &tunnel_writer_sender,
        &event_sender,
        &context,
        &mut session_state,
    )
    .await
    .expect("bootstrap disconnect should be handled");

    assert!(matches!(
        control_flow,
        TunnelSessionControlFlow::RestartRequired
    ));
    assert!(
        session_state.port_access_tcp_streams.is_empty(),
        "bootstrap disconnect should release tcp stream state",
    );
    match tcp_receiver
        .try_recv()
        .expect("tcp transport should receive terminate on bootstrap disconnect")
    {
        PortAccessTcpCommand::Terminate => {}
        command => panic!("unexpected tcp command: {command:?}"),
    }
}

#[tokio::test]
async fn ordinary_bootstrap_disconnect_requests_shutdown_without_reconnect() {
    let (tunnel_writer_sender, _tunnel_writer_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (event_sender, _event_receiver) = tokio::sync::mpsc::unbounded_channel();
    let clock = SystemClock;
    let mut session_state = empty_tunnel_session_state();
    let supervisor_handle = test_tunnel_supervisor_handle("sbi_test", Arc::new(SystemClock));
    let context = TunnelSessionLoopContext {
        attachment_root: std::path::Path::new("/tmp"),
        cgroup_root: std::path::Path::new("/tmp"),
        sandbox_instance_id: "sbi_test",
        gateway_ws_url: "ws://127.0.0.1:3300/bootstrap",
        clock: &clock,
        platform_process_registry: crate::process::PlatformProcessRegistry::default(),
        supervisor_handle: &supervisor_handle,
    };

    let control_flow = handle_tunnel_session_event(
        TunnelSessionEvent::BootstrapClosed {
            is_gateway_service_restart: false,
            reason: Some("provider timeout".to_string()),
        },
        &tunnel_writer_sender,
        &event_sender,
        &context,
        &mut session_state,
    )
    .await
    .expect("ordinary bootstrap disconnect should be handled");

    assert!(matches!(
        control_flow,
        TunnelSessionControlFlow::ShutdownRequested
    ));
}

#[tokio::test]
async fn emits_agent_stream_summary_when_gateway_closes_stream() {
    let (tunnel_writer_sender, mut tunnel_writer_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (event_sender, _event_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (agent_sender, mut agent_receiver) = tokio::sync::mpsc::unbounded_channel();
    let clock = FixedClock { now_ms: 1_500 };
    let mut stats = AgentStreamStats::new(500);
    stats.record_outbound_message(256, 700, 256);
    stats.record_credit_restore(256, 900);
    stats.record_outbound_message(128, 1_000, 128);
    stats.record_inbound_message(64);
    let mut session_state = TunnelSessionMutableState {
        agent_endpoint_url: None,
        runtime_env: BTreeMap::new(),
        telemetry_relay: TelemetryRelay::default(),
        pending_signing_requests: BTreeMap::new(),
        pending_egress_token_requests: BTreeMap::new(),
        pending_agent_opens: BTreeMap::new(),
        pending_exec_opens: BTreeMap::new(),
        agent_streams: BTreeMap::from([(
            7,
            AgentStreamState {
                sender: agent_sender,
                send_window: StreamSendWindow::new(AGENT_STREAM_WINDOW_BYTES),
                stats,
            },
        )]),
        port_access_http_streams: BTreeMap::new(),
        port_access_tcp_streams: BTreeMap::new(),
        process_streams: ProcessStreamState::default(),
        file_search_streams: BTreeMap::new(),
        operation_stream_requested: false,
        operation_stream_close_requested: false,
        operation_stream_close_response_sender: None,
        operation_stream_send_window: None,
        pending_operation_records: Default::default(),
        file_uploads: BTreeMap::new(),
    };
    enable_test_telemetry(&mut session_state.telemetry_relay);
    let supervisor_handle = test_tunnel_supervisor_handle("sbi_test", Arc::new(SystemClock));
    let context = TunnelSessionLoopContext {
        attachment_root: std::path::Path::new("/tmp"),
        cgroup_root: std::path::Path::new("/tmp"),
        sandbox_instance_id: "sbi_test",
        gateway_ws_url: "ws://127.0.0.1:3300/bootstrap",
        clock: &clock,
        platform_process_registry: crate::process::PlatformProcessRegistry::default(),
        supervisor_handle: &supervisor_handle,
    };
    let close_message = parse_stream_control_message(r#"{"type":"stream.close","streamId":7}"#)
        .expect("stream.close should parse");

    handle_tunnel_control_message(
        &tunnel_writer_sender,
        &event_sender,
        close_message,
        &context,
        &mut session_state,
    )
    .await
    .expect("gateway close should succeed");

    let telemetry_log = read_queued_telemetry_log_line(&mut tunnel_writer_receiver).await;
    assert_eq!(
        telemetry_log,
        json!({
            "timestamp": "1970-01-01T00:00:01.5Z",
            "level": "info",
            "event": "agent_stream_summary",
            "streamId": 7,
            "channelKind": "agent",
            "outcome": "closed",
            "closeSource": "gateway",
            "durationMs": 1000,
            "messageCountOut": 2,
            "messageCountIn": 1,
            "totalBytesOut": 384,
            "totalBytesIn": 64,
            "maxMessageBytesOut": 256,
            "maxMessageBytesIn": 64,
            "maxOutstandingBytes": 256,
            "avgCreditReturnMs": 200,
            "creditReturnCount": 1,
            "resetCode": null,
            "reason": null
        })
    );
    assert!(session_state.agent_streams.is_empty());
    let forwarded_close = agent_receiver
        .recv()
        .await
        .expect("runtime close should be forwarded");
    assert_eq!(forwarded_close, Message::Close(None));
}

#[tokio::test]
async fn resets_and_releases_agent_stream_after_invalid_gateway_payload_kind() {
    let (tunnel_writer_sender, mut tunnel_writer_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (agent_sender, mut agent_receiver) = tokio::sync::mpsc::unbounded_channel();
    let clock = FixedClock { now_ms: 1_200 };
    let mut session_state = empty_tunnel_session_state();
    session_state.agent_streams.insert(
        74,
        AgentStreamState {
            sender: agent_sender,
            send_window: StreamSendWindow::new(AGENT_STREAM_WINDOW_BYTES),
            stats: AgentStreamStats::new(1_000),
        },
    );
    enable_test_telemetry(&mut session_state.telemetry_relay);

    handle_tunnel_binary_frame(
        &tunnel_writer_sender,
        StreamDataFrame {
            stream_id: 74,
            payload_kind: PAYLOAD_KIND_RAW_BYTES,
            payload: b"not websocket data".to_vec(),
        },
        &mut session_state,
        &clock,
    )
    .expect("invalid agent stream payload should reset without failing the tunnel");

    assert_eq!(
        read_queued_telemetry_log_line(&mut tunnel_writer_receiver).await,
        json!({
            "timestamp": "1970-01-01T00:00:01.2Z",
            "level": "info",
            "event": "agent_stream_summary",
            "streamId": 74,
            "channelKind": "agent",
            "outcome": "reset",
            "closeSource": "gateway",
            "durationMs": 200,
            "messageCountOut": 0,
            "messageCountIn": 0,
            "totalBytesOut": 0,
            "totalBytesIn": 0,
            "maxMessageBytesOut": 0,
            "maxMessageBytesIn": 0,
            "maxOutstandingBytes": 0,
            "avgCreditReturnMs": null,
            "creditReturnCount": 0,
            "resetCode": "invalid_stream_data",
            "reason": "agent stream only accepts websocket text or binary payload kinds"
        })
    );
    assert_eq!(
        read_writer_text_json(&mut tunnel_writer_receiver).await,
        json!({
            "type": "stream.reset",
            "streamId": 74,
            "code": "invalid_stream_data",
            "message": "agent stream only accepts websocket text or binary payload kinds"
        })
    );
    assert!(session_state.agent_streams.is_empty());
    assert_eq!(
        agent_receiver
            .recv()
            .await
            .expect("runtime stream should receive close after gateway reset"),
        Message::Close(None)
    );
}

#[tokio::test]
async fn emits_window_exhausted_and_summary_telemetry_for_agent_stream() {
    let (tunnel_writer_sender, mut tunnel_writer_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (event_sender, _event_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (agent_sender, _agent_receiver) = tokio::sync::mpsc::unbounded_channel();
    let clock = FixedClock { now_ms: 1_200 };
    let mut session_state = TunnelSessionMutableState {
        agent_endpoint_url: None,
        runtime_env: BTreeMap::new(),
        telemetry_relay: TelemetryRelay::default(),
        pending_signing_requests: BTreeMap::new(),
        pending_egress_token_requests: BTreeMap::new(),
        pending_agent_opens: BTreeMap::new(),
        pending_exec_opens: BTreeMap::new(),
        agent_streams: BTreeMap::from([(
            7,
            AgentStreamState {
                sender: agent_sender,
                send_window: StreamSendWindow::new(1),
                stats: AgentStreamStats::new(200),
            },
        )]),
        port_access_http_streams: BTreeMap::new(),
        port_access_tcp_streams: BTreeMap::new(),
        process_streams: ProcessStreamState::default(),
        file_search_streams: BTreeMap::new(),
        operation_stream_requested: false,
        operation_stream_close_requested: false,
        operation_stream_close_response_sender: None,
        operation_stream_send_window: None,
        pending_operation_records: Default::default(),
        file_uploads: BTreeMap::new(),
    };
    enable_test_telemetry(&mut session_state.telemetry_relay);
    let supervisor_handle = test_tunnel_supervisor_handle("sbi_test", Arc::new(SystemClock));
    let context = TunnelSessionLoopContext {
        attachment_root: std::path::Path::new("/tmp"),
        cgroup_root: std::path::Path::new("/tmp"),
        sandbox_instance_id: "sbi_test",
        gateway_ws_url: "ws://127.0.0.1:3300/bootstrap",
        clock: &clock,
        platform_process_registry: crate::process::PlatformProcessRegistry::default(),
        supervisor_handle: &supervisor_handle,
    };

    handle_tunnel_session_event(
        TunnelSessionEvent::AgentMessage {
            stream_id: 7,
            message: Message::Text("too big".to_string().into()),
        },
        &tunnel_writer_sender,
        &event_sender,
        &context,
        &mut session_state,
    )
    .await
    .expect("window exhaustion should still produce a reset");

    let exhaustion_log = read_queued_telemetry_log_line(&mut tunnel_writer_receiver).await;
    assert_eq!(
        exhaustion_log,
        json!({
            "timestamp": "1970-01-01T00:00:01.2Z",
            "level": "warn",
            "event": "agent_stream_window_exhausted",
            "streamId": 7,
            "channelKind": "agent",
            "payloadKind": "websocket_text",
            "payloadBytes": 7,
            "availableBytes": 1,
            "outstandingBytes": AGENT_STREAM_WINDOW_BYTES - 1,
            "maxWindowBytes": AGENT_STREAM_WINDOW_BYTES,
            "payloadExceedsMaxWindow": false,
            "payloadExceedsAvailableWindow": true,
            "messageCountOut": 0,
            "streamAgeMs": 1000,
            "oldestUnackedMs": null
        })
    );

    let summary_log = read_queued_telemetry_log_line(&mut tunnel_writer_receiver).await;
    assert_eq!(
        summary_log,
        json!({
            "timestamp": "1970-01-01T00:00:01.2Z",
            "level": "info",
            "event": "agent_stream_summary",
            "streamId": 7,
            "channelKind": "agent",
            "outcome": "reset",
            "closeSource": "runtime",
            "durationMs": 1000,
            "messageCountOut": 0,
            "messageCountIn": 0,
            "totalBytesOut": 0,
            "totalBytesIn": 0,
            "maxMessageBytesOut": 0,
            "maxMessageBytesIn": 0,
            "maxOutstandingBytes": 0,
            "avgCreditReturnMs": null,
            "creditReturnCount": 0,
            "resetCode": "stream_window_exhausted",
            "reason": "agent stream send window is exhausted"
        })
    );

    let reset_message = tunnel_writer_receiver
        .recv()
        .await
        .expect("stream reset should be queued");
    let TunnelWriterMessage::Text(payload) = reset_message else {
        panic!("expected a stream.reset control message");
    };
    assert_eq!(
        serde_json::from_str::<Value>(&payload).expect("reset payload should be json"),
        json!({
            "type": "stream.reset",
            "streamId": 7,
            "code": "stream_window_exhausted",
            "message": "agent stream send window is exhausted"
        })
    );
    assert!(session_state.agent_streams.is_empty());
}

fn insert_test_file_upload_stream(
    session_state: &mut TunnelSessionMutableState,
    stream_id: u32,
    directory_path: &std::path::Path,
    size_bytes: usize,
) -> PathBuf {
    let temp_path = directory_path.join(format!(".att_test_{stream_id}.part"));
    let file = fs::File::create(&temp_path).expect("temporary upload file should be created");
    session_state.file_uploads.insert(
        stream_id,
        FileUploadState {
            attachment_id: format!("att_test_{stream_id}"),
            thread_directory_path: directory_path.to_path_buf(),
            thread_id: "thread_test".to_string(),
            mime_type: "application/octet-stream".to_string(),
            original_filename: "upload.bin".to_string(),
            size_bytes,
            temp_path: temp_path.clone(),
            file,
            received_bytes: 0,
        },
    );
    temp_path
}

#[tokio::test]
async fn invalid_file_upload_payload_resets_and_removes_partial_file() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let (tunnel_writer_sender, mut tunnel_writer_receiver) = tokio::sync::mpsc::unbounded_channel();
    let mut session_state = empty_tunnel_session_state();
    let temp_path = insert_test_file_upload_stream(&mut session_state, 75, temp_dir.path(), 4);

    handle_tunnel_binary_frame(
        &tunnel_writer_sender,
        StreamDataFrame {
            stream_id: 75,
            payload_kind: PAYLOAD_KIND_WEBSOCKET_BINARY,
            payload: b"pong".to_vec(),
        },
        &mut session_state,
        &SystemClock,
    )
    .expect("invalid upload payload kind should reset without failing the tunnel");

    assert_eq!(
        read_writer_text_json(&mut tunnel_writer_receiver).await,
        json!({
            "type": "stream.reset",
            "streamId": 75,
            "code": "invalid_stream_data",
            "message": "file upload stream only accepts raw byte payloads"
        })
    );
    assert!(
        !session_state.file_uploads.contains_key(&75),
        "invalid upload payloads should release upload state",
    );
    assert!(
        !temp_path.exists(),
        "invalid upload payloads should remove the partial file",
    );
}

#[tokio::test]
async fn oversized_file_upload_payload_resets_and_removes_partial_file() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
    let (tunnel_writer_sender, mut tunnel_writer_receiver) = tokio::sync::mpsc::unbounded_channel();
    let mut session_state = empty_tunnel_session_state();
    let temp_path = insert_test_file_upload_stream(&mut session_state, 76, temp_dir.path(), 4);

    handle_tunnel_binary_frame(
        &tunnel_writer_sender,
        StreamDataFrame {
            stream_id: 76,
            payload_kind: PAYLOAD_KIND_RAW_BYTES,
            payload: b"hello".to_vec(),
        },
        &mut session_state,
        &SystemClock,
    )
    .expect("oversized upload payload should reset without failing the tunnel");

    assert_eq!(
        read_writer_text_json(&mut tunnel_writer_receiver).await,
        json!({
            "type": "stream.reset",
            "streamId": 76,
            "code": "byte_count_exceeded",
            "message": "received more bytes than declared by the upload metadata"
        })
    );
    assert!(
        !session_state.file_uploads.contains_key(&76),
        "oversized upload payloads should release upload state",
    );
    assert!(
        !temp_path.exists(),
        "oversized upload payloads should remove the partial file",
    );
}
