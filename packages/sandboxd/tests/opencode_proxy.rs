use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use serde_json::{Value, json};
use tungstenite::{Message, connect};

use sandboxd::opencode_proxy::{derive_opencode_raw_server_url, start_opencode_proxy};
use sandboxd::runtime::readiness::RuntimeReadinessManager;

#[test]
fn relays_http_requests_over_the_websocket_runtime_endpoint() {
    let simulated_server = SimulatedOpenCodeServer::start(|request| {
        assert_eq!(request.method, "POST");
        assert_eq!(
            request.path,
            "/session/session_123/message?directory=%2Fworkspace"
        );
        assert!(request.body.contains("\"message\":\"hello\""));
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{\"ok\":true}"
            .to_string()
    });

    let runtime_readiness_manager =
        std::sync::Arc::new(std::sync::Mutex::new(RuntimeReadinessManager::default()));
    let proxy = start_opencode_proxy(
        "ws://127.0.0.1:0/opencode",
        &simulated_server.base_url,
        runtime_readiness_manager,
    )
    .expect("OpenCode proxy should start");

    let (mut client, _) = connect(proxy.listen_url()).expect("proxy websocket should connect");
    client
        .send(Message::Text(
            json!({
                "id": 7,
                "method": "POST",
                "path": "/session/session_123/message?directory=%2Fworkspace",
                "body": {
                    "message": "hello"
                }
            })
            .to_string()
            .into(),
        ))
        .expect("websocket request should send");

    let response = read_json_text_message(&mut client);
    assert_eq!(response["id"], json!(7));
    assert_eq!(response["type"], json!("response"));
    assert_eq!(response["status"], json!(200));
    assert_eq!(response["body"], json!("{\"ok\":true}"));

    client.close(None).expect("websocket should close cleanly");
    proxy.close().expect("OpenCode proxy should close cleanly");
    simulated_server.join();
}

#[test]
fn relays_opencode_event_streams_as_websocket_sse_frames() {
    let simulated_server = SimulatedOpenCodeServer::start(|request| {
        assert_eq!(request.method, "GET");
        assert_eq!(request.path, "/event");
        // OpenCode's EventApi returns text/event-stream events with event:
        // message and JSON-stringified data from the bus.
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\nevent: message\ndata: {\"type\":\"server.connected\"}\n\n"
            .to_string()
    });

    let runtime_readiness_manager =
        std::sync::Arc::new(std::sync::Mutex::new(RuntimeReadinessManager::default()));
    let proxy = start_opencode_proxy(
        "ws://127.0.0.1:0/opencode",
        &simulated_server.base_url,
        runtime_readiness_manager,
    )
    .expect("OpenCode proxy should start");

    let (mut client, _) = connect(proxy.listen_url()).expect("proxy websocket should connect");
    client
        .send(Message::Text(
            json!({
                "id": "events",
                "method": "GET",
                "path": "/event"
            })
            .to_string()
            .into(),
        ))
        .expect("websocket request should send");

    let response = read_json_text_message(&mut client);
    assert_eq!(response["id"], json!("events"));
    assert_eq!(response["type"], json!("response"));
    assert_eq!(response["status"], json!(200));

    let event = read_json_text_message(&mut client);
    assert_eq!(event["id"], json!("events"));
    assert_eq!(event["type"], json!("sse"));
    assert_eq!(event["event"], json!("message"));
    assert_eq!(event["data"], json!("{\"type\":\"server.connected\"}"));

    let complete = read_json_text_message(&mut client);
    assert_eq!(complete["id"], json!("events"));
    assert_eq!(complete["type"], json!("complete"));

    client.close(None).expect("websocket should close cleanly");
    proxy.close().expect("OpenCode proxy should close cleanly");
    simulated_server.join();
}

#[test]
fn returns_bad_gateway_when_raw_opencode_server_is_unavailable_and_keeps_proxy_alive() {
    let unavailable_listener =
        TcpListener::bind("127.0.0.1:0").expect("unavailable listener should bind");
    let unavailable_port = unavailable_listener
        .local_addr()
        .expect("unavailable listener should expose address")
        .port();
    drop(unavailable_listener);

    let runtime_readiness_manager =
        std::sync::Arc::new(std::sync::Mutex::new(RuntimeReadinessManager::default()));
    let proxy = start_opencode_proxy(
        "ws://127.0.0.1:0/opencode",
        &format!("http://127.0.0.1:{unavailable_port}"),
        runtime_readiness_manager,
    )
    .expect("OpenCode proxy should start");

    let (mut first_client, _) =
        connect(proxy.listen_url()).expect("proxy websocket should connect");
    first_client
        .send(Message::Text(
            json!({
                "id": "first",
                "method": "GET",
                "path": "/global/health"
            })
            .to_string()
            .into(),
        ))
        .expect("first websocket request should send");

    let first_response = read_json_text_message(&mut first_client);
    assert_eq!(first_response["id"], json!("first"));
    assert_eq!(first_response["type"], json!("response"));
    assert_eq!(first_response["status"], json!(502));
    assert!(
        first_response["body"]
            .as_str()
            .expect("response body should be a string")
            .contains("OpenCode upstream request failed")
    );
    first_client
        .close(None)
        .expect("first websocket should close cleanly");

    let (mut second_client, _) =
        connect(proxy.listen_url()).expect("proxy should still accept websocket connections");
    second_client
        .send(Message::Text(
            json!({
                "id": "second",
                "method": "GET",
                "path": "/global/health"
            })
            .to_string()
            .into(),
        ))
        .expect("second websocket request should send");

    let second_response = read_json_text_message(&mut second_client);
    assert_eq!(second_response["id"], json!("second"));
    assert_eq!(second_response["type"], json!("response"));
    assert_eq!(second_response["status"], json!(502));

    second_client
        .close(None)
        .expect("second websocket should close cleanly");
    proxy.close().expect("OpenCode proxy should close cleanly");
}

#[test]
fn derives_raw_server_origin_from_opencode_health_url() {
    let raw_server_url = derive_opencode_raw_server_url("http://127.0.0.1:4511/global/health")
        .expect("OpenCode health URL should derive to origin");

    assert_eq!(raw_server_url, "http://127.0.0.1:4511");
}

struct SimulatedOpenCodeServer {
    base_url: String,
    request_receiver: mpsc::Receiver<()>,
    thread: thread::JoinHandle<()>,
}

impl SimulatedOpenCodeServer {
    fn start(handle_request: fn(SimulatedHttpRequest) -> String) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("simulated server should bind");
        let port = listener
            .local_addr()
            .expect("simulated server should expose address")
            .port();
        let (request_sender, request_receiver) = mpsc::channel();
        let thread = thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("simulated server should accept proxied request");
            let request = read_http_request_from_stream(&mut stream);
            let response = handle_request(request);
            stream
                .write_all(response.as_bytes())
                .expect("simulated response should write");
            request_sender
                .send(())
                .expect("simulated server completion should send");
        });

        Self {
            base_url: format!("http://127.0.0.1:{port}"),
            request_receiver,
            thread,
        }
    }

    fn join(self) {
        self.request_receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("simulated server should receive proxied request");
        self.thread
            .join()
            .expect("simulated server thread should exit cleanly");
    }
}

