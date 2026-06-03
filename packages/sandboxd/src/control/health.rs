//! Loopback health endpoint for the local control server.
//!
//! The endpoint projects the same activation state that the Unix socket
//! mutates, so container health checks can observe readiness without sending
//! control protocol requests.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;

use crate::control::state::{ControlServerState, lock_control_state};
use crate::control::{ActivationPhase, ControlError, DEFAULT_HEALTH_ENDPOINT_PATH};
#[cfg(any(test, debug_assertions))]
use crate::control::{EGRESS_PROXY_FAULT_KILL_PATH, TEST_FAULTS_ENABLED_ENV};
use crate::sandboxd_state::SandboxdState;
use crate::supervision::{
    ComponentHealthSnapshot, ComponentHealthState, SandboxdDaemonPhase, SandboxdHealthResponse,
    SandboxdHealthSnapshot, SupervisedComponent,
};
use crate::time::{Clock, Sleeper, SystemClock, format_rfc3339_timestamp};

pub(super) fn run_health_server_loop(
    listener: TcpListener,
    state: &Arc<Mutex<ControlServerState>>,
    shutdown_receiver: &mpsc::Receiver<()>,
    sleeper: &dyn Sleeper,
    accept_poll_interval: Duration,
) -> Result<(), ControlError> {
    loop {
        if shutdown_receiver.try_recv().is_ok() {
            return Ok(());
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_nonblocking(false)
                    .map_err(ControlError::ConfigureConnection)?;
                handle_health_connection(&mut stream, state)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                sleeper.sleep(accept_poll_interval);
            }
            Err(error) => return Err(ControlError::AcceptHealthConnection(error)),
        }
    }
}

fn handle_health_connection(
    stream: &mut TcpStream,
    state: &Arc<Mutex<ControlServerState>>,
) -> Result<(), ControlError> {
    let request_head = read_http_request_head(stream)?;
    let mut request_lines = request_head.lines();
    let request_line = request_lines.next().unwrap_or_default();
    let response = match parse_http_request_line(request_line) {
        Some(("GET", DEFAULT_HEALTH_ENDPOINT_PATH)) => build_http_json_response(
            200,
            &serialize_health_response(&build_health_response(state)?)
                .map_err(ControlError::SerializeResponse)?,
        ),
        #[cfg(any(test, debug_assertions))]
        Some(("POST", EGRESS_PROXY_FAULT_KILL_PATH)) => build_fault_injection_response(state)?,
        _ => build_http_json_response(404, br#"{"error":"not_found"}"#),
    };

    stream
        .write_all(&response)
        .map_err(ControlError::WriteHealthResponse)
}

fn parse_http_request_line(request_line: &str) -> Option<(&str, &str)> {
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?;
    let path = parts.next()?;
    let _http_version = parts.next()?;
    Some((method, path))
}

fn read_http_request_head(stream: &mut TcpStream) -> Result<String, ControlError> {
    let mut raw_request = Vec::new();
    let mut buffer = [0_u8; 1024];

    loop {
        let bytes_read = stream
            .read(&mut buffer)
            .map_err(ControlError::ReadHealthRequest)?;
        if bytes_read == 0 {
            break;
        }
        raw_request.extend_from_slice(&buffer[..bytes_read]);
        if raw_request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if raw_request.len() > 16 * 1024 {
            break;
        }
    }

    Ok(String::from_utf8_lossy(&raw_request).into_owned())
}

fn build_http_json_response(status_code: u16, body: &[u8]) -> Vec<u8> {
    let status_text = match status_code {
        200 => "OK",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        _ => "OK",
    };
    let mut response = Vec::new();
    response.extend_from_slice(format!("HTTP/1.1 {status_code} {status_text}\r\n").as_bytes());
    response.extend_from_slice(b"content-type: application/json\r\n");
    response.extend_from_slice(format!("content-length: {}\r\n", body.len()).as_bytes());
    response.extend_from_slice(b"connection: close\r\n\r\n");
    response.extend_from_slice(body);
    response
}

#[cfg(any(test, debug_assertions))]
#[derive(Serialize)]
struct FaultInjectionAcceptedResponse {
    status: &'static str,
    component: &'static str,
    action: &'static str,
}

#[cfg(any(test, debug_assertions))]
#[derive(Serialize)]
struct FaultInjectionErrorResponse<'a> {
    error: &'a str,
}

#[cfg(any(test, debug_assertions))]
fn build_fault_injection_response(
    state: &Arc<Mutex<ControlServerState>>,
) -> Result<Vec<u8>, ControlError> {
    if !test_fault_injection_enabled() {
        let body = serde_json::to_vec(&FaultInjectionErrorResponse {
            error: "test_fault_injection_disabled",
        })
        .map_err(ControlError::SerializeResponse)?;
        return Ok(build_http_json_response(403, &body));
    }

    let fault_result = lock_control_state(state)?
        .sandboxd_state
        .as_ref()
        .ok_or_else(|| "sandboxd is not activated".to_string())
        .and_then(SandboxdState::force_egress_proxy_shutdown_for_test);

    match fault_result {
        Ok(()) => {
            let body = serde_json::to_vec(&FaultInjectionAcceptedResponse {
                status: "accepted",
                component: "egress_proxy",
                action: "kill",
            })
            .map_err(ControlError::SerializeResponse)?;
            Ok(build_http_json_response(200, &body))
        }
        Err(error) => {
            let body = serde_json::to_vec(&FaultInjectionErrorResponse { error: &error })
                .map_err(ControlError::SerializeResponse)?;
            Ok(build_http_json_response(409, &body))
        }
    }
}

