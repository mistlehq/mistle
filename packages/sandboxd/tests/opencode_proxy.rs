use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Duration;

use serde_json::{Value, json};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket, connect};

use sandboxd::opencode_proxy::{derive_opencode_raw_server_url, start_opencode_proxy};
use sandboxd::runtime::readiness::RuntimeReadinessManager;
use sandboxd::time::{Sleeper, ThreadSleeper};

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

    let proxy = start_opencode_proxy(
        "ws://127.0.0.1:0/opencode",
        &simulated_server.base_url,
        runtime_readiness_manager(),
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

    let proxy = start_opencode_proxy(
        "ws://127.0.0.1:0/opencode",
        &simulated_server.base_url,
        runtime_readiness_manager(),
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
fn proxy_survives_client_disconnect_while_event_stream_is_open() {
    let raw_server = start_simulated_streaming_opencode_server();
    let proxy = start_opencode_proxy(
        "ws://127.0.0.1:0/opencode",
        &format!("http://{}", raw_server.listener_address),
        runtime_readiness_manager(),
    )
    .expect("OpenCode proxy should start");

    let (mut event_client, _) = connect_to_proxy_with_retry(
        proxy.listen_url(),
        &ThreadSleeper,
        sandboxd::time::Duration::from_secs(5),
    );
    event_client
        .send(Message::Text(
            json!({
                "id": "events-1",
                "method": "GET",
                "path": "/event",
                "headers": {}
            })
            .to_string()
            .into(),
        ))
        .expect("event request should send");

    let event_response = read_json_text_message(&mut event_client);
    assert_eq!(event_response["type"], json!("response"));
    assert_eq!(event_response["status"], json!(200));

    drop(event_client);

    ThreadSleeper.sleep(sandboxd::time::Duration::from_millis(150));

    let (mut health_client, _) = connect_to_proxy_with_retry(
        proxy.listen_url(),
        &ThreadSleeper,
        sandboxd::time::Duration::from_secs(2),
    );
    health_client
        .send(Message::Text(
            json!({
                "id": "health-1",
                "method": "GET",
                "path": "/global/health",
                "headers": {}
            })
            .to_string()
            .into(),
        ))
        .expect("health request should send after event client disconnect");

    let health_response = read_json_text_message(&mut health_client);
    assert_eq!(health_response["type"], json!("response"));
    assert_eq!(health_response["status"], json!(200));
    assert_eq!(health_response["body"], json!("ok"));

    health_client
        .close(None)
        .expect("health client should close cleanly");
    proxy.close().expect("OpenCode proxy should close cleanly");
    raw_server.close();
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

    let proxy = start_opencode_proxy(
        "ws://127.0.0.1:0/opencode",
        &format!("http://127.0.0.1:{unavailable_port}"),
        runtime_readiness_manager(),
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

struct StreamingSimulatedOpenCodeServer {
    listener_address: SocketAddr,
    shutdown_requested: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl StreamingSimulatedOpenCodeServer {
    fn close(mut self) {
        self.shutdown_requested.store(true, Ordering::Relaxed);
        let _ = TcpStream::connect(self.listener_address);
        if let Some(thread) = self.thread.take() {
            thread
                .join()
                .expect("streaming simulated OpenCode server should stop cleanly");
        }
    }
}

struct SimulatedHttpRequest {
    method: String,
    path: String,
    body: String,
}

fn start_simulated_streaming_opencode_server() -> StreamingSimulatedOpenCodeServer {
    let listener =
        TcpListener::bind(("127.0.0.1", 0)).expect("simulated OpenCode server should bind");
    let listener_address = listener
        .local_addr()
        .expect("simulated OpenCode server should expose its address");
    listener
        .set_nonblocking(true)
        .expect("simulated OpenCode server listener should become nonblocking");
    let shutdown_requested = Arc::new(AtomicBool::new(false));
    let thread_shutdown_requested = shutdown_requested.clone();
    let thread = thread::spawn(move || {
        while !thread_shutdown_requested.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let request_shutdown_requested = thread_shutdown_requested.clone();
                    thread::spawn(move || {
                        handle_streaming_simulated_opencode_request(
                            stream,
                            request_shutdown_requested,
                        );
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("simulated OpenCode server accept failed: {error}"),
            }
        }
    });

    StreamingSimulatedOpenCodeServer {
        listener_address,
        shutdown_requested,
        thread: Some(thread),
    }
}

fn handle_streaming_simulated_opencode_request(
    mut stream: TcpStream,
    shutdown_requested: Arc<AtomicBool>,
) {
    stream
        .set_nonblocking(false)
        .expect("simulated OpenCode request stream should become blocking");
    let request = read_http_request_from_stream(&mut stream);
    if request.method == "GET" && request.path == "/event" {
        // OpenCode's EventApi returns a long-lived text/event-stream response;
        // production clients subscribe through
        // packages/integrations-definitions/src/agent-runtimes/opencode/client.ts.
        // Keeping the response open exercises cleanup of an active proxy
        // request task when the websocket client disconnects.
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n\r\nevent: message\ndata: {\"type\":\"ready\"}\n\n",
            )
            .expect("simulated OpenCode SSE response should write");
        while !shutdown_requested.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(25));
        }
        return;
    }

    if request.method == "GET" && request.path == "/global/health" {
        // The compiled OpenCode runtime uses /global/health as its readiness
        // check in packages/integrations-definitions/src/agent-runtimes/opencode/compile-runtime.ts.
        stream
            .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok")
            .expect("simulated OpenCode health response should write");
        return;
    }

    stream
        .write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 9\r\n\r\nnot found")
        .expect("simulated OpenCode not-found response should write");
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

fn connect_to_proxy_with_retry(
    proxy_url: &str,
    sleeper: &dyn Sleeper,
    timeout: sandboxd::time::Duration,
) -> (
    WebSocket<MaybeTlsStream<TcpStream>>,
    tungstenite::handshake::client::Response,
) {
    let attempts = (timeout.as_millis() / 20).max(1);
    let mut last_error = None;

    for _ in 0..attempts {
        match connect(proxy_url) {
            Ok(connection) => return connection,
            Err(error) => {
                last_error = Some(error);
                sleeper.sleep(sandboxd::time::Duration::from_millis(20));
            }
        }
    }

    panic!(
        "timed out connecting to proxy {proxy_url}: {}",
        last_error.expect("last proxy connection error should exist")
    );
}

fn read_json_text_message<S>(client: &mut WebSocket<S>) -> Value
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

fn runtime_readiness_manager() -> Arc<Mutex<RuntimeReadinessManager>> {
    Arc::new(Mutex::new(RuntimeReadinessManager::default()))
}