struct SimulatedHttpRequest {
    method: String,
    path: String,
    body: String,
}

fn read_http_request_from_stream(stream: &mut TcpStream) -> SimulatedHttpRequest {
    let mut buffer = Vec::new();
    let mut scratch = [0_u8; 1024];
    loop {
        let bytes_read = stream
            .read(&mut scratch)
            .expect("simulated request should read");
        if bytes_read == 0 {
            break;
        }
        buffer.extend_from_slice(&scratch[..bytes_read]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let request = String::from_utf8(buffer).expect("simulated request should be utf8");
    let header_end = request
        .find("\r\n\r\n")
        .expect("simulated request should include header terminator");
    let (headers, initial_body) = request.split_at(header_end + 4);
    let request_line = headers
        .lines()
        .next()
        .expect("simulated request should include request line");
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .expect("simulated request should include method")
        .to_string();
    let path = request_parts
        .next()
        .expect("simulated request should include path")
        .to_string();
    let content_length = headers
        .lines()
        .find_map(|line| {
            line.to_ascii_lowercase()
                .strip_prefix("content-length: ")
                .map(str::to_string)
        })
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = initial_body.to_string();
    while body.len() < content_length {
        let bytes_read = stream
            .read(&mut scratch)
            .expect("simulated request body should read");
        if bytes_read == 0 {
            break;
        }
        body.push_str(
            std::str::from_utf8(&scratch[..bytes_read])
                .expect("simulated request body should be utf8"),
        );
    }

    SimulatedHttpRequest { method, path, body }
}

fn read_json_text_message<S>(client: &mut tungstenite::WebSocket<S>) -> Value
where
    S: Read + Write,
{
    let message = client
        .read()
        .expect("websocket should receive a text message");
    let Message::Text(payload) = message else {
        panic!("expected websocket text message");
    };
    serde_json::from_str(payload.as_str()).expect("websocket payload should be json")
}
