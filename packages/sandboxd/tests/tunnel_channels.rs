use std::fs;
use std::io;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;

use serde_json::Value;
use tungstenite::{Message, WebSocket, accept, connect};

use serde_json::json;

use sandboxd::time::{Clock, SystemClock, ThreadSleeper};
use sandboxd::tunnel::agent_stream::{DEFAULT_AGENT_STREAM_POLL_INTERVAL, relay_agent_stream};
use sandboxd::tunnel::file_upload::relay_file_upload_stream;
use sandboxd::tunnel::protocol::{
    PAYLOAD_KIND_RAW_BYTES, PAYLOAD_KIND_WEBSOCKET_TEXT, decode_stream_data_frame,
    encode_stream_data_frame,
};
use sandboxd::tunnel::telemetry::{
    SANDBOX_TELEMETRY_LOG_STREAM_ID, SandboxTelemetryLogLevel, TelemetryRelay,
    decode_telemetry_data_frame,
};

static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy)]
struct FixedClock {
    now_ms: u64,
}

impl Clock for FixedClock {
    fn now_ms(&self) -> u64 {
        self.now_ms
    }
}

#[test]
fn relays_agent_channel_frames_between_tunnel_and_runtime_endpoint() {
    let runtime_listener = TcpListener::bind("127.0.0.1:0").expect("runtime listener should bind");
    let runtime_address = runtime_listener
        .local_addr()
        .expect("runtime listener should expose its address");
    let runtime_url = format!("ws://127.0.0.1:{}/runtime", runtime_address.port());

    let runtime_thread = thread::spawn(move || {
        let (stream, _) = runtime_listener
            .accept()
            .expect("runtime endpoint should accept tunnel relay");
        let mut websocket = accept(stream).expect("runtime websocket handshake should succeed");

        let Message::Text(payload) = websocket
            .read()
            .expect("runtime endpoint should receive a websocket text frame")
        else {
            panic!("expected runtime websocket text frame");
        };
        assert_eq!(payload.as_str(), "hello runtime");

        websocket
            .send(Message::Text("hello tunnel".to_string().into()))
            .expect("runtime endpoint should send a websocket text response");
        websocket
            .close(None)
            .expect("runtime endpoint should close cleanly");
    });

    let tunnel_listener = TcpListener::bind("127.0.0.1:0").expect("tunnel listener should bind");
    let tunnel_address = tunnel_listener
        .local_addr()
        .expect("tunnel listener should expose its address");
    let runtime_url_for_server = runtime_url.clone();
    let tunnel_thread = thread::spawn(move || {
        let (stream, _) = tunnel_listener
            .accept()
            .expect("tunnel relay should accept a client");
        let mut websocket = accept(stream).expect("tunnel websocket handshake should succeed");
        let Message::Text(open_payload) = websocket
            .read()
            .expect("tunnel relay should receive the initial stream.open")
        else {
            panic!("expected initial text stream.open payload");
        };

        relay_agent_stream(
            &mut websocket,
            open_payload.as_str(),
            &runtime_url_for_server,
            &ThreadSleeper,
            DEFAULT_AGENT_STREAM_POLL_INTERVAL,
        )
        .expect("agent relay should finish cleanly");
    });

    let (mut client_socket, _) = connect(format!("ws://127.0.0.1:{}/agent", tunnel_address.port()))
        .expect("client should connect to tunnel relay");
    client_socket
        .send(Message::Text(
            r#"{"type":"stream.open","streamId":7,"channel":{"kind":"agent"}}"#
                .to_string()
                .into(),
        ))
        .expect("client should send agent stream.open");

    assert_eq!(
        read_text_message(&mut client_socket),
        r#"{"type":"stream.open.ok","streamId":7}"#
    );

    let encoded_input = encode_stream_data_frame(7, PAYLOAD_KIND_WEBSOCKET_TEXT, b"hello runtime")
        .expect("agent input frame should encode");
    client_socket
        .send(Message::Binary(encoded_input.into()))
        .expect("client should send agent input");

    let output_frame = read_binary_frame(&mut client_socket);
    assert_eq!(output_frame.stream_id, 7);
    assert_eq!(output_frame.payload_kind, PAYLOAD_KIND_WEBSOCKET_TEXT);
    assert_eq!(
        String::from_utf8(output_frame.payload).expect("payload should be utf8"),
        "hello tunnel"
    );

    client_socket
        .send(Message::Text(
            r#"{"type":"stream.close","streamId":7}"#.to_string().into(),
        ))
        .expect("client should close the agent stream");

    runtime_thread
        .join()
        .expect("runtime endpoint thread should exit cleanly");
    tunnel_thread
        .join()
        .expect("tunnel relay thread should exit cleanly");
}

