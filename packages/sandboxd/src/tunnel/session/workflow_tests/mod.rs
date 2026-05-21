use super::{
    DEFAULT_ATTACHMENT_ROOT, OperationStreamMessage, SANDBOX_OPERATION_STREAM_ID,
    TunnelSessionError,
};

use crate::tunnel::session::agent::{AgentStreamState, AgentStreamStats};
use crate::tunnel::session::bootstrap::{
    TunnelWriterMessage, connect_bootstrap_websocket, resolve_bootstrap_tunnel_url,
};
use crate::tunnel::session::file_search::terminate_file_search_stream;
use crate::tunnel::session::file_upload::FileUploadState;
use crate::tunnel::session::lifecycle::snapshot_runtime_connection_state;
use crate::tunnel::session::operation::SANDBOX_OPERATION_STREAM_FORMAT;
use crate::tunnel::session::port_access::{
    PortAccessTcpStreamState, handle_ports_transport_message, mark_port_access_tcp_direction_closed,
};
use crate::tunnel::session::process::ProcessStreamState;
use crate::tunnel::session::router::{
    handle_tunnel_binary_frame, handle_tunnel_control_message, handle_tunnel_session_event,
    handle_tunnel_session_request,
};
use crate::tunnel::session::runner::run_connected_tunnel_session_catching_panics;
use crate::tunnel::session::state::{
    ConnectedTunnelSessionOutcome, TunnelSessionControlFlow, TunnelSessionEvent,
    TunnelSessionLoopContext, TunnelSessionMutableState, TunnelSessionRequest,
    TunnelSessionRuntime, TunnelSessionRuntimeConnectionState,
};

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
#[cfg(target_os = "linux")]
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock, mpsc};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "linux")]
use base64::Engine;
use serde_json::{Value, json};
use tokio::time::timeout;
use tungstenite::{
    Error as WebSocketError, Message, WebSocket, accept, accept_hdr,
    handshake::server::{Request, Response},
};

use crate::keepalive::KeepaliveManager;
use crate::protocol::startup::{StartupInput, StartupMode};
use crate::runtime::adapters::RuntimeAdapterRegistry;
use crate::runtime::readiness::RuntimeReadinessManager;
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};
use crate::time::{Clock, SystemClock, ThreadSleeper};
use crate::tunnel::port_access_transport::{PortAccessTcpCommand, PortAccessTransportEvent};
use crate::tunnel::protocol::{
    AGENT_STREAM_WINDOW_BYTES, PAYLOAD_KIND_RAW_BYTES, PAYLOAD_KIND_WEBSOCKET_BINARY,
    PAYLOAD_KIND_WEBSOCKET_TEXT, PortAccessTarget, PortsTcpClose, PortsTcpConnected, PortsTcpOpen,
    PortsTransportMessage, StreamDataFrame, StreamSendWindow, decode_stream_data_frame,
    encode_stream_data_frame, parse_stream_control_message,
};
use crate::tunnel::session::{
    GatewayEgressTokenProvider, TunnelSession, TunnelSigningRequest, TunnelSigningResponse,
};
use crate::tunnel::telemetry::{
    SANDBOX_TELEMETRY_LOG_STREAM_ID, TelemetryRelay, decode_telemetry_data_frame,
};

static REQUEST_ID_COUNTER: AtomicU64 = AtomicU64::new(900);

#[derive(Default)]
struct PanicClock {
    panic_requested: std::sync::atomic::AtomicBool,
}

struct FixedClock {
    now_ms: u64,
}

#[cfg(target_os = "linux")]
enum TunnelGatewayTestMessage {
    Text(Value),
    Binary(StreamDataFrame),
}

impl PanicClock {
    fn request_panic(&self) {
        self.panic_requested.store(true, Ordering::Relaxed);
    }
}

fn test_tunnel_supervisor_handle(
    sandbox_instance_id: &str,
    clock: Arc<dyn Clock>,
) -> SandboxdSupervisorHandle {
    SandboxdSupervisorHandle::new(
        sandbox_instance_id,
        clock,
        BTreeSet::from([SupervisedComponent::TunnelSession]),
    )
}

impl Clock for PanicClock {
    fn now_ms(&self) -> u64 {
        assert!(
            !self.panic_requested.swap(false, Ordering::Relaxed),
            "panic clock requested connected-session panic"
        );
        0
    }
}

