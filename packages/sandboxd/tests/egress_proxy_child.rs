#[cfg(target_os = "linux")]
use std::fs;
#[cfg(target_os = "linux")]
use std::io::{Read, Write};
#[cfg(target_os = "linux")]
use std::net::{SocketAddr, TcpListener, TcpStream};
#[cfg(target_os = "linux")]
use std::os::fd::{AsRawFd, RawFd};
#[cfg(target_os = "linux")]
use std::process::{Child, Command, Stdio};
#[cfg(target_os = "linux")]
use std::sync::mpsc;
#[cfg(target_os = "linux")]
use std::thread;
#[cfg(target_os = "linux")]
use std::time::{Duration, Instant};

#[cfg(target_os = "linux")]
use sandboxd::control;
#[cfg(target_os = "linux")]
use sandboxd::protocol::activation::ActivationInput;
#[cfg(target_os = "linux")]
use sandboxd::test_support::TestEnvVarsGuard;
#[cfg(target_os = "linux")]
use sandboxd::time::{Sleeper, ThreadSleeper};
#[cfg(target_os = "linux")]
use tungstenite::{Message, accept};

#[cfg(target_os = "linux")]
#[test]
fn child_process_forwards_unmatched_plain_http_requests_directly() {
    let temp_dir = tempfile::Builder::new()
        .prefix("egress-child-supervisor-")
        .tempdir_in("/tmp")
        .expect("temp dir should be creatable");
    let upstream = start_single_request_http_server();
    let proxy_addr = reserve_loopback_address();
    let config_path = temp_dir.path().join("egress-proxy-child.json");
    let certificate_file = write_inherited_file(
        temp_dir.path().join("proxy-ca.pem"),
        "unused-plain-http-test-certificate",
    );
    let private_key_file = write_inherited_file(
        temp_dir.path().join("proxy-ca-key.pem"),
        "unused-plain-http-test-private-key",
    );
    fs::write(
        &config_path,
        serde_json::to_vec(&serde_json::json!({
            "sandboxInstanceId": "sbi_child_process_test",
            "listenAddr": proxy_addr.to_string(),
            "tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox/sbi_child_process_test",
            "routes": [],
            "proxyCaCertificateFd": certificate_file.as_raw_fd(),
            "proxyCaPrivateKeyFd": private_key_file.as_raw_fd()
        }))
        .expect("child config should serialize"),
    )
    .expect("child config should be writable");

    let mut child = Command::new(env!("CARGO_BIN_EXE_sandboxd"))
        .arg("egress-proxy")
        .arg("--config")
        .arg(&config_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("egress proxy child process should spawn");

    wait_until_tcp_accepts(proxy_addr, &mut child);

    let response = send_proxy_http_request(
        proxy_addr,
        &format!("http://{}/direct-child", upstream.addr),
        &upstream.addr.to_string(),
    );
    let observed_request = upstream
        .request_receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("upstream should receive forwarded request");

    assert!(response.contains("HTTP/1.1 200 OK"));
    assert!(response.contains("child-proxy-upstream-ok"));
    assert_eq!(observed_request.request_line, "GET /direct-child HTTP/1.1");
    assert_eq!(
        observed_request.host_header,
        Some(upstream.addr.to_string())
    );

    terminate_child(child);
}

#[cfg(target_os = "linux")]
#[test]
fn process_supervisor_restarts_child_after_the_active_proxy_exits() {
    if !nix::unistd::geteuid().is_root() {
        eprintln!(
            "skipping egress proxy child supervisor restart test because production CA paths require root"
        );
        return;
    }

    let temp_dir = tempfile::Builder::new()
        .prefix("egress-child-supervisor-")
        .tempdir_in("/tmp")
        .expect("temp dir should be creatable");
    let _env_guard = TestEnvVarsGuard::set([
        (
            "MISTLE_SANDBOXD_EGRESS_PROXY_CHILD_PATH",
            env!("CARGO_BIN_EXE_sandboxd").to_string(),
        ),
        ("MISTLE_SANDBOXD_ENABLE_TEST_FAULTS", "1".to_string()),
    ]);
    let control_socket_path = temp_dir.path().join("control.sock");
    let global_git_config_path = temp_dir.path().join(".gitconfig");
    let upstream = start_single_request_http_server();
    let bootstrap_gateway = start_bootstrap_gateway();
    let server = control::start_control_server_with_health_endpoint(
        &control_socket_path,
        "127.0.0.1:0"
            .parse()
            .expect("health endpoint address should parse"),
        ThreadSleeper,
        control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        &global_git_config_path,
    )
    .expect("control server should start");

    control::submit_activate(
        &control_socket_path,
        &startup_input_with_egress_route(&bootstrap_gateway.ws_url),
    )
    .expect("activation submission should succeed");
    wait_for_activated(&server);
    let initial_component = wait_for_egress_proxy_restart_count(server.health_endpoint_addr(), 0);
    let proxy_addr: SocketAddr = initial_component["details"]["listenAddr"]
        .as_str()
        .expect("egress proxy listenAddr detail should exist")
        .parse()
        .expect("egress proxy listenAddr should parse");
    assert_eq!(initial_component["details"]["runtimeMode"], "child_process");
    assert_eq!(
        initial_component["details"]["childBinary"],
        env!("CARGO_BIN_EXE_sandboxd")
    );
    let initial_child_pid = component_child_pid(&initial_component);

    let initial_response = send_proxy_http_request(
        proxy_addr,
        &format!("http://{}/before-restart", upstream.addr),
        &upstream.addr.to_string(),
    );
    assert!(initial_response.contains("HTTP/1.1 200 OK"));
    upstream
        .request_receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("upstream should receive the first proxied request");

    let (fault_status, fault_body) = fetch_http_json_response(
        server.health_endpoint_addr(),
        "POST",
        "/__faults/components/egress-proxy/kill",
    );
    assert_eq!(fault_status, 200);
    assert_eq!(fault_body["status"], "accepted");
    assert_eq!(fault_body["component"], "egress_proxy");
    assert_eq!(fault_body["action"], "kill");

    let restarted_component = wait_for_egress_proxy_restart_count(server.health_endpoint_addr(), 1);
    assert_eq!(restarted_component["state"], "healthy");
    assert_eq!(
        restarted_component["details"]["runtimeMode"],
        "child_process"
    );
    let restarted_child_pid = component_child_pid(&restarted_component);
    assert_ne!(restarted_child_pid, initial_child_pid);
    let restarted_upstream = start_single_request_http_server();
    let restarted_response = send_proxy_http_request(
        proxy_addr,
        &format!("http://{}/after-restart", restarted_upstream.addr),
        &restarted_upstream.addr.to_string(),
    );
    assert!(restarted_response.contains("HTTP/1.1 200 OK"));
    restarted_upstream
        .request_receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("upstream should receive the proxied request after restart");

    server.close().expect("control server should stop cleanly");
    bootstrap_gateway
        .close()
        .expect("bootstrap gateway should stop cleanly");
}

#[cfg(target_os = "linux")]
fn write_inherited_file(path: std::path::PathBuf, payload: &str) -> fs::File {
    fs::write(&path, payload).expect("inherited fd payload should be writable");
    let file = fs::File::open(&path).expect("inherited fd payload should be openable");
    clear_close_on_exec(file.as_raw_fd());
    file
}

#[cfg(target_os = "linux")]
fn clear_close_on_exec(fd: RawFd) {
    sandboxd::bootstrap::clear_close_on_exec(fd)
        .expect("inherited fd should remain open across sandboxd child exec");
}

#[cfg(target_os = "linux")]
fn startup_input_with_egress_route(tunnel_gateway_ws_url: &str) -> ActivationInput {
    ActivationInput {
        operation_kind: sandboxd::protocol::startup::ActivationOperationKind::Start,
        bootstrap_token: "bootstrap-token-value".to_string(),
        tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
        tunnel_gateway_ws_url: tunnel_gateway_ws_url.to_string(),
        runtime_plan: serde_json::json!({
            "sandboxProfileId": "sbp_egress_proxy_child",
            "version": 1,
            "image": {
                "source": "base",
                "imageRef": "registry.example.test/base:latest"
            },
            "egressRoutes": [
                {
                    "egressRuleId": "egr_child_restart",
                    "bindingId": "binding_child_restart",
                    "familyId": "family_child_restart",
                    "variantId": "variant_child_restart",
                    "match": {
                        "hosts": ["api.example.test"]
                    },
                    "upstream": {
                        "baseUrl": "https://api.example.test"
                    },
                    "authInjection": {
                        "type": "bearer"
                    },
                    "credentialResolver": {
                        "kind": "mistle_mcp_token",
                        "apiKeyId": "api_key_child_restart"
                    }
                }
            ],
            "artifacts": [],
            "workspaceSources": [],
            "runtimeClients": [],
            "agentRuntimes": []
        }),
        git_identity: None,
        acting_user_id: None,
        transparent_proxy: None,
    }
}

#[cfg(target_os = "linux")]
struct SingleRequestHttpServer {
    addr: SocketAddr,
    request_receiver: mpsc::Receiver<ObservedHttpRequest>,
}

#[cfg(target_os = "linux")]
struct ObservedHttpRequest {
    request_line: String,
    host_header: Option<String>,
}

#[cfg(target_os = "linux")]
struct BootstrapGateway {
    ws_url: String,
    shutdown_sender: mpsc::Sender<()>,
    thread: Option<thread::JoinHandle<()>>,
}

#[cfg(target_os = "linux")]
impl BootstrapGateway {
    fn close(mut self) -> Result<(), String> {
        let _ = self.shutdown_sender.send(());
        let thread = self
            .thread
            .take()
            .expect("bootstrap gateway thread should exist");
        thread
            .join()
            .map_err(|_| "bootstrap gateway thread panicked".to_string())
    }
}

#[cfg(target_os = "linux")]
fn start_bootstrap_gateway() -> BootstrapGateway {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bootstrap gateway should bind");
    listener
        .set_nonblocking(true)
        .expect("bootstrap gateway listener should become nonblocking");
    let ws_url = format!(
        "ws://127.0.0.1:{}/bootstrap",
        listener
            .local_addr()
            .expect("bootstrap gateway should expose an address")
            .port()
    );
    let (shutdown_sender, shutdown_receiver) = mpsc::channel();

    let thread = thread::spawn(move || {
        loop {
            if shutdown_receiver.try_recv().is_ok() {
                return;
            }

            match listener.accept() {
                Ok((stream, _)) => {
                    stream
                        .set_nonblocking(false)
                        .expect("bootstrap gateway stream should become blocking");
                    stream
                        .set_read_timeout(Some(Duration::from_millis(100)))
                        .expect("bootstrap gateway stream should have a read timeout");
                    let mut websocket =
                        accept(stream).expect("bootstrap gateway handshake should succeed");
                    loop {
                        if shutdown_receiver.try_recv().is_ok() {
                            return;
                        }

                        match websocket.read() {
                            Ok(Message::Close(_)) => return,
                            Ok(
                                Message::Text(_)
                                | Message::Binary(_)
                                | Message::Ping(_)
                                | Message::Pong(_)
                                | Message::Frame(_),
                            ) => {}
                            Err(tungstenite::Error::Io(error))
                                if error.kind() == std::io::ErrorKind::WouldBlock
                                    || error.kind() == std::io::ErrorKind::TimedOut => {}
                            Err(_) => return,
                        }
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    ThreadSleeper.sleep(sandboxd::time::Duration::from_millis(10));
                }
                Err(error) => panic!("bootstrap gateway accept should succeed: {error}"),
            }
        }
    });

    BootstrapGateway {
        ws_url,
        shutdown_sender,
        thread: Some(thread),
    }
}

#[cfg(target_os = "linux")]
fn start_single_request_http_server() -> SingleRequestHttpServer {
    let listener = TcpListener::bind("127.0.0.1:0").expect("upstream listener should bind");
    let addr = listener
        .local_addr()
        .expect("upstream listener address should be available");
    let (request_sender, request_receiver) = mpsc::channel();

    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("upstream should accept request");
        let mut buffer = [0_u8; 4096];
        let byte_count = stream
            .read(&mut buffer)
            .expect("upstream should read request");
        let request_text = String::from_utf8_lossy(&buffer[..byte_count]);
        let mut lines = request_text.lines();
        let request_line = lines
            .next()
            .expect("request should include request line")
            .to_string();
        let host_header = lines.find_map(|line| {
            line.strip_prefix("host: ")
                .or_else(|| line.strip_prefix("Host: "))
                .map(str::to_string)
        });

        request_sender
            .send(ObservedHttpRequest {
                request_line,
                host_header,
            })
            .expect("observed request should be sent");
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\ncontent-length: 23\r\nconnection: close\r\n\r\nchild-proxy-upstream-ok",
            )
            .expect("upstream response should be written");
    });

    SingleRequestHttpServer {
        addr,
        request_receiver,
    }
}