#[test]
fn persists_supported_image_uploads_and_emits_completion() {
    let attachment_root = create_temp_test_dir("file_upload");
    let tunnel_listener = TcpListener::bind("127.0.0.1:0").expect("tunnel listener should bind");
    let tunnel_address = tunnel_listener
        .local_addr()
        .expect("tunnel listener should expose its address");
    let attachment_root_for_server = attachment_root.clone();

    let tunnel_thread = thread::spawn(move || {
        let (stream, _) = tunnel_listener
            .accept()
            .expect("file upload relay should accept a client");
        let mut websocket = accept(stream).expect("tunnel websocket handshake should succeed");
        let Message::Text(open_payload) = websocket
            .read()
            .expect("file upload relay should receive the initial stream.open")
        else {
            panic!("expected initial text stream.open payload");
        };

        relay_file_upload_stream(
            &mut websocket,
            open_payload.as_str(),
            &attachment_root_for_server,
            &SystemClock,
        )
        .expect("file upload relay should finish cleanly");
    });

    let (mut client_socket, _) =
        connect(format!("ws://127.0.0.1:{}/upload", tunnel_address.port()))
            .expect("client should connect to file upload relay");
    client_socket
        .send(Message::Text(
            r#"{"type":"stream.open","streamId":9,"channel":{"kind":"fileUpload","threadId":"thread_123","mimeType":"image/png","originalFilename":"image.png","sizeBytes":8}}"#
                .to_string()
                .into(),
        ))
        .expect("client should send file upload stream.open");

    assert_eq!(
        read_text_message(&mut client_socket),
        r#"{"type":"stream.open.ok","streamId":9}"#
    );

    let png_bytes = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    let encoded_upload = encode_stream_data_frame(9, PAYLOAD_KIND_RAW_BYTES, &png_bytes)
        .expect("upload frame should encode");
    client_socket
        .send(Message::Binary(encoded_upload.into()))
        .expect("client should send upload bytes");

    let window_message = parse_json_text_message(&mut client_socket);
    assert_eq!(window_message["type"], "stream.window");
    assert_eq!(window_message["streamId"], 9);
    assert_eq!(window_message["bytes"], 8);

    client_socket
        .send(Message::Text(
            r#"{"type":"stream.close","streamId":9}"#.to_string().into(),
        ))
        .expect("client should close the upload stream");

    let completion_event = parse_json_text_message(&mut client_socket);
    assert_eq!(completion_event["type"], "stream.event");
    assert_eq!(completion_event["streamId"], 9);
    assert_eq!(completion_event["event"]["type"], "fileUpload.completed");
    assert_eq!(completion_event["event"]["threadId"], "thread_123");
    assert_eq!(completion_event["event"]["mimeType"], "image/png");
    assert_eq!(completion_event["event"]["sizeBytes"], 8);

    let persisted_path = completion_event["event"]["path"]
        .as_str()
        .expect("completion event should include the final path");
    assert_eq!(
        fs::read(persisted_path).expect("persisted upload should be readable"),
        png_bytes
    );

    let completion_message = parse_json_text_message(&mut client_socket);
    assert_eq!(completion_message["type"], "stream.complete");
    assert_eq!(completion_message["streamId"], 9);

    tunnel_thread
        .join()
        .expect("file upload relay thread should exit cleanly");
    fs::remove_dir_all(&attachment_root).expect("attachment root should be removable");
}