impl Clock for FixedClock {
    fn now_ms(&self) -> u64 {
        self.now_ms
    }
}

fn enable_test_telemetry(relay: &mut TelemetryRelay) {
    relay
        .attach_tunnel_connection()
        .expect("telemetry relay should attach");
    relay
        .handle_control_message(&format!(
            r#"{{"type":"telemetry.open.ok","streamId":{SANDBOX_TELEMETRY_LOG_STREAM_ID},"initialWindowBytes":{AGENT_STREAM_WINDOW_BYTES}}}"#
        ))
        .expect("telemetry open.ok should be accepted");
}

async fn read_queued_telemetry_log_line(
    receiver: &mut tokio::sync::mpsc::UnboundedReceiver<TunnelWriterMessage>,
) -> Value {
    let writer_message = receiver
        .recv()
        .await
        .expect("telemetry frame should be queued");
    let TunnelWriterMessage::Binary(payload) = writer_message else {
        panic!("expected a binary telemetry frame");
    };
    let decoded = decode_telemetry_data_frame(payload.as_ref())
        .expect("telemetry frame should decode successfully");
    serde_json::from_slice(&decoded).expect("telemetry line should be valid json")
}

async fn read_writer_text_json(
    receiver: &mut tokio::sync::mpsc::UnboundedReceiver<TunnelWriterMessage>,
) -> Value {
    let writer_message = receiver
        .recv()
        .await
        .expect("writer text frame should be queued");
    let TunnelWriterMessage::Text(payload) = writer_message else {
        panic!("expected a tunnel writer text frame");
    };
    serde_json::from_str::<Value>(&payload).expect("writer text payload should be json")
}

async fn read_writer_binary_frame(
    receiver: &mut tokio::sync::mpsc::UnboundedReceiver<TunnelWriterMessage>,
) -> StreamDataFrame {
    let writer_message = receiver
        .recv()
        .await
        .expect("writer binary frame should be queued");
    let TunnelWriterMessage::Binary(payload) = writer_message else {
        panic!("expected a tunnel writer binary frame");
    };
    decode_stream_data_frame(payload.as_ref()).expect("writer binary frame should decode")
}

fn empty_tunnel_session_state() -> TunnelSessionMutableState {
    TunnelSessionMutableState {
        agent_endpoint_url: None,
        runtime_env: BTreeMap::new(),
        telemetry_relay: TelemetryRelay::default(),
        pending_signing_requests: BTreeMap::new(),
        pending_egress_token_requests: BTreeMap::new(),
        pending_agent_opens: BTreeMap::new(),
        pending_exec_opens: BTreeMap::new(),
        agent_streams: BTreeMap::new(),
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
    }
}

fn test_tunnel_session_runtime() -> TunnelSessionRuntime {
    TunnelSessionRuntime {
        keepalive_manager: Arc::new(Mutex::new(KeepaliveManager::default())),
        runtime_readiness_manager: Arc::new(Mutex::new(RuntimeReadinessManager::default())),
        connection_state: Arc::new(RwLock::new(TunnelSessionRuntimeConnectionState {
            agent_endpoint_url: None,
            runtime_env: BTreeMap::new(),
        })),
        cgroup_root: PathBuf::from(crate::cgroups::DEFAULT_CGROUP_ROOT),
        attachment_root: PathBuf::from(DEFAULT_ATTACHMENT_ROOT),
        sandbox_instance_id: "sbi_test".to_string(),
        gateway_ws_url: "ws://127.0.0.1:1/v1/bootstrap".to_string(),
        operation_id: None,
        operation_kind: "start",
        transparent_passthrough_socket_mark: None,
        shutdown_requested: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        clock: Arc::new(SystemClock),
        sleeper: Arc::new(ThreadSleeper),
        supervisor_handle: test_tunnel_supervisor_handle("sbi_test", Arc::new(SystemClock)),
    }
}

mod exec_process_ports;
mod gateway;
mod live_session;
mod reconnect;
mod request;
mod router;

fn read_json_text_message<S>(socket: &mut WebSocket<S>) -> Value
where
    S: std::io::Read + std::io::Write,
{
    loop {
        match socket
            .read()
            .expect("websocket should receive one text message")
        {
            Message::Text(payload) => {
                return serde_json::from_str(payload.as_str())
                    .expect("text payload should be valid json");
            }
            Message::Binary(payload) if decode_telemetry_data_frame(payload.as_ref()).is_ok() => {
                continue;
            }
            _ => panic!("expected websocket text message"),
        }
    }
}

