use crate::tunnel::protocol::serialize::serialize_json;
use crate::tunnel::protocol::{
    BootstrapTelemetryControlMessage, EgressTokenControlMessage, EgressTokenRequest,
    FileSearchResultKind, FileSearchStreamMessage, FileUploadCompletedEventInput,
    PAYLOAD_KIND_RAW_BYTES, PAYLOAD_KIND_WEBSOCKET_TEXT, ProcessesStreamMessage, PtyControlMessage,
    PtySessionControlMessage, SigningControlMessage, SigningRequest, StreamControlMessage,
    StreamSendWindow, decode_stream_data_frame, egress_token_request, encode_stream_data_frame,
    exec_result_event, file_upload_completed_event, parse_bootstrap_telemetry_control_message,
    parse_egress_token_control_message, parse_file_search_stream_message,
    parse_ports_control_message, parse_ports_transport_message, parse_processes_stream_message,
    parse_pty_control_message, parse_pty_session_control_message, parse_signing_control_message,
    parse_stream_control_message, ports_target_authorize_failure_result,
    ports_target_authorize_success_result, pty_exit_event, signing_request, stream_complete,
    stream_open_error, stream_open_ok, stream_reset, stream_window, telemetry_close,
    telemetry_open,
};

#[test]
fn parses_valid_stream_opens() {
    let agent = parse_stream_control_message(
        r#"{"type":"stream.open","streamId":7,"channel":{"kind":"agent"}}"#,
    )
    .expect("agent stream.open should parse");
    assert!(matches!(agent, StreamControlMessage::OpenAgent(_)));

    let processes = parse_stream_control_message(
        r#"{"type":"stream.open","streamId":11,"channel":{"kind":"processes"}}"#,
    )
    .expect("processes stream.open should parse");
    assert!(matches!(processes, StreamControlMessage::OpenProcesses(_)));

    let upload = parse_stream_control_message(
        r#"{"type":"stream.open","streamId":7,"channel":{"kind":"fileUpload","threadId":"thread_123","mimeType":"image/png","originalFilename":"image.png","sizeBytes":8}}"#,
    )
    .expect("file upload stream.open should parse");
    assert!(matches!(upload, StreamControlMessage::OpenFileUpload(_)));

    let exec = parse_stream_control_message(
        r#"{"type":"stream.open","streamId":8,"channel":{"kind":"exec","command":"git","args":["status","--short"],"cwd":"/workspace/repo","stdin":"prompt text","timeoutMs":15000,"maxOutputBytes":65536}}"#,
    )
    .expect("exec stream.open should parse");
    assert!(matches!(exec, StreamControlMessage::OpenExec(_)));

    let file_search = parse_stream_control_message(
        r#"{"type":"stream.open","streamId":31,"channel":{"kind":"fileSearch","cwd":"/workspace/repo"}}"#,
    )
    .expect("file search stream.open should parse");
    assert!(matches!(
        file_search,
        StreamControlMessage::OpenFileSearch(_)
    ));
}