#[test]
fn rejects_unsupported_uploaded_file_content() {
    let attachment_root = create_temp_test_dir("file_upload_invalid");
    let tunnel_listener = TcpListener::bind("127.0.0.1:0").expect("tunnel listener should bind");
    let tunnel_address = tunnel_listener
        .local_addr()
        .expect("tunnel listener should expose its address");
    let attachment_root_for_server = attachment_root.clone();

    let tunnel_thread = thread::spawn(move || {
        let (stream, _) = tunnel_listener
            .accept()
            .expect("file upload relay should accept a client");
        let mut websocket = accept(stream).expect("tunnel websocket handshake should succeed");
        let Message::Text(open_payload) = websocket
            .read()
            .expect("file upload relay should receive the initial stream.open")
        else {
            panic!("expected initial text stream.open payload");
        };

        relay_file_upload_stream(
            &mut websocket,
            open_payload.as_str(),
            &attachment_root_for_server,
            &SystemClock,
        )
        .expect("file upload relay should finish cleanly");
    });

    let (mut client_socket, _) =
        connect(format!("ws://127.0.0.1:{}/upload", tunnel_address.port()))
            .expect("client should connect to file upload relay");
    client_socket
        .send(Message::Text(
            r#"{"type":"stream.open","streamId":10,"channel":{"kind":"fileUpload","threadId":"thread_456","mimeType":"image/png","originalFilename":"image.png","sizeBytes":8}}"#
                .to_string()
                .into(),
        ))
        .expect("client should send file upload stream.open");

    assert_eq!(
        read_text_message(&mut client_socket),
        r#"{"type":"stream.open.ok","streamId":10}"#
    );

    let invalid_bytes = vec![0_u8; 8];
    let encoded_upload = encode_stream_data_frame(10, PAYLOAD_KIND_RAW_BYTES, &invalid_bytes)
        .expect("upload frame should encode");
    client_socket
        .send(Message::Binary(encoded_upload.into()))
        .expect("client should send upload bytes");

    let window_message = parse_json_text_message(&mut client_socket);
    assert_eq!(window_message["type"], "stream.window");
    assert_eq!(window_message["streamId"], 10);
    assert_eq!(window_message["bytes"], 8);

    client_socket
        .send(Message::Text(
            r#"{"type":"stream.close","streamId":10}"#.to_string().into(),
        ))
        .expect("client should close the upload stream");

    let reset_message = parse_json_text_message(&mut client_socket);
    assert_eq!(reset_message["type"], "stream.reset");
    assert_eq!(reset_message["streamId"], 10);
    assert_eq!(reset_message["code"], "invalid_file_type");
    assert_eq!(
        reset_message["message"],
        "uploaded file is not a supported image"
    );

    tunnel_thread
        .join()
        .expect("file upload relay thread should exit cleanly");
    let persisted_thread_dir = attachment_root.join("thread_456");
    if persisted_thread_dir.exists() {
        assert!(
            fs::read_dir(&persisted_thread_dir)
                .expect("thread upload directory should be readable")
                .next()
                .is_none(),
            "invalid uploads should not leave persisted attachment files"
        );
    }
    fs::remove_dir_all(&attachment_root).expect("attachment root should be removable");
}

