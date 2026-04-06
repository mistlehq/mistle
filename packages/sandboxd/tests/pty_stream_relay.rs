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
    PtyControlMessage, decode_stream_data_frame, parse_pty_control_message,
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

    let encoded_input = sandboxd::tunnel::protocol::encode_stream_data_frame(2, b"hello\n")
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

    let encoded_primary_input = sandboxd::tunnel::protocol::encode_stream_data_frame(1, b"bye\n")
        .expect("primary input frame should encode");
    client_socket
        .send(Message::Binary(encoded_primary_input.into()))
        .expect("client should send bytes through the primary stream");

    let primary_window = parse_json_text_message(&mut client_socket);
    assert_eq!(primary_window["type"], "stream.window");
    assert_eq!(primary_window["streamId"], 1);
    assert_eq!(primary_window["bytes"], 4);

    let primary_output = read_binary_frame(&mut client_socket);
    assert_eq!(primary_output.stream_id, 1);
    assert_eq!(
        String::from_utf8(primary_output.payload).expect("payload should be utf8"),
        "bye\r\n"
    );

    client_socket
        .send(Message::Text(
            r#"{"type":"stream.close","streamId":1}"#.to_string().into(),
        ))
        .expect("client should close the primary stream");

    let exit_event = parse_json_text_message(&mut client_socket);
    assert_eq!(exit_event["type"], "stream.event");
    assert_eq!(exit_event["streamId"], 1);
    assert_eq!(exit_event["event"]["type"], "pty.exit");
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