fn read_stream_text_message<S>(socket: &mut WebSocket<S>) -> Value
where
    S: std::io::Read + std::io::Write,
{
    loop {
        let message = read_json_text_message(socket);
        match message["type"].as_str() {
            Some("keepalive.state") | Some("runtime.ready") => continue,
            _ => return message,
        }
    }
}

#[cfg(target_os = "linux")]
fn read_port_access_message_for_stream<S>(
    socket: &mut WebSocket<S>,
    expected_stream_id: u32,
) -> Value
where
    S: std::io::Read + std::io::Write,
{
    loop {
        let message = read_stream_text_message(socket);
        if message["streamId"] == Value::Number(expected_stream_id.into()) {
            return message;
        }
    }
}

#[cfg(target_os = "linux")]
fn read_tunnel_message_for_stream<S>(
    socket: &mut WebSocket<S>,
    expected_stream_id: u32,
) -> TunnelGatewayTestMessage
where
    S: std::io::Read + std::io::Write,
{
    loop {
        match socket.read().expect("websocket should receive one message") {
            Message::Text(payload) => {
                let message: Value =
                    serde_json::from_str(payload.as_str()).expect("text payload should be json");
                match message["type"].as_str() {
                    Some("keepalive.state") | Some("runtime.ready") => continue,
                    _ if message["streamId"] == Value::Number(expected_stream_id.into()) => {
                        return TunnelGatewayTestMessage::Text(message);
                    }
                    _ => continue,
                }
            }
            Message::Binary(payload) => {
                if decode_telemetry_data_frame(payload.as_ref()).is_ok() {
                    continue;
                }
                let frame = decode_stream_data_frame(payload.as_ref())
                    .expect("binary payload should be stream data");
                if frame.stream_id == expected_stream_id {
                    return TunnelGatewayTestMessage::Binary(frame);
                }
            }
            _ => panic!("expected websocket text or binary message"),
        }
    }
}

#[cfg(target_os = "linux")]
fn decode_port_access_body_chunk(message: &Value) -> Vec<u8> {
    let payload = message["bytes"]
        .as_str()
        .expect("ports.http.body.chunk should include base64 bytes");
    base64::engine::general_purpose::STANDARD
        .decode(payload.as_bytes())
        .expect("ports.http.body.chunk bytes should decode")
}

fn read_binary_frame<S>(socket: &mut WebSocket<S>) -> crate::tunnel::protocol::StreamDataFrame
where
    S: std::io::Read + std::io::Write,
{
    let Message::Binary(payload) = socket
        .read()
        .expect("websocket should receive one binary frame")
    else {
        panic!("expected websocket binary frame");
    };

    decode_stream_data_frame(payload.as_ref()).expect("binary frame should decode")
}

fn read_non_telemetry_binary_frame<S>(
    socket: &mut WebSocket<S>,
) -> crate::tunnel::protocol::StreamDataFrame
where
    S: std::io::Read + std::io::Write,
{
    loop {
        let frame = read_binary_frame(socket);
        if frame.stream_id != SANDBOX_TELEMETRY_LOG_STREAM_ID {
            return frame;
        }
    }
}

fn read_binary_frame_for_stream<S>(
    socket: &mut WebSocket<S>,
    expected_stream_id: u32,
) -> crate::tunnel::protocol::StreamDataFrame
where
    S: std::io::Read + std::io::Write,
{
    loop {
        match socket.read().expect("websocket should receive one message") {
            Message::Text(payload) => {
                let message: Value = serde_json::from_str(payload.as_str())
                    .expect("text payload should be valid json");
                match message["type"].as_str() {
                    Some("keepalive.state") | Some("runtime.ready") => continue,
                    other => panic!(
                        "expected binary frame for stream {expected_stream_id}, got text control message {other:?}"
                    ),
                }
            }
            Message::Binary(payload) => {
                if decode_telemetry_data_frame(payload.as_ref()).is_ok() {
                    continue;
                }
                let frame = decode_stream_data_frame(payload.as_ref())
                    .expect("binary payload should be stream data");
                if frame.stream_id == expected_stream_id {
                    return frame;
                }
            }
            _ => panic!("expected websocket text or binary message"),
        }
    }
}