#[cfg(target_os = "linux")]
fn wait_for_activated(server: &control::ControlServer) {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        match server.activation_phase() {
            control::ActivationPhase::Activated => return,
            control::ActivationPhase::Failed(error) => {
                panic!("sandboxd activation failed before egress proxy became available: {error}");
            }
            control::ActivationPhase::Activating | control::ActivationPhase::Unactivated => {}
        }

        if Instant::now() >= deadline {
            panic!("timed out waiting for sandboxd activation");
        }
        ThreadSleeper.sleep(sandboxd::time::Duration::from_millis(25));
    }
}

#[cfg(target_os = "linux")]
fn wait_for_egress_proxy_restart_count(
    health_endpoint_addr: SocketAddr,
    minimum_restart_count: u64,
) -> serde_json::Value {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let (status_code, body) = fetch_http_json_response(
            health_endpoint_addr,
            "GET",
            control::DEFAULT_HEALTH_ENDPOINT_PATH,
        );
        assert_eq!(status_code, 200);
        if let Some(component) = find_egress_proxy_component(&body)
            && component["state"] == "healthy"
            && component["restart_count"].as_u64().unwrap_or_default() >= minimum_restart_count
        {
            return component.clone();
        }

        if Instant::now() >= deadline {
            panic!(
                "timed out waiting for egress proxy restart_count >= {minimum_restart_count}: {body}"
            );
        }
        ThreadSleeper.sleep(sandboxd::time::Duration::from_millis(50));
    }
}

