//! Runtime proxy and agent endpoint probes owned by initialized sandboxd state.
//!
//! These probes validate the local boundary sandboxd uses before publishing
//! `runtime.ready: true`: the runtime-specific proxy can answer a cheap request
//! where applicable, and the final agent endpoint websocket can be opened.

use std::collections::BTreeMap;
use std::net::TcpStream;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde_json::{Value, json};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket, connect};

use crate::supervision::{ComponentHealthState, SandboxdSupervisorHandle, SupervisedComponent};

const RUNTIME_PROBE_INTERVAL: Duration = Duration::from_millis(100);
const RUNTIME_PROBE_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Debug, Clone)]
pub(super) struct RuntimeAgentProbePlan {
    pub(super) agent_endpoint_url: String,
    pub(super) runtime_probe: RuntimeSpecificProbe,
}

#[derive(Debug, Clone)]
pub(super) enum RuntimeSpecificProbe {
    Codex,
    OpenCode {
        proxy_url: String,
        health_path: String,
        expected_status: u16,
    },
    Pi {
        proxy_url: String,
    },
}

pub(super) struct RuntimeAgentProbeHandle {
    shutdown_requested: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}

impl RuntimeAgentProbeHandle {
    pub(super) fn start(
        plan: RuntimeAgentProbePlan,
        supervisor_handle: SandboxdSupervisorHandle,
    ) -> Self {
        let shutdown_requested = Arc::new(AtomicBool::new(false));
        let mut threads = Vec::new();
        let agent_probe_shutdown = shutdown_requested.clone();
        let agent_probe_supervisor = supervisor_handle.clone();
        let agent_endpoint_url = plan.agent_endpoint_url.clone();
        threads.push(thread::spawn(move || {
            run_runtime_agent_endpoint_probe_loop(
                agent_endpoint_url,
                agent_probe_supervisor,
                agent_probe_shutdown,
            );
        }));

        match plan.runtime_probe {
            RuntimeSpecificProbe::Codex => {}
            RuntimeSpecificProbe::OpenCode {
                proxy_url,
                health_path,
                expected_status,
            } => {
                let opencode_probe_shutdown = shutdown_requested.clone();
                let opencode_probe_supervisor = supervisor_handle.clone();
                threads.push(thread::spawn(move || {
                    run_opencode_proxy_connectivity_probe_loop(
                        proxy_url,
                        health_path,
                        expected_status,
                        opencode_probe_supervisor,
                        opencode_probe_shutdown,
                    );
                }));
            }
            RuntimeSpecificProbe::Pi { proxy_url } => {
                let pi_probe_shutdown = shutdown_requested.clone();
                let pi_probe_supervisor = supervisor_handle;
                threads.push(thread::spawn(move || {
                    run_pi_proxy_connectivity_probe_loop(
                        proxy_url,
                        pi_probe_supervisor,
                        pi_probe_shutdown,
                    );
                }));
            }
        }

        Self {
            shutdown_requested,
            threads,
        }
    }

