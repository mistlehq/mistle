use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tungstenite::accept;
use tungstenite::connect;
use tungstenite::{Message, WebSocket};

use sandboxd::time::{SystemClock, ThreadSleeper};
use sandboxd::tunnel::protocol::{
    PAYLOAD_KIND_RAW_BYTES, PtyControlMessage, decode_stream_data_frame, parse_pty_control_message,
};
use sandboxd::tunnel::pty_stream::{DEFAULT_PTY_STREAM_POLL_INTERVAL, relay_pty_stream};

#[test]
fn relays_pty_output_and_exit_over_websocket() {
    let cgroup_root = create_temp_test_dir("pty_stream_scope_output");
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener
        .local_addr()
        .expect("listener should expose its address");
    let server_cgroup_root = cgroup_root.clone();

    let server_thread = thread::spawn(move || {
        let (stream, _) = listener.accept().expect("server should accept a client");
        let mut websocket = accept(stream).expect("server handshake should succeed");
        let Message::Text(open_payload) = websocket
            .read()
            .expect("server should receive the initial stream.open")
        else {
            panic!("expected initial text stream.open payload");
        };

        relay_pty_stream(
            &mut websocket,
            open_payload.as_str(),
            &server_cgroup_root,
            "sbi_123",
            &SystemClock,
            &ThreadSleeper,
            DEFAULT_PTY_STREAM_POLL_INTERVAL,
        )
        .expect("pty relay should finish cleanly");
    });

    let (mut client_socket, _) =
        connect(format!("ws://127.0.0.1:{}/pty", address.port())).expect("client should connect");
    client_socket
        .send(Message::Text(
            r#"{"type":"stream.open","streamId":1,"channel":{"kind":"pty","session":"create","ptySessionId":"terminal","command":"/bin/sh","args":["-lc","printf 'hello from pty'; exit 4"]}}"#
                .to_string()
                .into(),
        ))
        .expect("client should send stream.open");

    assert_eq!(
        read_text_message(&mut client_socket),
        r#"{"type":"stream.open.ok","streamId":1}"#
    );

    let output_frame = read_binary_frame(&mut client_socket);
    assert_eq!(output_frame.stream_id, 1);
    assert_eq!(
        String::from_utf8(output_frame.payload).expect("payload should be utf8"),
        "hello from pty"
    );

    let event = parse_json_text_message(&mut client_socket);
    assert_eq!(event["type"], "stream.event");
    assert_eq!(event["streamId"], 1);
    assert_eq!(event["event"]["type"], "pty.exit");
    assert_eq!(event["event"]["exitCode"], 4);
    assert_eq!(read_scope_procs_files(&cgroup_root).len(), 1);

    server_thread
        .join()
        .expect("server thread should exit cleanly");
    std::fs::remove_dir_all(cgroup_root).expect("temp root should be removable");
}