#[cfg(target_os = "linux")]
fn component_child_pid(component: &serde_json::Value) -> u32 {
    let child_pid = component["details"]["childPid"]
        .as_str()
        .expect("egress proxy childPid detail should exist")
        .parse::<u32>()
        .expect("egress proxy childPid should parse");
    assert!(child_pid > 0);
    child_pid
}

#[cfg(target_os = "linux")]
fn find_egress_proxy_component(body: &serde_json::Value) -> Option<&serde_json::Value> {
    body["snapshot"]["components"]
        .as_array()?
        .iter()
        .find(|component| component["component"] == "egress_proxy")
}

#[cfg(target_os = "linux")]
fn fetch_http_json_response(
    health_endpoint_addr: SocketAddr,
    method: &str,
    path: &str,
) -> (u16, serde_json::Value) {
    let mut stream =
        TcpStream::connect(health_endpoint_addr).expect("health endpoint should accept TCP");
    stream
        .write_all(
            format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .expect("health endpoint request should write");
    let mut raw_response = String::new();
    stream
        .read_to_string(&mut raw_response)
        .expect("health endpoint response should read");
    let (head, body) = raw_response
        .split_once("\r\n\r\n")
        .expect("HTTP response should contain headers and body");
    let status_code = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .expect("HTTP response status should parse");
    (
        status_code,
        serde_json::from_str(body).expect("health endpoint body should be JSON"),
    )
}

#[cfg(target_os = "linux")]
fn reserve_loopback_address() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").expect("reserved listener should bind");
    listener
        .local_addr()
        .expect("reserved listener address should be available")
}