    pub(super) fn close(mut self) {
        self.shutdown_requested.store(true, Ordering::Relaxed);
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

fn run_runtime_agent_endpoint_probe_loop(
    agent_endpoint_url: String,
    supervisor_handle: SandboxdSupervisorHandle,
    shutdown_requested: Arc<AtomicBool>,
) {
    let component = SupervisedComponent::RuntimeAgentEndpoint;
    supervisor_handle.replace_component_details(
        component,
        BTreeMap::from([("endpointUrl".to_string(), agent_endpoint_url.clone())]),
    );
    supervisor_handle.mark_component_starting(component);

    while !shutdown_requested.load(Ordering::Relaxed) {
        match check_websocket_handshake(&agent_endpoint_url) {
            Ok(()) => mark_probe_healthy(
                &supervisor_handle,
                component,
                BTreeMap::from([
                    ("endpointUrl".to_string(), agent_endpoint_url.clone()),
                    ("connectivityState".to_string(), "Connected".to_string()),
                ]),
            ),
            Err(error) => mark_probe_failure(
                &supervisor_handle,
                component,
                BTreeMap::from([("endpointUrl".to_string(), agent_endpoint_url.clone())]),
                error,
                "agent_endpoint_websocket",
            ),
        }
        thread::sleep(RUNTIME_PROBE_INTERVAL);
    }
}

fn run_opencode_proxy_connectivity_probe_loop(
    proxy_url: String,
    health_path: String,
    expected_status: u16,
    supervisor_handle: SandboxdSupervisorHandle,
    shutdown_requested: Arc<AtomicBool>,
) {
    let component = SupervisedComponent::OpenCodeProxyConnectivity;
    supervisor_handle.replace_component_details(
        component,
        BTreeMap::from([
            ("proxyUrl".to_string(), proxy_url.clone()),
            ("healthPath".to_string(), health_path.clone()),
            ("expectedStatus".to_string(), expected_status.to_string()),
        ]),
    );
    supervisor_handle.mark_component_starting(component);

    while !shutdown_requested.load(Ordering::Relaxed) {
        match check_opencode_proxy_connectivity(&proxy_url, &health_path, expected_status) {
            Ok(observed_status) => mark_probe_healthy(
                &supervisor_handle,
                component,
                BTreeMap::from([
                    ("proxyUrl".to_string(), proxy_url.clone()),
                    ("healthPath".to_string(), health_path.clone()),
                    ("expectedStatus".to_string(), expected_status.to_string()),
                    ("observedStatus".to_string(), observed_status.to_string()),
                    ("connectivityState".to_string(), "Connected".to_string()),
                ]),
            ),
            Err(error) => mark_probe_failure(
                &supervisor_handle,
                component,
                BTreeMap::from([
                    ("proxyUrl".to_string(), proxy_url.clone()),
                    ("healthPath".to_string(), health_path.clone()),
                    ("expectedStatus".to_string(), expected_status.to_string()),
                ]),
                error,
                "opencode_proxy_health",
            ),
        }
        thread::sleep(RUNTIME_PROBE_INTERVAL);
    }
}

fn run_pi_proxy_connectivity_probe_loop(
    proxy_url: String,
    supervisor_handle: SandboxdSupervisorHandle,
    shutdown_requested: Arc<AtomicBool>,
) {
    let component = SupervisedComponent::PiProxyConnectivity;
    supervisor_handle.replace_component_details(
        component,
        BTreeMap::from([
            ("proxyUrl".to_string(), proxy_url.clone()),
            ("requestMethod".to_string(), "pi/getState".to_string()),
        ]),
    );
    supervisor_handle.mark_component_starting(component);

    while !shutdown_requested.load(Ordering::Relaxed) {
        match check_pi_proxy_connectivity(&proxy_url) {
            Ok(()) => mark_probe_healthy(
                &supervisor_handle,
                component,
                BTreeMap::from([
                    ("proxyUrl".to_string(), proxy_url.clone()),
                    ("requestMethod".to_string(), "pi/getState".to_string()),
                    ("connectivityState".to_string(), "Connected".to_string()),
                ]),
            ),
            Err(error) => mark_probe_failure(
                &supervisor_handle,
                component,
                BTreeMap::from([
                    ("proxyUrl".to_string(), proxy_url.clone()),
                    ("requestMethod".to_string(), "pi/getState".to_string()),
                ]),
                error,
                "pi_proxy_get_state",
            ),
        }
        thread::sleep(RUNTIME_PROBE_INTERVAL);
    }
}

fn mark_probe_healthy(
    supervisor_handle: &SandboxdSupervisorHandle,
    component: SupervisedComponent,
    details: BTreeMap<String, String>,
) {
    supervisor_handle.replace_component_details(component, details);
    supervisor_handle.mark_component_healthy(component);
    supervisor_handle.record_component_healthcheck(component);
}

fn mark_probe_failure(
    supervisor_handle: &SandboxdSupervisorHandle,
    component: SupervisedComponent,
    mut details: BTreeMap<String, String>,
    error: String,
    probe_kind: &'static str,
) {
    let is_already_restarting = supervisor_handle
        .component_snapshot(component)
        .is_some_and(|snapshot| snapshot.state == ComponentHealthState::Restarting);
    details.insert("connectivityState".to_string(), "Disconnected".to_string());
    details.insert("lastProbeError".to_string(), error.clone());
    supervisor_handle.replace_component_details(component, details);
    if is_already_restarting {
        return;
    }
    supervisor_handle.mark_component_restarting(component, error.clone());
    supervisor_handle.emit_component_healthcheck_failed(
        component,
        "runtime_probe_failed",
        error,
        probe_kind,
        &[],
    );
}

fn check_websocket_handshake(url: &str) -> Result<(), String> {
    let mut socket = connect_probe_websocket(url)?;
    socket
        .close(None)
        .map_err(|error| format!("failed to close websocket probe: {error}"))
}

fn check_opencode_proxy_connectivity(
    proxy_url: &str,
    health_path: &str,
    expected_status: u16,
) -> Result<u16, String> {
    let mut socket = connect_probe_websocket(proxy_url)?;
    socket
        .send(Message::Text(
            json!({
                "id": "sandboxd-opencode-health",
                "method": "GET",
                "path": health_path,
                "headers": null,
                "body": null,
                "idempotency": null
            })
            .to_string()
            .into(),
        ))
        .map_err(|error| format!("failed to send OpenCode proxy health request: {error}"))?;
    let response = read_json_text_message(&mut socket)?;
    let observed_status = response
        .get("status")
        .and_then(Value::as_u64)
        .and_then(|status| u16::try_from(status).ok())
        .ok_or_else(|| {
            format!("OpenCode proxy health response did not include status: {response}")
        })?;
    if observed_status != expected_status {
        return Err(format!(
            "OpenCode proxy health returned status {observed_status}, expected {expected_status}"
        ));
    }
    socket
        .close(None)
        .map_err(|error| format!("failed to close OpenCode proxy health socket: {error}"))?;
    Ok(observed_status)
}

fn check_pi_proxy_connectivity(proxy_url: &str) -> Result<(), String> {
    let mut socket = connect_probe_websocket(proxy_url)?;
    socket
        .send(Message::Text(
            json!({
                "jsonrpc": "2.0",
                "id": "sandboxd-pi-health",
                "method": "pi/getState"
            })
            .to_string()
            .into(),
        ))
        .map_err(|error| format!("failed to send Pi proxy health request: {error}"))?;
    let response = read_json_rpc_response_with_id(&mut socket, "sandboxd-pi-health")?;
    if response.get("error").is_some() {
        return Err(format!(
            "Pi proxy health returned an error response: {response}"
        ));
    }
    if response.get("result").is_none() {
        return Err(format!(
            "Pi proxy health response did not include result: {response}"
        ));
    }
    socket
        .close(None)
        .map_err(|error| format!("failed to close Pi proxy health socket: {error}"))?;
    Ok(())
}

fn connect_probe_websocket(url: &str) -> Result<WebSocket<MaybeTlsStream<TcpStream>>, String> {
    let (mut socket, _) =
        connect(url).map_err(|error| format!("websocket probe connection failed: {error}"))?;
    configure_probe_timeouts(socket.get_mut())?;
    Ok(socket)
}

fn configure_probe_timeouts(stream: &mut MaybeTlsStream<TcpStream>) -> Result<(), String> {
    if let MaybeTlsStream::Plain(stream) = stream {
        stream
            .set_read_timeout(Some(RUNTIME_PROBE_TIMEOUT))
            .map_err(|error| format!("failed to set websocket probe read timeout: {error}"))?;
        stream
            .set_write_timeout(Some(RUNTIME_PROBE_TIMEOUT))
            .map_err(|error| format!("failed to set websocket probe write timeout: {error}"))?;
    }
    Ok(())
}

fn read_json_text_message(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
) -> Result<Value, String> {
    match socket
        .read()
        .map_err(|error| format!("failed to read websocket probe response: {error}"))?
    {
        Message::Text(payload) => serde_json::from_str(payload.as_str())
            .map_err(|error| format!("websocket probe response was not json: {error}")),
        other => Err(format!(
            "websocket probe expected text response, received {other:?}"
        )),
    }
}

fn read_json_rpc_response_with_id(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    expected_id: &str,
) -> Result<Value, String> {
    loop {
        let response = read_json_text_message(socket)?;
        if response
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| id == expected_id)
        {
            return Ok(response);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, Instant};

    use tungstenite::{Message, accept};

    use crate::sandboxd_state::agent_endpoint_probe::{
        RuntimeAgentProbeHandle, RuntimeAgentProbePlan, RuntimeSpecificProbe,
        check_opencode_proxy_connectivity, check_pi_proxy_connectivity, check_websocket_handshake,
    };
    use crate::supervision::{ComponentHealthState, SandboxdSupervisorHandle, SupervisedComponent};
    use crate::time::SystemClock;

    #[test]
    fn websocket_handshake_probe_succeeds_when_endpoint_accepts_websocket_connections() {
        let server = SingleConnectionWebSocketServer::start(|socket| {
            let _ = socket.read();
        });

        check_websocket_handshake(&server.url)
            .expect("websocket handshake probe should succeed against a real listener");

        server.join();
    }

    #[test]
    fn endpoint_probe_loop_marks_agent_endpoint_healthy_after_websocket_handshake() {
        let server = SingleConnectionWebSocketServer::start(|socket| {
            let _ = socket.read();
        });
        let supervisor_handle = probe_supervisor();
        let probe_handle = RuntimeAgentProbeHandle::start(
            RuntimeAgentProbePlan {
                agent_endpoint_url: server.url.clone(),
                runtime_probe: RuntimeSpecificProbe::Codex,
            },
            supervisor_handle.clone(),
        );

        wait_for_component_state(
            &supervisor_handle,
            SupervisedComponent::RuntimeAgentEndpoint,
            ComponentHealthState::Healthy,
        );

        probe_handle.close();
        server.join();
    }

    #[test]
    fn endpoint_probe_loop_marks_agent_endpoint_restarting_when_websocket_dial_fails() {
        let listener =
            TcpListener::bind(("127.0.0.1", 0)).expect("test port reservation should bind");
        let url = format!(
            "ws://{}",
            listener
                .local_addr()
                .expect("test port reservation address should be readable")
        );
        drop(listener);
        let supervisor_handle = probe_supervisor();
        let probe_handle = RuntimeAgentProbeHandle::start(
            RuntimeAgentProbePlan {
                agent_endpoint_url: url,
                runtime_probe: RuntimeSpecificProbe::Codex,
            },
            supervisor_handle.clone(),
        );

        wait_for_component_state(
            &supervisor_handle,
            SupervisedComponent::RuntimeAgentEndpoint,
            ComponentHealthState::Restarting,
        );

        probe_handle.close();
    }

    #[test]
    fn opencode_proxy_connectivity_probe_requires_expected_health_status() {
        let server = SingleConnectionWebSocketServer::start(|socket| {
            let request = socket
                .read()
                .expect("OpenCode probe request should be readable");
            let Message::Text(request_payload) = request else {
                panic!("OpenCode probe should send a text request");
            };
            let request_json: serde_json::Value =
                serde_json::from_str(request_payload.as_str()).expect("request should be json");
            assert_eq!(request_json["method"], "GET");
            assert_eq!(request_json["path"], "/global/health");
            socket
                .send(Message::Text(
                    serde_json::json!({
                        "id": "sandboxd-opencode-health",
                        "type": "response",
                        "status": 204,
                        "headers": {},
                        "body": ""
                    })
                    .to_string()
                    .into(),
                ))
                .expect("OpenCode probe response should be writable");
        });

        let observed_status = check_opencode_proxy_connectivity(&server.url, "/global/health", 204)
            .expect("OpenCode proxy connectivity probe should accept expected status");

        assert_eq!(observed_status, 204);
        server.join();
    }

    #[test]
    fn opencode_proxy_connectivity_probe_fails_on_unexpected_health_status() {
        let server = SingleConnectionWebSocketServer::start(|socket| {
            let _ = socket
                .read()
                .expect("OpenCode probe request should be readable");
            socket
                .send(Message::Text(
                    serde_json::json!({
                        "id": "sandboxd-opencode-health",
                        "type": "response",
                        "status": 500,
                        "headers": {},
                        "body": ""
                    })
                    .to_string()
                    .into(),
                ))
                .expect("OpenCode probe response should be writable");
        });

        let error = check_opencode_proxy_connectivity(&server.url, "/global/health", 204)
            .expect_err("OpenCode proxy connectivity probe should reject unexpected status");

        assert!(error.contains("expected 204"));
        server.join();
    }

    #[test]
    fn pi_proxy_connectivity_probe_accepts_successful_get_state_response() {
        let server = SingleConnectionWebSocketServer::start(|socket| {
            let request = socket.read().expect("Pi probe request should be readable");
            let Message::Text(request_payload) = request else {
                panic!("Pi probe should send a text request");
            };
            let request_json: serde_json::Value =
                serde_json::from_str(request_payload.as_str()).expect("request should be json");
            assert_eq!(request_json["method"], "pi/getState");
            socket
                .send(Message::Text(
                    serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": "sandboxd-pi-health",
                        "result": {
                            "sessionFile": "/tmp/session.json"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("Pi probe response should be writable");
        });

        check_pi_proxy_connectivity(&server.url)
            .expect("Pi proxy connectivity probe should accept getState result");

        server.join();
    }

    #[test]
    fn pi_proxy_connectivity_probe_ignores_notifications_before_get_state_response() {
        let server = SingleConnectionWebSocketServer::start(|socket| {
            let _ = socket.read().expect("Pi probe request should be readable");
            socket
                .send(Message::Text(
                    serde_json::json!({
                        "jsonrpc": "2.0",
                        "method": "pi/event",
                        "params": {
                            "type": "message",
                            "message": "queued event"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("Pi event notification should be writable");
            socket
                .send(Message::Text(
                    serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": "sandboxd-pi-health",
                        "result": {
                            "sessionFile": "/tmp/session.json"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("Pi probe response should be writable");
        });

        check_pi_proxy_connectivity(&server.url)
            .expect("Pi proxy connectivity probe should ignore notifications before response");

        server.join();
    }

    #[test]
    fn pi_proxy_connectivity_probe_rejects_error_response() {
        let server = SingleConnectionWebSocketServer::start(|socket| {
            let _ = socket.read().expect("Pi probe request should be readable");
            socket
                .send(Message::Text(
                    serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": "sandboxd-pi-health",
                        "error": {
                            "code": -32000,
                            "message": "not ready"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("Pi probe response should be writable");
        });

        let error = check_pi_proxy_connectivity(&server.url)
            .expect_err("Pi proxy connectivity probe should reject JSON-RPC errors");

        assert!(error.contains("error response"));
        server.join();
    }

    struct SingleConnectionWebSocketServer {
        url: String,
        thread: thread::JoinHandle<()>,
    }

    impl SingleConnectionWebSocketServer {
        fn start(
            handler: impl FnOnce(&mut tungstenite::WebSocket<std::net::TcpStream>) + Send + 'static,
        ) -> Self {
            let listener =
                TcpListener::bind(("127.0.0.1", 0)).expect("test websocket server should bind");
            let address = listener
                .local_addr()
                .expect("test websocket server address should be readable");
            let (ready_sender, ready_receiver) = mpsc::channel();
            let thread = thread::spawn(move || {
                ready_sender
                    .send(())
                    .expect("test websocket server should report readiness");
                let (stream, _) = listener
                    .accept()
                    .expect("test websocket server should accept one connection");
                let mut socket = accept(stream).expect("websocket handshake should complete");
                handler(&mut socket);
            });
            ready_receiver
                .recv()
                .expect("test websocket server should become ready");
            Self {
                url: format!("ws://{address}"),
                thread,
            }
        }

        fn join(self) {
            self.thread
                .join()
                .expect("test websocket server should finish");
        }
    }

    fn probe_supervisor() -> SandboxdSupervisorHandle {
        SandboxdSupervisorHandle::new(
            "sandbox-123".to_string(),
            std::sync::Arc::new(SystemClock),
            BTreeSet::from([SupervisedComponent::RuntimeAgentEndpoint]),
        )
    }

    fn wait_for_component_state(
        supervisor_handle: &SandboxdSupervisorHandle,
        component: SupervisedComponent,
        expected_state: ComponentHealthState,
    ) {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if supervisor_handle
                .component_snapshot(component)
                .is_some_and(|snapshot| snapshot.state == expected_state)
            {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "component {component:?} did not reach {expected_state:?}"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }
}