#[cfg(any(test, debug_assertions))]
fn test_fault_injection_enabled() -> bool {
    matches!(
        std::env::var(TEST_FAULTS_ENABLED_ENV),
        Ok(value) if value == "1" || value.eq_ignore_ascii_case("true")
    )
}

fn build_health_response(
    state: &Arc<Mutex<ControlServerState>>,
) -> Result<SandboxdHealthResponse, ControlError> {
    let observed_at = SystemClock.now_system_time();
    let state = lock_control_state(state)?;

    let (daemon_phase, snapshot, init_error) = match &state.activation_phase {
        ActivationPhase::Unactivated => (SandboxdDaemonPhase::Unactivated, None, None),
        ActivationPhase::Activating => (SandboxdDaemonPhase::Activating, None, None),
        ActivationPhase::Activated => match state.sandboxd_state.as_ref() {
            Some(sandboxd_state) => (
                SandboxdDaemonPhase::Activated,
                Some(sandboxd_state.health_snapshot()),
                None,
            ),
            None => (SandboxdDaemonPhase::Activating, None, None),
        },
        ActivationPhase::Failed(error) => (SandboxdDaemonPhase::Failed, None, Some(error.clone())),
    };

    Ok(SandboxdHealthResponse {
        daemon_phase,
        observed_at,
        snapshot,
        init_error,
    })
}

fn serialize_health_response(
    response: &SandboxdHealthResponse,
) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&SerializableHealthResponse::from_response(response)?)
}

#[derive(Serialize)]
struct SerializableHealthResponse {
    daemon_phase: &'static str,
    observed_at: String,
    snapshot: Option<SerializableHealthSnapshot>,
    init_error: Option<String>,
}

#[derive(Serialize)]
struct SerializableHealthSnapshot {
    observed_at: String,
    components: Vec<SerializableComponentHealthSnapshot>,
}

#[derive(Serialize)]
struct SerializableComponentHealthSnapshot {
    component: &'static str,
    state: &'static str,
    restart_count: u64,
    last_started_at: Option<String>,
    last_failed_at: Option<String>,
    last_healthcheck_at: Option<String>,
    last_error: Option<String>,
    details: std::collections::BTreeMap<String, String>,
}

impl SerializableHealthResponse {
    fn from_response(response: &SandboxdHealthResponse) -> Result<Self, serde_json::Error> {
        Ok(Self {
            daemon_phase: daemon_phase_name(response.daemon_phase),
            observed_at: serialize_timestamp(response.observed_at)?,
            snapshot: response
                .snapshot
                .as_ref()
                .map(SerializableHealthSnapshot::from_snapshot)
                .transpose()?,
            init_error: response.init_error.clone(),
        })
    }
}

impl SerializableHealthSnapshot {
    fn from_snapshot(snapshot: &SandboxdHealthSnapshot) -> Result<Self, serde_json::Error> {
        Ok(Self {
            observed_at: serialize_timestamp(snapshot.observed_at)?,
            components: snapshot
                .components
                .iter()
                .map(SerializableComponentHealthSnapshot::from_snapshot)
                .collect::<Result<Vec<_>, _>>()?,
        })
    }
}

impl SerializableComponentHealthSnapshot {
    fn from_snapshot(snapshot: &ComponentHealthSnapshot) -> Result<Self, serde_json::Error> {
        Ok(Self {
            component: component_name(snapshot.component),
            state: component_state_name(snapshot.state),
            restart_count: snapshot.restart_count,
            last_started_at: snapshot
                .last_started_at
                .map(serialize_timestamp)
                .transpose()?,
            last_failed_at: snapshot
                .last_failed_at
                .map(serialize_timestamp)
                .transpose()?,
            last_healthcheck_at: snapshot
                .last_healthcheck_at
                .map(serialize_timestamp)
                .transpose()?,
            last_error: snapshot.last_error.clone(),
            details: snapshot.details.clone(),
        })
    }
}

fn serialize_timestamp(timestamp: std::time::SystemTime) -> Result<String, serde_json::Error> {
    format_rfc3339_timestamp(timestamp)
        .map_err(|error| serde_json::Error::io(std::io::Error::other(error.to_string())))
}

fn daemon_phase_name(phase: SandboxdDaemonPhase) -> &'static str {
    match phase {
        SandboxdDaemonPhase::Unactivated => "unactivated",
        SandboxdDaemonPhase::Activating => "activating",
        SandboxdDaemonPhase::Activated => "activated",
        SandboxdDaemonPhase::Failed => "failed",
    }
}

fn component_name(component: SupervisedComponent) -> &'static str {
    match component {
        SupervisedComponent::Sandboxd => "sandboxd",
        SupervisedComponent::TunnelSession => "tunnel_session",
        SupervisedComponent::EgressProxy => "egress_proxy",
        SupervisedComponent::CodexProxy => "codex_proxy",
        SupervisedComponent::CodexAppServer => "codex_app_server",
        SupervisedComponent::OpenCodeProxy => "opencode_proxy",
        SupervisedComponent::OpenCodeServer => "opencode_server",
        SupervisedComponent::OpenCodeProxyConnectivity => "opencode_proxy_connectivity",
        SupervisedComponent::PiProxy => "pi_proxy",
        SupervisedComponent::PiRpcProcess => "pi_rpc_process",
        SupervisedComponent::PiProxyConnectivity => "pi_proxy_connectivity",
        SupervisedComponent::RuntimeAgentEndpoint => "runtime_agent_endpoint",
    }
}

fn component_state_name(state: ComponentHealthState) -> &'static str {
    match state {
        ComponentHealthState::Starting => "starting",
        ComponentHealthState::Healthy => "healthy",
        ComponentHealthState::Restarting => "restarting",
        ComponentHealthState::Stopped => "stopped",
    }
}