#[cfg(target_os = "linux")]
fn wait_until_tcp_accepts(addr: SocketAddr, child: &mut Child) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(status) = child
            .try_wait()
            .expect("child process status should be available")
        {
            let mut stderr = String::new();
            if let Some(mut child_stderr) = child.stderr.take() {
                child_stderr
                    .read_to_string(&mut stderr)
                    .expect("child stderr should be readable");
            }
            panic!("egress proxy child exited before accepting tcp connections: {status} {stderr}");
        }

        if TcpStream::connect_timeout(&addr, Duration::from_millis(100)).is_ok() {
            return;
        }

        if Instant::now() >= deadline {
            terminate_child_by_mut_ref(child);
            panic!("timed out waiting for egress proxy child to listen on {addr}");
        }

        thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(target_os = "linux")]
fn send_proxy_http_request(proxy_addr: SocketAddr, target_url: &str, host_header: &str) -> String {
    let mut stream = TcpStream::connect(proxy_addr).expect("proxy connection should open");
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .expect("proxy read timeout should be set");
    write!(
        stream,
        "GET {target_url} HTTP/1.1\r\nHost: {host_header}\r\nConnection: close\r\n\r\n"
    )
    .expect("proxy request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("proxy response should be readable");
    response
}

#[cfg(target_os = "linux")]
fn terminate_child(mut child: Child) {
    terminate_child_by_mut_ref(&mut child);
}

#[cfg(target_os = "linux")]
fn terminate_child_by_mut_ref(child: &mut Child) {
    if child
        .try_wait()
        .expect("child process status should be available")
        .is_none()
    {
        child.kill().expect("child process should be killable");
    }
    let _ = child.wait();
}