#[test]
fn supports_attach_streams_and_detaches_secondary_close() {
    let cgroup_root = create_temp_test_dir("pty_stream_scope_attach");
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener
        .local_addr()
        .expect("listener should expose its address");
    let server_cgroup_root = cgroup_root.clone();

    let server_thread = thread::spawn(move || {
        let (stream, _) = listener.accept().expect("server should accept a client");
        let mut websocket = accept(stream).expect("server handshake should succeed");
        let Message::Text(open_payload) = websocket
            .read()
            .expect("server should receive the initial stream.open")
        else {
            panic!("expected initial text stream.open payload");
        };

        relay_pty_stream(
            &mut websocket,
            open_payload.as_str(),
            &server_cgroup_root,
            "sbi_123",
            &SystemClock,
            &ThreadSleeper,
            DEFAULT_PTY_STREAM_POLL_INTERVAL,
        )
        .expect("pty relay should finish cleanly");
    });

    let (mut client_socket, _) =
        connect(format!("ws://127.0.0.1:{}/pty", address.port())).expect("client should connect");
    client_socket
        .send(Message::Text(
            r#"{"type":"stream.open","streamId":1,"channel":{"kind":"pty","session":"create","ptySessionId":"terminal","command":"/bin/sh","args":["-lc","stty -echo; cat"]}}"#
                .to_string()
                .into(),
        ))
        .expect("client should send primary stream.open");
    assert_eq!(
        read_text_message(&mut client_socket),
        r#"{"type":"stream.open.ok","streamId":1}"#
    );

    client_socket
        .send(Message::Text(
            r#"{"type":"stream.open","streamId":2,"channel":{"kind":"pty","session":"attach","ptySessionId":"terminal"}}"#
                .to_string()
                .into(),
        ))
        .expect("client should send attach stream.open");
    assert_eq!(
        read_text_message(&mut client_socket),
        r#"{"type":"stream.open.ok","streamId":2}"#
    );

    client_socket
        .send(Message::Text(
            r#"{"type":"stream.signal","streamId":2,"signal":{"type":"pty.resize","cols":100,"rows":40}}"#
                .to_string()
                .into(),
        ))
        .expect("client should send resize signal");

    let encoded_input =
        sandboxd::tunnel::protocol::encode_stream_data_frame(2, PAYLOAD_KIND_RAW_BYTES, b"hello\n")
            .expect("input frame should encode");
    client_socket
        .send(Message::Binary(encoded_input.into()))
        .expect("client should send PTY stdin bytes");

    let window_message = parse_json_text_message(&mut client_socket);
    assert_eq!(window_message["type"], "stream.window");
    assert_eq!(window_message["streamId"], 2);
    assert_eq!(window_message["bytes"], 6);

    let first_output = read_binary_frame(&mut client_socket);
    let second_output = read_binary_frame(&mut client_socket);
    let outputs = [
        (
            first_output.stream_id,
            String::from_utf8(first_output.payload).expect("payload should be utf8"),
        ),
        (
            second_output.stream_id,
            String::from_utf8(second_output.payload).expect("payload should be utf8"),
        ),
    ];
    assert!(outputs.contains(&(1, "hello\r\n".to_string())));
    assert!(outputs.contains(&(2, "hello\r\n".to_string())));

    client_socket
        .send(Message::Text(
            r#"{"type":"stream.close","streamId":2}"#.to_string().into(),
        ))
        .expect("client should close the attached stream");

    let encoded_primary_input =
        sandboxd::tunnel::protocol::encode_stream_data_frame(1, PAYLOAD_KIND_RAW_BYTES, b"bye\n")
            .expect("primary input frame should encode");
    client_socket
        .send(Message::Binary(encoded_primary_input.into()))
        .expect("client should send bytes through the primary stream");

    let mut saw_primary_window = false;
    let mut saw_primary_output = false;
    for _ in 0..6 {
        match client_socket
            .read()
            .expect("socket should receive PTY frames after writing to the primary stream")
        {
            Message::Text(payload) => {
                let message: Value =
                    serde_json::from_str(payload.as_str()).expect("text payload should be valid json");
                if message["type"] == "stream.window" && message["streamId"] == 1 {
                    assert_eq!(message["bytes"], 4);
                    saw_primary_window = true;
                }
            }
            Message::Binary(payload) => {
                let frame =
                    decode_stream_data_frame(payload.as_ref()).expect("binary frame should decode");
                let payload = String::from_utf8(frame.payload).expect("payload should be utf8");
                if frame.stream_id == 2 {
                    assert_ne!(
                        payload, "bye\r\n",
                        "detached secondary stream should not receive primary-stream output"
                    );
                    continue;
                }

                if frame.stream_id == 1 && payload == "bye\r\n" {
                    saw_primary_output = true;
                }
            }
            other_message => panic!("unexpected websocket message after primary write: {other_message:?}"),
        }

        if saw_primary_window && saw_primary_output {
            break;
        }
    }

    assert!(saw_primary_window, "expected primary stream.window after primary write");
    assert!(saw_primary_output, "expected primary PTY output after primary write");

    let encoded_follow_up_input =
        sandboxd::tunnel::protocol::encode_stream_data_frame(1, PAYLOAD_KIND_RAW_BYTES, b"again\n")
            .expect("follow-up primary input frame should encode");
    client_socket
        .send(Message::Binary(encoded_follow_up_input.into()))
        .expect("client should send follow-up bytes through the primary stream");

    let mut saw_follow_up_window = false;
    let mut saw_follow_up_output = false;
    for _ in 0..4 {
        match client_socket
            .read()
            .expect("socket should receive PTY frames after follow-up primary write")
        {
            Message::Text(payload) => {
                let message: Value =
                    serde_json::from_str(payload.as_str()).expect("text payload should be valid json");
                if message["type"] == "stream.window" && message["streamId"] == 1 {
                    assert_eq!(message["bytes"], 6);
                    saw_follow_up_window = true;
                }
            }
            Message::Binary(payload) => {
                let frame =
                    decode_stream_data_frame(payload.as_ref()).expect("binary frame should decode");
                assert_ne!(
                    frame.stream_id, 2,
                    "detached secondary stream should not receive newly produced PTY output"
                );
                if frame.stream_id == 1 {
                    let payload =
                        String::from_utf8(frame.payload).expect("payload should be utf8");
                    if payload == "again\r\n" {
                        saw_follow_up_output = true;
                    }
                }
            }
            other_message => {
                panic!("unexpected websocket message after follow-up primary write: {other_message:?}")
            }
        }

        if saw_follow_up_window && saw_follow_up_output {
            break;
        }
    }

    assert!(
        saw_follow_up_window,
        "expected primary stream.window after follow-up primary write"
    );
    assert!(
        saw_follow_up_output,
        "expected primary PTY output after follow-up primary write"
    );

    client_socket
        .send(Message::Text(
            r#"{"type":"stream.close","streamId":1}"#.to_string().into(),
        ))
        .expect("client should close the primary stream");

    let mut saw_primary_exit = false;
    for _ in 0..6 {
        match client_socket
            .read()
            .expect("socket should receive PTY close frames after closing the primary stream")
        {
            Message::Text(payload) => {
                let message: Value =
                    serde_json::from_str(payload.as_str()).expect("text payload should be valid json");
                if message["type"] == "stream.event"
                    && message["streamId"] == 1
                    && message["event"]["type"] == "pty.exit"
                {
                    saw_primary_exit = true;
                    break;
                }
            }
            Message::Binary(_) => {}
            other_message => panic!("unexpected websocket message after primary close: {other_message:?}"),
        }
    }

    assert!(saw_primary_exit, "expected primary pty.exit after closing the primary stream");
    assert_eq!(read_scope_procs_files(&cgroup_root).len(), 1);

    server_thread
        .join()
        .expect("server thread should exit cleanly");
    std::fs::remove_dir_all(cgroup_root).expect("temp root should be removable");
}