#[cfg(target_os = "linux")]
fn read_processes_snapshot<S>(socket: &mut WebSocket<S>) -> (u32, Value)
where
    S: std::io::Read + std::io::Write,
{
    let frame = read_binary_frame(socket);
    assert_eq!(frame.payload_kind, PAYLOAD_KIND_WEBSOCKET_TEXT);
    let payload =
        serde_json::from_slice::<Value>(&frame.payload).expect("snapshot payload should be json");
    assert_eq!(
        payload["type"],
        Value::String("processes.snapshot".to_string())
    );
    (frame.stream_id, payload)
}

#[cfg(target_os = "linux")]
fn read_processes_snapshot_for_stream<S>(
    socket: &mut WebSocket<S>,
    expected_stream_id: u32,
) -> (u32, Value)
where
    S: std::io::Read + std::io::Write,
{
    loop {
        let snapshot = read_processes_snapshot(socket);
        if snapshot.0 == expected_stream_id {
            return snapshot;
        }
    }
}

#[cfg(target_os = "linux")]
fn assert_processes_snapshot_contains(
    snapshot: &Value,
    server_marker: &str,
    idle_marker: &str,
    listener_port: u16,
) {
    let processes = snapshot["processes"]
        .as_array()
        .expect("processes snapshot should include a processes array");
    let server_process = processes
        .iter()
        .find(|process| {
            process["command"]
                .as_str()
                .is_some_and(|command| command.contains(server_marker))
        })
        .expect("snapshot should include the listening server process");
    assert!(
        server_process["listeners"]
            .as_array()
            .expect("server listeners should be an array")
            .iter()
            .any(|listener| {
                listener["port"] == Value::Number(listener_port.into())
                    && listener["bindAddress"] == Value::String("0.0.0.0".to_string())
            }),
        "server process should expose the expected local-bind listener"
    );

    assert!(
        !processes.iter().any(|process| {
            process["command"]
                .as_str()
                .is_some_and(|command| command.contains(idle_marker))
        }),
        "snapshot should omit processes without local-bind listeners"
    );
}

#[cfg(target_os = "linux")]
fn stream_ids_from_snapshots(stream_ids: &[u32]) -> Vec<u32> {
    let mut stream_ids = stream_ids.to_vec();
    stream_ids.sort_unstable();
    stream_ids
}

#[cfg(target_os = "linux")]
fn spawn_node_fixture(script_name: &str, args: &[&str]) -> Child {
    Command::new("node")
        .arg(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures")
                .join(script_name),
        )
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("node process should spawn")
}

#[cfg(target_os = "linux")]
fn reserve_available_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("port reservation listener should bind");
    let port = listener
        .local_addr()
        .expect("reserved listener should expose its address")
        .port();
    drop(listener);
    port
}

#[cfg(target_os = "linux")]
fn wait_until_listening(port: u16) {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for the test listener on port {port} to accept connections"
        );
        thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(target_os = "linux")]
fn terminate_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn read_telemetry_log_line<S>(socket: &mut WebSocket<S>) -> Value
where
    S: std::io::Read + std::io::Write,
{
    loop {
        match socket
            .read()
            .expect("websocket should receive one telemetry frame")
        {
            Message::Text(payload) => {
                let message: Value = serde_json::from_str(payload.as_str())
                    .expect("text payload should be valid json");
                match message["type"].as_str() {
                    Some("keepalive.state") | Some("runtime.ready") => continue,
                    _ => panic!("expected websocket binary telemetry frame"),
                }
            }
            Message::Binary(payload) => {
                let telemetry_payload = decode_telemetry_data_frame(payload.as_ref())
                    .expect("telemetry frame should decode");
                socket
                    .send(Message::Text(
                        json!({
                            "type": "telemetry.window",
                            "streamId": SANDBOX_TELEMETRY_LOG_STREAM_ID,
                            "bytes": telemetry_payload.len()
                        })
                        .to_string()
                        .into(),
                    ))
                    .expect("gateway should replenish telemetry stream credit");
                return serde_json::from_slice(&telemetry_payload)
                    .expect("telemetry frame should contain one json log line");
            }
            _ => panic!("expected websocket binary telemetry frame"),
        }
    }
}

fn read_telemetry_log_line_with_event<S>(socket: &mut WebSocket<S>, expected_event: &str) -> Value
where
    S: std::io::Read + std::io::Write,
{
    loop {
        let message = read_telemetry_log_line(socket);
        if message["event"] == Value::String(expected_event.to_string()) {
            return message;
        }
    }
}