#[test]
fn ignores_unknown_fields_while_parsing_protocol_messages() {
    let stream_open = parse_stream_control_message(
        r#"{"type":"stream.open","streamId":8,"ignored":true,"channel":{"kind":"exec","command":"git","args":["status"],"cwd":"/workspace/repo","ignored":true}}"#,
    )
    .expect("stream.open should parse with unknown fields");
    let StreamControlMessage::OpenExec(exec) = stream_open else {
        panic!("expected exec stream.open");
    };
    assert_eq!(exec.stream_id, 8);
    assert_eq!(exec.channel.command, "git");
    assert_eq!(exec.channel.cwd.as_deref(), Some("/workspace/repo"));

    let stream_signal = parse_stream_control_message(
        r#"{"type":"stream.signal","streamId":9,"ignored":true,"signal":{"type":"pty.resize","cols":120,"rows":40,"ignored":true}}"#,
    )
    .expect("stream.signal should parse with unknown fields");
    let StreamControlMessage::Signal(signal) = stream_signal else {
        panic!("expected pty stream.signal");
    };
    assert_eq!(signal.signal.cols, 120);
    assert_eq!(signal.signal.rows, 40);

    let processes_snapshot = parse_processes_stream_message(
        r#"{"type":"processes.snapshot","observedAt":"2026-04-10T00:00:00Z","ignored":true,"processes":[{"pid":7,"command":"node server","ignored":true,"listeners":[{"port":5173,"bindAddress":"127.0.0.1","ignored":true}]}]}"#,
    )
    .expect("processes.snapshot should parse with unknown fields");
    let ProcessesStreamMessage::Snapshot(snapshot) = processes_snapshot else {
        panic!("expected processes snapshot");
    };
    assert_eq!(snapshot.processes[0].pid, 7);
    assert_eq!(snapshot.processes[0].listeners[0].port, 5173);

    let file_search_query = parse_file_search_stream_message(
        r#"{"type":"fileSearch.query","requestId":"file_search_req_123","query":"protocol","limit":20,"ignored":true}"#,
    )
    .expect("fileSearch.query should parse with unknown fields");
    let FileSearchStreamMessage::Query(query) = file_search_query else {
        panic!("expected fileSearch query");
    };
    assert_eq!(query.request_id, "file_search_req_123");
    assert_eq!(query.limit, Some(20));

    let ports_open = parse_ports_transport_message(
        r#"{"type":"ports.http.open","streamId":41,"ignored":true,"target":{"kind":"port","port":5173,"ignored":true},"upstreamProtocol":"https","request":{"method":"GET","path":"/src/main.ts","query":"import=1","headers":{"accept":["text/plain"]},"ignored":true}}"#,
    )
    .expect("ports.http.open should parse with unknown fields");
    let Some(crate::tunnel::protocol::PortsTransportMessage::HttpOpen(http_open)) = ports_open
    else {
        panic!("expected ports.http.open");
    };
    assert_eq!(http_open.stream_id, 41);
    assert_eq!(http_open.request.path, "/src/main.ts");

    let pty_open = parse_pty_session_control_message(
        r#"{"type":"pty.session.open","requestId":"pty_open_req_123","ptySessionId":"pty_123","transportUrl":"wss://gateway.example.com/pty","transportToken":"jwt-token","ignored":true,"launch":{"session":"create","cols":120,"rows":40,"cwd":"/workspace/repo","command":"codex","args":["resume","thread_123"],"ignored":true}}"#,
    )
    .expect("pty.session.open should parse with unknown fields");
    assert!(matches!(pty_open, Some(PtySessionControlMessage::Open(_))));
}

#[test]
fn parses_valid_pty_control_messages() {
    let message = parse_pty_control_message(
        r#"{"type":"stream.signal","streamId":7,"signal":{"type":"pty.resize","cols":80,"rows":24}}"#,
    )
    .expect("pty stream.signal should parse");

    assert!(matches!(message, PtyControlMessage::Signal(_)));
}