#[test]
fn negotiates_telemetry_stream_and_flushes_buffered_logs() {
    let tunnel_listener = TcpListener::bind("127.0.0.1:0").expect("tunnel listener should bind");
    let tunnel_address = tunnel_listener
        .local_addr()
        .expect("tunnel listener should expose its address");

    let tunnel_thread = thread::spawn(move || {
        let (stream, _) = tunnel_listener
            .accept()
            .expect("telemetry relay should accept a client");
        let mut websocket = accept(stream).expect("tunnel websocket handshake should succeed");
        let mut relay = TelemetryRelay::default();
        let clock = FixedClock { now_ms: 104 };

        for frame in relay
            .attach_tunnel_connection()
            .expect("telemetry relay should send telemetry.open")
        {
            send_telemetry_frame(&mut websocket, frame);
        }

        let Message::Text(payload) = websocket
            .read()
            .expect("telemetry relay should receive telemetry control response")
        else {
            panic!("expected telemetry control text frame");
        };
        let control_frames = relay
            .handle_control_message(payload.as_str())
            .expect("telemetry control response should be handled")
            .expect("telemetry control response should be consumed");
        for frame in control_frames {
            send_telemetry_frame(&mut websocket, frame);
        }

        for frame in relay
            .enqueue_log_record(
                &clock,
                SandboxTelemetryLogLevel::Warn,
                "bootstrap_control_message_dropped",
                &[
                    (
                        "message",
                        json!("sandboxd dropped bootstrap control message: sandboxd log line"),
                    ),
                    ("reason", json!("sandboxd log line")),
                ],
            )
            .expect("telemetry relay should flush buffered logs")
        {
            send_telemetry_frame(&mut websocket, frame);
        }
        for frame in relay
            .detach_tunnel_connection()
            .expect("telemetry relay should send telemetry.close")
        {
            send_telemetry_frame(&mut websocket, frame);
        }
    });

    let (mut client_socket, _) = connect(format!(
        "ws://127.0.0.1:{}/telemetry",
        tunnel_address.port()
    ))
    .expect("client should connect to telemetry relay");
    let open_message = parse_json_text_message(&mut client_socket);
    assert_eq!(open_message["type"], "telemetry.open");
    assert_eq!(open_message["streamId"], SANDBOX_TELEMETRY_LOG_STREAM_ID);
    assert_eq!(open_message["signal"], "logs");
    assert_eq!(open_message["format"], "mistle.sandbox-runtime.log.v1");

    client_socket
        .send(Message::Text(
            format!(
                r#"{{"type":"telemetry.open.ok","streamId":{SANDBOX_TELEMETRY_LOG_STREAM_ID},"initialWindowBytes":1024}}"#
            )
            .into(),
        ))
        .expect("client should grant telemetry send window");

    let Message::Binary(payload) = client_socket
        .read()
        .expect("client should receive telemetry bytes")
    else {
        panic!("expected telemetry binary frame");
    };
    let telemetry_bytes =
        decode_telemetry_data_frame(payload.as_ref()).expect("telemetry data frame should decode");
    let telemetry_log_line: Value =
        serde_json::from_slice(&telemetry_bytes).expect("telemetry bytes should contain json");
    assert_eq!(telemetry_log_line["timestamp"], "1970-01-01T00:00:00.104Z");
    assert_eq!(telemetry_log_line["level"], "warn");
    assert_eq!(telemetry_log_line["event"], "bootstrap_control_message_dropped");
    assert_eq!(
        telemetry_log_line["message"],
        "sandboxd dropped bootstrap control message: sandboxd log line"
    );
    assert_eq!(telemetry_log_line["reason"], "sandboxd log line");

    let close_message = parse_json_text_message(&mut client_socket);
    assert_eq!(close_message["type"], "telemetry.close");
    assert_eq!(close_message["streamId"], SANDBOX_TELEMETRY_LOG_STREAM_ID);

    tunnel_thread
        .join()
        .expect("telemetry relay thread should exit cleanly");
}

fn read_text_message<S>(socket: &mut WebSocket<S>) -> String
where
    S: io::Read + io::Write,
{
    let Message::Text(payload) = socket
        .read()
        .expect("socket should receive one text message")
    else {
        panic!("expected websocket text message");
    };

    payload.to_string()
}

fn parse_json_text_message<S>(socket: &mut WebSocket<S>) -> Value
where
    S: io::Read + io::Write,
{
    let payload = read_text_message(socket);
    serde_json::from_str(&payload).expect("text payload should be valid json")
}

fn read_binary_frame<S>(socket: &mut WebSocket<S>) -> sandboxd::tunnel::protocol::StreamDataFrame
where
    S: io::Read + io::Write,
{
    let Message::Binary(payload) = socket
        .read()
        .expect("socket should receive one binary frame")
    else {
        panic!("expected websocket binary frame");
    };

    decode_stream_data_frame(payload.as_ref()).expect("binary frame should decode")
}

fn send_telemetry_frame<S>(
    socket: &mut WebSocket<S>,
    frame: sandboxd::tunnel::telemetry::TelemetryRelayFrame,
)
where
    S: io::Read + io::Write,
{
    match frame {
        sandboxd::tunnel::telemetry::TelemetryRelayFrame::Text(payload) => socket
            .send(Message::Text(payload.into()))
            .expect("telemetry relay should send text frame"),
        sandboxd::tunnel::telemetry::TelemetryRelayFrame::Binary(payload) => socket
            .send(Message::Binary(payload.into()))
            .expect("telemetry relay should send binary frame"),
    }
}

fn create_temp_test_dir(prefix: &str) -> PathBuf {
    let counter = TEMP_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
    let path = PathBuf::from("/tmp").join(format!(
        "sbd_{prefix}_{}_{}_{}",
        std::process::id(),
        counter,
        SystemClock.now_ms()
    ));

    fs::create_dir_all(&path).expect("temp test dir should be creatable");
    path
}