fn read_text_message<S>(socket: &mut WebSocket<S>) -> String
where
    S: std::io::Read + std::io::Write,
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
    S: std::io::Read + std::io::Write,
{
    let payload = read_text_message(socket);
    serde_json::from_str(&payload).expect("text payload should be valid json")
}

fn read_binary_frame<S>(socket: &mut WebSocket<S>) -> sandboxd::tunnel::protocol::StreamDataFrame
where
    S: std::io::Read + std::io::Write,
{
    let Message::Binary(payload) = socket
        .read()
        .expect("socket should receive one binary frame")
    else {
        panic!("expected websocket binary data frame");
    };

    decode_stream_data_frame(payload.as_ref()).expect("binary frame should decode")
}

fn read_scope_procs_files(cgroup_root: &Path) -> Vec<String> {
    let user_root = cgroup_root.join("sbi_123").join("user");
    let entries = std::fs::read_dir(&user_root).expect("user scope root should exist");
    let mut contents = Vec::new();
    for entry in entries {
        let entry = entry.expect("user scope entry should be readable");
        let procs_file = entry.path().join("cgroup.procs");
        contents
            .push(std::fs::read_to_string(procs_file).expect("cgroup.procs should be readable"));
    }
    contents
}

fn create_temp_test_dir(prefix: &str) -> PathBuf {
    let unique_suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();
    let path = std::path::Path::new("/tmp").join(format!(
        "sbd_{prefix}_{}_{}",
        std::process::id(),
        unique_suffix
    ));
    std::fs::create_dir_all(&path).expect("temp root should be creatable");
    path
}

#[test]
fn parses_attach_open_message_integration_fixture_shape() {
    let message = parse_pty_control_message(
        r#"{"type":"stream.open","streamId":2,"channel":{"kind":"pty","session":"attach","ptySessionId":"terminal"}}"#,
    )
    .expect("attach stream.open should parse");

    assert!(matches!(message, PtyControlMessage::Open(_)));
}