#[test]
fn parses_valid_processes_stream_messages() {
    let refresh = parse_processes_stream_message(r#"{"type":"processes.refresh"}"#)
        .expect("processes.refresh should parse");
    assert!(matches!(refresh, ProcessesStreamMessage::Refresh(_)));

    let snapshot = parse_processes_stream_message(
        r#"{"type":"processes.snapshot","observedAt":"2026-04-10T00:00:00Z","processes":[{"pid":7,"command":"node server","listeners":[{"port":5173,"bindAddress":"127.0.0.1"}]}]}"#,
    )
    .expect("processes.snapshot should parse");
    assert!(matches!(snapshot, ProcessesStreamMessage::Snapshot(_)));
}

#[test]
fn parses_valid_file_search_stream_messages() {
    let query = parse_file_search_stream_message(
        r#"{"type":"fileSearch.query","requestId":"file_search_req_123","query":"src tunnel","limit":20}"#,
    )
    .expect("fileSearch.query should parse");
    let FileSearchStreamMessage::Query(query) = query else {
        panic!("expected fileSearch query");
    };
    assert_eq!(query.request_id, "file_search_req_123");
    assert_eq!(query.query, "src tunnel");
    assert_eq!(query.limit, Some(20));

    let empty_query = parse_file_search_stream_message(
        r#"{"type":"fileSearch.query","requestId":"file_search_req_123","query":""}"#,
    )
    .expect("empty fileSearch.query should parse");
    let FileSearchStreamMessage::Query(empty_query) = empty_query else {
        panic!("expected fileSearch query");
    };
    assert_eq!(empty_query.query, "");
    assert_eq!(empty_query.limit, None);

    let results = parse_file_search_stream_message(
        r#"{"type":"fileSearch.results","requestId":"file_search_req_123","query":"protocol","items":[{"path":"packages/sandbox-session-protocol/src/stream-protocol.ts","kind":"file"},{"path":"packages/sandboxd/src/tunnel","kind":"directory"}]}"#,
    )
    .expect("fileSearch.results should parse");
    let FileSearchStreamMessage::Results(results) = results else {
        panic!("expected fileSearch results");
    };
    assert_eq!(results.items.len(), 2);
    assert_eq!(results.items[0].kind, FileSearchResultKind::File);
    assert_eq!(results.items[1].kind, FileSearchResultKind::Directory);

    let error = parse_file_search_stream_message(
        r#"{"type":"fileSearch.error","requestId":"file_search_req_123","code":"search_failed","message":"file search failed"}"#,
    )
    .expect("fileSearch.error should parse");
    assert!(matches!(error, FileSearchStreamMessage::Error(_)));

    let select = parse_file_search_stream_message(
        r#"{"type":"fileSearch.select","query":"protocol","path":"packages/sandbox-session-protocol/src/stream-protocol.ts"}"#,
    )
    .expect("fileSearch.select should parse");
    assert!(matches!(select, FileSearchStreamMessage::Select(_)));
}

#[test]
fn rejects_invalid_file_search_stream_messages() {
    let invalid_limit = parse_file_search_stream_message(
        r#"{"type":"fileSearch.query","requestId":"file_search_req_123","query":"protocol","limit":0}"#,
    );
    assert!(
        invalid_limit
            .expect_err("zero fileSearch.query limit should fail validation")
            .to_string()
            .contains("fileSearch.query limit must be a positive integer")
    );

    let invalid_result_kind = parse_file_search_stream_message(
        r#"{"type":"fileSearch.results","requestId":"file_search_req_123","query":"protocol","items":[{"path":"packages/sandbox-session-protocol/src/stream-protocol.ts","kind":"symlink"}]}"#,
    );
    assert!(
        invalid_result_kind
            .expect_err("invalid fileSearch.results item kind should fail parsing")
            .to_string()
            .contains("unknown variant")
    );

    let invalid_open = parse_stream_control_message(
        r#"{"type":"stream.open","streamId":31,"channel":{"kind":"fileSearch","cwd":""}}"#,
    );
    assert!(
        invalid_open
            .expect_err("empty fileSearch cwd should fail validation")
            .to_string()
            .contains("file search stream.open request channel.cwd is required")
    );
}

#[test]
fn parses_valid_ports_control_messages() {
    let authorize = parse_ports_control_message(
        r#"{"type":"ports.target.authorize","requestId":"req_port_access_1","target":{"kind":"port","port":5173}}"#,
    )
    .expect("ports.target.authorize should parse");
    assert!(matches!(
        authorize,
        Some(crate::tunnel::protocol::PortsControlMessage::TargetAuthorize(_))
    ));
}

#[test]
fn parses_valid_ports_tcp_transport_messages() {
    let tcp_open = parse_ports_transport_message(
        r#"{"type":"ports.tcp.open","streamId":61,"target":{"kind":"port","port":5173},"upstreamProtocol":"https"}"#,
    )
    .expect("ports.tcp.open should parse");
    assert!(matches!(
        tcp_open,
        Some(crate::tunnel::protocol::PortsTransportMessage::TcpOpen(_))
    ));

    let connected =
        parse_ports_transport_message(r#"{"type":"ports.tcp.connected","streamId":61}"#)
            .expect("ports.tcp.connected should parse");
    assert!(matches!(
        connected,
        Some(crate::tunnel::protocol::PortsTransportMessage::TcpConnected(_))
    ));

    let close = parse_ports_transport_message(
        r#"{"type":"ports.tcp.close","streamId":61,"direction":"request"}"#,
    )
    .expect("ports.tcp.close should parse");
    assert!(matches!(
        close,
        Some(crate::tunnel::protocol::PortsTransportMessage::TcpClose(_))
    ));

    let error = parse_ports_transport_message(
        r#"{"type":"ports.tcp.error","streamId":61,"code":"upstream_connect_failed","message":"target refused connection"}"#,
    )
    .expect("ports.tcp.error should parse");
    assert!(matches!(
        error,
        Some(crate::tunnel::protocol::PortsTransportMessage::TcpError(_))
    ));
}

#[test]
fn rejects_invalid_ports_tcp_transport_messages() {
    let unsupported_protocol = parse_ports_transport_message(
        r#"{"type":"ports.tcp.open","streamId":61,"target":{"kind":"port","port":5173},"upstreamProtocol":"ftp"}"#,
    );
    assert!(
        unsupported_protocol
            .expect_err("unsupported protocol should fail validation")
            .to_string()
            .contains("ports.tcp.open upstreamProtocol must be 'http' or 'https'")
    );

    let invalid_target_kind = parse_ports_transport_message(
        r#"{"type":"ports.tcp.open","streamId":61,"target":{"kind":"host","port":5173},"upstreamProtocol":"http"}"#,
    );
    assert!(
        invalid_target_kind
            .expect_err("invalid target kind should fail validation")
            .to_string()
            .contains("ports target kind must be 'port'")
    );

    let invalid_target_port = parse_ports_transport_message(
        r#"{"type":"ports.tcp.open","streamId":61,"target":{"kind":"port","port":0},"upstreamProtocol":"http"}"#,
    );
    assert!(
        invalid_target_port
            .expect_err("invalid target port should fail validation")
            .to_string()
            .contains("ports target port must be greater than zero")
    );

    let invalid_direction = parse_ports_transport_message(
        r#"{"type":"ports.tcp.close","streamId":61,"direction":"both"}"#,
    );
    assert!(
        invalid_direction
            .expect_err("invalid direction should fail validation")
            .to_string()
            .contains("ports.tcp.close direction must be 'request' or 'response'")
    );
}

#[test]
fn parses_valid_ports_http_transport_messages() {
    let http_open = parse_ports_transport_message(
        r#"{"type":"ports.http.open","streamId":41,"target":{"kind":"port","port":5173},"upstreamProtocol":"https","request":{"method":"GET","path":"/src/main.ts","query":"import=1","headers":{"accept":["text/plain"]}}}"#,
    )
    .expect("ports.http.open should parse");
    assert!(matches!(
        http_open,
        Some(crate::tunnel::protocol::PortsTransportMessage::HttpOpen(_))
    ));

    let response_start = parse_ports_transport_message(
        r#"{"type":"ports.http.response.start","streamId":41,"status":200,"headers":{"content-type":["text/plain"]}}"#,
    )
    .expect("ports.http.response.start should parse");
    assert!(matches!(
        response_start,
        Some(crate::tunnel::protocol::PortsTransportMessage::HttpResponseStart(_))
    ));

    let body_chunk = parse_ports_transport_message(
        r#"{"type":"ports.http.body.chunk","streamId":41,"direction":"response","bytes":"SGVsbG8=","encoding":"base64"}"#,
    )
    .expect("ports.http.body.chunk should parse");
    assert!(matches!(
        body_chunk,
        Some(crate::tunnel::protocol::PortsTransportMessage::HttpBodyChunk(_))
    ));

    let body_end = parse_ports_transport_message(
        r#"{"type":"ports.http.body.end","streamId":41,"direction":"response"}"#,
    )
    .expect("ports.http.body.end should parse");
    assert!(matches!(
        body_end,
        Some(crate::tunnel::protocol::PortsTransportMessage::HttpBodyEnd(
            _
        ))
    ));

    let stream_close =
        parse_ports_transport_message(r#"{"type":"ports.stream.close","streamId":41}"#)
            .expect("ports.stream.close should parse");
    assert!(matches!(
        stream_close,
        Some(crate::tunnel::protocol::PortsTransportMessage::StreamClose(
            _
        ))
    ));

    let stream_error = parse_ports_transport_message(
        r#"{"type":"ports.stream.error","streamId":41,"code":"upstream_io_error","message":"upstream closed early"}"#,
    )
    .expect("ports.stream.error should parse");
    assert!(matches!(
        stream_error,
        Some(crate::tunnel::protocol::PortsTransportMessage::StreamError(
            _
        ))
    ));
}

#[test]
fn parses_valid_signing_control_messages() {
    let request = parse_signing_control_message(
        r#"{"type":"signing.request","requestId":"sign_req_123","organizationId":"org_123","sandboxInstanceId":"sbi_123","actingUserId":"usr_123","providerFamily":"github","integrationConnectionId":"icn_github","format":"ssh","keyRef":"key::ssh-ed25519 AAAA","grant":"grant-token","payload":"c2lnbi1tZQ==","encoding":"base64"}"#,
    )
    .expect("signing.request should parse");
    assert!(matches!(request, Some(SigningControlMessage::Request(_))));

    let request_without_connection_id = parse_signing_control_message(
        r#"{"type":"signing.request","requestId":"sign_req_123","organizationId":"org_123","sandboxInstanceId":"sbi_123","actingUserId":"usr_123","providerFamily":"github","format":"ssh","keyRef":"key::ssh-ed25519 AAAA","grant":"grant-token","payload":"c2lnbi1tZQ==","encoding":"base64"}"#,
    )
    .expect("signing.request without integrationConnectionId should parse");
    assert!(matches!(
        request_without_connection_id,
        Some(SigningControlMessage::Request(_))
    ));

    let result = parse_signing_control_message(
        r#"{"type":"signing.result","requestId":"sign_req_123","ok":false,"code":"signing_backend_not_implemented","message":"Git signing backend is not implemented yet."}"#,
    )
    .expect("signing.result should parse");
    assert!(matches!(
        result,
        Some(SigningControlMessage::ResultFailure(_))
    ));
}

#[test]
fn parses_valid_egress_token_control_messages() {
    let request = parse_egress_token_control_message(
        r#"{"type":"egress.token.request","requestId":"egress_token_req_123"}"#,
    )
    .expect("egress.token.request should parse");
    assert!(matches!(
        request,
        Some(EgressTokenControlMessage::Request(_))
    ));

    let response = parse_egress_token_control_message(
        r#"{"type":"egress.token.response","requestId":"egress_token_req_123","token":"jwt-token","expiresAt":"2026-05-17T00:05:00Z","ttlMs":300000}"#,
    )
    .expect("egress.token.response should parse");
    assert!(matches!(
        response,
        Some(EgressTokenControlMessage::Response(_))
    ));

    let error = parse_egress_token_control_message(
        r#"{"type":"egress.token.error","requestId":"egress_token_req_123","code":"invalid_sandbox_state","message":"Sandbox instance is not active."}"#,
    )
    .expect("egress.token.error should parse");
    assert!(matches!(error, Some(EgressTokenControlMessage::Error(_))));
}

#[test]
fn rejects_invalid_egress_token_errors() {
    let invalid_code = parse_egress_token_control_message(
        r#"{"type":"egress.token.error","requestId":"egress_token_req_123","code":"not_in_contract","message":"Nope."}"#,
    );

    assert!(
        invalid_code
            .expect_err("invalid error code should fail validation")
            .to_string()
            .contains("egress.token.error code is invalid")
    );
}

#[test]
fn parses_valid_pty_session_control_messages() {
    let open = parse_pty_session_control_message(
        r#"{"type":"pty.session.open","requestId":"pty_open_req_123","ptySessionId":"pty_123","transportUrl":"wss://gateway.example.com/pty","transportToken":"jwt-token","launch":{"session":"create","cols":120,"rows":40,"cwd":"/workspace/repo","command":"codex","args":["resume","thread_123"]}}"#,
    )
    .expect("pty.session.open should parse");
    assert!(matches!(open, Some(PtySessionControlMessage::Open(_))));

    let opened = parse_pty_session_control_message(
        r#"{"type":"pty.session.opened","requestId":"pty_open_req_123","ptySessionId":"pty_123"}"#,
    )
    .expect("pty.session.opened should parse");
    assert!(matches!(opened, Some(PtySessionControlMessage::Opened(_))));

    let error = parse_pty_session_control_message(
        r#"{"type":"pty.session.error","requestId":"pty_open_req_123","ptySessionId":"pty_123","code":"transport_connect_failed","message":"gateway websocket failed"}"#,
    )
    .expect("pty.session.error should parse");
    assert!(matches!(error, Some(PtySessionControlMessage::Error(_))));
}

#[test]
fn rejects_invalid_pty_session_control_messages() {
    let invalid_transport_url = parse_pty_session_control_message(
        r#"{"type":"pty.session.open","requestId":"pty_open_req_123","ptySessionId":"pty_123","transportUrl":"https://gateway.example.com/pty","transportToken":"jwt-token","launch":{"session":"create","cols":120,"rows":40}}"#,
    );
    assert!(
        invalid_transport_url
            .expect_err("invalid transport url should fail validation")
            .to_string()
            .contains("pty.session.open transportUrl must use ws or wss")
    );

    let invalid_error_code = parse_pty_session_control_message(
        r#"{"type":"pty.session.error","requestId":"pty_open_req_123","ptySessionId":"pty_123","code":"not_in_contract","message":"Nope."}"#,
    );
    assert!(
        invalid_error_code
            .expect_err("invalid error code should fail validation")
            .to_string()
            .contains("pty.session.error code is invalid")
    );
}

#[test]
fn round_trips_data_frames() {
    let encoded = encode_stream_data_frame(9, PAYLOAD_KIND_WEBSOCKET_TEXT, b"hello")
        .expect("frame should encode");
    let decoded = decode_stream_data_frame(&encoded).expect("frame should decode");

    assert_eq!(decoded.stream_id, 9);
    assert_eq!(decoded.payload_kind, PAYLOAD_KIND_WEBSOCKET_TEXT);
    assert_eq!(decoded.payload, b"hello");
}

#[test]
fn serializes_stream_responses() {
    assert_eq!(
        stream_open_ok(7),
        r#"{"type":"stream.open.ok","streamId":7}"#
    );
    assert_eq!(
        stream_open_error(7, "invalid_connect_request", "bad request"),
        r#"{"type":"stream.open.error","streamId":7,"code":"invalid_connect_request","message":"bad request"}"#
    );
    assert_eq!(
        stream_reset(7, "target_closed", "target closed stream"),
        r#"{"type":"stream.reset","streamId":7,"code":"target_closed","message":"target closed stream"}"#
    );
    assert_eq!(
        stream_window(7, 128),
        r#"{"type":"stream.window","streamId":7,"bytes":128}"#
    );
    assert_eq!(
        stream_complete(7),
        r#"{"type":"stream.complete","streamId":7}"#
    );
    assert_eq!(
        signing_request(&SigningRequest {
            message_type: "signing.request".to_string(),
            request_id: "sign_req_123".to_string(),
            organization_id: "org_123".to_string(),
            sandbox_instance_id: "sbi_123".to_string(),
            acting_user_id: "usr_123".to_string(),
            provider_family: "github".to_string(),
            integration_connection_id: Some("icn_github".to_string()),
            format: "ssh".to_string(),
            key_ref: "key::ssh-ed25519 AAAA".to_string(),
            grant: "grant-token".to_string(),
            payload: "c2lnbi1tZQ==".to_string(),
            encoding: "base64".to_string(),
        }),
        r#"{"type":"signing.request","requestId":"sign_req_123","organizationId":"org_123","sandboxInstanceId":"sbi_123","actingUserId":"usr_123","providerFamily":"github","integrationConnectionId":"icn_github","format":"ssh","keyRef":"key::ssh-ed25519 AAAA","grant":"grant-token","payload":"c2lnbi1tZQ==","encoding":"base64"}"#
    );
    assert_eq!(
        signing_request(&SigningRequest {
            message_type: "signing.request".to_string(),
            request_id: "sign_req_123".to_string(),
            organization_id: "org_123".to_string(),
            sandbox_instance_id: "sbi_123".to_string(),
            acting_user_id: "usr_123".to_string(),
            provider_family: "github".to_string(),
            integration_connection_id: None,
            format: "ssh".to_string(),
            key_ref: "key::ssh-ed25519 AAAA".to_string(),
            grant: "grant-token".to_string(),
            payload: "c2lnbi1tZQ==".to_string(),
            encoding: "base64".to_string(),
        }),
        r#"{"type":"signing.request","requestId":"sign_req_123","organizationId":"org_123","sandboxInstanceId":"sbi_123","actingUserId":"usr_123","providerFamily":"github","format":"ssh","keyRef":"key::ssh-ed25519 AAAA","grant":"grant-token","payload":"c2lnbi1tZQ==","encoding":"base64"}"#
    );
    assert_eq!(
        egress_token_request(&EgressTokenRequest {
            message_type: "egress.token.request".to_string(),
            request_id: "egress_token_req_123".to_string(),
            acting_user_id: None,
        }),
        r#"{"type":"egress.token.request","requestId":"egress_token_req_123"}"#
    );
    assert_eq!(
        ports_target_authorize_success_result("req_port_access_1", "https", true),
        r#"{"type":"ports.target.authorize.result","requestId":"req_port_access_1","authorized":true,"upstreamProtocol":"https","websocketCapable":true}"#
    );
    assert_eq!(
        ports_target_authorize_failure_result("req_port_access_2", "unsupported_protocol"),
        r#"{"type":"ports.target.authorize.result","requestId":"req_port_access_2","authorized":false,"reason":"unsupported_protocol"}"#
    );
    assert_eq!(
        pty_exit_event(7, 3),
        r#"{"type":"stream.event","streamId":7,"event":{"type":"pty.exit","exitCode":3}}"#
    );
    assert_eq!(
        file_upload_completed_event(FileUploadCompletedEventInput {
            stream_id: 7,
            kind: "image",
            attachment_id: "att_123",
            thread_id: "thread_123",
            original_filename: "image.png",
            mime_type: "image/png",
            size_bytes: 8,
            path: "/root/.local/attachments/thread_123/file.png",
        }),
        r#"{"type":"stream.event","streamId":7,"event":{"type":"fileUpload.completed","kind":"image","attachmentId":"att_123","threadId":"thread_123","originalFilename":"image.png","mimeType":"image/png","sizeBytes":8,"path":"/root/.local/attachments/thread_123/file.png"}}"#
    );
    assert_eq!(
        exec_result_event(9, 0, "stdout", "stderr", true),
        r#"{"type":"stream.event","streamId":9,"event":{"type":"exec.result","exitCode":0,"stdout":"stdout","stderr":"stderr","truncated":true}}"#
    );
    assert_eq!(
        telemetry_open(42, "logs", "mistle.sandbox-runtime.log.v1"),
        r#"{"type":"telemetry.open","streamId":42,"signal":"logs","format":"mistle.sandbox-runtime.log.v1"}"#
    );
    assert_eq!(
        telemetry_close(42),
        r#"{"type":"telemetry.close","streamId":42}"#
    );
}

#[test]
fn serializes_ports_http_transport_messages() {
    assert_eq!(
        serialize_json(&super::PortsHttpOpen {
            message_type: "ports.http.open".to_string(),
            stream_id: 41,
            target: super::PortAccessTarget {
                kind: "port".to_string(),
                port: 5173,
            },
            upstream_protocol: "https".to_string(),
            request: super::PortsHttpRequest {
                method: "GET".to_string(),
                path: "/src/main.ts".to_string(),
                query: Some("import=1".to_string()),
                headers: std::collections::BTreeMap::from([(
                    "accept".to_string(),
                    vec!["text/plain".to_string()],
                )]),
            },
        }),
        r#"{"type":"ports.http.open","streamId":41,"target":{"kind":"port","port":5173},"upstreamProtocol":"https","request":{"method":"GET","path":"/src/main.ts","query":"import=1","headers":{"accept":["text/plain"]}}}"#
    );
    assert_eq!(
        serialize_json(&super::PortsHttpResponseStart {
            message_type: "ports.http.response.start".to_string(),
            stream_id: 41,
            status: 200,
            headers: std::collections::BTreeMap::from([(
                "content-type".to_string(),
                vec!["text/plain".to_string()],
            )]),
        }),
        r#"{"type":"ports.http.response.start","streamId":41,"status":200,"headers":{"content-type":["text/plain"]}}"#
    );
    assert_eq!(
        serialize_json(&super::PortsHttpBodyChunk {
            message_type: "ports.http.body.chunk".to_string(),
            stream_id: 41,
            direction: "response".to_string(),
            bytes: "SGVsbG8=".to_string(),
            encoding: "base64".to_string(),
        }),
        r#"{"type":"ports.http.body.chunk","streamId":41,"direction":"response","bytes":"SGVsbG8=","encoding":"base64"}"#
    );
    assert_eq!(
        serialize_json(&super::PortsHttpBodyEnd {
            message_type: "ports.http.body.end".to_string(),
            stream_id: 41,
            direction: "response".to_string(),
        }),
        r#"{"type":"ports.http.body.end","streamId":41,"direction":"response"}"#
    );
    assert_eq!(
        serialize_json(&super::PortsStreamClose {
            message_type: "ports.stream.close".to_string(),
            stream_id: 41,
        }),
        r#"{"type":"ports.stream.close","streamId":41}"#
    );
    assert_eq!(
        serialize_json(&super::PortsStreamError {
            message_type: "ports.stream.error".to_string(),
            stream_id: 41,
            code: "upstream_io_error".to_string(),
            message: "upstream closed early".to_string(),
        }),
        r#"{"type":"ports.stream.error","streamId":41,"code":"upstream_io_error","message":"upstream closed early"}"#
    );
}

#[test]
fn parses_bootstrap_telemetry_control_messages() {
    let message = parse_bootstrap_telemetry_control_message(
        r#"{"type":"telemetry.open.ok","streamId":42,"initialWindowBytes":1024}"#,
    )
    .expect("telemetry.open.ok should parse");
    assert!(matches!(
        message,
        Some(BootstrapTelemetryControlMessage::OpenOk(_))
    ));

    let non_telemetry = parse_bootstrap_telemetry_control_message(
        r#"{"type":"stream.window","streamId":42,"bytes":10}"#,
    )
    .expect("non-telemetry control message should parse");
    assert!(non_telemetry.is_none());
}

#[test]
fn enforces_stream_send_window_capacity() {
    let mut window = StreamSendWindow::new(0);

    window.add(32).expect("window credit should be added");
    assert!(window.try_consume(16));
    assert_eq!(window.available_bytes(), 16);
    assert!(!window.try_consume(17));
}

#[test]
fn rejects_unsupported_payload_kinds() {
    let error = encode_stream_data_frame(1, 9, b"x").expect_err("payload kind should be rejected");
    assert_eq!(error.to_string(), "payloadKind is not supported: 9");

    let encoded = vec![1, 0, 0, 0, 1, 9, b'x'];
    let error = decode_stream_data_frame(&encoded).expect_err("payload kind should be rejected");
    assert_eq!(error.to_string(), "payloadKind is not supported: 9");
}

#[test]
fn preserves_raw_bytes_payload_kind() {
    let encoded =
        encode_stream_data_frame(2, PAYLOAD_KIND_RAW_BYTES, b"bytes").expect("frame should encode");
    let decoded = decode_stream_data_frame(&encoded).expect("frame should decode");

    assert_eq!(decoded.payload_kind, PAYLOAD_KIND_RAW_BYTES);
    assert_eq!(decoded.payload, b"bytes");
}