fn accept_bootstrap_websocket(stream: TcpStream) -> (WebSocket<TcpStream>, String) {
    let request_uri = Arc::new(Mutex::new(None::<String>));
    let request_uri_capture = request_uri.clone();
    #[allow(clippy::result_large_err)]
    let websocket = accept_hdr(stream, move |request: &Request, response: Response| {
        *request_uri_capture
            .lock()
            .expect("request uri capture lock should not be poisoned") =
            Some(request.uri().to_string());
        Ok(response)
    })
    .expect("gateway websocket handshake should succeed");
    let request_uri = request_uri
        .lock()
        .expect("request uri capture lock should not be poisoned")
        .clone()
        .expect("captured bootstrap request uri should exist");
    (websocket, request_uri)
}

fn expect_tunnel_connected_publications(socket: &mut WebSocket<TcpStream>) {
    let telemetry_open = read_json_text_message(socket);
    assert_eq!(telemetry_open["type"], "telemetry.open");
    socket
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
        let control_message = read_json_text_message(socket);
        match control_message["type"].as_str() {
            Some("keepalive.state") => saw_keepalive = true,
            Some("operation.open") => {
                acknowledge_operation_open(socket, &control_message);
            }
            Some("runtime.ready") => saw_runtime_ready = true,
            other => panic!(
                "unexpected bootstrap control message while waiting for reconnect readiness: {other:?}"
            ),
        }
    }
}

fn acknowledge_operation_open(socket: &mut WebSocket<TcpStream>, message: &Value) {
    socket
        .send(Message::Text(
            json!({
                "type": "operation.open.ok",
                "streamId": message["streamId"],
                "initialWindowBytes": 1024
            })
            .to_string()
            .into(),
        ))
        .expect("gateway should acknowledge operation.open");
}

fn read_http_request(stream: &mut TcpStream) -> String {
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(1)))
        .expect("http request stream should accept a read timeout");
    let mut request_bytes = Vec::new();
    let mut buffer = [0_u8; 1024];
    loop {
        let bytes_read = stream
            .read(&mut buffer)
            .expect("http request stream should be readable");
        assert!(
            bytes_read > 0,
            "http request stream should not close before headers"
        );
        request_bytes.extend_from_slice(&buffer[..bytes_read]);
        if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    String::from_utf8(request_bytes).expect("http request should be valid utf-8")
}

fn assert_http_bearer_token(request: &str, expected_token: &str) {
    let normalized_request = request.to_ascii_lowercase();
    assert!(
        normalized_request.contains(&format!("\r\nauthorization: bearer {expected_token}\r\n")),
        "http request should contain the expected bearer token"
    );
}

fn assert_http_header(request: &str, header_name: &str, expected_value: &str) {
    let normalized_request = request.to_ascii_lowercase();
    let normalized_header_name = header_name.to_ascii_lowercase();
    let normalized_expected_value = expected_value.to_ascii_lowercase();
    assert!(
        normalized_request.contains(&format!(
            "\r\n{normalized_header_name}: {normalized_expected_value}\r\n"
        )),
        "http request should contain header '{header_name}: {expected_value}'"
    );
}

fn write_http_json_response(stream: &mut TcpStream, status_code: u16, body: &Value) {
    let body_bytes = body.to_string();
    let response = format!(
        "HTTP/1.1 {status_code} {}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
        status_text(status_code),
        body_bytes.len(),
        body_bytes
    );
    stream
        .write_all(response.as_bytes())
        .expect("http response should be writable");
    stream.flush().expect("http response should flush");
}

fn status_text(status_code: u16) -> &'static str {
    match status_code {
        200 => "OK",
        401 => "Unauthorized",
        404 => "Not Found",
        409 => "Conflict",
        _ => panic!("unexpected test status code {status_code}"),
    }
}

fn send_websocket_ping_and_expect_pong<S>(socket: &mut WebSocket<S>, payload: &[u8])
where
    S: std::io::Read + std::io::Write,
{
    socket
        .send(Message::Ping(payload.to_vec().into()))
        .expect("websocket ping should send");

    let Message::Pong(pong_payload) = socket
        .read()
        .expect("websocket should receive a pong response")
    else {
        panic!("expected websocket pong response");
    };

    assert_eq!(pong_payload.as_ref(), payload);
}
