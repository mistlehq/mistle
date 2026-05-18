//! Live bootstrap tunnel session orchestration for `sandboxd`.
//!
//! Once the daemon has initialized the sandbox runtime, it needs one loop that
//! owns the connected bootstrap websocket and routes multiplexed tunnel
//! traffic: keepalive publication, telemetry negotiation, agent-runtime
//! websocket streams, PTY streams, and file uploads.

use std::any::Any;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fmt::{self, Display};
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::net::SocketAddr;
use std::os::fd::AsFd;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration as StdDuration, Instant};

use base64::Engine;
use bytes::Bytes;
use futures_util::{FutureExt, Sink, SinkExt, StreamExt};
use http_body_util::{BodyExt, Empty};
use hyper::header::{AUTHORIZATION, CONTENT_LENGTH};
use hyper::{Request, StatusCode};
use hyper_rustls::{HttpsConnector, HttpsConnectorBuilder};
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::TokioExecutor;
use nix::errno::Errno;
use nix::fcntl::{FcntlArg, OFlag, fcntl};
use nix::sys::signal::{Signal, kill};
use nix::unistd::Pid;
use serde::Deserialize;
use serde_json::{Map, Value};
use tokio::net::{TcpSocket, TcpStream, lookup_host};
use tokio::runtime::Builder;
use tokio::sync::mpsc;
use tokio::task::JoinHandle as TokioJoinHandle;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::{Error as WebSocketError, Message, client::IntoClientRequest};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tokio_tungstenite::{client_async_tls_with_config, connect_async};
use tracing::{info, warn};
use url::Url;

use crate::cgroups::{DEFAULT_CGROUP_ROOT, UserScopePaths, is_scope_populated};
use crate::keepalive::KeepaliveManager;
use crate::protocol::startup::{StartupInput, TransparentProxyBypassKind};
use crate::pty::{
    DEFAULT_PTY_TERMINATE_POLL_INTERVAL, DEFAULT_PTY_TERMINATE_TIMEOUT_MS, PtyEvent, PtySession,
    PtySpawnRequest, start_scoped_pty_session,
};
use crate::runtime::readiness::RuntimeReadinessManager;
use crate::supervision::{
    SandboxdSupervisorHandle, SupervisedComponent, encode_forwarded_lifecycle_event_log_line,
};
use crate::time::{Clock, Duration, Sleeper};
use crate::tunnel::port_access::{PortAccessAuthorizeDecision, authorize_target_port};
use crate::tunnel::port_access_transport::{
    PortAccessHttpCommand, PortAccessTcpCommand, PortAccessTransportEvent, spawn_http_transport,
    spawn_tcp_transport,
};
use crate::tunnel::protocol::{
    AGENT_STREAM_WINDOW_BYTES, CONNECT_ERROR_CODE_AGENT_ENDPOINT_DIAL_FAILED,
    CONNECT_ERROR_CODE_PROCESSES_STREAM_UNAVAILABLE, CONNECT_ERROR_CODE_PTY_SESSION_CREATE_FAILED,
    CONNECT_ERROR_CODE_PTY_SESSION_EXISTS, CONNECT_ERROR_CODE_PTY_SESSION_UNAVAILABLE,
    EgressTokenControlMessage, EgressTokenRequest, FILE_UPLOAD_RESET_CODE_BYTE_COUNT_EXCEEDED,
    FILE_UPLOAD_RESET_CODE_BYTE_COUNT_MISMATCH, FILE_UPLOAD_RESET_CODE_INVALID_FILE_TYPE,
    FileUploadCompletedEventInput, PAYLOAD_KIND_RAW_BYTES, PAYLOAD_KIND_WEBSOCKET_BINARY,
    PAYLOAD_KIND_WEBSOCKET_TEXT, PORT_ACCESS_AUTHORIZE_REASON_PORT_UNREACHABLE,
    PORT_ACCESS_AUTHORIZE_REASON_UNSUPPORTED_PROTOCOL, PtyControlMessage, PtySessionControlMessage,
    PtySessionLaunchMode, PtySessionOpen, STREAM_RESET_CODE_EXEC_COMMAND_FAILED,
    STREAM_RESET_CODE_INVALID_STREAM_CLOSE, STREAM_RESET_CODE_INVALID_STREAM_DATA,
    STREAM_RESET_CODE_INVALID_STREAM_SIGNAL, STREAM_RESET_CODE_INVALID_STREAM_WINDOW,
    STREAM_RESET_CODE_PROCESSES_SNAPSHOT_FAILED, STREAM_RESET_CODE_STREAM_CLOSE_FAILED,
    STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED, STREAM_RESET_CODE_TARGET_CLOSED,
    SigningControlMessage, SigningRequest, StreamControlMessage, StreamSendWindow,
    decode_stream_data_frame, egress_token_request, encode_stream_data_frame, exec_result_event,
    file_upload_completed_event, parse_egress_token_control_message, parse_ports_control_message,
    parse_ports_transport_message, parse_processes_stream_message, parse_pty_control_message,
    parse_pty_session_control_message, parse_signing_control_message, parse_stream_control_message,
    ports_target_authorize_failure_result, ports_target_authorize_success_result, pty_exit_event,
    pty_session_error, pty_session_opened, signing_request, stream_complete, stream_open_error,
    stream_open_ok, stream_reset, stream_window,
};
use crate::tunnel::runtime_processes::collect_processes_snapshot;
use crate::tunnel::telemetry::{SandboxTelemetryLogLevel, TelemetryRelay, TelemetryRelayFrame};
use crate::tunnel::upload_classification::{UploadClassificationError, classify_uploaded_file};

/// Default attachment root for file uploads received over the bootstrap tunnel.
pub const DEFAULT_ATTACHMENT_ROOT: &str = "/root/.local/attachments";
/// Poll interval while the live tunnel session has no immediately available work.
pub const DEFAULT_TUNNEL_SESSION_POLL_INTERVAL: Duration = Duration::from_millis(10);
pub const SANDBOX_OPERATION_STREAM_ID: u32 = 0xffff_fffd;
/// Poll interval while PTY output threads wait for the next blocking event.
pub const DEFAULT_PTY_EVENT_POLL_INTERVAL: Duration = Duration::from_millis(10);
/// Maximum time to wait for bootstrap tunnel DNS resolution.
pub const DEFAULT_BOOTSTRAP_TUNNEL_LOOKUP_TIMEOUT: Duration = Duration::from_secs(10);
/// Maximum time to wait for one bootstrap tunnel TCP dial.
pub const DEFAULT_BOOTSTRAP_TUNNEL_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Maximum time to wait for the bootstrap websocket handshake.
pub const DEFAULT_BOOTSTRAP_TUNNEL_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_UPLOAD_SIZE_BYTES: usize = 16 * 1024 * 1024;
const MAX_UPLOAD_THREAD_ID_LENGTH: usize = 128;
static UPLOAD_ID_COUNTER: AtomicU64 = AtomicU64::new(1);
const DEFAULT_EXEC_TIMEOUT_MS: u64 = 15_000;
const OPERATION_RECORD_CHANNEL_CAPACITY: usize = 1024;
const PENDING_OPERATION_RECORD_CAPACITY: usize = 1024;
const SANDBOX_OPERATION_STREAM_FORMAT: &str = "mistle.sandbox-operation.v1+jsonl";
const DEFAULT_EXEC_MAX_OUTPUT_BYTES: usize = 16 * 1024 * 1024;
const DEFAULT_AGENT_ENDPOINT_UPDATE_TIMEOUT: StdDuration = StdDuration::from_secs(10);
const DEFAULT_SIGNING_REQUEST_TIMEOUT: StdDuration = StdDuration::from_secs(120);
const DEFAULT_EGRESS_TOKEN_REQUEST_TIMEOUT: StdDuration = StdDuration::from_secs(10);
const EGRESS_TOKEN_REFRESH_SKEW_MS: u64 = 30_000;
const EXEC_OUTPUT_READ_BUFFER_BYTES: usize = 8192;
const DEFAULT_PROCESSES_SNAPSHOT_INTERVAL: Duration = Duration::from_millis(500);
const DEFAULT_RUNTIME_ENV_UPDATE_TIMEOUT: StdDuration = StdDuration::from_secs(10);
const TUNNEL_RECONNECT_BACKOFF_MS: [u64; 6] = [0, 250, 500, 1000, 2000, 5000];
const AGENT_STREAM_WINDOW_THRESHOLD_BYTES: [usize; 5] = [
    1024 * 1024,
    2 * 1024 * 1024,
    4 * 1024 * 1024,
    8 * 1024 * 1024,
    AGENT_STREAM_WINDOW_BYTES.saturating_mul(95) / 100,
];
const AGENT_STREAM_CHANNEL_KIND: &str = "agent";
const AGENT_STREAM_EVENT_SUMMARY: &str = "agent_stream_summary";
const AGENT_STREAM_EVENT_WINDOW_EXHAUSTED: &str = "agent_stream_window_exhausted";
const AGENT_STREAM_EVENT_WINDOW_THRESHOLD_CROSSED: &str = "agent_stream_window_threshold_crossed";
const AGENT_STREAM_OUTCOME_CLOSED: &str = "closed";
const AGENT_STREAM_OUTCOME_RESET: &str = "reset";
const AGENT_STREAM_OUTCOME_BOOTSTRAP_CLOSED: &str = "bootstrap_closed";
const AGENT_STREAM_CLOSE_SOURCE_GATEWAY: &str = "gateway";
const AGENT_STREAM_CLOSE_SOURCE_RUNTIME: &str = "runtime";
const AGENT_STREAM_CLOSE_SOURCE_BOOTSTRAP: &str = "bootstrap";
const PTY_STREAM_CHANNEL_KIND: &str = "pty";
const PTY_EVENT_LATENCY_WARNING: &str = "pty_input_latency_warning";
const PTY_EVENT_SUMMARY: &str = "pty_session_summary";
const PTY_OUTCOME_CLOSED: &str = "closed";
const PTY_OUTCOME_EXITED: &str = "exited";
const PTY_OUTCOME_RESET: &str = "reset";
const PTY_INPUT_LATENCY_WARNING_THRESHOLD_MS: u64 = 100;
const DIRECT_PTY_STREAM_ID: u32 = 1;
const PTY_SESSION_ERROR_CODE_CREATE_FAILED: &str = "pty_create_failed";
const PTY_SESSION_ERROR_CODE_ATTACH_FAILED: &str = "pty_attach_failed";
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TunnelSigningRequest {
    pub request_id: String,
    pub organization_id: String,
    pub sandbox_instance_id: String,
    pub acting_user_id: String,
    pub provider_family: String,
    pub format: String,
    pub key_ref: String,
    pub grant: String,
    pub payload_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TunnelSigningResponse {
    Success {
        request_id: String,
        signature_base64: String,
    },
    Failure {
        request_id: String,
        code: String,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TunnelEgressToken {
    pub token: String,
    pub expires_at: String,
    pub ttl_ms: u64,
}

#[derive(Debug, Clone)]
struct CachedEgressToken {
    token: TunnelEgressToken,
    stored_at: Instant,
    cache_ttl_ms: u64,
    source_request_id: String,
}

pub enum OperationStreamMessage {
    Record(String),
    Close {
        response_sender: std::sync::mpsc::Sender<Result<(), String>>,
    },
}

#[derive(Clone)]
pub struct GatewayEgressTokenProvider {
    request_sender: Arc<RwLock<Option<mpsc::UnboundedSender<TunnelSessionRequest>>>>,
    cached_token: Arc<Mutex<Option<CachedEgressToken>>>,
    next_request_id: Arc<AtomicU64>,
    sandbox_instance_id: String,
}

impl GatewayEgressTokenProvider {
    pub fn new(sandbox_instance_id: impl Into<String>) -> Self {
        Self {
            request_sender: Arc::new(RwLock::new(None)),
            cached_token: Arc::new(Mutex::new(None)),
            next_request_id: Arc::new(AtomicU64::new(1)),
            sandbox_instance_id: sandbox_instance_id.into(),
        }
    }

    fn attach(&self, request_sender: mpsc::UnboundedSender<TunnelSessionRequest>) {
        match self.request_sender.write() {
            Ok(mut sender) => *sender = Some(request_sender),
            Err(error) => {
                eprintln!("sandboxd failed to attach gateway egress token provider: {error}");
            }
        }
    }

    pub fn token(&self) -> Result<TunnelEgressToken, TunnelSessionError> {
        if let Some(token) = self.cached_token()? {
            return Ok(token);
        }

        let request_sender = self
            .request_sender
            .read()
            .map_err(|error| TunnelSessionError::EgressToken(error.to_string()))?
            .clone()
            .ok_or_else(|| {
                TunnelSessionError::EgressToken(
                    "gateway egress token provider is not attached to the bootstrap session"
                        .to_string(),
                )
            })?;
        let request_id = format!(
            "egress_token_req_{}",
            self.next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        let (response_sender, response_receiver) = std::sync::mpsc::channel();
        request_sender
            .send(TunnelSessionRequest::EgressToken {
                request_id: request_id.clone(),
                response_sender,
            })
            .map_err(|error| TunnelSessionError::EgressToken(error.to_string()))?;

        match response_receiver.recv_timeout(DEFAULT_EGRESS_TOKEN_REQUEST_TIMEOUT) {
            Ok(Ok(token)) => {
                self.store_token(token.clone(), &request_id)?;
                Ok(token)
            }
            Ok(Err(error)) => Err(error),
            Err(error) => Err(TunnelSessionError::EgressToken(format!(
                "egress token request {request_id} timed out or disconnected: {error}"
            ))),
        }
    }

    fn cached_token(&self) -> Result<Option<TunnelEgressToken>, TunnelSessionError> {
        let cached_token = self
            .cached_token
            .lock()
            .map_err(|error| TunnelSessionError::EgressToken(error.to_string()))?
            .clone();
        let Some(cached_token) = cached_token else {
            return Ok(None);
        };
        let elapsed_ms = cached_token
            .stored_at
            .elapsed()
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX);
        if elapsed_ms >= cached_token.cache_ttl_ms {
            return Ok(None);
        }
        info!(
            event = "egress_token_cache_hit",
            request_id = cached_token.source_request_id.as_str(),
            sandbox_instance_id = self.sandbox_instance_id.as_str(),
            expires_at = cached_token.token.expires_at.as_str(),
            ttl_ms = cached_token.token.ttl_ms,
            cache_ttl_ms = cached_token.cache_ttl_ms,
            elapsed_ms = elapsed_ms,
            "using cached gateway egress token"
        );
        Ok(Some(cached_token.token))
    }

    fn store_token(
        &self,
        token: TunnelEgressToken,
        request_id: &str,
    ) -> Result<(), TunnelSessionError> {
        let mut cached_token = self
            .cached_token
            .lock()
            .map_err(|error| TunnelSessionError::EgressToken(error.to_string()))?;
        *cached_token = Some(CachedEgressToken {
            cache_ttl_ms: token.ttl_ms.saturating_sub(EGRESS_TOKEN_REFRESH_SKEW_MS),
            token,
            stored_at: Instant::now(),
            source_request_id: request_id.to_string(),
        });
        Ok(())
    }
}

fn resolve_default_attachment_root() -> PathBuf {
    if let Some(attachment_root) = crate::test_support::attachment_root_override() {
        return attachment_root;
    }

    #[cfg(test)]
    {
        std::env::temp_dir().join(format!(
            "mistle-sandboxd-test-attachments-{}",
            std::process::id()
        ))
    }

    #[cfg(not(test))]
    PathBuf::from(DEFAULT_ATTACHMENT_ROOT)
}

fn prioritize_ipv4_socket_addresses(mut addresses: Vec<SocketAddr>) -> Vec<SocketAddr> {
    addresses.sort_by_key(|address| if address.is_ipv4() { 0 } else { 1 });
    addresses
}

/// Describes why the live bootstrap tunnel session could not start or stop.
#[derive(Debug)]
pub enum TunnelSessionError {
    InvalidGatewayUrl(String),
    ConfigureTunnelSocket(String),
    AttachmentRoot(String),
    AttachTelemetry(String),
    HandleTelemetry(String),
    PublishKeepalive(serde_json::Error),
    PublishRuntimeReady(serde_json::Error),
    MissingRuntimeReadyState(String),
    WriteTunnelText(String),
    WriteTunnelBinary(String),
    ReadTunnel(String),
    ParseControl(String),
    ParseDataFrame(String),
    Signing(String),
    EgressToken(String),
    AgentDial(String),
    AgentSocket(String),
    AgentRead(String),
    AgentWrite(String),
    Egress(String),
    PortAccess(String),
    Processes(String),
    Pty(String),
    FileUpload(String),
    SessionPanicked,
}

impl Display for TunnelSessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidGatewayUrl(error) => {
                write!(
                    f,
                    "failed to derive sandbox instance id from tunnel url: {error}"
                )
            }
            Self::ConfigureTunnelSocket(error) => {
                write!(f, "failed to configure bootstrap tunnel socket: {error}")
            }
            Self::AttachmentRoot(error) => write!(f, "failed to prepare attachment root: {error}"),
            Self::AttachTelemetry(error) => {
                write!(f, "failed to attach telemetry relay: {error}")
            }
            Self::HandleTelemetry(error) => {
                write!(f, "failed to handle bootstrap telemetry control: {error}")
            }
            Self::PublishKeepalive(error) => {
                write!(f, "failed to serialize keepalive payload: {error}")
            }
            Self::PublishRuntimeReady(error) => {
                write!(f, "failed to serialize runtime readiness payload: {error}")
            }
            Self::MissingRuntimeReadyState(error) => {
                write!(f, "failed to prepare runtime readiness payload: {error}")
            }
            Self::WriteTunnelText(error) => {
                write!(f, "failed to write bootstrap tunnel text frame: {error}")
            }
            Self::WriteTunnelBinary(error) => {
                write!(f, "failed to write bootstrap tunnel binary frame: {error}")
            }
            Self::ReadTunnel(error) => write!(f, "failed to read bootstrap tunnel frame: {error}"),
            Self::ParseControl(error) => {
                write!(f, "invalid bootstrap tunnel control frame: {error}")
            }
            Self::ParseDataFrame(error) => {
                write!(f, "invalid bootstrap tunnel data frame: {error}")
            }
            Self::Signing(error) => write!(f, "failed to handle signing request: {error}"),
            Self::EgressToken(error) => {
                write!(f, "failed to handle egress token request: {error}")
            }
            Self::AgentDial(error) => {
                write!(f, "failed to connect agent runtime endpoint: {error}")
            }
            Self::AgentSocket(error) => {
                write!(f, "failed to configure agent runtime socket: {error}")
            }
            Self::AgentRead(error) => write!(f, "failed to read agent runtime socket: {error}"),
            Self::AgentWrite(error) => write!(f, "failed to write agent runtime socket: {error}"),
            Self::Egress(error) => write!(f, "failed to service gateway egress request: {error}"),
            Self::PortAccess(error) => {
                write!(f, "failed to handle port access control message: {error}")
            }
            Self::Processes(error) => {
                write!(f, "failed to service processes tunnel stream: {error}")
            }
            Self::Pty(error) => write!(f, "failed to handle PTY tunnel stream: {error}"),
            Self::FileUpload(error) => write!(f, "failed to handle file upload stream: {error}"),
            Self::SessionPanicked => write!(f, "bootstrap tunnel session thread panicked"),
        }
    }
}

impl std::error::Error for TunnelSessionError {}

/// Owns the background tunnel session thread for the initialized daemon.
pub struct TunnelSession {
    shutdown_requested: Arc<AtomicBool>,
    request_sender: mpsc::UnboundedSender<TunnelSessionRequest>,
    thread: Option<JoinHandle<Result<(), TunnelSessionError>>>,
    supervisor_handle: SandboxdSupervisorHandle,
}

enum TunnelSessionControlFlow {
    Continue,
    RestartRequired,
}

enum ConnectedTunnelSessionOutcome {
    ShutdownRequested,
    RestartRequired,
}

struct ConnectedTunnelSessionResult {
    outcome: ConnectedTunnelSessionOutcome,
    startup_completed: bool,
}

enum ConnectedTunnelSessionLoopItem {
    Event(TunnelSessionEvent),
    Request(TunnelSessionRequest),
}

type TunnelExchangeHttpClient = Client<HttpsConnector<HttpConnector>, Empty<Bytes>>;

struct TunnelExchangeSuccess {
    bootstrap_token: String,
    tunnel_exchange_token: String,
}

enum TunnelExchangeOutcome {
    Success(TunnelExchangeSuccess),
    Retryable(String),
    Terminal(String),
}

enum TunnelWriterMessage {
    Text(String),
    Binary(Vec<u8>),
    Pong(Vec<u8>),
    Flush {
        response_sender: std::sync::mpsc::Sender<Result<(), String>>,
    },
    Close,
}

enum BootstrapWriterControlMessage {
    Pong(Vec<u8>),
}

enum TunnelSessionEvent {
    BootstrapMessage(Message),
    BootstrapClosed {
        reason: Option<String>,
    },
    AgentDialed {
        stream_id: u32,
        result: Box<Result<TunnelWebSocket, String>>,
    },
    AgentMessage {
        stream_id: u32,
        message: Message,
    },
    AgentWriteCompleted {
        stream_id: u32,
        bytes: usize,
    },
    PortAccessTransport(PortAccessTransportEvent),
    AgentClosed {
        stream_id: u32,
        reason: Option<String>,
    },
    ExecCompleted {
        stream_id: u32,
        result: Box<Result<ExecCommandResult, String>>,
    },
    Wake,
}

enum TunnelSessionRequest {
    SetAgentEndpoint {
        agent_endpoint_url: Option<String>,
        response_sender: std::sync::mpsc::Sender<Result<(), TunnelSessionError>>,
    },
    SetRuntimeEnvironment {
        runtime_env: BTreeMap<String, String>,
        response_sender: std::sync::mpsc::Sender<Result<(), TunnelSessionError>>,
    },
    Signing {
        request: TunnelSigningRequest,
        response_sender: std::sync::mpsc::Sender<Result<TunnelSigningResponse, TunnelSessionError>>,
    },
    EgressToken {
        request_id: String,
        response_sender: std::sync::mpsc::Sender<Result<TunnelEgressToken, TunnelSessionError>>,
    },
    OperationRecord {
        line: String,
    },
    OperationClose {
        response_sender: std::sync::mpsc::Sender<Result<(), String>>,
    },
}

#[derive(Debug, Clone, Copy)]
struct OutstandingAgentSend {
    bytes: usize,
    sent_at_ms: u64,
}

#[derive(Debug)]
struct AgentStreamStats {
    opened_at_ms: u64,
    message_count_out: u64,
    message_count_in: u64,
    total_bytes_out: u64,
    total_bytes_in: u64,
    max_message_bytes_out: usize,
    max_message_bytes_in: usize,
    max_outstanding_bytes: usize,
    credit_return_count: u64,
    credit_return_total_ms: u64,
    threshold_emissions_mask: u8,
    outstanding_sends: VecDeque<OutstandingAgentSend>,
}

impl AgentStreamStats {
    fn new(opened_at_ms: u64) -> Self {
        Self {
            opened_at_ms,
            message_count_out: 0,
            message_count_in: 0,
            total_bytes_out: 0,
            total_bytes_in: 0,
            max_message_bytes_out: 0,
            max_message_bytes_in: 0,
            max_outstanding_bytes: 0,
            credit_return_count: 0,
            credit_return_total_ms: 0,
            threshold_emissions_mask: 0,
            outstanding_sends: VecDeque::new(),
        }
    }

    fn record_outbound_message(
        &mut self,
        payload_bytes: usize,
        sent_at_ms: u64,
        outstanding_bytes: usize,
    ) {
        self.message_count_out = self.message_count_out.saturating_add(1);
        self.total_bytes_out = self.total_bytes_out.saturating_add(payload_bytes as u64);
        self.max_message_bytes_out = self.max_message_bytes_out.max(payload_bytes);
        self.max_outstanding_bytes = self.max_outstanding_bytes.max(outstanding_bytes);
        self.outstanding_sends.push_back(OutstandingAgentSend {
            bytes: payload_bytes,
            sent_at_ms,
        });
    }

    fn record_inbound_message(&mut self, payload_bytes: usize) {
        self.message_count_in = self.message_count_in.saturating_add(1);
        self.total_bytes_in = self.total_bytes_in.saturating_add(payload_bytes as u64);
        self.max_message_bytes_in = self.max_message_bytes_in.max(payload_bytes);
    }

    fn record_credit_restore(&mut self, bytes: usize, restored_at_ms: u64) {
        let mut remaining_bytes = bytes;
        while remaining_bytes > 0 {
            let Some(front_send) = self.outstanding_sends.front_mut() else {
                return;
            };
            let acknowledged_bytes = remaining_bytes.min(front_send.bytes);
            front_send.bytes -= acknowledged_bytes;
            remaining_bytes -= acknowledged_bytes;
            self.credit_return_count = self.credit_return_count.saturating_add(1);
            self.credit_return_total_ms = self
                .credit_return_total_ms
                .saturating_add(restored_at_ms.saturating_sub(front_send.sent_at_ms));
            if front_send.bytes == 0 {
                self.outstanding_sends.pop_front();
            }
        }
    }

    fn avg_credit_return_ms(&self) -> Option<u64> {
        if self.credit_return_count == 0 {
            return None;
        }

        Some(self.credit_return_total_ms / self.credit_return_count)
    }

    fn stream_age_ms(&self, now_ms: u64) -> u64 {
        now_ms.saturating_sub(self.opened_at_ms)
    }

    fn oldest_unacked_age_ms(&self, now_ms: u64) -> Option<u64> {
        self.outstanding_sends
            .front()
            .map(|send| now_ms.saturating_sub(send.sent_at_ms))
    }

    fn take_new_threshold_crossings(&mut self, outstanding_bytes: usize) -> Vec<usize> {
        let mut crossed_thresholds = Vec::new();
        for (index, threshold_bytes) in AGENT_STREAM_WINDOW_THRESHOLD_BYTES.iter().enumerate() {
            let emission_bit = 1_u8 << index;
            if outstanding_bytes >= *threshold_bytes
                && self.threshold_emissions_mask & emission_bit == 0
            {
                self.threshold_emissions_mask |= emission_bit;
                crossed_thresholds.push(*threshold_bytes);
            }
        }
        crossed_thresholds
    }
}

struct AgentStreamState {
    sender: mpsc::UnboundedSender<Message>,
    send_window: StreamSendWindow,
    stats: AgentStreamStats,
}

struct PendingAgentOpenState {
    task: TokioJoinHandle<()>,
}

struct PendingExecOpenState {
    cancel_requested: Arc<AtomicBool>,
    child_pid: Arc<Mutex<Option<u32>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TunnelExchangeResponse {
    bootstrap_token: String,
    tunnel_exchange_token: String,
}

struct ExecCommandResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
    truncated: bool,
}

impl TunnelSession {
    /// Starts one live bootstrap tunnel session thread for the initialized daemon.
    pub fn start(
        startup_input: &StartupInput,
        keepalive_manager: Arc<Mutex<KeepaliveManager>>,
        runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
        agent_endpoint_url: Option<String>,
        runtime_env: BTreeMap<String, String>,
        clock: Arc<dyn Clock>,
        sleeper: Arc<dyn Sleeper>,
    ) -> Result<Self, TunnelSessionError> {
        let sandbox_instance_id = derive_sandbox_instance_id(&startup_input.tunnel_gateway_ws_url)?;
        let supervisor_handle = SandboxdSupervisorHandle::new(
            sandbox_instance_id,
            clock.clone(),
            BTreeSet::from([SupervisedComponent::TunnelSession]),
        );

        Self::start_with_supervisor(
            startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            agent_endpoint_url,
            runtime_env,
            clock,
            sleeper,
            supervisor_handle,
        )
    }

    /// Starts one live bootstrap tunnel session thread using the shared supervisor boundary.
    #[allow(clippy::too_many_arguments)]
    pub fn start_with_supervisor(
        startup_input: &StartupInput,
        keepalive_manager: Arc<Mutex<KeepaliveManager>>,
        runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
        agent_endpoint_url: Option<String>,
        runtime_env: BTreeMap<String, String>,
        clock: Arc<dyn Clock>,
        sleeper: Arc<dyn Sleeper>,
        supervisor_handle: SandboxdSupervisorHandle,
    ) -> Result<Self, TunnelSessionError> {
        let sandbox_instance_id = derive_sandbox_instance_id(&startup_input.tunnel_gateway_ws_url)?;
        supervisor_handle.replace_component_details(
            SupervisedComponent::TunnelSession,
            BTreeMap::from([(
                "gatewayWsUrl".to_string(),
                startup_input.tunnel_gateway_ws_url.clone(),
            )]),
        );
        supervisor_handle.mark_component_starting(SupervisedComponent::TunnelSession);
        let attachment_root = resolve_default_attachment_root();

        let shutdown_requested = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (request_sender, request_receiver) = mpsc::unbounded_channel();
        let (startup_result_sender, startup_result_receiver) = std::sync::mpsc::channel();
        let thread = thread::spawn({
            let shutdown_requested = shutdown_requested.clone();
            let thread_supervisor_handle = supervisor_handle.clone();
            let cgroup_root = PathBuf::from(DEFAULT_CGROUP_ROOT);
            let runtime = TunnelSessionRuntime {
                keepalive_manager,
                runtime_readiness_manager,
                connection_state: Arc::new(RwLock::new(TunnelSessionRuntimeConnectionState {
                    agent_endpoint_url,
                    runtime_env,
                })),
                cgroup_root,
                attachment_root,
                sandbox_instance_id,
                gateway_ws_url: startup_input.tunnel_gateway_ws_url.clone(),
                operation_id: derive_startup_operation_id(&startup_input.tunnel_gateway_ws_url),
                operation_kind: startup_operation_kind(startup_input),
                transparent_passthrough_socket_mark: startup_transparent_passthrough_socket_mark(
                    startup_input,
                ),
                shutdown_requested,
                clock,
                sleeper,
                supervisor_handle: supervisor_handle.clone(),
            };
            let connected_url = startup_input.tunnel_gateway_ws_url.clone();
            let panic_connected_url = connected_url.clone();
            let bootstrap_token = startup_input.bootstrap_token.clone();
            let tunnel_exchange_token = startup_input.tunnel_exchange_token.clone();
            move || match panic::catch_unwind(AssertUnwindSafe(move || {
                let runtime_builder = Builder::new_multi_thread()
                    .worker_threads(2)
                    .enable_all()
                    .build()
                    .map_err(|error| {
                        TunnelSessionError::ConfigureTunnelSocket(error.to_string())
                    })?;

                let startup_result_sender = startup_result_sender;
                runtime_builder.block_on(async move {
                    run_tunnel_supervisor(
                        runtime,
                        &connected_url,
                        &bootstrap_token,
                        &tunnel_exchange_token,
                        request_receiver,
                        startup_result_sender,
                    )
                    .await
                })
            })) {
                Ok(result) => result,
                Err(payload) => {
                    let panic_text = format_panic_payload(payload.as_ref());
                    thread_supervisor_handle.mark_component_restarting(
                        SupervisedComponent::TunnelSession,
                        panic_text.clone(),
                    );
                    update_tunnel_supervision_details(
                        &thread_supervisor_handle,
                        &panic_connected_url,
                        Some("tunnel_thread_panic"),
                        None,
                        None,
                    );
                    thread_supervisor_handle.emit_component_exited(
                        SupervisedComponent::TunnelSession,
                        "panic",
                        Some(&panic_text),
                        &[
                            ("exitKind", Value::String("panic".to_string())),
                            ("panicBoundary", Value::String("tunnel_thread".to_string())),
                        ],
                    );
                    Err(TunnelSessionError::SessionPanicked)
                }
            }
        });

        match startup_result_receiver.recv() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                let _ = thread.join();
                return Err(error);
            }
            Err(_) => {
                let _ = thread.join();
                return Err(TunnelSessionError::SessionPanicked);
            }
        }

        Ok(Self {
            shutdown_requested,
            request_sender,
            thread: Some(thread),
            supervisor_handle,
        })
    }

    /// Starts a bootstrap tunnel with no runtime capabilities attached yet.
    pub fn start_minimal_with_supervisor(
        startup_input: &StartupInput,
        keepalive_manager: Arc<Mutex<KeepaliveManager>>,
        runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
        clock: Arc<dyn Clock>,
        sleeper: Arc<dyn Sleeper>,
        supervisor_handle: SandboxdSupervisorHandle,
    ) -> Result<Self, TunnelSessionError> {
        Self::start_with_supervisor(
            startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            clock,
            sleeper,
            supervisor_handle,
        )
    }

    pub fn request_signing(
        &self,
        request: TunnelSigningRequest,
    ) -> Result<TunnelSigningResponse, TunnelSessionError> {
        let (response_sender, response_receiver) = std::sync::mpsc::channel();
        self.request_sender
            .send(TunnelSessionRequest::Signing {
                request,
                response_sender,
            })
            .map_err(|error| TunnelSessionError::Signing(error.to_string()))?;

        response_receiver
            .recv_timeout(DEFAULT_SIGNING_REQUEST_TIMEOUT)
            .map_err(|error| TunnelSessionError::Signing(error.to_string()))?
    }

    pub fn attach_gateway_egress_token_provider(&self, provider: &GatewayEgressTokenProvider) {
        provider.attach(self.request_sender.clone());
    }

    pub fn set_agent_endpoint_url(
        &self,
        agent_endpoint_url: Option<String>,
    ) -> Result<(), TunnelSessionError> {
        let (response_sender, response_receiver) = std::sync::mpsc::channel();
        self.request_sender
            .send(TunnelSessionRequest::SetAgentEndpoint {
                agent_endpoint_url,
                response_sender,
            })
            .map_err(|error| TunnelSessionError::AgentDial(error.to_string()))?;

        response_receiver
            .recv_timeout(DEFAULT_AGENT_ENDPOINT_UPDATE_TIMEOUT)
            .map_err(|error| TunnelSessionError::AgentDial(error.to_string()))?
    }

    pub fn set_runtime_environment(
        &self,
        runtime_env: BTreeMap<String, String>,
    ) -> Result<(), TunnelSessionError> {
        let (response_sender, response_receiver) = std::sync::mpsc::channel();
        self.request_sender
            .send(TunnelSessionRequest::SetRuntimeEnvironment {
                runtime_env,
                response_sender,
            })
            .map_err(|error| TunnelSessionError::Processes(error.to_string()))?;

        response_receiver
            .recv_timeout(DEFAULT_RUNTIME_ENV_UPDATE_TIMEOUT)
            .map_err(|error| TunnelSessionError::Processes(error.to_string()))?
    }

    pub fn operation_record_sender(&self) -> mpsc::Sender<OperationStreamMessage> {
        let (record_sender, mut record_receiver) = mpsc::channel(OPERATION_RECORD_CHANNEL_CAPACITY);
        let request_sender = self.request_sender.clone();
        thread::spawn(move || {
            while let Some(message) = record_receiver.blocking_recv() {
                let request = match message {
                    OperationStreamMessage::Record(line) => {
                        TunnelSessionRequest::OperationRecord { line }
                    }
                    OperationStreamMessage::Close { response_sender } => {
                        TunnelSessionRequest::OperationClose { response_sender }
                    }
                };
                if request_sender.send(request).is_err() {
                    return;
                }
            }
        });
        record_sender
    }

    /// Stops the live bootstrap tunnel session and waits for its thread to exit.
    pub fn close(mut self) {
        self.shutdown_requested.store(true, Ordering::Relaxed);
        let thread = self
            .thread
            .take()
            .expect("tunnel session thread should exist");

        match thread.join() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                let error_text = error.to_string();
                self.supervisor_handle.mark_component_restarting(
                    SupervisedComponent::TunnelSession,
                    error_text.clone(),
                );
                self.supervisor_handle.emit_component_exited(
                    SupervisedComponent::TunnelSession,
                    "thread_returned",
                    Some(&error_text),
                    &[("exitKind", Value::String("thread_returned".to_string()))],
                );
            }
            Err(_) => {
                self.supervisor_handle.mark_component_restarting(
                    SupervisedComponent::TunnelSession,
                    "tunnel session thread panicked",
                );
                self.supervisor_handle.emit_component_exited(
                    SupervisedComponent::TunnelSession,
                    "panic",
                    Some("tunnel session thread panicked"),
                    &[
                        ("exitKind", Value::String("panic".to_string())),
                        ("panicBoundary", Value::String("tunnel_thread".to_string())),
                    ],
                );
            }
        }
        self.supervisor_handle
            .mark_component_stopped(SupervisedComponent::TunnelSession);
    }
}

struct PtySessionState {
    session: PtySession,
    primary_stream_id: u32,
    attached_stream_ids: BTreeSet<u32>,
    send_windows_by_stream_id: BTreeMap<u32, StreamSendWindow>,
    stats: PtySessionStats,
}

struct FileUploadState {
    attachment_id: String,
    thread_directory_path: PathBuf,
    thread_id: String,
    mime_type: String,
    original_filename: String,
    size_bytes: usize,
    temp_path: PathBuf,
    file: File,
    received_bytes: usize,
}

struct TunnelSessionRuntime {
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    connection_state: Arc<RwLock<TunnelSessionRuntimeConnectionState>>,
    cgroup_root: PathBuf,
    attachment_root: PathBuf,
    sandbox_instance_id: String,
    gateway_ws_url: String,
    operation_id: Option<String>,
    operation_kind: &'static str,
    transparent_passthrough_socket_mark: Option<u32>,
    shutdown_requested: Arc<AtomicBool>,
    clock: Arc<dyn Clock>,
    sleeper: Arc<dyn Sleeper>,
    supervisor_handle: SandboxdSupervisorHandle,
}

#[derive(Clone)]
struct TunnelSessionRuntimeConnectionState {
    agent_endpoint_url: Option<String>,
    runtime_env: BTreeMap<String, String>,
}
struct TunnelSessionLoopContext<'a> {
    attachment_root: &'a Path,
    cgroup_root: &'a Path,
    sandbox_instance_id: &'a str,
    gateway_ws_url: &'a str,
    clock: &'a dyn Clock,
    sleeper: &'a dyn Sleeper,
    supervisor_handle: &'a SandboxdSupervisorHandle,
}

struct PortAccessTcpStreamState {
    sender: mpsc::UnboundedSender<PortAccessTcpCommand>,
    request_window: StreamSendWindow,
    request_closed: bool,
    response_closed: bool,
}

struct TunnelSessionMutableState {
    agent_endpoint_url: Option<String>,
    runtime_env: BTreeMap<String, String>,
    telemetry_relay: TelemetryRelay,
    pending_signing_requests: BTreeMap<
        String,
        std::sync::mpsc::Sender<Result<TunnelSigningResponse, TunnelSessionError>>,
    >,
    pending_egress_token_requests:
        BTreeMap<String, std::sync::mpsc::Sender<Result<TunnelEgressToken, TunnelSessionError>>>,
    pending_agent_opens: BTreeMap<u32, PendingAgentOpenState>,
    pending_exec_opens: BTreeMap<u32, PendingExecOpenState>,
    agent_streams: BTreeMap<u32, AgentStreamState>,
    port_access_http_streams: BTreeMap<u32, mpsc::UnboundedSender<PortAccessHttpCommand>>,
    port_access_tcp_streams: BTreeMap<u32, PortAccessTcpStreamState>,
    processes_stream_send_windows: BTreeMap<u32, StreamSendWindow>,
    last_processes_snapshot_at_ms: Option<u64>,
    operation_stream_requested: bool,
    operation_stream_close_requested: bool,
    operation_stream_close_response_sender: Option<std::sync::mpsc::Sender<Result<(), String>>>,
    operation_stream_send_window: Option<StreamSendWindow>,
    pending_operation_records: VecDeque<String>,
    pty_sessions: BTreeMap<String, PtySessionState>,
    file_uploads: BTreeMap<u32, FileUploadState>,
}

struct AgentStreamTermination {
    outcome: &'static str,
    close_source: &'static str,
    reset_code: Option<&'static str>,
    reason: Option<String>,
}

struct PtySessionTermination {
    outcome: &'static str,
    reset_code: Option<&'static str>,
    reason: Option<String>,
}

struct AgentStreamWindowExhaustedTelemetry {
    available_bytes: usize,
    message_count_out: u64,
    oldest_unacked_ms: Option<u64>,
    outstanding_bytes: usize,
    payload_bytes: usize,
    payload_kind: &'static str,
    stream_age_ms: u64,
    stream_id: u32,
}

struct AgentStreamThresholdTelemetry {
    available_bytes: usize,
    message_count_out: u64,
    oldest_unacked_ms: Option<u64>,
    outstanding_bytes: usize,
    payload_bytes: usize,
    payload_kind: &'static str,
    stream_age_ms: u64,
    stream_id: u32,
    threshold_bytes: usize,
}

#[derive(Debug, Clone, Copy)]
struct PendingPtyInput {
    input_bytes: usize,
    received_at_ms: u64,
}

#[derive(Debug, Clone, Copy)]
struct PtyInputLatencyTelemetry {
    input_bytes: usize,
    input_to_first_output_ms: u64,
    interaction_count: u64,
    output_bytes: usize,
    session_age_ms: u64,
}

struct PtyOpenContext<'a> {
    cgroup_root: &'a Path,
    runtime_env: &'a BTreeMap<String, String>,
    sandbox_instance_id: &'a str,
    pty_sessions: &'a mut BTreeMap<String, PtySessionState>,
    clock: &'a dyn Clock,
    sleeper: &'a dyn Sleeper,
}

#[derive(Debug)]
struct PtySessionStats {
    avg_input_to_first_output_total_ms: u64,
    interaction_count: u64,
    max_input_to_first_output_ms: u64,
    opened_at_ms: u64,
    pending_input: Option<PendingPtyInput>,
    warning_count: u64,
}

impl PtySessionStats {
    fn new(opened_at_ms: u64) -> Self {
        Self {
            avg_input_to_first_output_total_ms: 0,
            interaction_count: 0,
            max_input_to_first_output_ms: 0,
            opened_at_ms,
            pending_input: None,
            warning_count: 0,
        }
    }

    fn record_input(&mut self, received_at_ms: u64, input_bytes: usize) {
        if self.pending_input.is_none() {
            self.pending_input = Some(PendingPtyInput {
                input_bytes,
                received_at_ms,
            });
        }
    }

    fn record_output(
        &mut self,
        emitted_at_ms: u64,
        output_bytes: usize,
    ) -> Option<PtyInputLatencyTelemetry> {
        let pending_input = self.pending_input.take()?;
        let input_to_first_output_ms = emitted_at_ms.saturating_sub(pending_input.received_at_ms);
        self.interaction_count = self.interaction_count.saturating_add(1);
        self.avg_input_to_first_output_total_ms = self
            .avg_input_to_first_output_total_ms
            .saturating_add(input_to_first_output_ms);
        self.max_input_to_first_output_ms = self
            .max_input_to_first_output_ms
            .max(input_to_first_output_ms);
        if input_to_first_output_ms > PTY_INPUT_LATENCY_WARNING_THRESHOLD_MS {
            self.warning_count = self.warning_count.saturating_add(1);
        }

        Some(PtyInputLatencyTelemetry {
            input_bytes: pending_input.input_bytes,
            input_to_first_output_ms,
            interaction_count: self.interaction_count,
            output_bytes,
            session_age_ms: self.session_age_ms(emitted_at_ms),
        })
    }

    fn avg_input_to_first_output_ms(&self) -> Option<u64> {
        if self.interaction_count == 0 {
            return None;
        }

        Some(self.avg_input_to_first_output_total_ms / self.interaction_count)
    }

    fn session_age_ms(&self, now_ms: u64) -> u64 {
        now_ms.saturating_sub(self.opened_at_ms)
    }
}

fn agent_stream_outstanding_bytes(send_window: &StreamSendWindow) -> usize {
    AGENT_STREAM_WINDOW_BYTES.saturating_sub(send_window.available_bytes())
}

fn websocket_payload_kind_name(payload_kind: u8) -> &'static str {
    match payload_kind {
        PAYLOAD_KIND_WEBSOCKET_TEXT => "websocket_text",
        PAYLOAD_KIND_WEBSOCKET_BINARY => "websocket_binary",
        _ => "unknown",
    }
}

fn publish_tunnel_telemetry_log(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    level: SandboxTelemetryLogLevel,
    event: &str,
    extra_fields: &[(&str, Value)],
) {
    match telemetry_relay.enqueue_log_record(clock, level, event, extra_fields) {
        Ok(frames) => {
            if let Err(error) = send_telemetry_frames(tunnel_writer_sender, frames) {
                eprintln!("sandboxd failed to publish telemetry event '{event}': {error}");
            }
        }
        Err(error) => {
            eprintln!("sandboxd failed to queue telemetry event '{event}': {error}");
        }
    }
}

fn publish_agent_stream_summary(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    stream_id: u32,
    agent_stream: &AgentStreamState,
    termination: &AgentStreamTermination,
) {
    let now_ms = clock.now_ms();
    let extra_fields = vec![
        ("streamId", Value::from(u64::from(stream_id))),
        (
            "channelKind",
            Value::String(AGENT_STREAM_CHANNEL_KIND.to_string()),
        ),
        ("outcome", Value::String(termination.outcome.to_string())),
        (
            "closeSource",
            Value::String(termination.close_source.to_string()),
        ),
        (
            "durationMs",
            Value::from(agent_stream.stats.stream_age_ms(now_ms)),
        ),
        (
            "messageCountOut",
            Value::from(agent_stream.stats.message_count_out),
        ),
        (
            "messageCountIn",
            Value::from(agent_stream.stats.message_count_in),
        ),
        (
            "totalBytesOut",
            Value::from(agent_stream.stats.total_bytes_out),
        ),
        (
            "totalBytesIn",
            Value::from(agent_stream.stats.total_bytes_in),
        ),
        (
            "maxMessageBytesOut",
            Value::from(agent_stream.stats.max_message_bytes_out as u64),
        ),
        (
            "maxMessageBytesIn",
            Value::from(agent_stream.stats.max_message_bytes_in as u64),
        ),
        (
            "maxOutstandingBytes",
            Value::from(agent_stream.stats.max_outstanding_bytes as u64),
        ),
        (
            "avgCreditReturnMs",
            agent_stream
                .stats
                .avg_credit_return_ms()
                .map_or(Value::Null, Value::from),
        ),
        (
            "creditReturnCount",
            Value::from(agent_stream.stats.credit_return_count),
        ),
        (
            "resetCode",
            termination
                .reset_code
                .map(|reset_code| Value::String(reset_code.to_string()))
                .unwrap_or(Value::Null),
        ),
        (
            "reason",
            termination
                .reason
                .as_ref()
                .map(|reason| Value::String(reason.clone()))
                .unwrap_or(Value::Null),
        ),
    ];

    publish_tunnel_telemetry_log(
        tunnel_writer_sender,
        telemetry_relay,
        clock,
        SandboxTelemetryLogLevel::Info,
        AGENT_STREAM_EVENT_SUMMARY,
        &extra_fields,
    );
}

fn remove_agent_stream_and_publish_summary(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
    clock: &dyn Clock,
    stream_id: u32,
    termination: AgentStreamTermination,
) -> Option<AgentStreamState> {
    let agent_stream = session_state.agent_streams.remove(&stream_id)?;
    publish_agent_stream_summary(
        tunnel_writer_sender,
        &mut session_state.telemetry_relay,
        clock,
        stream_id,
        &agent_stream,
        &termination,
    );
    Some(agent_stream)
}

fn publish_pty_input_latency_warning(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    pty_session_id: &str,
    primary_stream_id: u32,
    telemetry: PtyInputLatencyTelemetry,
) {
    let extra_fields = vec![
        ("ptySessionId", Value::String(pty_session_id.to_string())),
        ("streamId", Value::from(u64::from(primary_stream_id))),
        (
            "channelKind",
            Value::String(PTY_STREAM_CHANNEL_KIND.to_string()),
        ),
        (
            "thresholdMs",
            Value::from(PTY_INPUT_LATENCY_WARNING_THRESHOLD_MS),
        ),
        (
            "inputToFirstOutputMs",
            Value::from(telemetry.input_to_first_output_ms),
        ),
        ("inputBytes", Value::from(telemetry.input_bytes as u64)),
        ("outputBytes", Value::from(telemetry.output_bytes as u64)),
        ("interactionCount", Value::from(telemetry.interaction_count)),
        ("sessionAgeMs", Value::from(telemetry.session_age_ms)),
    ];

    publish_tunnel_telemetry_log(
        tunnel_writer_sender,
        telemetry_relay,
        clock,
        SandboxTelemetryLogLevel::Warn,
        PTY_EVENT_LATENCY_WARNING,
        &extra_fields,
    );
}

fn publish_pty_session_summary(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    pty_session_id: &str,
    primary_stream_id: u32,
    stats: &PtySessionStats,
    termination: &PtySessionTermination,
) {
    let now_ms = clock.now_ms();
    let extra_fields = vec![
        ("ptySessionId", Value::String(pty_session_id.to_string())),
        ("streamId", Value::from(u64::from(primary_stream_id))),
        (
            "channelKind",
            Value::String(PTY_STREAM_CHANNEL_KIND.to_string()),
        ),
        ("outcome", Value::String(termination.outcome.to_string())),
        ("durationMs", Value::from(stats.session_age_ms(now_ms))),
        ("interactionCount", Value::from(stats.interaction_count)),
        ("warningCount", Value::from(stats.warning_count)),
        (
            "avgInputToFirstOutputMs",
            stats
                .avg_input_to_first_output_ms()
                .map_or(Value::Null, Value::from),
        ),
        (
            "maxInputToFirstOutputMs",
            if stats.interaction_count == 0 {
                Value::Null
            } else {
                Value::from(stats.max_input_to_first_output_ms)
            },
        ),
        (
            "resetCode",
            termination
                .reset_code
                .map(|reset_code| Value::String(reset_code.to_string()))
                .unwrap_or(Value::Null),
        ),
        (
            "reason",
            termination
                .reason
                .as_ref()
                .map(|reason| Value::String(reason.clone()))
                .unwrap_or(Value::Null),
        ),
    ];

    publish_tunnel_telemetry_log(
        tunnel_writer_sender,
        telemetry_relay,
        clock,
        SandboxTelemetryLogLevel::Info,
        PTY_EVENT_SUMMARY,
        &extra_fields,
    );
}

fn remove_pty_session_and_publish_summary(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    pty_sessions: &mut BTreeMap<String, PtySessionState>,
    pty_session_id: &str,
    termination: PtySessionTermination,
) -> Option<PtySessionState> {
    let pty_state = pty_sessions.remove(pty_session_id)?;
    publish_pty_session_summary(
        tunnel_writer_sender,
        telemetry_relay,
        clock,
        pty_session_id,
        pty_state.primary_stream_id,
        &pty_state.stats,
        &termination,
    );
    Some(pty_state)
}

fn publish_agent_stream_window_exhausted(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    telemetry: AgentStreamWindowExhaustedTelemetry,
) {
    let extra_fields = vec![
        ("streamId", Value::from(u64::from(telemetry.stream_id))),
        (
            "channelKind",
            Value::String(AGENT_STREAM_CHANNEL_KIND.to_string()),
        ),
        (
            "payloadKind",
            Value::String(telemetry.payload_kind.to_string()),
        ),
        ("payloadBytes", Value::from(telemetry.payload_bytes as u64)),
        (
            "availableBytes",
            Value::from(telemetry.available_bytes as u64),
        ),
        (
            "outstandingBytes",
            Value::from(telemetry.outstanding_bytes as u64),
        ),
        (
            "maxWindowBytes",
            Value::from(AGENT_STREAM_WINDOW_BYTES as u64),
        ),
        (
            "payloadExceedsMaxWindow",
            Value::Bool(telemetry.payload_bytes > AGENT_STREAM_WINDOW_BYTES),
        ),
        (
            "payloadExceedsAvailableWindow",
            Value::Bool(telemetry.payload_bytes > telemetry.available_bytes),
        ),
        ("messageCountOut", Value::from(telemetry.message_count_out)),
        ("streamAgeMs", Value::from(telemetry.stream_age_ms)),
        (
            "oldestUnackedMs",
            telemetry.oldest_unacked_ms.map_or(Value::Null, Value::from),
        ),
    ];

    publish_tunnel_telemetry_log(
        tunnel_writer_sender,
        telemetry_relay,
        clock,
        SandboxTelemetryLogLevel::Warn,
        AGENT_STREAM_EVENT_WINDOW_EXHAUSTED,
        &extra_fields,
    );
}

fn publish_agent_stream_threshold_crossed(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    telemetry: AgentStreamThresholdTelemetry,
) {
    let extra_fields = vec![
        ("streamId", Value::from(u64::from(telemetry.stream_id))),
        (
            "channelKind",
            Value::String(AGENT_STREAM_CHANNEL_KIND.to_string()),
        ),
        (
            "payloadKind",
            Value::String(telemetry.payload_kind.to_string()),
        ),
        ("payloadBytes", Value::from(telemetry.payload_bytes as u64)),
        (
            "availableBytes",
            Value::from(telemetry.available_bytes as u64),
        ),
        (
            "outstandingBytes",
            Value::from(telemetry.outstanding_bytes as u64),
        ),
        (
            "thresholdBytes",
            Value::from(telemetry.threshold_bytes as u64),
        ),
        (
            "maxWindowBytes",
            Value::from(AGENT_STREAM_WINDOW_BYTES as u64),
        ),
        ("messageCountOut", Value::from(telemetry.message_count_out)),
        ("streamAgeMs", Value::from(telemetry.stream_age_ms)),
        (
            "oldestUnackedMs",
            telemetry.oldest_unacked_ms.map_or(Value::Null, Value::from),
        ),
    ];

    publish_tunnel_telemetry_log(
        tunnel_writer_sender,
        telemetry_relay,
        clock,
        SandboxTelemetryLogLevel::Warn,
        AGENT_STREAM_EVENT_WINDOW_THRESHOLD_CROSSED,
        &extra_fields,
    );
}

fn publish_bootstrap_closed_agent_stream_summaries(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
    clock: &dyn Clock,
    reason: &str,
) {
    let drained_streams = std::mem::take(&mut session_state.agent_streams);
    for (stream_id, agent_stream) in drained_streams {
        publish_agent_stream_summary(
            tunnel_writer_sender,
            &mut session_state.telemetry_relay,
            clock,
            stream_id,
            &agent_stream,
            &AgentStreamTermination {
                outcome: AGENT_STREAM_OUTCOME_BOOTSTRAP_CLOSED,
                close_source: AGENT_STREAM_CLOSE_SOURCE_BOOTSTRAP,
                reset_code: None,
                reason: Some(reason.to_string()),
            },
        );
    }
}

fn fail_pending_signing_requests(session_state: &mut TunnelSessionMutableState, message: &str) {
    for response_sender in std::mem::take(&mut session_state.pending_signing_requests).into_values()
    {
        let _ = response_sender.send(Err(TunnelSessionError::Signing(message.to_string())));
    }
}

fn fail_pending_egress_token_requests(
    session_state: &mut TunnelSessionMutableState,
    message: &str,
) {
    for response_sender in
        std::mem::take(&mut session_state.pending_egress_token_requests).into_values()
    {
        let _ = response_sender.send(Err(TunnelSessionError::EgressToken(message.to_string())));
    }
}

fn continue_with(
    result: Result<(), TunnelSessionError>,
) -> Result<TunnelSessionControlFlow, TunnelSessionError> {
    result.map(|()| TunnelSessionControlFlow::Continue)
}

async fn run_tunnel_supervisor(
    runtime: TunnelSessionRuntime,
    gateway_ws_url: &str,
    bootstrap_token: &str,
    tunnel_exchange_token: &str,
    request_receiver: mpsc::UnboundedReceiver<TunnelSessionRequest>,
    startup_result_sender: std::sync::mpsc::Sender<Result<(), TunnelSessionError>>,
) -> Result<(), TunnelSessionError> {
    let initial_connected_url = resolve_bootstrap_tunnel_url(gateway_ws_url, bootstrap_token)?;
    let (bootstrap_socket, _) = match connect_bootstrap_websocket(
        initial_connected_url.as_str(),
        runtime.transparent_passthrough_socket_mark,
    )
    .await
    {
        Ok(value) => value,
        Err(startup_error) => {
            let startup_error_text = startup_error.to_string();
            update_tunnel_supervision_details(
                &runtime.supervisor_handle,
                gateway_ws_url,
                Some("bootstrap_connect_failed"),
                Some(1),
                None,
            );
            runtime.supervisor_handle.mark_component_restarting(
                SupervisedComponent::TunnelSession,
                startup_error_text.clone(),
            );
            runtime.supervisor_handle.emit_component_healthcheck_failed(
                SupervisedComponent::TunnelSession,
                "bootstrap_connect_failed",
                startup_error_text.clone(),
                "bootstrap_connection",
                &[],
            );
            let _ = startup_result_sender.send(Err(TunnelSessionError::ConfigureTunnelSocket(
                startup_error_text,
            )));
            return Err(startup_error);
        }
    };
    let mut current_tunnel_exchange_token = tunnel_exchange_token.to_string();

    let mut request_receiver = request_receiver;
    let mut session_result = run_connected_tunnel_session_catching_panics(
        &runtime,
        bootstrap_socket,
        &mut request_receiver,
        Some(&startup_result_sender),
    )
    .await;
    if !session_result.startup_completed {
        return Ok(());
    }
    let token_exchange_url = resolve_tunnel_exchange_url(gateway_ws_url)?;
    let tunnel_exchange_client = build_tunnel_exchange_http_client()?;

    loop {
        match session_result.outcome {
            ConnectedTunnelSessionOutcome::ShutdownRequested => {
                return Ok(());
            }
            ConnectedTunnelSessionOutcome::RestartRequired => {}
        }

        let Some(reconnected_socket) = reconnect_bootstrap_tunnel(
            &runtime,
            &tunnel_exchange_client,
            token_exchange_url.as_str(),
            gateway_ws_url,
            &mut current_tunnel_exchange_token,
        )
        .await?
        else {
            return Ok(());
        };

        session_result = run_connected_tunnel_session_catching_panics(
            &runtime,
            reconnected_socket,
            &mut request_receiver,
            None,
        )
        .await;
    }
}

async fn run_connected_tunnel_session_catching_panics(
    runtime: &TunnelSessionRuntime,
    bootstrap_socket: TunnelWebSocket,
    request_receiver: &mut mpsc::UnboundedReceiver<TunnelSessionRequest>,
    startup_result_sender: Option<&std::sync::mpsc::Sender<Result<(), TunnelSessionError>>>,
) -> ConnectedTunnelSessionResult {
    let startup_completed = Arc::new(AtomicBool::new(startup_result_sender.is_none()));
    match AssertUnwindSafe(run_connected_tunnel_session(
        runtime,
        bootstrap_socket,
        request_receiver,
        startup_result_sender,
        startup_completed.as_ref(),
    ))
    .catch_unwind()
    .await
    {
        Ok(result) => result,
        Err(payload) => {
            let panic_text = format_panic_payload(payload.as_ref());
            update_tunnel_supervision_details(
                &runtime.supervisor_handle,
                &runtime.gateway_ws_url,
                Some("connected_session_panic"),
                None,
                None,
            );
            runtime
                .supervisor_handle
                .mark_component_restarting(SupervisedComponent::TunnelSession, panic_text.clone());
            runtime.supervisor_handle.emit_component_exited(
                SupervisedComponent::TunnelSession,
                "panic",
                Some(&panic_text),
                &[
                    ("exitKind", Value::String("panic".to_string())),
                    (
                        "panicBoundary",
                        Value::String("connected_session".to_string()),
                    ),
                ],
            );
            let startup_completed = startup_completed.load(Ordering::Relaxed);
            if let Some(startup_result_sender) = startup_result_sender
                && !startup_completed
            {
                let _ = startup_result_sender.send(Err(TunnelSessionError::SessionPanicked));
            }
            mark_tunnel_disconnected(runtime);
            ConnectedTunnelSessionResult {
                outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                startup_completed,
            }
        }
    }
}

fn publish_initial_runtime_readiness(
    runtime: &TunnelSessionRuntime,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
) -> Result<(), TunnelSessionError> {
    let publishable_state = runtime
        .runtime_readiness_manager
        .lock()
        .expect("runtime readiness manager lock should not be poisoned")
        .take_publishable_state()
        .ok_or_else(|| {
            TunnelSessionError::MissingRuntimeReadyState(
                "runtime readiness manager did not produce an initial state after tunnel attachment"
                    .to_string(),
            )
        })?;
    let payload = serde_json::to_string(&publishable_state)
        .map_err(TunnelSessionError::PublishRuntimeReady)?;

    write_tunnel_text(tunnel_writer_sender, payload)
}

fn snapshot_runtime_connection_state(
    runtime: &TunnelSessionRuntime,
) -> TunnelSessionRuntimeConnectionState {
    match runtime.connection_state.read() {
        Ok(connection_state) => connection_state.clone(),
        Err(poisoned_connection_state) => {
            eprintln!(
                "sandboxd bootstrap tunnel observed a poisoned connection state during connect; continuing with the poisoned state"
            );
            poisoned_connection_state.into_inner().clone()
        }
    }
}

fn set_runtime_agent_endpoint_url(
    runtime: &TunnelSessionRuntime,
    agent_endpoint_url: Option<String>,
) {
    match runtime.connection_state.write() {
        Ok(mut connection_state) => {
            connection_state.agent_endpoint_url = agent_endpoint_url;
        }
        Err(poisoned_connection_state) => {
            eprintln!(
                "sandboxd bootstrap tunnel observed a poisoned connection state during agent endpoint update; continuing with the poisoned state"
            );
            poisoned_connection_state.into_inner().agent_endpoint_url = agent_endpoint_url;
        }
    }
}

fn set_runtime_environment(runtime: &TunnelSessionRuntime, runtime_env: BTreeMap<String, String>) {
    match runtime.connection_state.write() {
        Ok(mut connection_state) => {
            connection_state.runtime_env = runtime_env;
        }
        Err(poisoned_connection_state) => {
            eprintln!(
                "sandboxd bootstrap tunnel observed a poisoned connection state during runtime environment update; continuing with the poisoned state"
            );
            poisoned_connection_state.into_inner().runtime_env = runtime_env;
        }
    }
}

async fn run_connected_tunnel_session(
    runtime: &TunnelSessionRuntime,
    bootstrap_socket: TunnelWebSocket,
    request_receiver: &mut mpsc::UnboundedReceiver<TunnelSessionRequest>,
    startup_result_sender: Option<&std::sync::mpsc::Sender<Result<(), TunnelSessionError>>>,
    startup_completed: &AtomicBool,
) -> ConnectedTunnelSessionResult {
    let (tunnel_writer_sender, tunnel_writer_receiver) = mpsc::unbounded_channel();
    let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
    let _bootstrap_socket_task = spawn_bootstrap_socket_task(
        bootstrap_socket,
        tunnel_writer_receiver,
        event_sender.clone(),
    );
    let _wake_thread = spawn_tunnel_wake_thread(
        runtime.shutdown_requested.clone(),
        runtime.sleeper.clone(),
        event_sender.clone(),
    );
    let connection_state = snapshot_runtime_connection_state(runtime);

    let mut session_state = TunnelSessionMutableState {
        agent_endpoint_url: connection_state.agent_endpoint_url,
        runtime_env: connection_state.runtime_env,
        telemetry_relay: TelemetryRelay::default(),
        pending_signing_requests: BTreeMap::new(),
        pending_egress_token_requests: BTreeMap::new(),
        pending_agent_opens: BTreeMap::new(),
        pending_exec_opens: BTreeMap::new(),
        agent_streams: BTreeMap::new(),
        port_access_http_streams: BTreeMap::new(),
        port_access_tcp_streams: BTreeMap::new(),
        processes_stream_send_windows: BTreeMap::new(),
        last_processes_snapshot_at_ms: None,
        operation_stream_requested: false,
        operation_stream_close_requested: false,
        operation_stream_close_response_sender: None,
        operation_stream_send_window: None,
        pending_operation_records: VecDeque::new(),
        pty_sessions: BTreeMap::new(),
        file_uploads: BTreeMap::new(),
    };
    let telemetry_frames = match session_state.telemetry_relay.attach_tunnel_connection() {
        Ok(frames) => frames,
        Err(error) => {
            let error = TunnelSessionError::AttachTelemetry(error.to_string());
            let error_text = error.to_string();
            update_tunnel_supervision_details(
                &runtime.supervisor_handle,
                &runtime.gateway_ws_url,
                Some("telemetry_attach_failed"),
                None,
                None,
            );
            runtime
                .supervisor_handle
                .mark_component_restarting(SupervisedComponent::TunnelSession, error.to_string());
            runtime.supervisor_handle.emit_component_exited(
                SupervisedComponent::TunnelSession,
                "thread_returned",
                Some(&error_text),
                &[("exitKind", Value::String("thread_returned".to_string()))],
            );
            mark_tunnel_disconnected(runtime);
            if let Some(startup_result_sender) = startup_result_sender {
                let _ = startup_result_sender.send(Err(error));
            }
            return ConnectedTunnelSessionResult {
                outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                startup_completed: false,
            };
        }
    };
    match send_telemetry_frames(&tunnel_writer_sender, telemetry_frames) {
        Ok(()) => {
            mark_tunnel_connected(runtime);
            if let Some(operation_id) = runtime.operation_id.as_deref()
                && let Err(error) = write_tunnel_text(
                    &tunnel_writer_sender,
                    operation_open(operation_id, runtime.operation_kind),
                )
            {
                eprintln!("sandboxd failed to open operation stream: {error}");
            } else if runtime.operation_id.is_some() {
                session_state.operation_stream_requested = true;
            }
            forward_supervisor_lifecycle_events(
                &runtime.supervisor_handle,
                &mut session_state.telemetry_relay,
                &tunnel_writer_sender,
            );
        }
        Err(error) => {
            let error_text = error.to_string();
            update_tunnel_supervision_details(
                &runtime.supervisor_handle,
                &runtime.gateway_ws_url,
                Some("telemetry_open_failed"),
                None,
                None,
            );
            runtime
                .supervisor_handle
                .mark_component_restarting(SupervisedComponent::TunnelSession, error.to_string());
            runtime.supervisor_handle.emit_component_exited(
                SupervisedComponent::TunnelSession,
                "thread_returned",
                Some(&error_text),
                &[("exitKind", Value::String("thread_returned".to_string()))],
            );
            mark_tunnel_disconnected(runtime);
            if let Some(startup_result_sender) = startup_result_sender {
                let _ = startup_result_sender.send(Err(error));
            }
            return ConnectedTunnelSessionResult {
                outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                startup_completed: false,
            };
        }
    }

    let loop_context = TunnelSessionLoopContext {
        attachment_root: &runtime.attachment_root,
        cgroup_root: &runtime.cgroup_root,
        sandbox_instance_id: &runtime.sandbox_instance_id,
        gateway_ws_url: &runtime.gateway_ws_url,
        clock: runtime.clock.as_ref(),
        sleeper: runtime.sleeper.as_ref(),
        supervisor_handle: &runtime.supervisor_handle,
    };

    if let Err(error) = publish_initial_runtime_readiness(runtime, &tunnel_writer_sender) {
        let error_text = error.to_string();
        update_tunnel_supervision_details(
            loop_context.supervisor_handle,
            loop_context.gateway_ws_url,
            Some("runtime_readiness_publish_failed"),
            None,
            None,
        );
        loop_context
            .supervisor_handle
            .mark_component_restarting(SupervisedComponent::TunnelSession, error_text.clone());
        loop_context.supervisor_handle.emit_component_exited(
            SupervisedComponent::TunnelSession,
            "thread_returned",
            Some(&error_text),
            &[("exitKind", Value::String("thread_returned".to_string()))],
        );
        mark_tunnel_disconnected(runtime);
        if let Some(startup_result_sender) = startup_result_sender {
            let _ = startup_result_sender.send(Err(error));
        }
        return ConnectedTunnelSessionResult {
            outcome: ConnectedTunnelSessionOutcome::RestartRequired,
            startup_completed: false,
        };
    }
    if let Some(startup_result_sender) = startup_result_sender {
        let _ = startup_result_sender.send(Ok(()));
    }
    startup_completed.store(true, Ordering::Relaxed);
    let startup_completed = true;

    loop {
        if let Err(error) = sync_pty_scope_keepalive(
            runtime.keepalive_manager.as_ref(),
            loop_context.cgroup_root,
            loop_context.sandbox_instance_id,
        ) {
            let error_text = error.to_string();
            update_tunnel_supervision_details(
                loop_context.supervisor_handle,
                loop_context.gateway_ws_url,
                Some("pty_keepalive_sync_failed"),
                None,
                None,
            );
            loop_context
                .supervisor_handle
                .mark_component_restarting(SupervisedComponent::TunnelSession, error_text.clone());
            loop_context.supervisor_handle.emit_component_exited(
                SupervisedComponent::TunnelSession,
                "thread_returned",
                Some(&error_text),
                &[("exitKind", Value::String("thread_returned".to_string()))],
            );
            mark_tunnel_disconnected(runtime);
            return ConnectedTunnelSessionResult {
                outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                startup_completed,
            };
        }
        {
            let publishable_state = runtime
                .keepalive_manager
                .lock()
                .expect("keepalive manager lock should not be poisoned")
                .take_publishable_state(loop_context.clock);
            if let Some(state) = publishable_state {
                let payload = match serde_json::to_string(&state) {
                    Ok(payload) => payload,
                    Err(error) => {
                        let publish_error = TunnelSessionError::PublishKeepalive(error);
                        let publish_error_text = publish_error.to_string();
                        update_tunnel_supervision_details(
                            loop_context.supervisor_handle,
                            loop_context.gateway_ws_url,
                            Some("keepalive_publish_failed"),
                            None,
                            None,
                        );
                        loop_context.supervisor_handle.mark_component_restarting(
                            SupervisedComponent::TunnelSession,
                            publish_error_text.clone(),
                        );
                        loop_context.supervisor_handle.emit_component_exited(
                            SupervisedComponent::TunnelSession,
                            "thread_returned",
                            Some(&publish_error_text),
                            &[("exitKind", Value::String("thread_returned".to_string()))],
                        );
                        mark_tunnel_disconnected(runtime);
                        return ConnectedTunnelSessionResult {
                            outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                            startup_completed,
                        };
                    }
                };
                if let Err(error) = write_tunnel_text(&tunnel_writer_sender, payload) {
                    let error_text = error.to_string();
                    update_tunnel_supervision_details(
                        loop_context.supervisor_handle,
                        loop_context.gateway_ws_url,
                        Some("keepalive_publish_failed"),
                        None,
                        None,
                    );
                    loop_context.supervisor_handle.mark_component_restarting(
                        SupervisedComponent::TunnelSession,
                        error_text.clone(),
                    );
                    loop_context.supervisor_handle.emit_component_exited(
                        SupervisedComponent::TunnelSession,
                        "thread_returned",
                        Some(&error_text),
                        &[("exitKind", Value::String("thread_returned".to_string()))],
                    );
                    mark_tunnel_disconnected(runtime);
                    return ConnectedTunnelSessionResult {
                        outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                        startup_completed,
                    };
                }
            }
        }
        {
            let publishable_state = runtime
                .runtime_readiness_manager
                .lock()
                .expect("runtime readiness manager lock should not be poisoned")
                .take_publishable_state();
            if let Some(state) = publishable_state {
                let payload = match serde_json::to_string(&state) {
                    Ok(payload) => payload,
                    Err(error) => {
                        let publish_error = TunnelSessionError::PublishRuntimeReady(error);
                        let publish_error_text = publish_error.to_string();
                        update_tunnel_supervision_details(
                            loop_context.supervisor_handle,
                            loop_context.gateway_ws_url,
                            Some("runtime_readiness_publish_failed"),
                            None,
                            None,
                        );
                        loop_context.supervisor_handle.mark_component_restarting(
                            SupervisedComponent::TunnelSession,
                            publish_error_text.clone(),
                        );
                        loop_context.supervisor_handle.emit_component_exited(
                            SupervisedComponent::TunnelSession,
                            "thread_returned",
                            Some(&publish_error_text),
                            &[("exitKind", Value::String("thread_returned".to_string()))],
                        );
                        mark_tunnel_disconnected(runtime);
                        return ConnectedTunnelSessionResult {
                            outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                            startup_completed,
                        };
                    }
                };
                if let Err(error) = write_tunnel_text(&tunnel_writer_sender, payload) {
                    let error_text = error.to_string();
                    update_tunnel_supervision_details(
                        loop_context.supervisor_handle,
                        loop_context.gateway_ws_url,
                        Some("runtime_readiness_publish_failed"),
                        None,
                        None,
                    );
                    loop_context.supervisor_handle.mark_component_restarting(
                        SupervisedComponent::TunnelSession,
                        error_text.clone(),
                    );
                    loop_context.supervisor_handle.emit_component_exited(
                        SupervisedComponent::TunnelSession,
                        "thread_returned",
                        Some(&error_text),
                        &[("exitKind", Value::String("thread_returned".to_string()))],
                    );
                    mark_tunnel_disconnected(runtime);
                    return ConnectedTunnelSessionResult {
                        outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                        startup_completed,
                    };
                }
            }
        }
        let next_item = tokio::select! {
            event = event_receiver.recv() => event.map(ConnectedTunnelSessionLoopItem::Event),
            request = request_receiver.recv() => request.map(ConnectedTunnelSessionLoopItem::Request),
        };
        let Some(next_item) = next_item else {
            break;
        };

        if runtime.shutdown_requested.load(Ordering::Relaxed) {
            for pending_agent_open in session_state.pending_agent_opens.values() {
                pending_agent_open.task.abort();
            }
            for pending_exec_open in session_state.pending_exec_opens.values() {
                pending_exec_open
                    .cancel_requested
                    .store(true, Ordering::Relaxed);
                let child_pid = pending_exec_open
                    .child_pid
                    .lock()
                    .expect("exec child pid lock should not be poisoned")
                    .to_owned();
                if let Some(child_pid) = child_pid {
                    let _ = kill_exec_child_process(child_pid);
                }
            }
            for pty_session in session_state.pty_sessions.values() {
                let _ = pty_session.session.terminate(
                    loop_context.clock,
                    loop_context.sleeper,
                    DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                    DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
                );
            }
            if let Ok(frames) = session_state.telemetry_relay.detach_tunnel_connection() {
                let _ = send_telemetry_frames(&tunnel_writer_sender, frames);
            }
            fail_pending_signing_requests(
                &mut session_state,
                "bootstrap tunnel session shut down before a signing result arrived",
            );
            fail_pending_egress_token_requests(
                &mut session_state,
                "bootstrap tunnel session shut down before an egress token arrived",
            );
            mark_tunnel_disconnected(runtime);
            let _ = write_tunnel_close(&tunnel_writer_sender);
            return ConnectedTunnelSessionResult {
                outcome: ConnectedTunnelSessionOutcome::ShutdownRequested,
                startup_completed,
            };
        }

        let control_flow_result = match next_item {
            ConnectedTunnelSessionLoopItem::Event(event) => {
                handle_tunnel_session_event(
                    event,
                    &tunnel_writer_sender,
                    &event_sender,
                    &loop_context,
                    &mut session_state,
                )
                .await
            }
            ConnectedTunnelSessionLoopItem::Request(request) => handle_tunnel_session_request(
                request,
                &tunnel_writer_sender,
                runtime,
                &mut session_state,
            ),
        };

        match control_flow_result {
            Ok(TunnelSessionControlFlow::Continue) => {
                forward_supervisor_lifecycle_events(
                    loop_context.supervisor_handle,
                    &mut session_state.telemetry_relay,
                    &tunnel_writer_sender,
                );
            }
            Ok(TunnelSessionControlFlow::RestartRequired) => {
                fail_pending_signing_requests(
                    &mut session_state,
                    "bootstrap tunnel session restarted before a signing result arrived",
                );
                fail_pending_egress_token_requests(
                    &mut session_state,
                    "bootstrap tunnel session restarted before an egress token arrived",
                );
                mark_tunnel_disconnected(runtime);
                return ConnectedTunnelSessionResult {
                    outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                    startup_completed,
                };
            }
            Err(error) => {
                let error_text = error.to_string();
                update_tunnel_supervision_details(
                    loop_context.supervisor_handle,
                    loop_context.gateway_ws_url,
                    Some("connected_session_event_loop_failed"),
                    None,
                    None,
                );
                loop_context.supervisor_handle.mark_component_restarting(
                    SupervisedComponent::TunnelSession,
                    error_text.clone(),
                );
                loop_context.supervisor_handle.emit_component_exited(
                    SupervisedComponent::TunnelSession,
                    "thread_returned",
                    Some(&error_text),
                    &[("exitKind", Value::String("thread_returned".to_string()))],
                );
                fail_pending_signing_requests(
                    &mut session_state,
                    "bootstrap tunnel session failed before a signing result arrived",
                );
                fail_pending_egress_token_requests(
                    &mut session_state,
                    "bootstrap tunnel session failed before an egress token arrived",
                );
                mark_tunnel_disconnected(runtime);
                return ConnectedTunnelSessionResult {
                    outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                    startup_completed,
                };
            }
        }
    }

    update_tunnel_supervision_details(
        &runtime.supervisor_handle,
        &runtime.gateway_ws_url,
        Some("event_channel_closed"),
        None,
        None,
    );
    runtime.supervisor_handle.mark_component_restarting(
        SupervisedComponent::TunnelSession,
        "bootstrap event channel closed".to_string(),
    );
    runtime.supervisor_handle.emit_component_exited(
        SupervisedComponent::TunnelSession,
        "thread_returned",
        Some("bootstrap event channel closed"),
        &[("exitKind", Value::String("thread_returned".to_string()))],
    );
    mark_tunnel_disconnected(runtime);
    ConnectedTunnelSessionResult {
        outcome: ConnectedTunnelSessionOutcome::RestartRequired,
        startup_completed,
    }
}

fn mark_tunnel_connected(runtime: &TunnelSessionRuntime) {
    match runtime.keepalive_manager.lock() {
        Ok(mut keepalive_manager) => keepalive_manager.on_tunnel_connected(runtime.clock.as_ref()),
        Err(poisoned_manager) => {
            eprintln!(
                "sandboxd bootstrap tunnel observed a poisoned keepalive manager during connect; continuing with the poisoned state"
            );
            poisoned_manager
                .into_inner()
                .on_tunnel_connected(runtime.clock.as_ref());
        }
    }
    match runtime.runtime_readiness_manager.lock() {
        Ok(mut runtime_readiness_manager) => runtime_readiness_manager.on_tunnel_connected(),
        Err(poisoned_manager) => {
            eprintln!(
                "sandboxd bootstrap tunnel observed a poisoned runtime readiness manager during connect; continuing with the poisoned state"
            );
            poisoned_manager.into_inner().on_tunnel_connected();
        }
    }
    update_tunnel_supervision_details(
        &runtime.supervisor_handle,
        &runtime.gateway_ws_url,
        None,
        None,
        None,
    );
    runtime
        .supervisor_handle
        .mark_component_healthy(SupervisedComponent::TunnelSession);
}

fn mark_tunnel_disconnected(runtime: &TunnelSessionRuntime) {
    match runtime.keepalive_manager.lock() {
        Ok(mut keepalive_manager) => keepalive_manager.on_tunnel_disconnected(),
        Err(poisoned_manager) => {
            eprintln!(
                "sandboxd bootstrap tunnel observed a poisoned keepalive manager during disconnect; continuing with the poisoned state"
            );
            poisoned_manager.into_inner().on_tunnel_disconnected();
        }
    }
    match runtime.runtime_readiness_manager.lock() {
        Ok(mut runtime_readiness_manager) => runtime_readiness_manager.on_tunnel_disconnected(),
        Err(poisoned_manager) => {
            eprintln!(
                "sandboxd bootstrap tunnel observed a poisoned runtime readiness manager during disconnect; continuing with the poisoned state"
            );
            poisoned_manager.into_inner().on_tunnel_disconnected();
        }
    }
}

fn build_tunnel_exchange_http_client() -> Result<TunnelExchangeHttpClient, TunnelSessionError> {
    let mut http_connector = HttpConnector::new();
    http_connector.enforce_http(false);
    let https_connector = HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|error| TunnelSessionError::ConfigureTunnelSocket(error.to_string()))?
        .https_or_http()
        .enable_http1()
        .wrap_connector(http_connector);
    Ok(Client::builder(TokioExecutor::new()).build(https_connector))
}

async fn reconnect_bootstrap_tunnel(
    runtime: &TunnelSessionRuntime,
    tunnel_exchange_client: &TunnelExchangeHttpClient,
    token_exchange_url: &str,
    gateway_ws_url: &str,
    current_tunnel_exchange_token: &mut String,
) -> Result<Option<TunnelWebSocket>, TunnelSessionError> {
    let mut attempt_index = 0_usize;

    loop {
        if runtime.shutdown_requested.load(Ordering::Relaxed) {
            return Ok(None);
        }

        let attempt_number = attempt_index + 1;
        update_tunnel_supervision_details(
            &runtime.supervisor_handle,
            &runtime.gateway_ws_url,
            Some("restart_attempt"),
            Some(attempt_number),
            None,
        );
        runtime
            .supervisor_handle
            .mark_component_starting(SupervisedComponent::TunnelSession);
        match exchange_tunnel_token(
            tunnel_exchange_client,
            token_exchange_url,
            current_tunnel_exchange_token.as_str(),
        )
        .await?
        {
            TunnelExchangeOutcome::Success(exchange) => {
                *current_tunnel_exchange_token = exchange.tunnel_exchange_token;
                let connected_url = resolve_bootstrap_tunnel_url(
                    gateway_ws_url,
                    exchange.bootstrap_token.as_str(),
                )?;
                match connect_bootstrap_websocket(
                    connected_url.as_str(),
                    runtime.transparent_passthrough_socket_mark,
                )
                .await
                {
                    Ok((bootstrap_socket, _)) => {
                        return Ok(Some(bootstrap_socket));
                    }
                    Err(error) => {
                        update_tunnel_supervision_details(
                            &runtime.supervisor_handle,
                            &runtime.gateway_ws_url,
                            Some("bootstrap_connect_failed"),
                            Some(attempt_number),
                            None,
                        );
                        runtime.supervisor_handle.mark_component_restarting(
                            SupervisedComponent::TunnelSession,
                            error.to_string(),
                        );
                        runtime.supervisor_handle.emit_component_healthcheck_failed(
                            SupervisedComponent::TunnelSession,
                            "bootstrap_connect_failed",
                            error.to_string(),
                            "bootstrap_connection",
                            &[],
                        );
                    }
                }
            }
            TunnelExchangeOutcome::Retryable(error) => {
                update_tunnel_supervision_details(
                    &runtime.supervisor_handle,
                    &runtime.gateway_ws_url,
                    Some("token_exchange_failed"),
                    Some(attempt_number),
                    None,
                );
                runtime
                    .supervisor_handle
                    .mark_component_restarting(SupervisedComponent::TunnelSession, error.clone());
                runtime.supervisor_handle.emit_component_healthcheck_failed(
                    SupervisedComponent::TunnelSession,
                    "token_exchange_failed",
                    error,
                    "bootstrap_connection",
                    &[],
                );
            }
            TunnelExchangeOutcome::Terminal(error) => {
                update_tunnel_supervision_details(
                    &runtime.supervisor_handle,
                    &runtime.gateway_ws_url,
                    Some("token_exchange_terminal"),
                    Some(attempt_number),
                    None,
                );
                runtime
                    .supervisor_handle
                    .mark_component_restarting(SupervisedComponent::TunnelSession, error.clone());
                runtime.supervisor_handle.emit_component_healthcheck_failed(
                    SupervisedComponent::TunnelSession,
                    "token_exchange_terminal",
                    error,
                    "bootstrap_connection",
                    &[],
                );
                mark_tunnel_disconnected(runtime);
                return Ok(None);
            }
        }

        mark_tunnel_disconnected(runtime);
        let backoff_ms = reconnect_backoff_ms(attempt_index);
        update_tunnel_supervision_details(
            &runtime.supervisor_handle,
            &runtime.gateway_ws_url,
            Some("retry_after_failure"),
            Some(attempt_number),
            Some(backoff_ms),
        );
        runtime.supervisor_handle.emit_component_restart_scheduled(
            SupervisedComponent::TunnelSession,
            "retry_after_failure",
            backoff_ms,
            &[],
        );
        runtime.sleeper.sleep(Duration::from_millis(backoff_ms));
        attempt_index = attempt_index.saturating_add(1);
    }
}

fn reconnect_backoff_ms(attempt_index: usize) -> u64 {
    *TUNNEL_RECONNECT_BACKOFF_MS
        .get(attempt_index)
        .unwrap_or_else(|| {
            TUNNEL_RECONNECT_BACKOFF_MS
                .last()
                .expect("backoff list should not be empty")
        })
}

fn forward_supervisor_lifecycle_events(
    supervisor_handle: &SandboxdSupervisorHandle,
    telemetry_relay: &mut TelemetryRelay,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
) {
    for line in supervisor_handle.drain_forwarded_lifecycle_event_lines() {
        let forwarded_line = match encode_forwarded_lifecycle_event_log_line(&line) {
            Ok(forwarded_line) => forwarded_line,
            Err(error) => {
                eprintln!("sandboxd failed to encode forwarded lifecycle telemetry: {error}");
                continue;
            }
        };
        let frames = match telemetry_relay.enqueue_log_line(&forwarded_line) {
            Ok(frames) => frames,
            Err(error) => {
                eprintln!("sandboxd failed to queue supervisor lifecycle telemetry: {error}");
                continue;
            }
        };
        if let Err(error) = send_telemetry_frames(tunnel_writer_sender, frames) {
            eprintln!("sandboxd failed to publish supervisor lifecycle telemetry: {error}");
        }
    }
}

fn update_tunnel_supervision_details(
    supervisor_handle: &SandboxdSupervisorHandle,
    gateway_ws_url: &str,
    last_reconnect_reason: Option<&str>,
    reconnect_attempt: Option<usize>,
    reconnect_backoff_ms: Option<u64>,
) {
    let mut details = BTreeMap::from([("gatewayWsUrl".to_string(), gateway_ws_url.to_string())]);
    if let Some(last_reconnect_reason) = last_reconnect_reason {
        details.insert(
            "lastReconnectReason".to_string(),
            last_reconnect_reason.to_string(),
        );
    }
    if let Some(reconnect_attempt) = reconnect_attempt {
        details.insert(
            "reconnectAttempt".to_string(),
            reconnect_attempt.to_string(),
        );
    }
    if let Some(reconnect_backoff_ms) = reconnect_backoff_ms {
        details.insert(
            "reconnectBackoffMs".to_string(),
            reconnect_backoff_ms.to_string(),
        );
    }
    supervisor_handle.replace_component_details(SupervisedComponent::TunnelSession, details);
}

async fn exchange_tunnel_token(
    tunnel_exchange_client: &TunnelExchangeHttpClient,
    token_exchange_url: &str,
    tunnel_exchange_token: &str,
) -> Result<TunnelExchangeOutcome, TunnelSessionError> {
    let normalized_token = tunnel_exchange_token.trim();
    if normalized_token.is_empty() {
        return Ok(TunnelExchangeOutcome::Retryable(
            "sandbox tunnel exchange token is required".to_string(),
        ));
    }

    let request = Request::post(token_exchange_url)
        .header(AUTHORIZATION, format!("Bearer {normalized_token}"))
        .header(CONTENT_LENGTH, "0")
        .body(Empty::new())
        .map_err(|error| TunnelSessionError::ConfigureTunnelSocket(error.to_string()))?;

    let response = match tunnel_exchange_client.request(request).await {
        Ok(response) => response,
        Err(error) => {
            return Ok(TunnelExchangeOutcome::Retryable(error.to_string()));
        }
    };
    let status = response.status();
    let response_body = response
        .into_body()
        .collect()
        .await
        .map_err(|error| error.to_string());

    let response_body = match response_body {
        Ok(response_body) => response_body.to_bytes(),
        Err(error) => {
            return Ok(TunnelExchangeOutcome::Retryable(error));
        }
    };

    match status {
        StatusCode::OK => {
            let parsed_response: TunnelExchangeResponse =
                match serde_json::from_slice(&response_body) {
                    Ok(response) => response,
                    Err(error) => {
                        return Ok(TunnelExchangeOutcome::Retryable(error.to_string()));
                    }
                };
            if parsed_response.bootstrap_token.trim().is_empty()
                || parsed_response.tunnel_exchange_token.trim().is_empty()
            {
                return Ok(TunnelExchangeOutcome::Retryable(
                    "tunnel exchange response must include non-empty bootstrapToken and tunnelExchangeToken"
                        .to_string(),
                ));
            }
            Ok(TunnelExchangeOutcome::Success(TunnelExchangeSuccess {
                bootstrap_token: parsed_response.bootstrap_token,
                tunnel_exchange_token: parsed_response.tunnel_exchange_token,
            }))
        }
        StatusCode::UNAUTHORIZED | StatusCode::NOT_FOUND | StatusCode::CONFLICT => {
            Ok(TunnelExchangeOutcome::Terminal(
                read_tunnel_exchange_error_message(status, &response_body),
            ))
        }
        StatusCode::TOO_MANY_REQUESTS => Ok(TunnelExchangeOutcome::Retryable(
            read_tunnel_exchange_error_message(status, &response_body),
        )),
        status if status.is_server_error() => Ok(TunnelExchangeOutcome::Retryable(
            read_tunnel_exchange_error_message(status, &response_body),
        )),
        _ => Ok(TunnelExchangeOutcome::Retryable(
            read_tunnel_exchange_error_message(status, &response_body),
        )),
    }
}

fn read_tunnel_exchange_error_message(status: StatusCode, response_body: &[u8]) -> String {
    match serde_json::from_slice::<Value>(response_body) {
        Ok(Value::Object(fields)) => fields
            .get("error")
            .and_then(Value::as_str)
            .map(std::string::ToString::to_string)
            .unwrap_or_else(|| {
                format!(
                    "token exchange returned unexpected status {}",
                    status.as_u16()
                )
            }),
        Ok(other) => format!(
            "token exchange returned status {} with unexpected JSON body: {other}",
            status.as_u16()
        ),
        Err(_) if response_body.is_empty() => {
            format!(
                "token exchange returned status {} with an empty body",
                status.as_u16()
            )
        }
        Err(_) => format!(
            "token exchange returned status {} with a non-JSON body",
            status.as_u16()
        ),
    }
}

type TunnelWebSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn connect_bootstrap_websocket(
    connected_url: &str,
    transparent_passthrough_socket_mark: Option<u32>,
) -> Result<
    (
        TunnelWebSocket,
        tokio_tungstenite::tungstenite::handshake::client::Response,
    ),
    TunnelSessionError,
> {
    let request = connected_url
        .into_client_request()
        .map_err(|error| TunnelSessionError::ConfigureTunnelSocket(error.to_string()))?;
    let uri = request.uri().clone();
    let host = uri
        .host()
        .ok_or_else(|| {
            TunnelSessionError::ConfigureTunnelSocket(format!(
                "bootstrap websocket URL is missing a host: {connected_url}"
            ))
        })?
        .to_string();
    let port = uri.port_u16().unwrap_or_else(|| match uri.scheme_str() {
        Some("wss") => 443,
        Some("ws") => 80,
        _ => 0,
    });
    if port == 0 {
        return Err(TunnelSessionError::ConfigureTunnelSocket(format!(
            "bootstrap websocket URL must use ws or wss scheme: {connected_url}"
        )));
    }

    let resolved_addresses = prioritize_ipv4_socket_addresses(
        timeout(
            DEFAULT_BOOTSTRAP_TUNNEL_LOOKUP_TIMEOUT,
            lookup_host((host.as_str(), port)),
        )
        .await
        .map_err(|_| {
            TunnelSessionError::ConfigureTunnelSocket(format!(
                "bootstrap websocket host lookup timed out after {}ms: {host}:{port}",
                DEFAULT_BOOTSTRAP_TUNNEL_LOOKUP_TIMEOUT.as_millis()
            ))
        })?
        .map_err(|error| TunnelSessionError::ConfigureTunnelSocket(error.to_string()))?
        .collect::<Vec<_>>(),
    );
    if resolved_addresses.is_empty() {
        return Err(TunnelSessionError::ConfigureTunnelSocket(format!(
            "bootstrap websocket host lookup returned no addresses: {host}:{port}"
        )));
    }

    let mut attempted_connect_errors = Vec::new();
    for address in resolved_addresses {
        let socket = match timeout(
            DEFAULT_BOOTSTRAP_TUNNEL_CONNECT_TIMEOUT,
            connect_bootstrap_tcp_socket(address, transparent_passthrough_socket_mark),
        )
        .await
        {
            Ok(Ok(socket)) => socket,
            Ok(Err(error)) => {
                attempted_connect_errors.push(format!("{address}: {error}"));
                continue;
            }
            Err(_) => {
                attempted_connect_errors.push(format!(
                    "{address}: tcp connect timed out after {}ms",
                    DEFAULT_BOOTSTRAP_TUNNEL_CONNECT_TIMEOUT.as_millis()
                ));
                continue;
            }
        };

        match timeout(
            DEFAULT_BOOTSTRAP_TUNNEL_HANDSHAKE_TIMEOUT,
            client_async_tls_with_config(request.clone(), socket, None, None),
        )
        .await
        {
            Ok(Ok(result)) => return Ok(result),
            Ok(Err(error)) => {
                attempted_connect_errors.push(format!("{address}: {error}"));
            }
            Err(_) => {
                attempted_connect_errors.push(format!(
                    "{address}: websocket handshake timed out after {}ms",
                    DEFAULT_BOOTSTRAP_TUNNEL_HANDSHAKE_TIMEOUT.as_millis()
                ));
            }
        }
    }

    Err(TunnelSessionError::ConfigureTunnelSocket(
        if attempted_connect_errors.is_empty() {
            format!("bootstrap websocket connect failed for {connected_url}")
        } else {
            format!(
                "bootstrap websocket failed to connect to any resolved address for {host}:{port}; attempts: {}",
                attempted_connect_errors.join("; ")
            )
        },
    ))
}

async fn connect_bootstrap_tcp_socket(
    address: SocketAddr,
    transparent_passthrough_socket_mark: Option<u32>,
) -> Result<TcpStream, std::io::Error> {
    let socket = match address {
        SocketAddr::V4(_) => TcpSocket::new_v4()?,
        SocketAddr::V6(_) => TcpSocket::new_v6()?,
    };
    if let Some(mark) = transparent_passthrough_socket_mark {
        configure_bootstrap_transparent_passthrough_socket(&socket, mark)?;
    }

    socket.connect(address).await
}

#[cfg(target_os = "linux")]
fn configure_bootstrap_transparent_passthrough_socket(
    socket: &TcpSocket,
    mark: u32,
) -> Result<(), std::io::Error> {
    nix::sys::socket::setsockopt(socket, nix::sys::socket::sockopt::Mark, &mark)
        .map_err(std::io::Error::other)
}

#[cfg(not(target_os = "linux"))]
fn configure_bootstrap_transparent_passthrough_socket(
    _socket: &TcpSocket,
    _mark: u32,
) -> Result<(), std::io::Error> {
    Ok(())
}

fn startup_transparent_passthrough_socket_mark(startup_input: &StartupInput) -> Option<u32> {
    let transparent_proxy = startup_input.transparent_proxy.as_ref()?;
    match transparent_proxy.passthrough_bypass.kind {
        TransparentProxyBypassKind::SocketMark => Some(transparent_proxy.passthrough_bypass.mark),
    }
}

fn spawn_bootstrap_socket_task(
    socket: TunnelWebSocket,
    receiver: mpsc::UnboundedReceiver<TunnelWriterMessage>,
    event_sender: mpsc::UnboundedSender<TunnelSessionEvent>,
) -> TokioJoinHandle<Result<(), TunnelSessionError>> {
    tokio::spawn(async move {
        let (writer, mut reader) = socket.split();
        let (control_sender, control_receiver) = mpsc::unbounded_channel();
        let writer_event_sender = event_sender.clone();
        let mut writer_task = tokio::spawn(async move {
            run_bootstrap_writer(writer, receiver, control_receiver, writer_event_sender).await
        });

        loop {
            tokio::select! {
                writer_result = &mut writer_task => {
                    return writer_result
                        .map_err(|error| TunnelSessionError::WriteTunnelText(error.to_string()))?;
                }
                inbound = reader.next() => {
                    match inbound {
                        Some(Ok(Message::Close(_))) | Some(Err(WebSocketError::ConnectionClosed)) | None => {
                            let _ = event_sender.send(TunnelSessionEvent::BootstrapClosed { reason: None });
                            writer_task.abort();
                            return Ok(());
                        }
                        Some(Ok(Message::Ping(payload))) => {
                            control_sender
                                .send(BootstrapWriterControlMessage::Pong(payload.to_vec()))
                                .map_err(|_| {
                                    TunnelSessionError::WriteTunnelText(
                                        "bootstrap tunnel writer is closed".to_string(),
                                    )
                                })?;
                        }
                        Some(Ok(message)) => {
                            let _ = event_sender.send(TunnelSessionEvent::BootstrapMessage(message));
                        }
                        Some(Err(error)) => {
                            let _ = event_sender.send(TunnelSessionEvent::BootstrapClosed {
                                reason: Some(error.to_string()),
                            });
                            writer_task.abort();
                            return Ok(());
                        }
                    }
                }
            }
        }
    })
}

async fn run_bootstrap_writer<W>(
    mut writer: W,
    mut receiver: mpsc::UnboundedReceiver<TunnelWriterMessage>,
    mut control_receiver: mpsc::UnboundedReceiver<BootstrapWriterControlMessage>,
    event_sender: mpsc::UnboundedSender<TunnelSessionEvent>,
) -> Result<(), TunnelSessionError>
where
    W: Sink<Message, Error = WebSocketError> + Unpin,
{
    let notify_bootstrap_closed = |reason: Option<String>| {
        let _ = event_sender.send(TunnelSessionEvent::BootstrapClosed { reason });
    };
    let mut pending_outbound = VecDeque::new();

    loop {
        while let Ok(control) = control_receiver.try_recv() {
            write_bootstrap_control_message(&mut writer, control, &notify_bootstrap_closed).await?;
        }
        while let Ok(message) = receiver.try_recv() {
            match message {
                TunnelWriterMessage::Pong(payload) => {
                    write_bootstrap_pong(&mut writer, payload, &notify_bootstrap_closed).await?;
                }
                TunnelWriterMessage::Close => {
                    write_bootstrap_close(&mut writer, &notify_bootstrap_closed).await?;
                    return Ok(());
                }
                TunnelWriterMessage::Text(_)
                | TunnelWriterMessage::Binary(_)
                | TunnelWriterMessage::Flush { .. } => pending_outbound.push_back(message),
            }
        }
        if let Some(message) = pending_outbound.pop_front() {
            if write_bootstrap_message(&mut writer, message, &notify_bootstrap_closed).await? {
                return Ok(());
            }
            continue;
        }

        tokio::select! {
            biased;
            control = control_receiver.recv() => {
                if let Some(control) = control {
                    write_bootstrap_control_message(&mut writer, control, &notify_bootstrap_closed).await?;
                }
            }
            outbound = receiver.recv() => {
                let Some(message) = outbound else {
                    notify_bootstrap_closed(Some("bootstrap tunnel writer channel closed".to_string()));
                    return Ok(());
                };

                if write_bootstrap_message(&mut writer, message, &notify_bootstrap_closed).await? {
                    return Ok(());
                }
            }
        }
    }
}

async fn write_bootstrap_control_message<W>(
    writer: &mut W,
    message: BootstrapWriterControlMessage,
    notify_bootstrap_closed: &impl Fn(Option<String>),
) -> Result<(), TunnelSessionError>
where
    W: Sink<Message, Error = WebSocketError> + Unpin,
{
    match message {
        BootstrapWriterControlMessage::Pong(payload) => {
            write_bootstrap_pong(writer, payload, notify_bootstrap_closed).await
        }
    }
}

async fn write_bootstrap_message<W>(
    writer: &mut W,
    message: TunnelWriterMessage,
    notify_bootstrap_closed: &impl Fn(Option<String>),
) -> Result<bool, TunnelSessionError>
where
    W: Sink<Message, Error = WebSocketError> + Unpin,
{
    match message {
        TunnelWriterMessage::Text(payload) => {
            if let Err(error) = writer.send(Message::Text(payload.into())).await {
                notify_bootstrap_closed(Some(format!(
                    "failed to write bootstrap tunnel text frame: {error}"
                )));
                return Err(TunnelSessionError::WriteTunnelText(error.to_string()));
            }
            Ok(false)
        }
        TunnelWriterMessage::Binary(payload) => {
            if let Err(error) = writer.send(Message::Binary(payload.into())).await {
                notify_bootstrap_closed(Some(format!(
                    "failed to write bootstrap tunnel binary frame: {error}"
                )));
                return Err(TunnelSessionError::WriteTunnelBinary(error.to_string()));
            }
            Ok(false)
        }
        TunnelWriterMessage::Pong(payload) => {
            write_bootstrap_pong(writer, payload, notify_bootstrap_closed).await?;
            Ok(false)
        }
        TunnelWriterMessage::Flush { response_sender } => {
            let _ = response_sender.send(Ok(()));
            Ok(false)
        }
        TunnelWriterMessage::Close => {
            write_bootstrap_close(writer, notify_bootstrap_closed).await?;
            Ok(true)
        }
    }
}

async fn write_bootstrap_pong<W>(
    writer: &mut W,
    payload: Vec<u8>,
    notify_bootstrap_closed: &impl Fn(Option<String>),
) -> Result<(), TunnelSessionError>
where
    W: Sink<Message, Error = WebSocketError> + Unpin,
{
    if let Err(error) = writer.send(Message::Pong(payload.into())).await {
        notify_bootstrap_closed(Some(format!(
            "failed to write bootstrap tunnel pong frame: {error}"
        )));
        return Err(TunnelSessionError::WriteTunnelText(error.to_string()));
    }
    Ok(())
}

async fn write_bootstrap_close<W>(
    writer: &mut W,
    notify_bootstrap_closed: &impl Fn(Option<String>),
) -> Result<(), TunnelSessionError>
where
    W: Sink<Message, Error = WebSocketError> + Unpin,
{
    if let Err(error) = writer.send(Message::Close(None)).await {
        notify_bootstrap_closed(Some(format!(
            "failed to write bootstrap tunnel close frame: {error}"
        )));
        return Err(TunnelSessionError::WriteTunnelText(error.to_string()));
    }
    notify_bootstrap_closed(None);
    Ok(())
}

fn spawn_tunnel_wake_thread(
    shutdown_requested: Arc<AtomicBool>,
    sleeper: Arc<dyn Sleeper>,
    event_sender: mpsc::UnboundedSender<TunnelSessionEvent>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        loop {
            if shutdown_requested.load(Ordering::Relaxed) {
                let _ = event_sender.send(TunnelSessionEvent::Wake);
                return;
            }

            sleeper.sleep(DEFAULT_TUNNEL_SESSION_POLL_INTERVAL);
            if event_sender.send(TunnelSessionEvent::Wake).is_err() {
                return;
            }
        }
    })
}

fn spawn_agent_stream_task(
    stream_id: u32,
    runtime_socket: TunnelWebSocket,
    event_sender: mpsc::UnboundedSender<TunnelSessionEvent>,
) -> mpsc::UnboundedSender<Message> {
    let (mut writer, mut reader) = runtime_socket.split();
    let (sender, mut receiver) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                message = receiver.recv() => {
                    let Some(message) = message else {
                        let _ = writer.send(Message::Close(None)).await;
                        let _ = event_sender.send(TunnelSessionEvent::AgentClosed {
                            stream_id,
                            reason: None,
                        });
                        return;
                    };
                    let written_bytes = match &message {
                        Message::Text(payload) => Some(payload.len()),
                        Message::Binary(payload) => Some(payload.len()),
                        _ => None,
                    };
                    if let Err(error) = writer.send(message).await {
                        let _ = event_sender.send(TunnelSessionEvent::AgentClosed {
                            stream_id,
                            reason: Some(error.to_string()),
                        });
                        return;
                    }
                    if let Some(bytes) = written_bytes {
                        let _ = event_sender.send(TunnelSessionEvent::AgentWriteCompleted {
                            stream_id,
                            bytes,
                        });
                    }
                }
                message = reader.next() => {
                    match message {
                        Some(Ok(Message::Close(_))) | Some(Err(WebSocketError::ConnectionClosed)) | None => {
                            let _ = event_sender.send(TunnelSessionEvent::AgentClosed {
                                stream_id,
                                reason: None,
                            });
                            return;
                        }
                        Some(Ok(message)) => {
                            let _ = event_sender.send(TunnelSessionEvent::AgentMessage { stream_id, message });
                        }
                        Some(Err(error)) => {
                            let _ = event_sender.send(TunnelSessionEvent::AgentClosed {
                                stream_id,
                                reason: Some(error.to_string()),
                            });
                            return;
                        }
                    }
                }
            }
        }
    });
    sender
}

fn spawn_port_access_transport_event_sender(
    event_sender: &mpsc::UnboundedSender<TunnelSessionEvent>,
) -> mpsc::UnboundedSender<PortAccessTransportEvent> {
    let (transport_event_sender, mut transport_event_receiver) = mpsc::unbounded_channel();
    let event_sender = event_sender.clone();
    tokio::spawn(async move {
        while let Some(event) = transport_event_receiver.recv().await {
            if event_sender
                .send(TunnelSessionEvent::PortAccessTransport(event))
                .is_err()
            {
                return;
            }
        }
    });
    transport_event_sender
}

fn spawn_agent_dial_task(
    stream_id: u32,
    runtime_endpoint_url: String,
    event_sender: mpsc::UnboundedSender<TunnelSessionEvent>,
) -> TokioJoinHandle<()> {
    tokio::spawn(async move {
        let result = match connect_async(&runtime_endpoint_url).await {
            Ok((runtime_socket, _)) => Ok(runtime_socket),
            Err(error) => Err(error.to_string()),
        };
        let _ = event_sender.send(TunnelSessionEvent::AgentDialed {
            stream_id,
            result: Box::new(result),
        });
    })
}

fn spawn_exec_task(
    message: crate::tunnel::protocol::ExecStreamOpen,
    runtime_env: BTreeMap<String, String>,
    cancel_requested: Arc<AtomicBool>,
    child_pid: Arc<Mutex<Option<u32>>>,
    event_sender: mpsc::UnboundedSender<TunnelSessionEvent>,
) {
    tokio::task::spawn_blocking(move || {
        let result = run_exec_command(
            &message,
            &runtime_env,
            &cancel_requested,
            Arc::clone(&child_pid),
        );
        let _ = event_sender.send(TunnelSessionEvent::ExecCompleted {
            stream_id: message.stream_id,
            result: Box::new(result),
        });
    });
}

struct BoundedOutput {
    text: String,
    truncated: bool,
}

fn run_exec_command(
    message: &crate::tunnel::protocol::ExecStreamOpen,
    runtime_env: &BTreeMap<String, String>,
    cancel_requested: &AtomicBool,
    child_pid: Arc<Mutex<Option<u32>>>,
) -> Result<ExecCommandResult, String> {
    let max_output_bytes = message
        .channel
        .max_output_bytes
        .unwrap_or(DEFAULT_EXEC_MAX_OUTPUT_BYTES);
    let timeout_ms = message
        .channel
        .timeout_ms
        .unwrap_or(DEFAULT_EXEC_TIMEOUT_MS);
    let mut child_command = Command::new(&message.channel.command);
    if let Some(args) = message.channel.args.as_ref() {
        child_command.args(args);
    }
    child_command.stdin(if message.channel.stdin.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    child_command.stdout(Stdio::piped());
    child_command.stderr(Stdio::piped());
    child_command.envs(runtime_env);
    if let Some(cwd) = message.channel.cwd.as_deref() {
        child_command.current_dir(cwd);
    }

    let mut child = child_command
        .spawn()
        .map_err(|error| format!("failed to spawn command: {error}"))?;
    {
        let mut stored_pid = child_pid
            .lock()
            .expect("exec child pid lock should not be poisoned");
        *stored_pid = Some(child.id());
    }
    let foreground_process_exited = Arc::new(AtomicBool::new(false));
    let stdin_thread = if let Some(stdin) = message.channel.stdin.clone() {
        let child_stdin = child
            .stdin
            .take()
            .ok_or_else(|| "command stdin pipe was not available".to_string())?;
        let stdin_foreground_process_exited = Arc::clone(&foreground_process_exited);
        Some(thread::spawn(move || {
            write_exec_stdin(child_stdin, stdin, stdin_foreground_process_exited)
        }))
    } else {
        None
    };
    if cancel_requested.load(Ordering::Relaxed) {
        kill_exec_child_process(child.id())?;
    }
    let stdout_reader = child
        .stdout
        .take()
        .ok_or_else(|| "command stdout pipe was not available".to_string())?;
    let stderr_reader = child
        .stderr
        .take()
        .ok_or_else(|| "command stderr pipe was not available".to_string())?;
    let shared_budget = Arc::new(Mutex::new(max_output_bytes));
    let stdout_budget = Arc::clone(&shared_budget);
    let stderr_budget = Arc::clone(&shared_budget);
    let stdout_thread = thread::spawn(move || read_bounded_output(stdout_reader, stdout_budget));
    let stderr_thread = thread::spawn(move || read_bounded_output(stderr_reader, stderr_budget));
    let status_result = wait_for_exec_child(&mut child, timeout_ms, cancel_requested);
    foreground_process_exited.store(true, Ordering::Relaxed);
    if let Some(stdin_thread) = stdin_thread {
        stdin_thread
            .join()
            .map_err(|_| "command stdin writer panicked".to_string())??;
    }
    let status = status_result?;
    let stdout = stdout_thread
        .join()
        .map_err(|_| "command stdout reader panicked".to_string())??;
    let stderr = stderr_thread
        .join()
        .map_err(|_| "command stderr reader panicked".to_string())??;

    Ok(ExecCommandResult {
        exit_code: status.code().unwrap_or(-1),
        stdout: stdout.text,
        stderr: stderr.text,
        truncated: stdout.truncated || stderr.truncated,
    })
}

fn write_exec_stdin(
    mut child_stdin: std::process::ChildStdin,
    stdin: String,
    foreground_process_exited: Arc<AtomicBool>,
) -> Result<(), String> {
    set_exec_stdin_nonblocking(&child_stdin)?;

    let bytes = stdin.as_bytes();
    let mut bytes_written = 0;
    while bytes_written < bytes.len() {
        match child_stdin.write(&bytes[bytes_written..]) {
            Ok(0) if foreground_process_exited.load(Ordering::Relaxed) => return Ok(()),
            Ok(0) => thread::sleep(std::time::Duration::from_millis(10)),
            Ok(count) => bytes_written += count,
            Err(error) if error.kind() == ErrorKind::BrokenPipe => return Ok(()),
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                if foreground_process_exited.load(Ordering::Relaxed) {
                    return Ok(());
                }
                thread::sleep(std::time::Duration::from_millis(10));
            }
            Err(error) => return Err(format!("failed to write command stdin: {error}")),
        }
    }

    Ok(())
}

fn set_exec_stdin_nonblocking(child_stdin: &std::process::ChildStdin) -> Result<(), String> {
    let flags_bits = fcntl(child_stdin.as_fd(), FcntlArg::F_GETFL)
        .map_err(|error| format!("failed to read command stdin flags: {error}"))?;
    let flags = OFlag::from_bits_truncate(flags_bits);
    fcntl(
        child_stdin.as_fd(),
        FcntlArg::F_SETFL(flags | OFlag::O_NONBLOCK),
    )
    .map_err(|error| format!("failed to set command stdin non-blocking: {error}"))?;
    Ok(())
}

fn wait_for_exec_child(
    child: &mut std::process::Child,
    timeout_ms: u64,
    cancel_requested: &AtomicBool,
) -> Result<std::process::ExitStatus, String> {
    let deadline = Instant::now() + std::time::Duration::from_millis(timeout_ms);
    loop {
        match child
            .try_wait()
            .map_err(|error| format!("failed to poll command: {error}"))?
        {
            Some(status) => return Ok(status),
            None if cancel_requested.load(Ordering::Relaxed) => {
                kill_exec_child_process(child.id())?;
                let _ = child
                    .wait()
                    .map_err(|error| format!("failed to wait for cancelled command: {error}"))?;
                return Err("command was cancelled".to_string());
            }
            None if Instant::now() >= deadline => {
                kill_exec_child_process(child.id())?;
                let _ = child
                    .wait()
                    .map_err(|error| format!("failed to wait for timed out command: {error}"))?;
                return Err(format!("command timed out after {timeout_ms}ms"));
            }
            None => thread::sleep(std::time::Duration::from_millis(10)),
        }
    }
}

fn kill_exec_child_process(child_pid: u32) -> Result<(), String> {
    match kill(Pid::from_raw(child_pid as i32), Signal::SIGKILL) {
        Ok(()) | Err(Errno::ESRCH) => Ok(()),
        Err(error) => Err(format!("failed to kill exec command: {error}")),
    }
}

fn read_bounded_output<R>(
    mut reader: R,
    remaining_bytes: Arc<Mutex<usize>>,
) -> Result<BoundedOutput, String>
where
    R: Read,
{
    let mut buffer = [0_u8; EXEC_OUTPUT_READ_BUFFER_BYTES];
    let mut output = Vec::new();
    let mut truncated = false;

    loop {
        let bytes_read = reader
            .read(&mut buffer)
            .map_err(|error| format!("failed to read command output: {error}"))?;
        if bytes_read == 0 {
            break;
        }

        let allowed_bytes = {
            let mut remaining = remaining_bytes
                .lock()
                .expect("remaining exec output budget lock should not be poisoned");
            let allowed = (*remaining).min(bytes_read);
            *remaining -= allowed;
            allowed
        };

        if allowed_bytes > 0 {
            output.extend_from_slice(&buffer[..allowed_bytes]);
        }
        if allowed_bytes < bytes_read {
            truncated = true;
        }
    }

    decode_bounded_output(output, truncated)
}

fn decode_bounded_output(output: Vec<u8>, truncated: bool) -> Result<BoundedOutput, String> {
    match String::from_utf8(output) {
        Ok(text) => Ok(BoundedOutput { text, truncated }),
        Err(error) if truncated => {
            let valid_up_to = error.utf8_error().valid_up_to();
            let bytes = error.into_bytes();
            let text =
                String::from_utf8(bytes[..valid_up_to].to_vec()).map_err(|decode_error| {
                    format!("command output was not valid utf-8: {decode_error}")
                })?;
            Ok(BoundedOutput {
                text,
                truncated: true,
            })
        }
        Err(error) => Err(format!("command output was not valid utf-8: {error}")),
    }
}

fn cancel_pending_exec_open(pending_exec_open: PendingExecOpenState) {
    pending_exec_open
        .cancel_requested
        .store(true, Ordering::Relaxed);
    let child_pid = pending_exec_open
        .child_pid
        .lock()
        .expect("exec child pid lock should not be poisoned")
        .to_owned();
    if let Some(child_pid) = child_pid {
        let _ = kill_exec_child_process(child_pid);
    }
}

fn poll_pty_sessions(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    pty_sessions: &mut BTreeMap<String, PtySessionState>,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<bool, TunnelSessionError> {
    let session_ids: Vec<String> = pty_sessions.keys().cloned().collect();
    let mut did_work = false;
    let mut closed_sessions = Vec::new();

    for session_id in session_ids {
        let Some(pty_state) = pty_sessions.get_mut(&session_id) else {
            continue;
        };

        let next_event = match pty_state
            .session
            .next_event_timeout(Duration::from_millis(0))
        {
            Ok(event) => event,
            Err(_) => {
                closed_sessions.push((
                    session_id.clone(),
                    PtySessionTermination {
                        outcome: PTY_OUTCOME_RESET,
                        reset_code: Some(STREAM_RESET_CODE_TARGET_CLOSED),
                        reason: Some("PTY session stopped responding to poll events".to_string()),
                    },
                ));
                continue;
            }
        };
        let Some(event) = next_event else {
            continue;
        };
        did_work = true;
        match event {
            PtyEvent::Output(chunk) => {
                if let Some(telemetry) = pty_state.stats.record_output(clock.now_ms(), chunk.len())
                    && telemetry.input_to_first_output_ms > PTY_INPUT_LATENCY_WARNING_THRESHOLD_MS
                {
                    publish_pty_input_latency_warning(
                        tunnel_writer_sender,
                        telemetry_relay,
                        clock,
                        &session_id,
                        pty_state.primary_stream_id,
                        telemetry,
                    );
                }
                let attached_stream_ids: Vec<u32> =
                    pty_state.attached_stream_ids.iter().copied().collect();
                for stream_id in attached_stream_ids {
                    let Some(send_window) = pty_state.send_windows_by_stream_id.get_mut(&stream_id)
                    else {
                        continue;
                    };
                    if !send_window.try_consume(chunk.len()) {
                        let _ = write_tunnel_text(
                            tunnel_writer_sender,
                            stream_reset(
                                stream_id,
                                STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
                                "pty stream send window is exhausted",
                            ),
                        );
                        pty_state.attached_stream_ids.remove(&stream_id);
                        pty_state.send_windows_by_stream_id.remove(&stream_id);
                        if stream_id == pty_state.primary_stream_id {
                            let _ = pty_state.session.terminate(
                                clock,
                                sleeper,
                                DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                                DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
                            );
                            closed_sessions.push((
                                session_id.clone(),
                                PtySessionTermination {
                                    outcome: PTY_OUTCOME_RESET,
                                    reset_code: Some(STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED),
                                    reason: Some("pty stream send window is exhausted".to_string()),
                                },
                            ));
                            break;
                        }
                        continue;
                    }

                    let encoded =
                        match encode_stream_data_frame(stream_id, PAYLOAD_KIND_RAW_BYTES, &chunk) {
                            Ok(encoded) => encoded,
                            Err(_) => continue,
                        };
                    let _ = write_tunnel_binary(tunnel_writer_sender, encoded);
                }
            }
            PtyEvent::Exit(exit_code) => {
                for stream_id in pty_state.attached_stream_ids.iter().copied() {
                    let _ = write_tunnel_text(
                        tunnel_writer_sender,
                        pty_exit_event(stream_id, exit_code),
                    );
                }
                closed_sessions.push((
                    session_id.clone(),
                    PtySessionTermination {
                        outcome: PTY_OUTCOME_EXITED,
                        reset_code: None,
                        reason: None,
                    },
                ));
            }
            PtyEvent::Closed => {
                if let Some(exit_code) = pty_state.session.exit_code() {
                    for stream_id in pty_state.attached_stream_ids.iter().copied() {
                        let _ = write_tunnel_text(
                            tunnel_writer_sender,
                            pty_exit_event(stream_id, exit_code),
                        );
                    }
                    closed_sessions.push((
                        session_id.clone(),
                        PtySessionTermination {
                            outcome: PTY_OUTCOME_EXITED,
                            reset_code: None,
                            reason: None,
                        },
                    ));
                }
            }
            PtyEvent::Error(message) => {
                let reason = message.clone();
                let _ = write_tunnel_text(
                    tunnel_writer_sender,
                    stream_reset(
                        pty_state.primary_stream_id,
                        STREAM_RESET_CODE_TARGET_CLOSED,
                        message,
                    ),
                );
                closed_sessions.push((
                    session_id.clone(),
                    PtySessionTermination {
                        outcome: PTY_OUTCOME_RESET,
                        reset_code: Some(STREAM_RESET_CODE_TARGET_CLOSED),
                        reason: Some(reason),
                    },
                ));
            }
        }
    }

    for (session_id, termination) in closed_sessions {
        let _ = remove_pty_session_and_publish_summary(
            tunnel_writer_sender,
            telemetry_relay,
            clock,
            pty_sessions,
            &session_id,
            termination,
        );
    }

    Ok(did_work)
}

fn sync_pty_scope_keepalive(
    keepalive_manager: &Mutex<KeepaliveManager>,
    cgroup_root: &Path,
    sandbox_instance_id: &str,
) -> Result<(), TunnelSessionError> {
    let any_user_scope_populated =
        any_populated_sandbox_user_scope(cgroup_root, sandbox_instance_id)?;

    keepalive_manager
        .lock()
        .expect("keepalive manager lock should not be poisoned")
        .set_user_active(any_user_scope_populated);

    Ok(())
}

fn any_populated_sandbox_user_scope(
    cgroup_root: &Path,
    sandbox_instance_id: &str,
) -> Result<bool, TunnelSessionError> {
    let user_root = cgroup_root.join(sandbox_instance_id).join("user");
    let entries = match fs::read_dir(&user_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(TunnelSessionError::Pty(format!(
                "failed to read sandbox user cgroup root {}: {error}",
                user_root.display()
            )));
        }
    };

    for entry_result in entries {
        let entry = entry_result.map_err(|error| {
            TunnelSessionError::Pty(format!(
                "failed to read sandbox user cgroup entry under {}: {error}",
                user_root.display()
            ))
        })?;
        let entry_type = entry.file_type().map_err(|error| {
            TunnelSessionError::Pty(format!(
                "failed to inspect sandbox user cgroup entry {}: {error}",
                entry.path().display()
            ))
        })?;
        if !entry_type.is_dir() {
            continue;
        }

        let scope_root = entry.path();
        let scope_paths = UserScopePaths {
            procs_file: scope_root.join("cgroup.procs"),
            events_file: scope_root.join("cgroup.events"),
            kill_file: scope_root.join("cgroup.kill"),
            scope_root,
        };
        let populated = match is_scope_populated(&scope_paths) {
            Ok(populated) => populated,
            Err(crate::cgroups::CgroupError::ReadFile { error, .. })
                if error.kind() == std::io::ErrorKind::NotFound =>
            {
                continue;
            }
            Err(error) => {
                return Err(TunnelSessionError::Pty(error.to_string()));
            }
        };
        if populated {
            return Ok(true);
        }
    }

    Ok(false)
}
fn send_processes_snapshot(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
    clock: &dyn Clock,
) -> Result<(), TunnelSessionError> {
    send_processes_snapshot_to_streams(
        tunnel_writer_sender,
        &mut session_state.processes_stream_send_windows,
        clock,
    )?;
    session_state.last_processes_snapshot_at_ms = Some(clock.now_ms());
    Ok(())
}

fn poll_processes_streams(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    processes_stream_send_windows: &mut BTreeMap<u32, StreamSendWindow>,
    last_processes_snapshot_at_ms: &mut Option<u64>,
    clock: &dyn Clock,
) -> Result<(), TunnelSessionError> {
    if processes_stream_send_windows.is_empty() {
        *last_processes_snapshot_at_ms = None;
        return Ok(());
    }

    let now_ms = clock.now_ms();
    let should_send = last_processes_snapshot_at_ms.is_none_or(|last_snapshot_at_ms| {
        now_ms.saturating_sub(last_snapshot_at_ms)
            >= DEFAULT_PROCESSES_SNAPSHOT_INTERVAL.as_millis() as u64
    });
    if !should_send {
        return Ok(());
    }

    send_processes_snapshot_to_streams(tunnel_writer_sender, processes_stream_send_windows, clock)?;
    *last_processes_snapshot_at_ms = Some(now_ms);
    Ok(())
}

fn send_processes_snapshot_to_streams(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    processes_stream_send_windows: &mut BTreeMap<u32, StreamSendWindow>,
    clock: &dyn Clock,
) -> Result<(), TunnelSessionError> {
    if processes_stream_send_windows.is_empty() {
        return Ok(());
    }

    let snapshot = collect_processes_snapshot(clock)
        .map_err(|error| TunnelSessionError::Processes(error.to_string()))?;
    let payload = serde_json::to_string(&snapshot)
        .map_err(|error| TunnelSessionError::Processes(error.to_string()))?;
    let mut exhausted_stream_ids = Vec::new();

    for (stream_id, send_window) in processes_stream_send_windows.iter_mut() {
        if !send_window.try_consume(payload.len()) {
            exhausted_stream_ids.push(*stream_id);
            continue;
        }

        let encoded =
            encode_stream_data_frame(*stream_id, PAYLOAD_KIND_WEBSOCKET_TEXT, payload.as_bytes())
                .map_err(|error| TunnelSessionError::ParseDataFrame(error.to_string()))?;
        write_tunnel_binary(tunnel_writer_sender, encoded)?;
    }

    for stream_id in exhausted_stream_ids {
        write_tunnel_text(
            tunnel_writer_sender,
            stream_reset(
                stream_id,
                STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
                "processes stream send window is exhausted",
            ),
        )?;
        processes_stream_send_windows.remove(&stream_id);
    }

    Ok(())
}

fn reset_processes_streams(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    processes_stream_send_windows: &mut BTreeMap<u32, StreamSendWindow>,
    message: String,
) -> Result<(), TunnelSessionError> {
    let stream_ids = processes_stream_send_windows
        .keys()
        .copied()
        .collect::<Vec<_>>();
    processes_stream_send_windows.clear();

    for stream_id in stream_ids {
        write_tunnel_text(
            tunnel_writer_sender,
            stream_reset(
                stream_id,
                STREAM_RESET_CODE_PROCESSES_SNAPSHOT_FAILED,
                message.clone(),
            ),
        )?;
    }

    Ok(())
}

async fn handle_tunnel_session_event(
    event: TunnelSessionEvent,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    event_sender: &mpsc::UnboundedSender<TunnelSessionEvent>,
    context: &TunnelSessionLoopContext<'_>,
    session_state: &mut TunnelSessionMutableState,
) -> Result<TunnelSessionControlFlow, TunnelSessionError> {
    match event {
        TunnelSessionEvent::BootstrapClosed { reason } => {
            let reason_text = reason.unwrap_or_else(|| "bootstrap tunnel closed".to_string());
            close_port_access_tcp_streams(session_state);
            publish_bootstrap_closed_agent_stream_summaries(
                tunnel_writer_sender,
                session_state,
                context.clock,
                &reason_text,
            );
            update_tunnel_supervision_details(
                context.supervisor_handle,
                context.gateway_ws_url,
                Some("bootstrap_closed"),
                None,
                None,
            );
            context
                .supervisor_handle
                .mark_component_restarting(SupervisedComponent::TunnelSession, reason_text.clone());
            context.supervisor_handle.emit_component_healthcheck_failed(
                SupervisedComponent::TunnelSession,
                "bootstrap_closed",
                reason_text,
                "bootstrap_connection",
                &[],
            );
            Ok(TunnelSessionControlFlow::RestartRequired)
        }
        TunnelSessionEvent::Wake => {
            poll_pty_sessions(
                tunnel_writer_sender,
                &mut session_state.telemetry_relay,
                &mut session_state.pty_sessions,
                context.clock,
                context.sleeper,
            )?;
            if let Err(error) = poll_processes_streams(
                tunnel_writer_sender,
                &mut session_state.processes_stream_send_windows,
                &mut session_state.last_processes_snapshot_at_ms,
                context.clock,
            ) {
                reset_processes_streams(
                    tunnel_writer_sender,
                    &mut session_state.processes_stream_send_windows,
                    error.to_string(),
                )?;
            }
            Ok(TunnelSessionControlFlow::Continue)
        }
        TunnelSessionEvent::AgentDialed { stream_id, result } => {
            let result = *result;
            if session_state
                .pending_agent_opens
                .remove(&stream_id)
                .is_none()
            {
                if let Ok(runtime_socket) = result {
                    drop(runtime_socket);
                }
                return Ok(TunnelSessionControlFlow::Continue);
            }

            match result {
                Ok(runtime_socket) => {
                    let sender =
                        spawn_agent_stream_task(stream_id, runtime_socket, event_sender.clone());
                    session_state.agent_streams.insert(
                        stream_id,
                        AgentStreamState {
                            sender,
                            send_window: StreamSendWindow::new(AGENT_STREAM_WINDOW_BYTES),
                            stats: AgentStreamStats::new(context.clock.now_ms()),
                        },
                    );
                    continue_with(write_tunnel_text(
                        tunnel_writer_sender,
                        stream_open_ok(stream_id),
                    ))
                }
                Err(error) => continue_with(write_tunnel_text(
                    tunnel_writer_sender,
                    stream_open_error(
                        stream_id,
                        CONNECT_ERROR_CODE_AGENT_ENDPOINT_DIAL_FAILED,
                        format!("failed to connect agent endpoint: {error}"),
                    ),
                )),
            }
        }
        TunnelSessionEvent::BootstrapMessage(message) => match message {
            Message::Text(payload) => {
                match session_state
                    .telemetry_relay
                    .handle_control_message(&payload)
                {
                    Ok(Some(frames)) => {
                        send_telemetry_frames(tunnel_writer_sender, frames)?;
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        report_dropped_bootstrap_text_message(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            format!("telemetry control rejected: {error}"),
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                }

                match parse_ports_control_message(&payload) {
                    Ok(Some(crate::tunnel::protocol::PortsControlMessage::TargetAuthorize(
                        message,
                    ))) => {
                        handle_ports_control_message(tunnel_writer_sender, message, context.clock)
                            .await?;
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        report_dropped_bootstrap_text_message(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            error.to_string(),
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                }

                match parse_ports_transport_message(&payload) {
                    Ok(Some(message)) => {
                        if let Err(error) =
                            handle_ports_transport_message(message, event_sender, session_state)
                        {
                            report_dropped_bootstrap_text_message(
                                tunnel_writer_sender,
                                &mut session_state.telemetry_relay,
                                context.clock,
                                error.to_string(),
                            );
                        }
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        report_dropped_bootstrap_text_message(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            error.to_string(),
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                }

                match parse_signing_control_message(&payload) {
                    Ok(Some(message)) => {
                        handle_signing_control_message(session_state, message);
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        report_dropped_bootstrap_text_message(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            error.to_string(),
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                }

                match parse_egress_token_control_message(&payload) {
                    Ok(Some(message)) => {
                        handle_egress_token_control_message(
                            session_state,
                            tunnel_writer_sender,
                            context.clock,
                            context.sandbox_instance_id,
                            message,
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        report_dropped_bootstrap_text_message(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            error.to_string(),
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                }

                if handle_operation_control_message(&payload, tunnel_writer_sender, session_state) {
                    return Ok(TunnelSessionControlFlow::Continue);
                }

                match parse_pty_session_control_message(&payload) {
                    Ok(Some(message)) => {
                        handle_pty_session_control_message(
                            message,
                            tunnel_writer_sender,
                            context,
                            session_state,
                        )?;
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        report_dropped_bootstrap_text_message(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            error.to_string(),
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                }

                let control_message = match parse_stream_control_message(&payload) {
                    Ok(message) => message,
                    Err(error) => {
                        report_dropped_bootstrap_text_message(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            error.to_string(),
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                };
                continue_with(
                    handle_tunnel_control_message(
                        tunnel_writer_sender,
                        event_sender,
                        control_message,
                        context,
                        session_state,
                    )
                    .await,
                )
            }
            Message::Binary(payload) => {
                let frame = match decode_stream_data_frame(payload.as_ref()) {
                    Ok(frame) => frame,
                    Err(error) => {
                        report_dropped_bootstrap_binary_frame(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            error.to_string(),
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                };
                continue_with(handle_tunnel_binary_frame(
                    tunnel_writer_sender,
                    frame,
                    session_state,
                    context.clock,
                ))
            }
            Message::Ping(payload) => {
                continue_with(write_tunnel_pong(tunnel_writer_sender, payload.to_vec()))
            }
            Message::Pong(_) => Ok(TunnelSessionControlFlow::Continue),
            Message::Close(_) => Ok(TunnelSessionControlFlow::RestartRequired),
            _ => Ok(TunnelSessionControlFlow::Continue),
        },
        TunnelSessionEvent::AgentMessage { stream_id, message } => match message {
            Message::Text(payload) => {
                let now_ms = context.clock.now_ms();
                let payload_bytes = payload.len();
                let mut threshold_crossings = Vec::new();
                let send_outcome = {
                    let Some(agent_stream) = session_state.agent_streams.get_mut(&stream_id) else {
                        return Ok(TunnelSessionControlFlow::Continue);
                    };
                    let available_bytes = agent_stream.send_window.available_bytes();
                    if !agent_stream.send_window.try_consume(payload_bytes) {
                        Err((
                            available_bytes,
                            agent_stream_outstanding_bytes(&agent_stream.send_window),
                            agent_stream.stats.message_count_out,
                            agent_stream.stats.stream_age_ms(now_ms),
                            agent_stream.stats.oldest_unacked_age_ms(now_ms),
                        ))
                    } else {
                        let available_after = agent_stream.send_window.available_bytes();
                        let outstanding_bytes =
                            agent_stream_outstanding_bytes(&agent_stream.send_window);
                        agent_stream.stats.record_outbound_message(
                            payload_bytes,
                            now_ms,
                            outstanding_bytes,
                        );
                        let message_count_out = agent_stream.stats.message_count_out;
                        let stream_age_ms = agent_stream.stats.stream_age_ms(now_ms);
                        let oldest_unacked_ms = agent_stream.stats.oldest_unacked_age_ms(now_ms);
                        threshold_crossings = agent_stream
                            .stats
                            .take_new_threshold_crossings(outstanding_bytes);
                        Ok((
                            available_after,
                            outstanding_bytes,
                            message_count_out,
                            stream_age_ms,
                            oldest_unacked_ms,
                        ))
                    }
                };
                let (
                    available_bytes,
                    outstanding_bytes,
                    message_count_out,
                    stream_age_ms,
                    oldest_unacked_ms,
                ) = match send_outcome {
                    Ok(values) => values,
                    Err((
                        available_bytes,
                        outstanding_bytes,
                        message_count_out,
                        stream_age_ms,
                        oldest_unacked_ms,
                    )) => {
                        publish_agent_stream_window_exhausted(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            AgentStreamWindowExhaustedTelemetry {
                                stream_id,
                                payload_kind: websocket_payload_kind_name(
                                    PAYLOAD_KIND_WEBSOCKET_TEXT,
                                ),
                                payload_bytes,
                                available_bytes,
                                outstanding_bytes,
                                message_count_out,
                                stream_age_ms,
                                oldest_unacked_ms,
                            },
                        );
                        remove_agent_stream_and_publish_summary(
                            tunnel_writer_sender,
                            session_state,
                            context.clock,
                            stream_id,
                            AgentStreamTermination {
                                outcome: AGENT_STREAM_OUTCOME_RESET,
                                close_source: AGENT_STREAM_CLOSE_SOURCE_RUNTIME,
                                reset_code: Some(STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED),
                                reason: Some("agent stream send window is exhausted".to_string()),
                            },
                        );
                        return continue_with(write_tunnel_text(
                            tunnel_writer_sender,
                            stream_reset(
                                stream_id,
                                STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
                                "agent stream send window is exhausted",
                            ),
                        ));
                    }
                };
                for threshold_bytes in threshold_crossings {
                    publish_agent_stream_threshold_crossed(
                        tunnel_writer_sender,
                        &mut session_state.telemetry_relay,
                        context.clock,
                        AgentStreamThresholdTelemetry {
                            stream_id,
                            payload_kind: websocket_payload_kind_name(PAYLOAD_KIND_WEBSOCKET_TEXT),
                            payload_bytes,
                            available_bytes,
                            outstanding_bytes,
                            threshold_bytes,
                            message_count_out,
                            stream_age_ms,
                            oldest_unacked_ms,
                        },
                    );
                }
                let encoded = encode_stream_data_frame(
                    stream_id,
                    PAYLOAD_KIND_WEBSOCKET_TEXT,
                    payload.as_bytes(),
                )
                .map_err(|error| TunnelSessionError::AgentRead(error.to_string()))?;
                continue_with(write_tunnel_binary(tunnel_writer_sender, encoded))
            }
            Message::Binary(payload) => {
                let now_ms = context.clock.now_ms();
                let payload_bytes = payload.len();
                let mut threshold_crossings = Vec::new();
                let send_outcome = {
                    let Some(agent_stream) = session_state.agent_streams.get_mut(&stream_id) else {
                        return Ok(TunnelSessionControlFlow::Continue);
                    };
                    let available_bytes = agent_stream.send_window.available_bytes();
                    if !agent_stream.send_window.try_consume(payload_bytes) {
                        Err((
                            available_bytes,
                            agent_stream_outstanding_bytes(&agent_stream.send_window),
                            agent_stream.stats.message_count_out,
                            agent_stream.stats.stream_age_ms(now_ms),
                            agent_stream.stats.oldest_unacked_age_ms(now_ms),
                        ))
                    } else {
                        let available_after = agent_stream.send_window.available_bytes();
                        let outstanding_bytes =
                            agent_stream_outstanding_bytes(&agent_stream.send_window);
                        agent_stream.stats.record_outbound_message(
                            payload_bytes,
                            now_ms,
                            outstanding_bytes,
                        );
                        let message_count_out = agent_stream.stats.message_count_out;
                        let stream_age_ms = agent_stream.stats.stream_age_ms(now_ms);
                        let oldest_unacked_ms = agent_stream.stats.oldest_unacked_age_ms(now_ms);
                        threshold_crossings = agent_stream
                            .stats
                            .take_new_threshold_crossings(outstanding_bytes);
                        Ok((
                            available_after,
                            outstanding_bytes,
                            message_count_out,
                            stream_age_ms,
                            oldest_unacked_ms,
                        ))
                    }
                };
                let (
                    available_bytes,
                    outstanding_bytes,
                    message_count_out,
                    stream_age_ms,
                    oldest_unacked_ms,
                ) = match send_outcome {
                    Ok(values) => values,
                    Err((
                        available_bytes,
                        outstanding_bytes,
                        message_count_out,
                        stream_age_ms,
                        oldest_unacked_ms,
                    )) => {
                        publish_agent_stream_window_exhausted(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            AgentStreamWindowExhaustedTelemetry {
                                stream_id,
                                payload_kind: websocket_payload_kind_name(
                                    PAYLOAD_KIND_WEBSOCKET_BINARY,
                                ),
                                payload_bytes,
                                available_bytes,
                                outstanding_bytes,
                                message_count_out,
                                stream_age_ms,
                                oldest_unacked_ms,
                            },
                        );
                        remove_agent_stream_and_publish_summary(
                            tunnel_writer_sender,
                            session_state,
                            context.clock,
                            stream_id,
                            AgentStreamTermination {
                                outcome: AGENT_STREAM_OUTCOME_RESET,
                                close_source: AGENT_STREAM_CLOSE_SOURCE_RUNTIME,
                                reset_code: Some(STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED),
                                reason: Some("agent stream send window is exhausted".to_string()),
                            },
                        );
                        return continue_with(write_tunnel_text(
                            tunnel_writer_sender,
                            stream_reset(
                                stream_id,
                                STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
                                "agent stream send window is exhausted",
                            ),
                        ));
                    }
                };
                for threshold_bytes in threshold_crossings {
                    publish_agent_stream_threshold_crossed(
                        tunnel_writer_sender,
                        &mut session_state.telemetry_relay,
                        context.clock,
                        AgentStreamThresholdTelemetry {
                            stream_id,
                            payload_kind: websocket_payload_kind_name(
                                PAYLOAD_KIND_WEBSOCKET_BINARY,
                            ),
                            payload_bytes,
                            available_bytes,
                            outstanding_bytes,
                            threshold_bytes,
                            message_count_out,
                            stream_age_ms,
                            oldest_unacked_ms,
                        },
                    );
                }
                let encoded = encode_stream_data_frame(
                    stream_id,
                    PAYLOAD_KIND_WEBSOCKET_BINARY,
                    payload.as_ref(),
                )
                .map_err(|error| TunnelSessionError::AgentRead(error.to_string()))?;
                continue_with(write_tunnel_binary(tunnel_writer_sender, encoded))
            }
            Message::Ping(payload) => {
                if let Some(agent_stream) = session_state.agent_streams.get(&stream_id) {
                    agent_stream
                        .sender
                        .send(Message::Pong(payload))
                        .map_err(|error| TunnelSessionError::AgentWrite(error.to_string()))?;
                }
                Ok(TunnelSessionControlFlow::Continue)
            }
            Message::Pong(_) => Ok(TunnelSessionControlFlow::Continue),
            Message::Close(_) => {
                remove_agent_stream_and_publish_summary(
                    tunnel_writer_sender,
                    session_state,
                    context.clock,
                    stream_id,
                    AgentStreamTermination {
                        outcome: AGENT_STREAM_OUTCOME_RESET,
                        close_source: AGENT_STREAM_CLOSE_SOURCE_RUNTIME,
                        reset_code: Some(STREAM_RESET_CODE_TARGET_CLOSED),
                        reason: Some("agent runtime websocket closed".to_string()),
                    },
                );
                continue_with(write_tunnel_text(
                    tunnel_writer_sender,
                    stream_reset(
                        stream_id,
                        STREAM_RESET_CODE_TARGET_CLOSED,
                        "agent runtime websocket closed",
                    ),
                ))
            }
            _ => Ok(TunnelSessionControlFlow::Continue),
        },
        TunnelSessionEvent::AgentWriteCompleted { stream_id, bytes } => {
            if !session_state.agent_streams.contains_key(&stream_id) {
                return Ok(TunnelSessionControlFlow::Continue);
            }

            continue_with(write_tunnel_text(
                tunnel_writer_sender,
                stream_window(stream_id, bytes),
            ))
        }
        TunnelSessionEvent::PortAccessTransport(event) => {
            match &event {
                PortAccessTransportEvent::HttpBodyEnd(message) => {
                    session_state
                        .port_access_http_streams
                        .remove(&message.stream_id);
                }
                PortAccessTransportEvent::TcpClose(message) => {
                    mark_port_access_tcp_direction_closed(
                        session_state,
                        message.stream_id,
                        &message.direction,
                    );
                }
                PortAccessTransportEvent::TcpError(message) => {
                    session_state
                        .port_access_tcp_streams
                        .remove(&message.stream_id);
                }
                PortAccessTransportEvent::StreamError(message) => {
                    session_state
                        .port_access_http_streams
                        .remove(&message.stream_id);
                    session_state
                        .port_access_tcp_streams
                        .remove(&message.stream_id);
                }
                PortAccessTransportEvent::HttpResponseStart(_)
                | PortAccessTransportEvent::HttpBodyChunk(_)
                | PortAccessTransportEvent::TcpConnected(_)
                | PortAccessTransportEvent::TcpData { .. }
                | PortAccessTransportEvent::TcpInputWindow { .. } => {}
            }

            let payload = match event {
                PortAccessTransportEvent::HttpResponseStart(message) => {
                    serde_json::to_string(&message)
                }
                PortAccessTransportEvent::HttpBodyChunk(message) => serde_json::to_string(&message),
                PortAccessTransportEvent::HttpBodyEnd(message) => serde_json::to_string(&message),
                PortAccessTransportEvent::TcpConnected(message) => serde_json::to_string(&message),
                PortAccessTransportEvent::TcpData { stream_id, bytes } => {
                    let encoded =
                        encode_stream_data_frame(stream_id, PAYLOAD_KIND_RAW_BYTES, &bytes)
                            .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;
                    return continue_with(write_tunnel_binary(tunnel_writer_sender, encoded));
                }
                PortAccessTransportEvent::TcpInputWindow { stream_id, bytes } => {
                    let Some(stream_state) =
                        session_state.port_access_tcp_streams.get_mut(&stream_id)
                    else {
                        return Ok(TunnelSessionControlFlow::Continue);
                    };
                    stream_state
                        .request_window
                        .add(bytes)
                        .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;
                    return continue_with(write_tunnel_text(
                        tunnel_writer_sender,
                        stream_window(stream_id, bytes),
                    ));
                }
                PortAccessTransportEvent::TcpClose(message) => serde_json::to_string(&message),
                PortAccessTransportEvent::TcpError(message) => serde_json::to_string(&message),
                PortAccessTransportEvent::StreamError(message) => serde_json::to_string(&message),
            }
            .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;
            continue_with(write_tunnel_text(tunnel_writer_sender, payload))
        }
        TunnelSessionEvent::AgentClosed { stream_id, reason } => {
            if remove_agent_stream_and_publish_summary(
                tunnel_writer_sender,
                session_state,
                context.clock,
                stream_id,
                AgentStreamTermination {
                    outcome: AGENT_STREAM_OUTCOME_RESET,
                    close_source: AGENT_STREAM_CLOSE_SOURCE_RUNTIME,
                    reset_code: Some(STREAM_RESET_CODE_TARGET_CLOSED),
                    reason: Some(
                        reason
                            .clone()
                            .unwrap_or_else(|| "agent runtime websocket closed".to_string()),
                    ),
                },
            )
            .is_some()
            {
                write_tunnel_text(
                    tunnel_writer_sender,
                    stream_reset(
                        stream_id,
                        STREAM_RESET_CODE_TARGET_CLOSED,
                        reason.unwrap_or_else(|| "agent runtime websocket closed".to_string()),
                    ),
                )?;
            }
            Ok(TunnelSessionControlFlow::Continue)
        }
        TunnelSessionEvent::ExecCompleted { stream_id, result } => {
            if session_state
                .pending_exec_opens
                .remove(&stream_id)
                .is_none()
            {
                return Ok(TunnelSessionControlFlow::Continue);
            }

            match *result {
                Ok(exec_result) => {
                    write_tunnel_text(
                        tunnel_writer_sender,
                        exec_result_event(
                            stream_id,
                            exec_result.exit_code,
                            &exec_result.stdout,
                            &exec_result.stderr,
                            exec_result.truncated,
                        ),
                    )?;
                    continue_with(write_tunnel_text(
                        tunnel_writer_sender,
                        stream_complete(stream_id),
                    ))
                }
                Err(error) => continue_with(write_tunnel_text(
                    tunnel_writer_sender,
                    stream_reset(stream_id, STREAM_RESET_CODE_EXEC_COMMAND_FAILED, error),
                )),
            }
        }
    }
}

fn handle_tunnel_session_request(
    request: TunnelSessionRequest,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    runtime: &TunnelSessionRuntime,
    session_state: &mut TunnelSessionMutableState,
) -> Result<TunnelSessionControlFlow, TunnelSessionError> {
    match request {
        TunnelSessionRequest::SetAgentEndpoint {
            agent_endpoint_url,
            response_sender,
        } => {
            set_runtime_agent_endpoint_url(runtime, agent_endpoint_url.clone());
            session_state.agent_endpoint_url = agent_endpoint_url;
            let _ = response_sender.send(Ok(()));
            Ok(TunnelSessionControlFlow::Continue)
        }
        TunnelSessionRequest::SetRuntimeEnvironment {
            runtime_env,
            response_sender,
        } => {
            set_runtime_environment(runtime, runtime_env.clone());
            session_state.runtime_env = runtime_env;
            let _ = response_sender.send(Ok(()));
            Ok(TunnelSessionControlFlow::Continue)
        }
        TunnelSessionRequest::Signing {
            request,
            response_sender,
        } => {
            if request.request_id.trim().is_empty() {
                let _ = response_sender.send(Err(TunnelSessionError::Signing(
                    "signing request id is required".to_string(),
                )));
                return Ok(TunnelSessionControlFlow::Continue);
            }

            if session_state
                .pending_signing_requests
                .contains_key(&request.request_id)
            {
                let _ = response_sender.send(Err(TunnelSessionError::Signing(
                    "duplicate signing request id".to_string(),
                )));
                return Ok(TunnelSessionControlFlow::Continue);
            }

            session_state
                .pending_signing_requests
                .insert(request.request_id.clone(), response_sender);
            let request_id = request.request_id.clone();

            let payload = signing_request(&SigningRequest {
                message_type: "signing.request".to_string(),
                request_id: request.request_id,
                organization_id: request.organization_id,
                sandbox_instance_id: request.sandbox_instance_id,
                acting_user_id: request.acting_user_id,
                provider_family: request.provider_family,
                format: request.format,
                key_ref: request.key_ref,
                grant: request.grant,
                payload: request.payload_base64,
                encoding: "base64".to_string(),
            });

            match write_tunnel_text(tunnel_writer_sender, payload) {
                Ok(()) => Ok(TunnelSessionControlFlow::Continue),
                Err(error) => {
                    if let Some(response_sender) =
                        session_state.pending_signing_requests.remove(&request_id)
                    {
                        let _ = response_sender
                            .send(Err(TunnelSessionError::Signing(error.to_string())));
                    }
                    Err(error)
                }
            }
        }
        TunnelSessionRequest::EgressToken {
            request_id,
            response_sender,
        } => {
            if request_id.trim().is_empty() {
                let _ = response_sender.send(Err(TunnelSessionError::EgressToken(
                    "egress token request id is required".to_string(),
                )));
                return Ok(TunnelSessionControlFlow::Continue);
            }

            if session_state
                .pending_egress_token_requests
                .contains_key(&request_id)
            {
                let _ = response_sender.send(Err(TunnelSessionError::EgressToken(
                    "duplicate egress token request id".to_string(),
                )));
                return Ok(TunnelSessionControlFlow::Continue);
            }

            record_egress_token_event(
                tunnel_writer_sender,
                session_state,
                runtime.clock.as_ref(),
                runtime.sandbox_instance_id.as_str(),
                "egress_token_request_started",
                &request_id,
                &[],
            );
            session_state
                .pending_egress_token_requests
                .insert(request_id.clone(), response_sender);
            let payload = egress_token_request(&EgressTokenRequest {
                message_type: "egress.token.request".to_string(),
                request_id: request_id.clone(),
            });

            match write_tunnel_text(tunnel_writer_sender, payload) {
                Ok(()) => Ok(TunnelSessionControlFlow::Continue),
                Err(error) => {
                    if let Some(response_sender) = session_state
                        .pending_egress_token_requests
                        .remove(&request_id)
                    {
                        let _ = response_sender
                            .send(Err(TunnelSessionError::EgressToken(error.to_string())));
                    }
                    record_egress_token_event(
                        tunnel_writer_sender,
                        session_state,
                        runtime.clock.as_ref(),
                        runtime.sandbox_instance_id.as_str(),
                        "egress_token_request_failed",
                        &request_id,
                        &[("error", Value::String(error.to_string()))],
                    );
                    Err(error)
                }
            }
        }
        TunnelSessionRequest::OperationRecord { line } => {
            enqueue_operation_record(session_state, line);
            flush_pending_operation_records(tunnel_writer_sender, session_state);
            Ok(TunnelSessionControlFlow::Continue)
        }
        TunnelSessionRequest::OperationClose { response_sender } => {
            close_operation_stream(tunnel_writer_sender, session_state, response_sender);
            Ok(TunnelSessionControlFlow::Continue)
        }
    }
}

fn startup_operation_kind(startup_input: &StartupInput) -> &'static str {
    startup_input.operation_kind.as_str()
}

fn derive_startup_operation_id(tunnel_gateway_ws_url: &str) -> Option<String> {
    let Ok(url) = Url::parse(tunnel_gateway_ws_url) else {
        return None;
    };
    url.query_pairs().find_map(|(name, value)| {
        if name == "operation_id" && !value.is_empty() {
            Some(value.into_owned())
        } else {
            None
        }
    })
}

fn operation_open(operation_id: &str, operation_kind: &str) -> String {
    serde_json::json!({
        "type": "operation.open",
        "streamId": SANDBOX_OPERATION_STREAM_ID,
        "operationId": operation_id,
        "operationKind": operation_kind,
        "format": SANDBOX_OPERATION_STREAM_FORMAT
    })
    .to_string()
}

fn operation_close() -> String {
    serde_json::json!({
        "type": "operation.close",
        "streamId": SANDBOX_OPERATION_STREAM_ID
    })
    .to_string()
}

fn write_operation_record(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    payload: &[u8],
) -> Result<(), TunnelSessionError> {
    let frame =
        encode_stream_data_frame(SANDBOX_OPERATION_STREAM_ID, PAYLOAD_KIND_RAW_BYTES, payload)
            .map_err(|error| TunnelSessionError::ParseDataFrame(error.to_string()))?;
    write_tunnel_binary(tunnel_writer_sender, frame)
}

fn close_operation_stream(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
    response_sender: std::sync::mpsc::Sender<Result<(), String>>,
) {
    session_state.operation_stream_close_requested = true;
    session_state.operation_stream_close_response_sender = Some(response_sender);
    flush_pending_operation_records(tunnel_writer_sender, session_state);
    close_operation_stream_if_drained(tunnel_writer_sender, session_state);
}

fn close_operation_stream_if_drained(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
) {
    if !session_state.operation_stream_close_requested
        || !session_state.pending_operation_records.is_empty()
    {
        return;
    }

    let response_sender = session_state.operation_stream_close_response_sender.take();

    if session_state.operation_stream_requested {
        if let Err(error) = write_tunnel_text(tunnel_writer_sender, operation_close()) {
            if let Some(response_sender) = response_sender {
                let _ = response_sender.send(Err(error.to_string()));
            }
            eprintln!("sandboxd failed to close operation stream: {error}");
        } else if let Some(response_sender) = response_sender
            && let Err(error) = write_tunnel_flush(tunnel_writer_sender, response_sender)
        {
            eprintln!("sandboxd failed to wait for operation stream flush: {error}");
        }
    } else if let Some(response_sender) = response_sender {
        let _ = response_sender.send(Ok(()));
    }
    session_state.operation_stream_requested = false;
    session_state.operation_stream_close_requested = false;
    session_state.operation_stream_send_window = None;
}

fn handle_operation_control_message(
    payload: &str,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(payload) else {
        return false;
    };
    let Some(message_type) = value.get("type").and_then(Value::as_str) else {
        return false;
    };
    match message_type {
        "operation.open.ok" => {
            if value
                .get("streamId")
                .and_then(Value::as_u64)
                .and_then(|stream_id| u32::try_from(stream_id).ok())
                != Some(SANDBOX_OPERATION_STREAM_ID)
            {
                return true;
            }
            let Some(initial_window_bytes) = value
                .get("initialWindowBytes")
                .and_then(Value::as_u64)
                .and_then(|bytes| usize::try_from(bytes).ok())
            else {
                session_state.operation_stream_send_window = None;
                return true;
            };
            session_state.operation_stream_send_window =
                Some(StreamSendWindow::new(initial_window_bytes));
            flush_pending_operation_records(tunnel_writer_sender, session_state);
            close_operation_stream_if_drained(tunnel_writer_sender, session_state);
            true
        }
        "operation.window" => {
            if value
                .get("streamId")
                .and_then(Value::as_u64)
                .and_then(|stream_id| u32::try_from(stream_id).ok())
                != Some(SANDBOX_OPERATION_STREAM_ID)
            {
                return true;
            }
            if let Some(send_window) = session_state.operation_stream_send_window.as_mut()
                && let Some(bytes) = value
                    .get("bytes")
                    .and_then(Value::as_u64)
                    .and_then(|bytes| usize::try_from(bytes).ok())
            {
                let _ = send_window.add(bytes);
            }
            flush_pending_operation_records(tunnel_writer_sender, session_state);
            close_operation_stream_if_drained(tunnel_writer_sender, session_state);
            true
        }
        "operation.open.error" | "operation.reset" => {
            session_state.operation_stream_requested = false;
            session_state.operation_stream_close_requested = false;
            if let Some(response_sender) =
                session_state.operation_stream_close_response_sender.take()
            {
                let _ = response_sender.send(Err(format!("{message_type} received")));
            }
            session_state.operation_stream_send_window = None;
            session_state.pending_operation_records.clear();
            true
        }
        _ => message_type.starts_with("operation."),
    }
}

fn enqueue_operation_record(session_state: &mut TunnelSessionMutableState, line: String) {
    if session_state.pending_operation_records.len() >= PENDING_OPERATION_RECORD_CAPACITY {
        return;
    }
    session_state.pending_operation_records.push_back(line);
}

fn flush_pending_operation_records(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
) {
    let Some(send_window) = session_state.operation_stream_send_window.as_mut() else {
        return;
    };
    while let Some(line) = session_state.pending_operation_records.front() {
        if !send_window.try_consume(line.len()) {
            return;
        }
        if let Some(line) = session_state.pending_operation_records.pop_front()
            && let Err(error) = write_operation_record(tunnel_writer_sender, line.as_bytes())
        {
            eprintln!("sandboxd failed to publish operation record: {error}");
            session_state.operation_stream_send_window = None;
            return;
        }
    }
    close_operation_stream_if_drained(tunnel_writer_sender, session_state);
}

fn record_egress_token_event(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
    clock: &dyn Clock,
    sandbox_instance_id: &str,
    event: &str,
    request_id: &str,
    extra_fields: &[(&str, Value)],
) {
    let maybe_error = extra_fields
        .iter()
        .find_map(|(field, value)| (*field == "error").then_some(value))
        .and_then(Value::as_str);
    if let Some(error) = maybe_error {
        warn!(
            event = event,
            request_id = request_id,
            sandbox_instance_id = sandbox_instance_id,
            error = error,
            "gateway egress token request failed"
        );
    } else {
        info!(
            event = event,
            request_id = request_id,
            sandbox_instance_id = sandbox_instance_id,
            "gateway egress token request advanced"
        );
    }

    if !session_state.operation_stream_requested
        && session_state.operation_stream_send_window.is_none()
    {
        return;
    }

    let Ok(observed_at) = crate::time::format_rfc3339_timestamp(clock.now_system_time()) else {
        return;
    };
    let mut payload = Map::new();
    payload.insert("event".to_string(), Value::String(event.to_string()));
    payload.insert(
        "component".to_string(),
        Value::String(SupervisedComponent::TunnelSession.as_str().to_string()),
    );
    payload.insert(
        "sandboxInstanceId".to_string(),
        Value::String(sandbox_instance_id.to_string()),
    );
    payload.insert(
        "requestId".to_string(),
        Value::String(request_id.to_string()),
    );
    payload.insert("observedAt".to_string(), Value::String(observed_at));
    for (field_name, field_value) in extra_fields {
        payload.insert((*field_name).to_string(), field_value.clone());
    }
    if let Ok(line) = serde_json::to_string(&Value::Object(payload)) {
        enqueue_operation_record(session_state, line + "\n");
        flush_pending_operation_records(tunnel_writer_sender, session_state);
    }
}

fn handle_signing_control_message(
    session_state: &mut TunnelSessionMutableState,
    message: SigningControlMessage,
) {
    match message {
        SigningControlMessage::Request(request) => {
            eprintln!(
                "sandboxd dropped unexpected signing request '{}' from the gateway",
                request.request_id
            );
        }
        SigningControlMessage::ResultSuccess(result) => {
            if let Some(response_sender) = session_state
                .pending_signing_requests
                .remove(&result.request_id)
            {
                let _ = response_sender.send(Ok(TunnelSigningResponse::Success {
                    request_id: result.request_id,
                    signature_base64: result.signature,
                }));
            }
        }
        SigningControlMessage::ResultFailure(result) => {
            if let Some(response_sender) = session_state
                .pending_signing_requests
                .remove(&result.request_id)
            {
                let _ = response_sender.send(Ok(TunnelSigningResponse::Failure {
                    request_id: result.request_id,
                    code: result.code,
                    message: result.message,
                }));
            }
        }
    }
}

fn handle_egress_token_control_message(
    session_state: &mut TunnelSessionMutableState,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    clock: &dyn Clock,
    sandbox_instance_id: &str,
    message: EgressTokenControlMessage,
) {
    match message {
        EgressTokenControlMessage::Request(request) => {
            eprintln!(
                "sandboxd dropped unexpected egress token request '{}' from the gateway",
                request.request_id
            );
        }
        EgressTokenControlMessage::Response(response) => {
            if let Some(response_sender) = session_state
                .pending_egress_token_requests
                .remove(&response.request_id)
            {
                let request_id = response.request_id;
                let expires_at = response.expires_at;
                let ttl_ms = response.ttl_ms;
                let _ = response_sender.send(Ok(TunnelEgressToken {
                    token: response.token,
                    expires_at: expires_at.clone(),
                    ttl_ms,
                }));
                record_egress_token_event(
                    tunnel_writer_sender,
                    session_state,
                    clock,
                    sandbox_instance_id,
                    "egress_token_request_completed",
                    &request_id,
                    &[
                        ("expiresAt", Value::String(expires_at)),
                        ("ttlMs", Value::from(ttl_ms)),
                    ],
                );
            }
        }
        EgressTokenControlMessage::Error(error) => {
            if let Some(response_sender) = session_state
                .pending_egress_token_requests
                .remove(&error.request_id)
            {
                let _ = response_sender.send(Err(TunnelSessionError::EgressToken(format!(
                    "{}: {}",
                    error.code, error.message
                ))));
                record_egress_token_event(
                    tunnel_writer_sender,
                    session_state,
                    clock,
                    sandbox_instance_id,
                    "egress_token_request_failed",
                    &error.request_id,
                    &[
                        ("code", Value::String(error.code)),
                        ("error", Value::String(error.message)),
                    ],
                );
            }
        }
    }
}

fn report_dropped_bootstrap_text_message(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    reason: impl Display,
) {
    report_dropped_bootstrap_message(
        tunnel_writer_sender,
        telemetry_relay,
        clock,
        "bootstrap_control_message_dropped",
        format!("sandboxd dropped bootstrap control message: {reason}"),
        reason.to_string(),
    );
}

fn report_dropped_bootstrap_binary_frame(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    reason: impl Display,
) {
    report_dropped_bootstrap_message(
        tunnel_writer_sender,
        telemetry_relay,
        clock,
        "bootstrap_data_frame_dropped",
        format!("sandboxd dropped bootstrap data frame: {reason}"),
        reason.to_string(),
    );
}

fn report_dropped_bootstrap_message(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    event: &str,
    message: String,
    reason: String,
) {
    eprintln!("{message}");

    match telemetry_relay.enqueue_log_record(
        clock,
        SandboxTelemetryLogLevel::Warn,
        event,
        &[
            ("message", Value::String(message.clone())),
            ("reason", Value::String(reason)),
        ],
    ) {
        Ok(frames) => {
            if let Err(error) = send_telemetry_frames(tunnel_writer_sender, frames) {
                eprintln!(
                    "sandboxd failed to publish dropped bootstrap message telemetry: {error}"
                );
            }
        }
        Err(error) => {
            eprintln!("sandboxd failed to queue dropped bootstrap message telemetry: {error}");
        }
    }
}

fn format_panic_payload(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    "unknown panic payload".to_string()
}

async fn handle_tunnel_control_message(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    event_sender: &mpsc::UnboundedSender<TunnelSessionEvent>,
    control_message: StreamControlMessage,
    context: &TunnelSessionLoopContext<'_>,
    session_state: &mut TunnelSessionMutableState,
) -> Result<(), TunnelSessionError> {
    match control_message {
        StreamControlMessage::OpenAgent(message) => {
            let Some(runtime_endpoint_url) = session_state.agent_endpoint_url.as_deref() else {
                write_tunnel_text(
                    tunnel_writer_sender,
                    stream_open_error(
                        message.stream_id,
                        CONNECT_ERROR_CODE_AGENT_ENDPOINT_DIAL_FAILED,
                        "agent runtime endpoint is not available",
                    ),
                )?;
                return Ok(());
            };
            session_state.pending_agent_opens.insert(
                message.stream_id,
                PendingAgentOpenState {
                    task: spawn_agent_dial_task(
                        message.stream_id,
                        runtime_endpoint_url.to_string(),
                        event_sender.clone(),
                    ),
                },
            );
        }
        StreamControlMessage::OpenProcesses(message) => {
            if let Err(error) = collect_processes_snapshot(context.clock) {
                write_tunnel_text(
                    tunnel_writer_sender,
                    stream_open_error(
                        message.stream_id,
                        CONNECT_ERROR_CODE_PROCESSES_STREAM_UNAVAILABLE,
                        error.to_string(),
                    ),
                )?;
                return Ok(());
            }
            session_state
                .processes_stream_send_windows
                .insert(message.stream_id, StreamSendWindow::default());
            write_tunnel_text(tunnel_writer_sender, stream_open_ok(message.stream_id))?;
            if let Err(error) =
                send_processes_snapshot(tunnel_writer_sender, session_state, context.clock)
            {
                reset_processes_streams(
                    tunnel_writer_sender,
                    &mut session_state.processes_stream_send_windows,
                    error.to_string(),
                )?;
            }
        }
        StreamControlMessage::OpenPty(message) => {
            let mut pty_open_context = PtyOpenContext {
                cgroup_root: context.cgroup_root,
                runtime_env: &session_state.runtime_env,
                sandbox_instance_id: context.sandbox_instance_id,
                pty_sessions: &mut session_state.pty_sessions,
                clock: context.clock,
                sleeper: context.sleeper,
            };
            handle_pty_open(tunnel_writer_sender, message, &mut pty_open_context)?;
        }
        StreamControlMessage::OpenFileUpload(message) => {
            let upload_state =
                create_file_upload_state(&message, context.attachment_root, context.clock)
                    .map_err(TunnelSessionError::FileUpload)?;
            session_state
                .file_uploads
                .insert(message.stream_id, upload_state);
            write_tunnel_text(tunnel_writer_sender, stream_open_ok(message.stream_id))?;
        }
        StreamControlMessage::OpenExec(message) => {
            let cancel_requested = Arc::new(AtomicBool::new(false));
            let child_pid = Arc::new(Mutex::new(None));
            session_state.pending_exec_opens.insert(
                message.stream_id,
                PendingExecOpenState {
                    cancel_requested: Arc::clone(&cancel_requested),
                    child_pid: Arc::clone(&child_pid),
                },
            );
            spawn_exec_task(
                message.clone(),
                session_state.runtime_env.clone(),
                cancel_requested,
                child_pid,
                event_sender.clone(),
            );
            write_tunnel_text(tunnel_writer_sender, stream_open_ok(message.stream_id))?;
        }
        StreamControlMessage::Signal(message) => {
            let Some(pty_state) = session_state
                .pty_sessions
                .values_mut()
                .find(|pty_state| pty_state.attached_stream_ids.contains(&message.stream_id))
            else {
                write_tunnel_text(
                    tunnel_writer_sender,
                    stream_reset(
                        message.stream_id,
                        STREAM_RESET_CODE_INVALID_STREAM_SIGNAL,
                        format!(
                            "stream signal streamId {} is not attached to an active PTY session",
                            message.stream_id
                        ),
                    ),
                )?;
                return Ok(());
            };

            pty_state
                .session
                .resize(message.signal.cols, message.signal.rows)
                .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
        }
        StreamControlMessage::Close(message) => {
            if let Some(pending_agent_open) =
                session_state.pending_agent_opens.remove(&message.stream_id)
            {
                pending_agent_open.task.abort();
                return Ok(());
            }
            if let Some(agent_stream) = remove_agent_stream_and_publish_summary(
                tunnel_writer_sender,
                session_state,
                context.clock,
                message.stream_id,
                AgentStreamTermination {
                    outcome: AGENT_STREAM_OUTCOME_CLOSED,
                    close_source: AGENT_STREAM_CLOSE_SOURCE_GATEWAY,
                    reset_code: None,
                    reason: None,
                },
            ) {
                let _ = agent_stream.sender.send(Message::Close(None));
                return Ok(());
            }
            if session_state
                .processes_stream_send_windows
                .remove(&message.stream_id)
                .is_some()
            {
                return Ok(());
            }
            if let Some(pending_exec_open) =
                session_state.pending_exec_opens.remove(&message.stream_id)
            {
                cancel_pending_exec_open(pending_exec_open);
                return Ok(());
            }
            if let Some(pty_session_id) = session_state
                .pty_sessions
                .iter()
                .find(|(_, pty_state)| pty_state.attached_stream_ids.contains(&message.stream_id))
                .map(|(session_id, _)| session_id.clone())
            {
                handle_pty_close(
                    tunnel_writer_sender,
                    &mut session_state.telemetry_relay,
                    &pty_session_id,
                    message.stream_id,
                    &mut session_state.pty_sessions,
                    context.clock,
                    context.sleeper,
                )?;
                return Ok(());
            }
            if let Some(upload_state) = session_state.file_uploads.remove(&message.stream_id) {
                finalize_file_upload(tunnel_writer_sender, message.stream_id, upload_state)?;
                return Ok(());
            }

            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    message.stream_id,
                    STREAM_RESET_CODE_INVALID_STREAM_CLOSE,
                    format!(
                        "stream.close streamId {} is not bound to an active tunnel stream",
                        message.stream_id
                    ),
                ),
            )?;
        }
        StreamControlMessage::Window(message) => {
            if let Some(agent_stream) = session_state.agent_streams.get_mut(&message.stream_id) {
                agent_stream
                    .send_window
                    .add(message.bytes)
                    .map_err(|error| TunnelSessionError::ParseControl(error.to_string()))?;
                agent_stream
                    .stats
                    .record_credit_restore(message.bytes, context.clock.now_ms());
                return Ok(());
            }
            if let Some(send_window) = session_state
                .processes_stream_send_windows
                .get_mut(&message.stream_id)
            {
                send_window
                    .add(message.bytes)
                    .map_err(|error| TunnelSessionError::ParseControl(error.to_string()))?;
                return Ok(());
            }
            if let Some(stream_state) = session_state
                .port_access_tcp_streams
                .get(&message.stream_id)
            {
                stream_state
                    .sender
                    .send(PortAccessTcpCommand::Window {
                        bytes: message.bytes,
                    })
                    .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;
                return Ok(());
            }
            if session_state
                .pending_agent_opens
                .contains_key(&message.stream_id)
            {
                return Ok(());
            }
            if session_state
                .pending_exec_opens
                .contains_key(&message.stream_id)
            {
                return Ok(());
            }
            if let Some(pty_state) = session_state
                .pty_sessions
                .values_mut()
                .find(|pty_state| pty_state.attached_stream_ids.contains(&message.stream_id))
            {
                let Some(send_window) = pty_state
                    .send_windows_by_stream_id
                    .get_mut(&message.stream_id)
                else {
                    return Ok(());
                };
                send_window
                    .add(message.bytes)
                    .map_err(|error| TunnelSessionError::ParseControl(error.to_string()))?;
                return Ok(());
            }

            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    message.stream_id,
                    STREAM_RESET_CODE_INVALID_STREAM_WINDOW,
                    format!(
                        "stream.window streamId {} is not bound to an active tunnel stream",
                        message.stream_id
                    ),
                ),
            )?;
        }
    }

    Ok(())
}

async fn handle_ports_control_message(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    message: crate::tunnel::protocol::PortsTargetAuthorize,
    clock: &dyn Clock,
) -> Result<(), TunnelSessionError> {
    let decision = authorize_target_port(clock, &message.target)
        .await
        .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;

    match decision {
        PortAccessAuthorizeDecision::Authorized {
            upstream_protocol,
            websocket_capable,
        } => write_tunnel_text(
            tunnel_writer_sender,
            ports_target_authorize_success_result(
                &message.request_id,
                upstream_protocol,
                websocket_capable,
            ),
        ),
        PortAccessAuthorizeDecision::Rejected { reason } => {
            let reason = match reason {
                PORT_ACCESS_AUTHORIZE_REASON_PORT_UNREACHABLE => {
                    PORT_ACCESS_AUTHORIZE_REASON_PORT_UNREACHABLE
                }
                PORT_ACCESS_AUTHORIZE_REASON_UNSUPPORTED_PROTOCOL => {
                    PORT_ACCESS_AUTHORIZE_REASON_UNSUPPORTED_PROTOCOL
                }
                _ => {
                    return Err(TunnelSessionError::PortAccess(format!(
                        "unknown port access authorize rejection reason: {reason}"
                    )));
                }
            };
            write_tunnel_text(
                tunnel_writer_sender,
                ports_target_authorize_failure_result(&message.request_id, reason),
            )
        }
    }
}

fn handle_ports_transport_message(
    message: crate::tunnel::protocol::PortsTransportMessage,
    event_sender: &mpsc::UnboundedSender<TunnelSessionEvent>,
    session_state: &mut TunnelSessionMutableState,
) -> Result<(), TunnelSessionError> {
    match message {
        crate::tunnel::protocol::PortsTransportMessage::TcpOpen(message) => {
            if port_access_stream_is_active(session_state, message.stream_id) {
                return Err(TunnelSessionError::PortAccess(format!(
                    "ports.tcp.open streamId {} already exists",
                    message.stream_id
                )));
            }
            let transport_event_sender = spawn_port_access_transport_event_sender(event_sender);
            let stream_sender = spawn_tcp_transport(message.clone(), transport_event_sender);
            session_state.port_access_tcp_streams.insert(
                message.stream_id,
                PortAccessTcpStreamState {
                    sender: stream_sender,
                    request_window: StreamSendWindow::default(),
                    request_closed: false,
                    response_closed: false,
                },
            );
        }
        crate::tunnel::protocol::PortsTransportMessage::TcpConnected(message) => {
            return Err(TunnelSessionError::PortAccess(format!(
                "ports.tcp.connected streamId {} must not be sent from the gateway to sandboxd",
                message.stream_id
            )));
        }
        crate::tunnel::protocol::PortsTransportMessage::TcpClose(message) => {
            if message.direction != "request" {
                return Err(TunnelSessionError::PortAccess(format!(
                    "ports.tcp.close streamId {} must use request direction when sent to sandboxd",
                    message.stream_id
                )));
            }
            let Some(stream_state) = session_state
                .port_access_tcp_streams
                .get(&message.stream_id)
            else {
                return Err(TunnelSessionError::PortAccess(format!(
                    "ports.tcp.close streamId {} is not bound to an active port access tcp stream",
                    message.stream_id
                )));
            };
            stream_state
                .sender
                .send(PortAccessTcpCommand::Close {
                    direction: message.direction.clone(),
                })
                .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;
        }
        crate::tunnel::protocol::PortsTransportMessage::TcpError(message) => {
            return Err(TunnelSessionError::PortAccess(format!(
                "ports.tcp.error streamId {} must not be sent from the gateway to sandboxd",
                message.stream_id
            )));
        }
        crate::tunnel::protocol::PortsTransportMessage::HttpOpen(message) => {
            if port_access_stream_is_active(session_state, message.stream_id) {
                return Err(TunnelSessionError::PortAccess(format!(
                    "ports.http.open streamId {} already exists",
                    message.stream_id
                )));
            }
            let transport_event_sender = spawn_port_access_transport_event_sender(event_sender);
            let stream_sender = spawn_http_transport(message.clone(), transport_event_sender);
            session_state
                .port_access_http_streams
                .insert(message.stream_id, stream_sender);
        }
        crate::tunnel::protocol::PortsTransportMessage::HttpBodyChunk(message) => {
            if message.direction != "request" {
                return Err(TunnelSessionError::PortAccess(format!(
                    "ports.http.body.chunk streamId {} must use request direction when sent to sandboxd",
                    message.stream_id
                )));
            }
            let Some(stream_sender) = session_state
                .port_access_http_streams
                .get(&message.stream_id)
            else {
                return Err(TunnelSessionError::PortAccess(format!(
                    "ports.http.body.chunk streamId {} is not bound to an active port access http stream",
                    message.stream_id
                )));
            };
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(message.bytes.as_bytes())
                .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;
            stream_sender
                .send(PortAccessHttpCommand::RequestBodyChunk { bytes })
                .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;
        }
        crate::tunnel::protocol::PortsTransportMessage::HttpBodyEnd(message) => {
            if message.direction != "request" {
                return Err(TunnelSessionError::PortAccess(format!(
                    "ports.http.body.end streamId {} must use request direction when sent to sandboxd",
                    message.stream_id
                )));
            }
            let Some(stream_sender) = session_state
                .port_access_http_streams
                .get(&message.stream_id)
            else {
                return Err(TunnelSessionError::PortAccess(format!(
                    "ports.http.body.end streamId {} is not bound to an active port access http stream",
                    message.stream_id
                )));
            };
            stream_sender
                .send(PortAccessHttpCommand::RequestBodyEnd)
                .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;
        }
        crate::tunnel::protocol::PortsTransportMessage::StreamClose(message) => {
            if let Some(stream_sender) = session_state
                .port_access_http_streams
                .remove(&message.stream_id)
            {
                stream_sender
                    .send(PortAccessHttpCommand::Close)
                    .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;
            } else if let Some(stream_state) = session_state
                .port_access_tcp_streams
                .remove(&message.stream_id)
            {
                stream_state
                    .sender
                    .send(PortAccessTcpCommand::Terminate)
                    .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;
            } else {
                return Err(TunnelSessionError::PortAccess(format!(
                    "ports.stream.close streamId {} is not bound to an active port access transport stream",
                    message.stream_id
                )));
            }
        }
        crate::tunnel::protocol::PortsTransportMessage::HttpResponseStart(message) => {
            return Err(TunnelSessionError::PortAccess(format!(
                "ports.http.response.start streamId {} must not be sent from the gateway to sandboxd",
                message.stream_id
            )));
        }
        crate::tunnel::protocol::PortsTransportMessage::StreamError(message) => {
            return Err(TunnelSessionError::PortAccess(format!(
                "ports.stream.error streamId {} must not be sent from the gateway to sandboxd",
                message.stream_id
            )));
        }
    }

    Ok(())
}

fn port_access_stream_is_active(session_state: &TunnelSessionMutableState, stream_id: u32) -> bool {
    session_state
        .port_access_http_streams
        .contains_key(&stream_id)
        || session_state
            .port_access_tcp_streams
            .contains_key(&stream_id)
        || tunnel_stream_is_active(session_state, stream_id)
}

fn tunnel_stream_is_active(session_state: &TunnelSessionMutableState, stream_id: u32) -> bool {
    session_state.agent_streams.contains_key(&stream_id)
        || session_state.pending_agent_opens.contains_key(&stream_id)
        || session_state.pending_exec_opens.contains_key(&stream_id)
        || session_state
            .processes_stream_send_windows
            .contains_key(&stream_id)
        || session_state.file_uploads.contains_key(&stream_id)
        || session_state
            .pty_sessions
            .values()
            .any(|pty_state| pty_state.attached_stream_ids.contains(&stream_id))
}

fn mark_port_access_tcp_direction_closed(
    session_state: &mut TunnelSessionMutableState,
    stream_id: u32,
    direction: &str,
) {
    let Some(stream_state) = session_state.port_access_tcp_streams.get_mut(&stream_id) else {
        return;
    };
    match direction {
        "request" => stream_state.request_closed = true,
        "response" => stream_state.response_closed = true,
        _ => return,
    }
    if stream_state.request_closed && stream_state.response_closed {
        session_state.port_access_tcp_streams.remove(&stream_id);
    }
}

fn close_port_access_tcp_streams(session_state: &mut TunnelSessionMutableState) {
    for (_, stream_state) in std::mem::take(&mut session_state.port_access_tcp_streams) {
        let _ = stream_state.sender.send(PortAccessTcpCommand::Terminate);
    }
}

fn handle_tunnel_binary_frame(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    frame: crate::tunnel::protocol::StreamDataFrame,
    session_state: &mut TunnelSessionMutableState,
    clock: &dyn Clock,
) -> Result<(), TunnelSessionError> {
    if let Some(agent_stream) = session_state.agent_streams.get_mut(&frame.stream_id) {
        let payload_bytes = frame.payload.len();
        match frame.payload_kind {
            PAYLOAD_KIND_WEBSOCKET_TEXT => {
                let payload = String::from_utf8(frame.payload)
                    .map_err(|error| TunnelSessionError::AgentWrite(error.to_string()))?;
                agent_stream
                    .sender
                    .send(Message::Text(payload.into()))
                    .map_err(|error| TunnelSessionError::AgentWrite(error.to_string()))?;
                agent_stream.stats.record_inbound_message(payload_bytes);
            }
            PAYLOAD_KIND_WEBSOCKET_BINARY => {
                agent_stream
                    .sender
                    .send(Message::Binary(frame.payload.into()))
                    .map_err(|error| TunnelSessionError::AgentWrite(error.to_string()))?;
                agent_stream.stats.record_inbound_message(payload_bytes);
            }
            _ => {
                write_tunnel_text(
                    tunnel_writer_sender,
                    stream_reset(
                        frame.stream_id,
                        STREAM_RESET_CODE_INVALID_STREAM_DATA,
                        "agent stream only accepts websocket text or binary payload kinds",
                    ),
                )?;
            }
        }
        return Ok(());
    }

    if session_state
        .processes_stream_send_windows
        .contains_key(&frame.stream_id)
    {
        if frame.payload_kind != PAYLOAD_KIND_WEBSOCKET_TEXT {
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    frame.stream_id,
                    STREAM_RESET_CODE_INVALID_STREAM_DATA,
                    "processes stream only accepts websocket text payloads",
                ),
            )?;
            session_state
                .processes_stream_send_windows
                .remove(&frame.stream_id);
            return Ok(());
        }

        let payload = String::from_utf8(frame.payload)
            .map_err(|error| TunnelSessionError::ParseDataFrame(error.to_string()))?;
        match parse_processes_stream_message(&payload) {
            Ok(crate::tunnel::protocol::ProcessesStreamMessage::Refresh(_)) => {
                write_tunnel_text(
                    tunnel_writer_sender,
                    stream_window(frame.stream_id, payload.len()),
                )?;
                if let Err(error) = send_processes_snapshot_to_streams(
                    tunnel_writer_sender,
                    &mut session_state.processes_stream_send_windows,
                    clock,
                ) {
                    reset_processes_streams(
                        tunnel_writer_sender,
                        &mut session_state.processes_stream_send_windows,
                        error.to_string(),
                    )?;
                } else {
                    session_state.last_processes_snapshot_at_ms = Some(clock.now_ms());
                }
            }
            Ok(crate::tunnel::protocol::ProcessesStreamMessage::Snapshot(_)) => {
                write_tunnel_text(
                    tunnel_writer_sender,
                    stream_reset(
                        frame.stream_id,
                        STREAM_RESET_CODE_INVALID_STREAM_DATA,
                        "processes stream does not accept processes.snapshot payloads from the gateway",
                    ),
                )?;
                session_state
                    .processes_stream_send_windows
                    .remove(&frame.stream_id);
            }
            Err(error) => {
                write_tunnel_text(
                    tunnel_writer_sender,
                    stream_reset(
                        frame.stream_id,
                        STREAM_RESET_CODE_INVALID_STREAM_DATA,
                        error.to_string(),
                    ),
                )?;
                session_state
                    .processes_stream_send_windows
                    .remove(&frame.stream_id);
            }
        }
        return Ok(());
    }

    if session_state
        .port_access_tcp_streams
        .contains_key(&frame.stream_id)
    {
        if frame.payload_kind != PAYLOAD_KIND_RAW_BYTES {
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    frame.stream_id,
                    STREAM_RESET_CODE_INVALID_STREAM_DATA,
                    "port access tcp stream only accepts raw byte data frames",
                ),
            )?;
            if let Some(stream_state) = session_state
                .port_access_tcp_streams
                .remove(&frame.stream_id)
            {
                let _ = stream_state.sender.send(PortAccessTcpCommand::Terminate);
            }
            return Ok(());
        }

        let Some(stream_state) = session_state
            .port_access_tcp_streams
            .get_mut(&frame.stream_id)
        else {
            return Ok(());
        };
        if !stream_state.request_window.try_consume(frame.payload.len()) {
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    frame.stream_id,
                    STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
                    "port access tcp request stream window is exhausted",
                ),
            )?;
            let stream_state = session_state
                .port_access_tcp_streams
                .remove(&frame.stream_id)
                .expect("tcp stream state should exist after failed window consume");
            let _ = stream_state.sender.send(PortAccessTcpCommand::Terminate);
            return Ok(());
        }
        stream_state
            .sender
            .send(PortAccessTcpCommand::Data {
                bytes: frame.payload,
            })
            .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;
        return Ok(());
    }

    if let Some(pty_state) = session_state
        .pty_sessions
        .values_mut()
        .find(|pty_state| pty_state.attached_stream_ids.contains(&frame.stream_id))
    {
        if frame.payload_kind != PAYLOAD_KIND_RAW_BYTES {
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    frame.stream_id,
                    STREAM_RESET_CODE_INVALID_STREAM_DATA,
                    "pty stream only accepts raw byte data frames",
                ),
            )?;
            return Ok(());
        }

        pty_state
            .session
            .write(&frame.payload)
            .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
        pty_state
            .stats
            .record_input(clock.now_ms(), frame.payload.len());
        write_tunnel_text(
            tunnel_writer_sender,
            stream_window(frame.stream_id, frame.payload.len()),
        )?;
        return Ok(());
    }

    if let Some(upload_state) = session_state.file_uploads.get_mut(&frame.stream_id) {
        if frame.payload_kind != PAYLOAD_KIND_RAW_BYTES {
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    frame.stream_id,
                    STREAM_RESET_CODE_INVALID_STREAM_DATA,
                    "file upload stream only accepts raw byte payloads",
                ),
            )?;
            return Ok(());
        }

        upload_state.received_bytes = upload_state
            .received_bytes
            .saturating_add(frame.payload.len());
        if upload_state.received_bytes > upload_state.size_bytes {
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    frame.stream_id,
                    FILE_UPLOAD_RESET_CODE_BYTE_COUNT_EXCEEDED,
                    "received more bytes than declared by the upload metadata",
                ),
            )?;
            session_state.file_uploads.remove(&frame.stream_id);
            return Ok(());
        }

        upload_state
            .file
            .write_all(&frame.payload)
            .map_err(|error| TunnelSessionError::FileUpload(error.to_string()))?;
        write_tunnel_text(
            tunnel_writer_sender,
            stream_window(frame.stream_id, frame.payload.len()),
        )?;
        return Ok(());
    }

    write_tunnel_text(
        tunnel_writer_sender,
        stream_reset(
            frame.stream_id,
            STREAM_RESET_CODE_INVALID_STREAM_DATA,
            format!(
                "stream data frame streamId {} is not bound to an active tunnel stream",
                frame.stream_id
            ),
        ),
    )?;
    Ok(())
}

fn handle_pty_session_control_message(
    message: PtySessionControlMessage,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    context: &TunnelSessionLoopContext<'_>,
    session_state: &TunnelSessionMutableState,
) -> Result<(), TunnelSessionError> {
    let PtySessionControlMessage::Open(message) = message else {
        return Ok(());
    };

    let request = DirectPtyTransportRequest {
        cgroup_root: context.cgroup_root.to_path_buf(),
        runtime_env: session_state.runtime_env.clone(),
        sandbox_instance_id: context.sandbox_instance_id.to_string(),
        message,
    };
    let writer_sender = tunnel_writer_sender.clone();

    thread::spawn(move || {
        if let Err(error) = run_direct_pty_transport(request, writer_sender) {
            eprintln!("sandboxd direct pty transport failed: {error}");
        }
    });

    Ok(())
}

struct DirectPtyTransportRequest {
    cgroup_root: PathBuf,
    runtime_env: BTreeMap<String, String>,
    sandbox_instance_id: String,
    message: PtySessionOpen,
}

fn run_direct_pty_transport(
    request: DirectPtyTransportRequest,
    tunnel_writer_sender: mpsc::UnboundedSender<TunnelWriterMessage>,
) -> Result<(), TunnelSessionError> {
    let runtime = Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;

    runtime.block_on(run_direct_pty_transport_async(
        request,
        tunnel_writer_sender,
    ))
}

async fn run_direct_pty_transport_async(
    request: DirectPtyTransportRequest,
    tunnel_writer_sender: mpsc::UnboundedSender<TunnelWriterMessage>,
) -> Result<(), TunnelSessionError> {
    if request.message.launch.session != PtySessionLaunchMode::Create {
        write_tunnel_text(
            &tunnel_writer_sender,
            pty_session_error(
                &request.message.request_id,
                &request.message.pty_session_id,
                PTY_SESSION_ERROR_CODE_ATTACH_FAILED,
                "direct PTY transport does not support attaching to an existing PTY session",
            ),
        )?;
        return Ok(());
    }

    let session = match start_scoped_pty_session(
        PtySpawnRequest {
            cwd: request.message.launch.cwd.clone(),
            cols: request.message.launch.cols,
            rows: request.message.launch.rows,
            command: request.message.launch.command.clone(),
            args: request.message.launch.args.clone(),
            env: request.runtime_env,
        },
        &request.cgroup_root,
        &request.sandbox_instance_id,
        &crate::time::SystemClock,
        &crate::time::ThreadSleeper,
    ) {
        Ok(session) => session,
        Err(error) => {
            write_tunnel_text(
                &tunnel_writer_sender,
                pty_session_error(
                    &request.message.request_id,
                    &request.message.pty_session_id,
                    PTY_SESSION_ERROR_CODE_CREATE_FAILED,
                    error.to_string(),
                ),
            )?;
            return Ok(());
        }
    };

    let (socket, _) = match connect_async(request.message.transport_url.as_str())
        .await
        .map_err(|error| TunnelSessionError::Pty(error.to_string()))
    {
        Ok(result) => result,
        Err(error) => {
            let _ = session.terminate(
                &crate::time::SystemClock,
                &crate::time::ThreadSleeper,
                DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
            );
            write_tunnel_text(
                &tunnel_writer_sender,
                pty_session_error(
                    &request.message.request_id,
                    &request.message.pty_session_id,
                    PTY_SESSION_ERROR_CODE_ATTACH_FAILED,
                    error.to_string(),
                ),
            )?;
            return Ok(());
        }
    };

    write_tunnel_text(
        &tunnel_writer_sender,
        pty_session_opened(&request.message.request_id, &request.message.pty_session_id),
    )?;

    let (mut socket_writer, mut socket_reader) = socket.split();
    let mut poll_interval = tokio::time::interval(DEFAULT_PTY_EVENT_POLL_INTERVAL);

    loop {
        tokio::select! {
            maybe_message = socket_reader.next() => {
                match maybe_message {
                    Some(Ok(Message::Binary(payload))) => {
                        session
                            .write(payload.as_ref())
                            .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                    }
                    Some(Ok(Message::Text(payload))) => {
                        match parse_pty_control_message(payload.as_ref()) {
                            Ok(PtyControlMessage::Signal(message)) => {
                                session
                                    .resize(message.signal.cols, message.signal.rows)
                                    .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                            }
                            Ok(PtyControlMessage::Close(_)) => {
                                let exit_code = session
                                    .terminate(
                                        &crate::time::SystemClock,
                                        &crate::time::ThreadSleeper,
                                        DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                                        DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
                                    )
                                    .or_else(|_| {
                                        session.exit_code().ok_or_else(|| {
                                            TunnelSessionError::Pty(
                                                "PTY session did not report an exit code after close"
                                                    .to_string(),
                                            )
                                        })
                                    })?;
                                socket_writer
                                    .send(Message::Text(
                                        pty_exit_event(DIRECT_PTY_STREAM_ID, exit_code).into(),
                                    ))
                                    .await
                                    .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                                return Ok(());
                            }
                            Ok(PtyControlMessage::Window(_)) => {}
                            Ok(PtyControlMessage::Open(_)) => {
                                socket_writer
                                    .send(Message::Text(
                                        stream_reset(
                                            DIRECT_PTY_STREAM_ID,
                                            STREAM_RESET_CODE_INVALID_STREAM_SIGNAL,
                                            "direct PTY transport does not accept stream.open",
                                        )
                                        .into(),
                                    ))
                                    .await
                                    .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                            }
                            Err(error) => {
                                socket_writer
                                    .send(Message::Text(
                                        stream_reset(
                                            DIRECT_PTY_STREAM_ID,
                                            STREAM_RESET_CODE_INVALID_STREAM_SIGNAL,
                                            error.to_string(),
                                        )
                                        .into(),
                                    ))
                                    .await
                                    .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                            }
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        socket_writer
                            .send(Message::Pong(payload))
                            .await
                            .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        let _ = session.terminate(
                            &crate::time::SystemClock,
                            &crate::time::ThreadSleeper,
                            DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                            DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
                        );
                        return Ok(());
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(_)) => {}
                    Some(Err(error)) => {
                        let _ = session.terminate(
                            &crate::time::SystemClock,
                            &crate::time::ThreadSleeper,
                            DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                            DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
                        );
                        return Err(TunnelSessionError::Pty(error.to_string()));
                    }
                }
            }
            _ = poll_interval.tick() => {
                while let Some(event) = session
                    .next_event_timeout(Duration::from_millis(0))
                    .map_err(|error| TunnelSessionError::Pty(error.to_string()))?
                {
                    match event {
                        PtyEvent::Output(chunk) => {
                            socket_writer
                                .send(Message::Binary(chunk.into()))
                                .await
                                .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                        }
                        PtyEvent::Exit(exit_code) => {
                            socket_writer
                                .send(Message::Text(
                                    pty_exit_event(DIRECT_PTY_STREAM_ID, exit_code).into(),
                                ))
                                .await
                                .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                            return Ok(());
                        }
                        PtyEvent::Closed => {
                            if let Some(exit_code) = session.exit_code() {
                                socket_writer
                                    .send(Message::Text(
                                        pty_exit_event(DIRECT_PTY_STREAM_ID, exit_code).into(),
                                    ))
                                    .await
                                    .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                                return Ok(());
                            }
                        }
                        PtyEvent::Error(message) => {
                            socket_writer
                                .send(Message::Text(
                                    stream_reset(
                                        DIRECT_PTY_STREAM_ID,
                                        STREAM_RESET_CODE_TARGET_CLOSED,
                                        message,
                                    )
                                    .into(),
                                ))
                                .await
                                .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
}

fn handle_pty_open(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    message: crate::tunnel::protocol::PtyStreamOpen,
    context: &mut PtyOpenContext<'_>,
) -> Result<(), TunnelSessionError> {
    match message.channel.session {
        crate::tunnel::protocol::PtySessionMode::Attach => {
            let Some(pty_state) = context
                .pty_sessions
                .get_mut(&message.channel.pty_session_id)
            else {
                write_tunnel_text(
                    tunnel_writer_sender,
                    stream_open_error(
                        message.stream_id,
                        CONNECT_ERROR_CODE_PTY_SESSION_UNAVAILABLE,
                        "pty session is not available",
                    ),
                )?;
                return Ok(());
            };

            pty_state.attached_stream_ids.insert(message.stream_id);
            pty_state
                .send_windows_by_stream_id
                .insert(message.stream_id, StreamSendWindow::default());
            write_tunnel_text(tunnel_writer_sender, stream_open_ok(message.stream_id))?;
        }
        crate::tunnel::protocol::PtySessionMode::Create => {
            if context
                .pty_sessions
                .contains_key(&message.channel.pty_session_id)
            {
                write_tunnel_text(
                    tunnel_writer_sender,
                    stream_open_error(
                        message.stream_id,
                        CONNECT_ERROR_CODE_PTY_SESSION_EXISTS,
                        "pty session already exists",
                    ),
                )?;
                return Ok(());
            }

            let session = match start_scoped_pty_session(
                PtySpawnRequest {
                    cwd: message.channel.cwd.clone(),
                    cols: message.channel.cols,
                    rows: message.channel.rows,
                    command: message.channel.command.clone(),
                    args: message.channel.args.clone(),
                    env: context.runtime_env.clone(),
                },
                context.cgroup_root,
                context.sandbox_instance_id,
                context.clock,
                context.sleeper,
            ) {
                Ok(session) => session,
                Err(error) => {
                    write_tunnel_text(
                        tunnel_writer_sender,
                        stream_open_error(
                            message.stream_id,
                            CONNECT_ERROR_CODE_PTY_SESSION_CREATE_FAILED,
                            error.to_string(),
                        ),
                    )?;
                    return Ok(());
                }
            };

            let mut attached_stream_ids = BTreeSet::new();
            attached_stream_ids.insert(message.stream_id);
            let mut send_windows_by_stream_id = BTreeMap::new();
            send_windows_by_stream_id.insert(message.stream_id, StreamSendWindow::default());
            context.pty_sessions.insert(
                message.channel.pty_session_id.clone(),
                PtySessionState {
                    session,
                    primary_stream_id: message.stream_id,
                    attached_stream_ids,
                    send_windows_by_stream_id,
                    stats: PtySessionStats::new(context.clock.now_ms()),
                },
            );
            write_tunnel_text(tunnel_writer_sender, stream_open_ok(message.stream_id))?;
        }
    }

    Ok(())
}

fn handle_pty_close(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    pty_session_id: &str,
    stream_id: u32,
    pty_sessions: &mut BTreeMap<String, PtySessionState>,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<(), TunnelSessionError> {
    let termination_outcome = {
        let Some(pty_state) = pty_sessions.get_mut(pty_session_id) else {
            return Ok(());
        };

        if !pty_state.attached_stream_ids.contains(&stream_id) {
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    stream_id,
                    STREAM_RESET_CODE_INVALID_STREAM_CLOSE,
                    format!(
                        "stream close streamId {stream_id} is not attached to the active PTY session"
                    ),
                ),
            )?;
            return Ok(());
        }

        if stream_id != pty_state.primary_stream_id {
            pty_state.attached_stream_ids.remove(&stream_id);
            pty_state.send_windows_by_stream_id.remove(&stream_id);
            return Ok(());
        }

        (
            pty_state.primary_stream_id,
            pty_state
                .attached_stream_ids
                .iter()
                .copied()
                .collect::<Vec<_>>(),
            pty_state.session.terminate(
                clock,
                sleeper,
                DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
            ),
        )
    };

    let (primary_stream_id, attached_stream_ids, termination_result) = termination_outcome;
    match termination_result {
        Ok(exit_code) => {
            for attached_stream_id in attached_stream_ids {
                write_tunnel_text(
                    tunnel_writer_sender,
                    pty_exit_event(attached_stream_id, exit_code),
                )?;
            }
            let _ = remove_pty_session_and_publish_summary(
                tunnel_writer_sender,
                telemetry_relay,
                clock,
                pty_sessions,
                pty_session_id,
                PtySessionTermination {
                    outcome: PTY_OUTCOME_CLOSED,
                    reset_code: None,
                    reason: None,
                },
            );
        }
        Err(error) => {
            let error_text = error.to_string();
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    primary_stream_id,
                    STREAM_RESET_CODE_STREAM_CLOSE_FAILED,
                    error_text.clone(),
                ),
            )?;
            let _ = remove_pty_session_and_publish_summary(
                tunnel_writer_sender,
                telemetry_relay,
                clock,
                pty_sessions,
                pty_session_id,
                PtySessionTermination {
                    outcome: PTY_OUTCOME_RESET,
                    reset_code: Some(STREAM_RESET_CODE_STREAM_CLOSE_FAILED),
                    reason: Some(error_text),
                },
            );
        }
    }

    Ok(())
}

fn create_file_upload_state(
    message: &crate::tunnel::protocol::FileUploadStreamOpen,
    attachment_root: &Path,
    clock: &dyn Clock,
) -> Result<FileUploadState, String> {
    assert_upload_metadata(
        &message.channel.thread_id,
        &message.channel.mime_type,
        message.channel.size_bytes,
    )?;
    let thread_directory_path =
        derive_upload_thread_directory_path(attachment_root, &message.channel.thread_id)?;
    fs::create_dir_all(&thread_directory_path).map_err(|error| {
        format!(
            "failed to create upload thread directory {}: {error}",
            thread_directory_path.display()
        )
    })?;

    let attachment_id = format!(
        "att_{}_{}",
        clock.now_ms(),
        UPLOAD_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let temp_path = thread_directory_path.join(format!(".{attachment_id}.part"));
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| {
            format!(
                "failed to create temporary upload file {}: {error}",
                temp_path.display()
            )
        })?;

    Ok(FileUploadState {
        attachment_id,
        thread_directory_path,
        thread_id: message.channel.thread_id.clone(),
        mime_type: message.channel.mime_type.clone(),
        original_filename: message.channel.original_filename.clone(),
        size_bytes: message.channel.size_bytes,
        temp_path,
        file,
        received_bytes: 0,
    })
}

fn finalize_file_upload(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    stream_id: u32,
    upload_state: FileUploadState,
) -> Result<(), TunnelSessionError> {
    if upload_state.received_bytes != upload_state.size_bytes {
        write_tunnel_text(
            tunnel_writer_sender,
            stream_reset(
                stream_id,
                FILE_UPLOAD_RESET_CODE_BYTE_COUNT_MISMATCH,
                "uploaded byte count did not match declared size",
            ),
        )?;
        let _ = fs::remove_file(&upload_state.temp_path);
        return Ok(());
    }

    upload_state
        .file
        .sync_all()
        .map_err(|error| TunnelSessionError::FileUpload(error.to_string()))?;
    let classification = match classify_uploaded_file(
        &upload_state.mime_type,
        &upload_state.temp_path,
        &upload_state.original_filename,
    ) {
        Ok(classification) => classification,
        Err(UploadClassificationError::Io(message)) => {
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(stream_id, FILE_UPLOAD_RESET_CODE_INVALID_FILE_TYPE, message),
            )?;
            let _ = fs::remove_file(&upload_state.temp_path);
            return Ok(());
        }
        Err(UploadClassificationError::Reset { code, message }) => {
            write_tunnel_text(tunnel_writer_sender, stream_reset(stream_id, code, message))?;
            let _ = fs::remove_file(&upload_state.temp_path);
            return Ok(());
        }
    };

    let final_path = upload_state.thread_directory_path.join(format!(
        "{}.{}",
        upload_state.attachment_id, classification.extension
    ));
    fs::rename(&upload_state.temp_path, &final_path)
        .map_err(|error| TunnelSessionError::FileUpload(error.to_string()))?;
    let final_path_text = final_path.to_string_lossy();
    write_tunnel_text(
        tunnel_writer_sender,
        file_upload_completed_event(FileUploadCompletedEventInput {
            stream_id,
            kind: classification.kind,
            attachment_id: &upload_state.attachment_id,
            thread_id: &upload_state.thread_id,
            original_filename: &upload_state.original_filename,
            mime_type: &upload_state.mime_type,
            size_bytes: upload_state.size_bytes,
            path: &final_path_text,
        }),
    )?;
    write_tunnel_text(tunnel_writer_sender, stream_complete(stream_id))?;

    Ok(())
}

pub(crate) fn derive_sandbox_instance_id(
    gateway_ws_url: &str,
) -> Result<String, TunnelSessionError> {
    let parsed_url = Url::parse(gateway_ws_url)
        .map_err(|error| TunnelSessionError::InvalidGatewayUrl(error.to_string()))?;
    let Some(segment) = parsed_url
        .path_segments()
        .and_then(|mut segments| segments.rfind(|segment| !segment.is_empty()))
    else {
        return Err(TunnelSessionError::InvalidGatewayUrl(
            "tunnel gateway url must end with the sandbox instance id path segment".to_string(),
        ));
    };

    Ok(segment.to_string())
}

fn resolve_bootstrap_tunnel_url(
    gateway_ws_url: &str,
    bootstrap_token: &str,
) -> Result<String, TunnelSessionError> {
    let normalized_token = bootstrap_token.trim();
    if normalized_token.is_empty() {
        return Err(TunnelSessionError::InvalidGatewayUrl(
            "sandbox tunnel bootstrap token is required".to_string(),
        ));
    }

    let mut parsed_url = Url::parse(gateway_ws_url)
        .map_err(|error| TunnelSessionError::InvalidGatewayUrl(error.to_string()))?;
    match parsed_url.scheme() {
        "ws" | "wss" => {}
        _ => {
            return Err(TunnelSessionError::InvalidGatewayUrl(
                "sandbox tunnel gateway ws url must use ws or wss scheme".to_string(),
            ));
        }
    }

    parsed_url
        .query_pairs_mut()
        .append_pair("bootstrap_token", normalized_token);
    Ok(parsed_url.to_string())
}

fn resolve_tunnel_exchange_url(gateway_ws_url: &str) -> Result<String, TunnelSessionError> {
    let mut parsed_url = Url::parse(gateway_ws_url)
        .map_err(|error| TunnelSessionError::InvalidGatewayUrl(error.to_string()))?;
    match parsed_url.scheme() {
        "ws" => parsed_url
            .set_scheme("http")
            .expect("ws -> http scheme rewrite should succeed"),
        "wss" => parsed_url
            .set_scheme("https")
            .expect("wss -> https scheme rewrite should succeed"),
        _ => {
            return Err(TunnelSessionError::InvalidGatewayUrl(
                "sandbox tunnel gateway ws url must use ws or wss scheme".to_string(),
            ));
        }
    }
    let mut path = parsed_url.path().trim_end_matches('/').to_string();
    path.push_str("/token-exchange");
    parsed_url.set_path(&path);
    Ok(parsed_url.to_string())
}

fn send_telemetry_frames(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    frames: Vec<TelemetryRelayFrame>,
) -> Result<(), TunnelSessionError> {
    for frame in frames {
        match frame {
            TelemetryRelayFrame::Text(payload) => write_tunnel_text(tunnel_writer_sender, payload)?,
            TelemetryRelayFrame::Binary(payload) => {
                write_tunnel_binary(tunnel_writer_sender, payload)?
            }
        }
    }

    Ok(())
}

fn write_tunnel_text(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    payload: String,
) -> Result<(), TunnelSessionError> {
    tunnel_writer_sender
        .send(TunnelWriterMessage::Text(payload))
        .map_err(|_| {
            TunnelSessionError::WriteTunnelText("bootstrap tunnel writer is closed".to_string())
        })
}

fn write_tunnel_binary(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    payload: Vec<u8>,
) -> Result<(), TunnelSessionError> {
    tunnel_writer_sender
        .send(TunnelWriterMessage::Binary(payload))
        .map_err(|_| {
            TunnelSessionError::WriteTunnelBinary("bootstrap tunnel writer is closed".to_string())
        })
}

fn write_tunnel_pong(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    payload: Vec<u8>,
) -> Result<(), TunnelSessionError> {
    tunnel_writer_sender
        .send(TunnelWriterMessage::Pong(payload))
        .map_err(|_| {
            TunnelSessionError::WriteTunnelText("bootstrap tunnel writer is closed".to_string())
        })
}

fn write_tunnel_flush(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    response_sender: std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), TunnelSessionError> {
    match tunnel_writer_sender.send(TunnelWriterMessage::Flush { response_sender }) {
        Ok(()) => Ok(()),
        Err(error) => {
            let error_message = "bootstrap tunnel writer is closed".to_string();
            match error.0 {
                TunnelWriterMessage::Flush { response_sender } => {
                    let _ = response_sender.send(Err(error_message.clone()));
                }
                TunnelWriterMessage::Text(_)
                | TunnelWriterMessage::Binary(_)
                | TunnelWriterMessage::Pong(_)
                | TunnelWriterMessage::Close => {}
            }
            Err(TunnelSessionError::WriteTunnelText(error_message))
        }
    }
}

fn write_tunnel_close(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
) -> Result<(), TunnelSessionError> {
    let _ = tunnel_writer_sender.send(TunnelWriterMessage::Close);
    Ok(())
}

fn assert_upload_metadata(
    thread_id: &str,
    mime_type: &str,
    size_bytes: usize,
) -> Result<(), String> {
    assert_safe_upload_thread_id(thread_id)?;
    if mime_type.trim().is_empty() {
        return Err("mimeType is required.".to_string());
    }
    if size_bytes == 0 {
        return Err("sizeBytes must be greater than 0.".to_string());
    }
    if size_bytes > MAX_UPLOAD_SIZE_BYTES {
        return Err("sizeBytes exceeds the configured upload limit.".to_string());
    }
    Ok(())
}

fn assert_safe_upload_thread_id(thread_id: &str) -> Result<(), String> {
    let trimmed_thread_id = thread_id.trim();
    if trimmed_thread_id.is_empty() {
        return Err("threadId is required.".to_string());
    }
    if trimmed_thread_id != thread_id {
        return Err("threadId must not include leading or trailing whitespace.".to_string());
    }
    if thread_id.len() > MAX_UPLOAD_THREAD_ID_LENGTH {
        return Err("threadId exceeds the configured length limit.".to_string());
    }
    if !thread_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("threadId must use only ASCII letters, digits, '_' or '-'.".to_string());
    }
    Ok(())
}

fn derive_upload_thread_directory_path(
    attachment_root_path: &Path,
    thread_id: &str,
) -> Result<PathBuf, String> {
    assert_safe_upload_thread_id(thread_id)?;
    Ok(attachment_root_path.join(thread_id))
}

#[cfg(test)]
mod tests {
    use super::{
        AgentStreamState, AgentStreamStats, ConnectedTunnelSessionOutcome, DEFAULT_ATTACHMENT_ROOT,
        OperationStreamMessage, PTY_OUTCOME_CLOSED, PortAccessTcpStreamState, PtySessionStats,
        PtySessionTermination, SANDBOX_OPERATION_STREAM_FORMAT, SANDBOX_OPERATION_STREAM_ID,
        TunnelSessionError, TunnelSessionEvent, TunnelSessionLoopContext,
        TunnelSessionMutableState, TunnelSessionRequest, TunnelSessionRuntime,
        TunnelSessionRuntimeConnectionState, TunnelWriterMessage, connect_bootstrap_websocket,
        handle_ports_transport_message, handle_tunnel_control_message, handle_tunnel_session_event,
        handle_tunnel_session_request, prioritize_ipv4_socket_addresses,
        publish_pty_input_latency_warning, publish_pty_session_summary,
        resolve_bootstrap_tunnel_url, resolve_tunnel_exchange_url,
        run_connected_tunnel_session_catching_panics, snapshot_runtime_connection_state,
        startup_transparent_passthrough_socket_mark, sync_pty_scope_keepalive,
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
    use tungstenite::{
        Error as WebSocketError, Message, WebSocket, accept, accept_hdr,
        handshake::server::{Request, Response},
    };

    use crate::keepalive::KeepaliveManager;
    use crate::protocol::startup::{
        StartupInput, StartupMode, TransparentProxyBypass, TransparentProxyBypassKind,
        TransparentProxyConfiguration,
    };
    use crate::runtime::adapters::RuntimeAdapterRegistry;
    use crate::runtime::readiness::RuntimeReadinessManager;
    use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};
    use crate::time::{Clock, SystemClock, ThreadSleeper};
    use crate::tunnel::port_access_transport::{PortAccessTcpCommand, PortAccessTransportEvent};
    use crate::tunnel::protocol::{
        AGENT_STREAM_WINDOW_BYTES, PAYLOAD_KIND_RAW_BYTES, PAYLOAD_KIND_WEBSOCKET_TEXT,
        PortAccessTarget, PortsTcpClose, PortsTcpConnected, PortsTcpOpen, PortsTransportMessage,
        StreamDataFrame, StreamSendWindow, decode_stream_data_frame, encode_stream_data_frame,
        parse_stream_control_message,
    };
    use crate::tunnel::session::{
        GatewayEgressTokenProvider, TunnelSession, TunnelSigningRequest, TunnelSigningResponse,
        decode_bounded_output,
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
            processes_stream_send_windows: BTreeMap::new(),
            last_processes_snapshot_at_ms: None,
            operation_stream_requested: false,
            operation_stream_close_requested: false,
            operation_stream_close_response_sender: None,
            operation_stream_send_window: None,
            pending_operation_records: Default::default(),
            pty_sessions: BTreeMap::new(),
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

    #[test]
    fn set_agent_endpoint_request_updates_the_existing_tunnel_session() {
        let (tunnel_writer_sender, _tunnel_writer_receiver) =
            tokio::sync::mpsc::unbounded_channel();
        let (response_sender, response_receiver) = mpsc::channel();
        let runtime = test_tunnel_session_runtime();
        let mut session_state = empty_tunnel_session_state();

        handle_tunnel_session_request(
            TunnelSessionRequest::SetAgentEndpoint {
                agent_endpoint_url: Some("ws://127.0.0.1:12345/agent".to_string()),
                response_sender,
            },
            &tunnel_writer_sender,
            &runtime,
            &mut session_state,
        )
        .expect("agent endpoint update should be handled");

        response_receiver
            .recv()
            .expect("endpoint update should acknowledge")
            .expect("endpoint update should succeed");
        assert_eq!(
            session_state.agent_endpoint_url.as_deref(),
            Some("ws://127.0.0.1:12345/agent")
        );
        let connection_state = snapshot_runtime_connection_state(&runtime);
        assert_eq!(
            connection_state.agent_endpoint_url.as_deref(),
            Some("ws://127.0.0.1:12345/agent")
        );
    }

    #[test]
    fn set_runtime_environment_request_updates_the_existing_tunnel_session() {
        let (tunnel_writer_sender, _tunnel_writer_receiver) =
            tokio::sync::mpsc::unbounded_channel();
        let (response_sender, response_receiver) = mpsc::channel();
        let runtime = test_tunnel_session_runtime();
        let mut session_state = empty_tunnel_session_state();

        handle_tunnel_session_request(
            TunnelSessionRequest::SetRuntimeEnvironment {
                runtime_env: BTreeMap::from([(
                    "MISTLE_RUNTIME_ENV".to_string(),
                    "ready".to_string(),
                )]),
                response_sender,
            },
            &tunnel_writer_sender,
            &runtime,
            &mut session_state,
        )
        .expect("runtime environment update should be handled");

        response_receiver
            .recv()
            .expect("runtime environment update should acknowledge")
            .expect("runtime environment update should succeed");
        assert_eq!(
            session_state.runtime_env.get("MISTLE_RUNTIME_ENV"),
            Some(&"ready".to_string())
        );
        let connection_state = snapshot_runtime_connection_state(&runtime);
        assert_eq!(
            connection_state.runtime_env.get("MISTLE_RUNTIME_ENV"),
            Some(&"ready".to_string())
        );
    }

    #[tokio::test]
    async fn restores_agent_stream_window_credit_after_runtime_writes_complete() {
        let (tunnel_writer_sender, mut tunnel_writer_receiver) =
            tokio::sync::mpsc::unbounded_channel();
        let (event_sender, _event_receiver) = tokio::sync::mpsc::unbounded_channel();
        let (agent_sender, _agent_receiver) = tokio::sync::mpsc::unbounded_channel();
        let clock = SystemClock;
        let sleeper = ThreadSleeper;
        let mut session_state = TunnelSessionMutableState {
            agent_endpoint_url: None,
            runtime_env: BTreeMap::new(),
            telemetry_relay: TelemetryRelay::default(),
            pending_signing_requests: BTreeMap::new(),
            pending_egress_token_requests: BTreeMap::new(),
            pending_agent_opens: BTreeMap::new(),
            pending_exec_opens: BTreeMap::new(),
            agent_streams: BTreeMap::from([(
                7,
                AgentStreamState {
                    sender: agent_sender,
                    send_window: StreamSendWindow::new(AGENT_STREAM_WINDOW_BYTES),
                    stats: AgentStreamStats::new(0),
                },
            )]),
            port_access_http_streams: BTreeMap::new(),
            port_access_tcp_streams: BTreeMap::new(),
            processes_stream_send_windows: BTreeMap::new(),
            last_processes_snapshot_at_ms: None,
            operation_stream_requested: false,
            operation_stream_close_requested: false,
            operation_stream_close_response_sender: None,
            operation_stream_send_window: None,
            pending_operation_records: Default::default(),
            pty_sessions: BTreeMap::new(),
            file_uploads: BTreeMap::new(),
        };
        let supervisor_handle = test_tunnel_supervisor_handle("sbi_test", Arc::new(SystemClock));
        let context = TunnelSessionLoopContext {
            attachment_root: std::path::Path::new("/tmp"),
            cgroup_root: std::path::Path::new("/tmp"),
            sandbox_instance_id: "sbi_test",
            gateway_ws_url: "ws://127.0.0.1:3300/bootstrap",
            clock: &clock,
            sleeper: &sleeper,
            supervisor_handle: &supervisor_handle,
        };

        handle_tunnel_session_event(
            TunnelSessionEvent::AgentWriteCompleted {
                stream_id: 7,
                bytes: 512,
            },
            &tunnel_writer_sender,
            &event_sender,
            &context,
            &mut session_state,
        )
        .await
        .expect("agent write completion should restore send credit");

        let writer_message = tunnel_writer_receiver
            .recv()
            .await
            .expect("window update should be queued");
        let TunnelWriterMessage::Text(payload) = writer_message else {
            panic!("expected a text stream.window update");
        };
        assert_eq!(
            serde_json::from_str::<Value>(&payload).expect("window payload should be json"),
            json!({
                "type": "stream.window",
                "streamId": 7,
                "bytes": 512
            })
        );
    }

    #[tokio::test]
    async fn serializes_port_access_tcp_events_to_tunnel_frames() {
        let (tunnel_writer_sender, mut tunnel_writer_receiver) =
            tokio::sync::mpsc::unbounded_channel();
        let (event_sender, _event_receiver) = tokio::sync::mpsc::unbounded_channel();
        let (tcp_sender, _tcp_receiver) =
            tokio::sync::mpsc::unbounded_channel::<PortAccessTcpCommand>();
        let clock = SystemClock;
        let sleeper = ThreadSleeper;
        let mut session_state = TunnelSessionMutableState {
            agent_endpoint_url: None,
            runtime_env: BTreeMap::new(),
            telemetry_relay: TelemetryRelay::default(),
            pending_signing_requests: BTreeMap::new(),
            pending_egress_token_requests: BTreeMap::new(),
            pending_agent_opens: BTreeMap::new(),
            pending_exec_opens: BTreeMap::new(),
            agent_streams: BTreeMap::new(),
            port_access_http_streams: BTreeMap::new(),
            port_access_tcp_streams: BTreeMap::from([(
                55,
                PortAccessTcpStreamState {
                    sender: tcp_sender,
                    request_window: StreamSendWindow::new(0),
                    request_closed: true,
                    response_closed: false,
                },
            )]),
            processes_stream_send_windows: BTreeMap::new(),
            last_processes_snapshot_at_ms: None,
            operation_stream_requested: false,
            operation_stream_close_requested: false,
            operation_stream_close_response_sender: None,
            operation_stream_send_window: None,
            pending_operation_records: Default::default(),
            pty_sessions: BTreeMap::new(),
            file_uploads: BTreeMap::new(),
        };
        let supervisor_handle = test_tunnel_supervisor_handle("sbi_test", Arc::new(SystemClock));
        let context = TunnelSessionLoopContext {
            attachment_root: std::path::Path::new("/tmp"),
            cgroup_root: std::path::Path::new("/tmp"),
            sandbox_instance_id: "sbi_test",
            gateway_ws_url: "ws://127.0.0.1:3300/bootstrap",
            clock: &clock,
            sleeper: &sleeper,
            supervisor_handle: &supervisor_handle,
        };

        handle_tunnel_session_event(
            TunnelSessionEvent::PortAccessTransport(PortAccessTransportEvent::TcpConnected(
                PortsTcpConnected {
                    message_type: "ports.tcp.connected".to_string(),
                    stream_id: 55,
                },
            )),
            &tunnel_writer_sender,
            &event_sender,
            &context,
            &mut session_state,
        )
        .await
        .expect("tcp connected event should serialize");
        assert_eq!(
            read_writer_text_json(&mut tunnel_writer_receiver).await,
            json!({
                "type": "ports.tcp.connected",
                "streamId": 55
            })
        );

        handle_tunnel_session_event(
            TunnelSessionEvent::PortAccessTransport(PortAccessTransportEvent::TcpData {
                stream_id: 55,
                bytes: b"pong".to_vec(),
            }),
            &tunnel_writer_sender,
            &event_sender,
            &context,
            &mut session_state,
        )
        .await
        .expect("tcp data event should serialize");
        let writer_message = tunnel_writer_receiver
            .recv()
            .await
            .expect("tcp data frame should be queued");
        let TunnelWriterMessage::Binary(payload) = writer_message else {
            panic!("expected tcp data as tunnel binary frame");
        };
        let frame = decode_stream_data_frame(payload.as_ref())
            .expect("tcp data frame should decode successfully");
        assert_eq!(frame.stream_id, 55);
        assert_eq!(frame.payload_kind, PAYLOAD_KIND_RAW_BYTES);
        assert_eq!(frame.payload, b"pong");

        handle_tunnel_session_event(
            TunnelSessionEvent::PortAccessTransport(PortAccessTransportEvent::TcpInputWindow {
                stream_id: 55,
                bytes: 4,
            }),
            &tunnel_writer_sender,
            &event_sender,
            &context,
            &mut session_state,
        )
        .await
        .expect("tcp input window event should serialize");
        assert_eq!(
            read_writer_text_json(&mut tunnel_writer_receiver).await,
            json!({
                "type": "stream.window",
                "streamId": 55,
                "bytes": 4
            })
        );

        handle_tunnel_session_event(
            TunnelSessionEvent::PortAccessTransport(PortAccessTransportEvent::TcpClose(
                PortsTcpClose {
                    message_type: "ports.tcp.close".to_string(),
                    stream_id: 55,
                    direction: "response".to_string(),
                },
            )),
            &tunnel_writer_sender,
            &event_sender,
            &context,
            &mut session_state,
        )
        .await
        .expect("tcp close event should serialize");
        assert_eq!(
            read_writer_text_json(&mut tunnel_writer_receiver).await,
            json!({
                "type": "ports.tcp.close",
                "streamId": 55,
                "direction": "response"
            })
        );
        assert!(
            !session_state.port_access_tcp_streams.contains_key(&55),
            "response close should release tcp stream state",
        );
    }

    #[test]
    fn routes_raw_tunnel_binary_frames_to_active_port_access_tcp_streams() {
        let (tunnel_writer_sender, _tunnel_writer_receiver) =
            tokio::sync::mpsc::unbounded_channel();
        let (tcp_sender, mut tcp_receiver) =
            tokio::sync::mpsc::unbounded_channel::<PortAccessTcpCommand>();
        let mut session_state = TunnelSessionMutableState {
            agent_endpoint_url: None,
            runtime_env: BTreeMap::new(),
            telemetry_relay: TelemetryRelay::default(),
            pending_signing_requests: BTreeMap::new(),
            pending_egress_token_requests: BTreeMap::new(),
            pending_agent_opens: BTreeMap::new(),
            pending_exec_opens: BTreeMap::new(),
            agent_streams: BTreeMap::new(),
            port_access_http_streams: BTreeMap::new(),
            port_access_tcp_streams: BTreeMap::from([(
                56,
                PortAccessTcpStreamState {
                    sender: tcp_sender,
                    request_window: StreamSendWindow::default(),
                    request_closed: false,
                    response_closed: false,
                },
            )]),
            processes_stream_send_windows: BTreeMap::new(),
            last_processes_snapshot_at_ms: None,
            operation_stream_requested: false,
            operation_stream_close_requested: false,
            operation_stream_close_response_sender: None,
            operation_stream_send_window: None,
            pending_operation_records: Default::default(),
            pty_sessions: BTreeMap::new(),
            file_uploads: BTreeMap::new(),
        };

        super::handle_tunnel_binary_frame(
            &tunnel_writer_sender,
            StreamDataFrame {
                stream_id: 56,
                payload_kind: PAYLOAD_KIND_RAW_BYTES,
                payload: b"ping".to_vec(),
            },
            &mut session_state,
            &SystemClock,
        )
        .expect("tcp binary frame should route to tcp command channel");

        match tcp_receiver
            .try_recv()
            .expect("tcp command receiver should receive request bytes")
        {
            PortAccessTcpCommand::Data { bytes } => assert_eq!(bytes, b"ping"),
            command => panic!("unexpected tcp command: {command:?}"),
        }
    }

    #[test]
    fn keeps_port_access_tcp_stream_active_until_both_directions_close() {
        let (tcp_sender, _tcp_receiver) =
            tokio::sync::mpsc::unbounded_channel::<PortAccessTcpCommand>();
        let mut session_state = TunnelSessionMutableState {
            agent_endpoint_url: None,
            runtime_env: BTreeMap::new(),
            telemetry_relay: TelemetryRelay::default(),
            pending_signing_requests: BTreeMap::new(),
            pending_egress_token_requests: BTreeMap::new(),
            pending_agent_opens: BTreeMap::new(),
            pending_exec_opens: BTreeMap::new(),
            agent_streams: BTreeMap::new(),
            port_access_http_streams: BTreeMap::new(),
            port_access_tcp_streams: BTreeMap::from([(
                57,
                PortAccessTcpStreamState {
                    sender: tcp_sender,
                    request_window: StreamSendWindow::default(),
                    request_closed: false,
                    response_closed: false,
                },
            )]),
            processes_stream_send_windows: BTreeMap::new(),
            last_processes_snapshot_at_ms: None,
            operation_stream_requested: false,
            operation_stream_close_requested: false,
            operation_stream_close_response_sender: None,
            operation_stream_send_window: None,
            pending_operation_records: Default::default(),
            pty_sessions: BTreeMap::new(),
            file_uploads: BTreeMap::new(),
        };

        super::mark_port_access_tcp_direction_closed(&mut session_state, 57, "response");
        assert!(
            session_state.port_access_tcp_streams.contains_key(&57),
            "response half-close must not discard request direction state",
        );

        super::mark_port_access_tcp_direction_closed(&mut session_state, 57, "request");
        assert!(
            !session_state.port_access_tcp_streams.contains_key(&57),
            "tcp stream state should release only after both directions close",
        );
    }

    #[test]
    fn rejects_port_access_tcp_open_when_stream_id_belongs_to_agent_stream() {
        let (event_sender, _event_receiver) = tokio::sync::mpsc::unbounded_channel();
        let (agent_sender, _agent_receiver) = tokio::sync::mpsc::unbounded_channel();
        let mut session_state = TunnelSessionMutableState {
            agent_endpoint_url: None,
            runtime_env: BTreeMap::new(),
            telemetry_relay: TelemetryRelay::default(),
            pending_signing_requests: BTreeMap::new(),
            pending_egress_token_requests: BTreeMap::new(),
            pending_agent_opens: BTreeMap::new(),
            pending_exec_opens: BTreeMap::new(),
            agent_streams: BTreeMap::from([(
                58,
                AgentStreamState {
                    sender: agent_sender,
                    send_window: StreamSendWindow::new(AGENT_STREAM_WINDOW_BYTES),
                    stats: AgentStreamStats::new(0),
                },
            )]),
            port_access_http_streams: BTreeMap::new(),
            port_access_tcp_streams: BTreeMap::new(),
            processes_stream_send_windows: BTreeMap::new(),
            last_processes_snapshot_at_ms: None,
            operation_stream_requested: false,
            operation_stream_close_requested: false,
            operation_stream_close_response_sender: None,
            operation_stream_send_window: None,
            pending_operation_records: Default::default(),
            pty_sessions: BTreeMap::new(),
            file_uploads: BTreeMap::new(),
        };

        let error = handle_ports_transport_message(
            PortsTransportMessage::TcpOpen(PortsTcpOpen {
                message_type: "ports.tcp.open".to_string(),
                stream_id: 58,
                target: PortAccessTarget {
                    kind: "port".to_string(),
                    port: 5173,
                },
                upstream_protocol: "http".to_string(),
            }),
            &event_sender,
            &mut session_state,
        )
        .expect_err("tcp open must reject stream id owned by an agent stream");

        assert!(
            error
                .to_string()
                .contains("ports.tcp.open streamId 58 already exists"),
            "collision errors should identify the rejected stream id",
        );
        assert!(
            session_state.port_access_tcp_streams.is_empty(),
            "rejected tcp opens must not create tcp stream state",
        );
    }

    #[tokio::test]
    async fn rejects_port_access_tcp_request_bytes_beyond_stream_window() {
        let (tunnel_writer_sender, mut tunnel_writer_receiver) =
            tokio::sync::mpsc::unbounded_channel();
        let (tcp_sender, mut tcp_receiver) =
            tokio::sync::mpsc::unbounded_channel::<PortAccessTcpCommand>();
        let mut session_state = TunnelSessionMutableState {
            agent_endpoint_url: None,
            runtime_env: BTreeMap::new(),
            telemetry_relay: TelemetryRelay::default(),
            pending_signing_requests: BTreeMap::new(),
            pending_egress_token_requests: BTreeMap::new(),
            pending_agent_opens: BTreeMap::new(),
            pending_exec_opens: BTreeMap::new(),
            agent_streams: BTreeMap::new(),
            port_access_http_streams: BTreeMap::new(),
            port_access_tcp_streams: BTreeMap::from([(
                59,
                PortAccessTcpStreamState {
                    sender: tcp_sender,
                    request_window: StreamSendWindow::new(4),
                    request_closed: false,
                    response_closed: false,
                },
            )]),
            processes_stream_send_windows: BTreeMap::new(),
            last_processes_snapshot_at_ms: None,
            operation_stream_requested: false,
            operation_stream_close_requested: false,
            operation_stream_close_response_sender: None,
            operation_stream_send_window: None,
            pending_operation_records: Default::default(),
            pty_sessions: BTreeMap::new(),
            file_uploads: BTreeMap::new(),
        };

        super::handle_tunnel_binary_frame(
            &tunnel_writer_sender,
            StreamDataFrame {
                stream_id: 59,
                payload_kind: PAYLOAD_KIND_RAW_BYTES,
                payload: b"ping".to_vec(),
            },
            &mut session_state,
            &SystemClock,
        )
        .expect("first tcp frame should fit within request window");
        match tcp_receiver
            .try_recv()
            .expect("tcp command receiver should receive in-window bytes")
        {
            PortAccessTcpCommand::Data { bytes } => assert_eq!(bytes, b"ping"),
            command => panic!("unexpected tcp command: {command:?}"),
        }

        super::handle_tunnel_binary_frame(
            &tunnel_writer_sender,
            StreamDataFrame {
                stream_id: 59,
                payload_kind: PAYLOAD_KIND_RAW_BYTES,
                payload: b"!".to_vec(),
            },
            &mut session_state,
            &SystemClock,
        )
        .expect("exhausted tcp request window should reset the stream");

        let reset = read_writer_text_json(&mut tunnel_writer_receiver).await;
        assert_eq!(
            reset,
            json!({
                "type": "stream.reset",
                "streamId": 59,
                "code": "stream_window_exhausted",
                "message": "port access tcp request stream window is exhausted"
            })
        );
        assert!(
            !session_state.port_access_tcp_streams.contains_key(&59),
            "stream state should be released after request-window exhaustion",
        );
        match tcp_receiver
            .try_recv()
            .expect("tcp transport should be terminated after window exhaustion")
        {
            PortAccessTcpCommand::Terminate => {}
            command => panic!("unexpected tcp command: {command:?}"),
        }
    }

    #[tokio::test]
    async fn bootstrap_disconnect_terminates_active_port_access_tcp_streams() {
        let (tunnel_writer_sender, _tunnel_writer_receiver) =
            tokio::sync::mpsc::unbounded_channel();
        let (event_sender, _event_receiver) = tokio::sync::mpsc::unbounded_channel();
        let (tcp_sender, mut tcp_receiver) =
            tokio::sync::mpsc::unbounded_channel::<PortAccessTcpCommand>();
        let clock = SystemClock;
        let sleeper = ThreadSleeper;
        let mut session_state = TunnelSessionMutableState {
            agent_endpoint_url: None,
            runtime_env: BTreeMap::new(),
            telemetry_relay: TelemetryRelay::default(),
            pending_signing_requests: BTreeMap::new(),
            pending_egress_token_requests: BTreeMap::new(),
            pending_agent_opens: BTreeMap::new(),
            pending_exec_opens: BTreeMap::new(),
            agent_streams: BTreeMap::new(),
            port_access_http_streams: BTreeMap::new(),
            port_access_tcp_streams: BTreeMap::from([(
                60,
                PortAccessTcpStreamState {
                    sender: tcp_sender,
                    request_window: StreamSendWindow::default(),
                    request_closed: false,
                    response_closed: false,
                },
            )]),
            processes_stream_send_windows: BTreeMap::new(),
            last_processes_snapshot_at_ms: None,
            operation_stream_requested: false,
            operation_stream_close_requested: false,
            operation_stream_close_response_sender: None,
            operation_stream_send_window: None,
            pending_operation_records: Default::default(),
            pty_sessions: BTreeMap::new(),
            file_uploads: BTreeMap::new(),
        };
        let supervisor_handle = test_tunnel_supervisor_handle("sbi_test", Arc::new(SystemClock));
        let context = TunnelSessionLoopContext {
            attachment_root: std::path::Path::new("/tmp"),
            cgroup_root: std::path::Path::new("/tmp"),
            sandbox_instance_id: "sbi_test",
            gateway_ws_url: "ws://127.0.0.1:3300/bootstrap",
            clock: &clock,
            sleeper: &sleeper,
            supervisor_handle: &supervisor_handle,
        };

        let control_flow = handle_tunnel_session_event(
            TunnelSessionEvent::BootstrapClosed {
                reason: Some("test bootstrap disconnect".to_string()),
            },
            &tunnel_writer_sender,
            &event_sender,
            &context,
            &mut session_state,
        )
        .await
        .expect("bootstrap disconnect should be handled");

        assert!(matches!(
            control_flow,
            super::TunnelSessionControlFlow::RestartRequired
        ));
        assert!(
            session_state.port_access_tcp_streams.is_empty(),
            "bootstrap disconnect should release tcp stream state",
        );
        match tcp_receiver
            .try_recv()
            .expect("tcp transport should receive terminate on bootstrap disconnect")
        {
            PortAccessTcpCommand::Terminate => {}
            command => panic!("unexpected tcp command: {command:?}"),
        }
    }

    #[tokio::test]
    async fn emits_agent_stream_summary_when_gateway_closes_stream() {
        let (tunnel_writer_sender, mut tunnel_writer_receiver) =
            tokio::sync::mpsc::unbounded_channel();
        let (event_sender, _event_receiver) = tokio::sync::mpsc::unbounded_channel();
        let (agent_sender, mut agent_receiver) = tokio::sync::mpsc::unbounded_channel();
        let clock = FixedClock { now_ms: 1_500 };
        let sleeper = ThreadSleeper;
        let mut stats = AgentStreamStats::new(500);
        stats.record_outbound_message(256, 700, 256);
        stats.record_credit_restore(256, 900);
        stats.record_outbound_message(128, 1_000, 128);
        stats.record_inbound_message(64);
        let mut session_state = TunnelSessionMutableState {
            agent_endpoint_url: None,
            runtime_env: BTreeMap::new(),
            telemetry_relay: TelemetryRelay::default(),
            pending_signing_requests: BTreeMap::new(),
            pending_egress_token_requests: BTreeMap::new(),
            pending_agent_opens: BTreeMap::new(),
            pending_exec_opens: BTreeMap::new(),
            agent_streams: BTreeMap::from([(
                7,
                AgentStreamState {
                    sender: agent_sender,
                    send_window: StreamSendWindow::new(AGENT_STREAM_WINDOW_BYTES),
                    stats,
                },
            )]),
            port_access_http_streams: BTreeMap::new(),
            port_access_tcp_streams: BTreeMap::new(),
            processes_stream_send_windows: BTreeMap::new(),
            last_processes_snapshot_at_ms: None,
            operation_stream_requested: false,
            operation_stream_close_requested: false,
            operation_stream_close_response_sender: None,
            operation_stream_send_window: None,
            pending_operation_records: Default::default(),
            pty_sessions: BTreeMap::new(),
            file_uploads: BTreeMap::new(),
        };
        enable_test_telemetry(&mut session_state.telemetry_relay);
        let supervisor_handle = test_tunnel_supervisor_handle("sbi_test", Arc::new(SystemClock));
        let context = TunnelSessionLoopContext {
            attachment_root: std::path::Path::new("/tmp"),
            cgroup_root: std::path::Path::new("/tmp"),
            sandbox_instance_id: "sbi_test",
            gateway_ws_url: "ws://127.0.0.1:3300/bootstrap",
            clock: &clock,
            sleeper: &sleeper,
            supervisor_handle: &supervisor_handle,
        };
        let close_message = parse_stream_control_message(r#"{"type":"stream.close","streamId":7}"#)
            .expect("stream.close should parse");

        handle_tunnel_control_message(
            &tunnel_writer_sender,
            &event_sender,
            close_message,
            &context,
            &mut session_state,
        )
        .await
        .expect("gateway close should succeed");

        let telemetry_log = read_queued_telemetry_log_line(&mut tunnel_writer_receiver).await;
        assert_eq!(
            telemetry_log,
            json!({
                "timestamp": "1970-01-01T00:00:01.5Z",
                "level": "info",
                "event": "agent_stream_summary",
                "streamId": 7,
                "channelKind": "agent",
                "outcome": "closed",
                "closeSource": "gateway",
                "durationMs": 1000,
                "messageCountOut": 2,
                "messageCountIn": 1,
                "totalBytesOut": 384,
                "totalBytesIn": 64,
                "maxMessageBytesOut": 256,
                "maxMessageBytesIn": 64,
                "maxOutstandingBytes": 256,
                "avgCreditReturnMs": 200,
                "creditReturnCount": 1,
                "resetCode": null,
                "reason": null
            })
        );
        assert!(session_state.agent_streams.is_empty());
        let forwarded_close = agent_receiver
            .recv()
            .await
            .expect("runtime close should be forwarded");
        assert_eq!(forwarded_close, Message::Close(None));
    }

    #[tokio::test]
    async fn emits_window_exhausted_and_summary_telemetry_for_agent_stream() {
        let (tunnel_writer_sender, mut tunnel_writer_receiver) =
            tokio::sync::mpsc::unbounded_channel();
        let (event_sender, _event_receiver) = tokio::sync::mpsc::unbounded_channel();
        let (agent_sender, _agent_receiver) = tokio::sync::mpsc::unbounded_channel();
        let clock = FixedClock { now_ms: 1_200 };
        let sleeper = ThreadSleeper;
        let mut session_state = TunnelSessionMutableState {
            agent_endpoint_url: None,
            runtime_env: BTreeMap::new(),
            telemetry_relay: TelemetryRelay::default(),
            pending_signing_requests: BTreeMap::new(),
            pending_egress_token_requests: BTreeMap::new(),
            pending_agent_opens: BTreeMap::new(),
            pending_exec_opens: BTreeMap::new(),
            agent_streams: BTreeMap::from([(
                7,
                AgentStreamState {
                    sender: agent_sender,
                    send_window: StreamSendWindow::new(1),
                    stats: AgentStreamStats::new(200),
                },
            )]),
            port_access_http_streams: BTreeMap::new(),
            port_access_tcp_streams: BTreeMap::new(),
            processes_stream_send_windows: BTreeMap::new(),
            last_processes_snapshot_at_ms: None,
            operation_stream_requested: false,
            operation_stream_close_requested: false,
            operation_stream_close_response_sender: None,
            operation_stream_send_window: None,
            pending_operation_records: Default::default(),
            pty_sessions: BTreeMap::new(),
            file_uploads: BTreeMap::new(),
        };
        enable_test_telemetry(&mut session_state.telemetry_relay);
        let supervisor_handle = test_tunnel_supervisor_handle("sbi_test", Arc::new(SystemClock));
        let context = TunnelSessionLoopContext {
            attachment_root: std::path::Path::new("/tmp"),
            cgroup_root: std::path::Path::new("/tmp"),
            sandbox_instance_id: "sbi_test",
            gateway_ws_url: "ws://127.0.0.1:3300/bootstrap",
            clock: &clock,
            sleeper: &sleeper,
            supervisor_handle: &supervisor_handle,
        };

        handle_tunnel_session_event(
            TunnelSessionEvent::AgentMessage {
                stream_id: 7,
                message: Message::Text("too big".to_string().into()),
            },
            &tunnel_writer_sender,
            &event_sender,
            &context,
            &mut session_state,
        )
        .await
        .expect("window exhaustion should still produce a reset");

        let exhaustion_log = read_queued_telemetry_log_line(&mut tunnel_writer_receiver).await;
        assert_eq!(
            exhaustion_log,
            json!({
                "timestamp": "1970-01-01T00:00:01.2Z",
                "level": "warn",
                "event": "agent_stream_window_exhausted",
                "streamId": 7,
                "channelKind": "agent",
                "payloadKind": "websocket_text",
                "payloadBytes": 7,
                "availableBytes": 1,
                "outstandingBytes": AGENT_STREAM_WINDOW_BYTES - 1,
                "maxWindowBytes": AGENT_STREAM_WINDOW_BYTES,
                "payloadExceedsMaxWindow": false,
                "payloadExceedsAvailableWindow": true,
                "messageCountOut": 0,
                "streamAgeMs": 1000,
                "oldestUnackedMs": null
            })
        );

        let summary_log = read_queued_telemetry_log_line(&mut tunnel_writer_receiver).await;
        assert_eq!(
            summary_log,
            json!({
                "timestamp": "1970-01-01T00:00:01.2Z",
                "level": "info",
                "event": "agent_stream_summary",
                "streamId": 7,
                "channelKind": "agent",
                "outcome": "reset",
                "closeSource": "runtime",
                "durationMs": 1000,
                "messageCountOut": 0,
                "messageCountIn": 0,
                "totalBytesOut": 0,
                "totalBytesIn": 0,
                "maxMessageBytesOut": 0,
                "maxMessageBytesIn": 0,
                "maxOutstandingBytes": 0,
                "avgCreditReturnMs": null,
                "creditReturnCount": 0,
                "resetCode": "stream_window_exhausted",
                "reason": "agent stream send window is exhausted"
            })
        );

        let reset_message = tunnel_writer_receiver
            .recv()
            .await
            .expect("stream reset should be queued");
        let TunnelWriterMessage::Text(payload) = reset_message else {
            panic!("expected a stream.reset control message");
        };
        assert_eq!(
            serde_json::from_str::<Value>(&payload).expect("reset payload should be json"),
            json!({
                "type": "stream.reset",
                "streamId": 7,
                "code": "stream_window_exhausted",
                "message": "agent stream send window is exhausted"
            })
        );
        assert!(session_state.agent_streams.is_empty());
    }

    #[test]
    fn tracks_pty_input_to_first_output_latency_stats() {
        let mut stats = PtySessionStats::new(1_000);

        stats.record_input(1_200, 1);
        let first_observation = stats
            .record_output(1_320, 32)
            .expect("first output should measure latency");
        assert_eq!(first_observation.input_to_first_output_ms, 120);
        assert_eq!(first_observation.interaction_count, 1);
        assert_eq!(first_observation.output_bytes, 32);

        stats.record_input(1_500, 2);
        let second_observation = stats
            .record_output(1_560, 12)
            .expect("second output should measure latency");
        assert_eq!(second_observation.input_to_first_output_ms, 60);
        assert_eq!(second_observation.interaction_count, 2);

        assert_eq!(stats.avg_input_to_first_output_ms(), Some(90));
        assert_eq!(stats.max_input_to_first_output_ms, 120);
        assert_eq!(stats.warning_count, 1);
    }

    #[tokio::test]
    async fn emits_pty_latency_warning_and_summary_telemetry() {
        let (tunnel_writer_sender, mut tunnel_writer_receiver) =
            tokio::sync::mpsc::unbounded_channel();
        let clock = FixedClock { now_ms: 2_000 };
        let mut telemetry_relay = TelemetryRelay::default();
        enable_test_telemetry(&mut telemetry_relay);
        let mut stats = PtySessionStats::new(500);

        stats.record_input(1_700, 1);
        let latency_telemetry = stats
            .record_output(1_845, 24)
            .expect("output should produce a latency sample");
        publish_pty_input_latency_warning(
            &tunnel_writer_sender,
            &mut telemetry_relay,
            &clock,
            "pty_demo",
            11,
            latency_telemetry,
        );
        publish_pty_session_summary(
            &tunnel_writer_sender,
            &mut telemetry_relay,
            &clock,
            "pty_demo",
            11,
            &stats,
            &PtySessionTermination {
                outcome: PTY_OUTCOME_CLOSED,
                reset_code: None,
                reason: None,
            },
        );

        let warning_log = read_queued_telemetry_log_line(&mut tunnel_writer_receiver).await;
        assert_eq!(
            warning_log,
            json!({
                "timestamp": "1970-01-01T00:00:02Z",
                "level": "warn",
                "event": "pty_input_latency_warning",
                "ptySessionId": "pty_demo",
                "streamId": 11,
                "channelKind": "pty",
                "thresholdMs": 100,
                "inputToFirstOutputMs": 145,
                "inputBytes": 1,
                "outputBytes": 24,
                "interactionCount": 1,
                "sessionAgeMs": 1345
            })
        );

        let summary_log = read_queued_telemetry_log_line(&mut tunnel_writer_receiver).await;
        assert_eq!(
            summary_log,
            json!({
                "timestamp": "1970-01-01T00:00:02Z",
                "level": "info",
                "event": "pty_session_summary",
                "ptySessionId": "pty_demo",
                "streamId": 11,
                "channelKind": "pty",
                "outcome": "closed",
                "durationMs": 1500,
                "interactionCount": 1,
                "warningCount": 1,
                "avgInputToFirstOutputMs": 145,
                "maxInputToFirstOutputMs": 145,
                "resetCode": null,
                "reason": null
            })
        );
    }

    #[test]
    fn trims_truncated_exec_output_to_a_valid_utf8_boundary() {
        let mut truncated_output = b"prefix ".to_vec();
        truncated_output.extend_from_slice(&"€".as_bytes()[..2]);

        let decoded = decode_bounded_output(truncated_output, true)
            .expect("truncated output should decode to the last valid utf-8 boundary");

        assert_eq!(decoded.text, "prefix ");
        assert!(decoded.truncated);
    }

    #[test]
    fn sync_pty_scope_keepalive_reads_populated_user_scopes_from_disk() {
        let test_dir = create_temp_test_dir("pty_scope_keepalive");
        let scope_paths = crate::cgroups::create_user_scope(&test_dir, "sbi_123", "scope_123")
            .expect("user scope should be created");
        std::fs::write(&scope_paths.events_file, "populated 1\n")
            .expect("scope events should be writable");
        let keepalive_manager = Mutex::new(KeepaliveManager::default());

        sync_pty_scope_keepalive(&keepalive_manager, &test_dir, "sbi_123")
            .expect("populated user scope should sync");

        assert!(
            keepalive_manager
                .lock()
                .expect("keepalive manager lock should not be poisoned")
                .active(),
            "populated user scope should keep the sandbox active"
        );

        std::fs::write(&scope_paths.events_file, "populated 0\n")
            .expect("scope events should be writable");
        sync_pty_scope_keepalive(&keepalive_manager, &test_dir, "sbi_123")
            .expect("empty user scope should sync");

        assert!(
            !keepalive_manager
                .lock()
                .expect("keepalive manager lock should not be poisoned")
                .active(),
            "empty user scope should clear sandbox keepalive"
        );

        std::fs::remove_dir_all(test_dir).expect("temp dir should be removable");
    }

    #[test]
    fn starts_live_tunnel_session_for_agent_and_file_upload_streams() {
        let upload_thread_id = format!(
            "thread_{}",
            REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
        );

        let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
        let raw_url = format!(
            "ws://127.0.0.1:{}/raw",
            raw_listener
                .local_addr()
                .expect("raw listener should expose an address")
                .port()
        );
        let raw_server_thread = thread::spawn(move || {
            let (monitor_stream, _) = raw_listener
                .accept()
                .expect("raw app-server should accept the monitor connection");
            let mut monitor_socket =
                accept(monitor_stream).expect("monitor handshake should succeed");

            assert_eq!(
                read_json_text_message(&mut monitor_socket)["method"],
                Value::String("initialize".to_string())
            );
            monitor_socket
                .send(Message::Text(
                    json!({
                        "id": 1,
                        "result": {
                            "userAgent": "codex-app-server",
                            "codexHome": "/tmp/codex-home",
                            "platformFamily": "linux",
                            "platformOs": "linux"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("initialize response should send");
            assert_eq!(
                read_json_text_message(&mut monitor_socket)["method"],
                Value::String("initialized".to_string())
            );

            let thread_loaded_list_request = read_json_text_message(&mut monitor_socket);
            assert_eq!(
                thread_loaded_list_request["method"],
                Value::String("thread/loaded/list".to_string())
            );
            monitor_socket
                .send(Message::Text(
                    json!({
                        "id": thread_loaded_list_request["id"],
                        "result": {
                            "data": [],
                            "nextCursor": null
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("thread/loaded/list response should send");

            let (client_stream, _) = raw_listener
                .accept()
                .expect("raw app-server should accept the proxied client connection");
            let mut client_socket =
                accept(client_stream).expect("proxied client handshake should succeed");
            let proxied_request = read_json_text_message(&mut client_socket);
            client_socket
                .send(Message::Text(
                    json!({
                        "id": proxied_request["id"],
                        "result": {
                            "data": []
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("proxied response should send");
            match client_socket.read() {
                Ok(Message::Close(_))
                | Err(WebSocketError::ConnectionClosed)
                | Err(WebSocketError::Protocol(_)) => {}
                Ok(other_message) => panic!(
                    "expected proxied client websocket to close after tunnel stream shutdown, got {other_message:?}"
                ),
                Err(error) => panic!(
                    "proxied client websocket should only end because the tunnel stream closed: {error}"
                ),
            }
        });

        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let upload_thread_id_for_gateway = upload_thread_id.clone();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let telemetry_open = read_json_text_message(&mut websocket);
            assert_eq!(telemetry_open["type"], "telemetry.open");
            websocket
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
                let control_message = read_json_text_message(&mut websocket);
                match control_message["type"].as_str() {
                    Some("keepalive.state") => {
                        assert_eq!(control_message["active"], Value::Bool(false));
                        saw_keepalive = true;
                    }
                    Some("runtime.ready") => {
                        if control_message["ready"] == Value::Bool(true) {
                            saw_runtime_ready = true;
                        }
                    }
                    Some("operation.open") => {
                        acknowledge_operation_open(&mut websocket, &control_message);
                    }
                    other => {
                        panic!("unexpected bootstrap control message before streams: {other:?}")
                    }
                }
            }

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.open",
                        "streamId": 7,
                        "channel": {
                            "kind": "agent"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open an agent stream");
            assert_eq!(
                read_stream_text_message(&mut websocket),
                json!({
                    "type": "stream.open.ok",
                    "streamId": 7
                })
            );

            let request_id = REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
            let encoded_request = encode_stream_data_frame(
                7,
                PAYLOAD_KIND_WEBSOCKET_TEXT,
                json!({
                    "id": request_id,
                    "method": "thread/loaded/list",
                    "params": {}
                })
                .to_string()
                .as_bytes(),
            )
            .expect("agent request frame should encode");
            let request_payload_len = encoded_request.len() - 6;
            websocket
                .send(Message::Binary(encoded_request.into()))
                .expect("gateway should send agent request data");

            let request_window = read_stream_text_message(&mut websocket);
            assert_eq!(
                request_window,
                json!({
                    "type": "stream.window",
                    "streamId": 7,
                    "bytes": request_payload_len
                })
            );

            let agent_response = read_non_telemetry_binary_frame(&mut websocket);
            assert_eq!(agent_response.stream_id, 7);
            assert_eq!(agent_response.payload_kind, PAYLOAD_KIND_WEBSOCKET_TEXT);
            assert_eq!(
                serde_json::from_slice::<Value>(&agent_response.payload)
                    .expect("agent response should be json"),
                json!({
                    "id": request_id,
                    "result": {
                        "data": []
                    }
                })
            );
            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.window",
                        "streamId": 7,
                        "bytes": agent_response.payload.len()
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should restore agent stream window credit");

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.close",
                        "streamId": 7
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should close the agent stream");

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.open",
                        "streamId": 9,
                        "channel": {
                            "kind": "fileUpload",
                            "threadId": upload_thread_id_for_gateway,
                            "mimeType": "image/png",
                            "originalFilename": "image.png",
                            "sizeBytes": 8
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open a file upload stream");
            assert_eq!(
                read_stream_text_message(&mut websocket),
                json!({
                    "type": "stream.open.ok",
                    "streamId": 9
                })
            );

            let png_bytes = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
            let encoded_upload = encode_stream_data_frame(9, PAYLOAD_KIND_RAW_BYTES, &png_bytes)
                .expect("file upload frame should encode");
            websocket
                .send(Message::Binary(encoded_upload.into()))
                .expect("gateway should send file upload bytes");

            let upload_window = read_stream_text_message(&mut websocket);
            assert_eq!(upload_window["type"], "stream.window");
            assert_eq!(upload_window["streamId"], Value::Number(9.into()));
            assert_eq!(upload_window["bytes"], Value::Number(8.into()));

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.close",
                        "streamId": 9
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should close the file upload stream");

            let completion_event = read_stream_text_message(&mut websocket);
            assert_eq!(completion_event["type"], "stream.event");
            assert_eq!(completion_event["streamId"], Value::Number(9.into()));
            assert_eq!(completion_event["event"]["type"], "fileUpload.completed");
            assert_eq!(completion_event["event"]["kind"], "image");
            let persisted_path = completion_event["event"]["path"]
                .as_str()
                .expect("file upload completed event should expose a persisted path")
                .to_string();
            assert_eq!(
                fs::read(&persisted_path).expect("persisted upload should be readable"),
                png_bytes
            );

            let complete_message = read_stream_text_message(&mut websocket);
            assert_eq!(complete_message["type"], "stream.complete");
            assert_eq!(complete_message["streamId"], Value::Number(9.into()));

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.open",
                        "streamId": 10,
                        "channel": {
                            "kind": "fileUpload",
                            "threadId": upload_thread_id_for_gateway,
                            "mimeType": "text/plain",
                            "originalFilename": "notes.txt",
                            "sizeBytes": 8
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open a generic file upload stream");
            assert_eq!(
                read_stream_text_message(&mut websocket),
                json!({
                    "type": "stream.open.ok",
                    "streamId": 10
                })
            );

            let file_bytes = b"notimage".to_vec();
            let encoded_upload = encode_stream_data_frame(10, PAYLOAD_KIND_RAW_BYTES, &file_bytes)
                .expect("file upload frame should encode");
            websocket
                .send(Message::Binary(encoded_upload.into()))
                .expect("gateway should send generic file upload bytes");

            let upload_window = read_stream_text_message(&mut websocket);
            assert_eq!(upload_window["type"], "stream.window");
            assert_eq!(upload_window["streamId"], Value::Number(10.into()));
            assert_eq!(upload_window["bytes"], Value::Number(8.into()));

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.close",
                        "streamId": 10
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should close the generic file upload stream");

            let completion_event = read_stream_text_message(&mut websocket);
            assert_eq!(completion_event["type"], "stream.event");
            assert_eq!(completion_event["streamId"], Value::Number(10.into()));
            assert_eq!(completion_event["event"]["type"], "fileUpload.completed");
            assert_eq!(completion_event["event"]["kind"], "file");
            let generic_persisted_path = completion_event["event"]["path"]
                .as_str()
                .expect("generic file upload completed event should expose a persisted path")
                .to_string();
            assert!(
                generic_persisted_path.ends_with(".txt"),
                "generic uploads should preserve safe filename extensions"
            );
            assert_eq!(
                fs::read(&generic_persisted_path)
                    .expect("generic persisted upload should be readable"),
                file_bytes
            );

            let complete_message = read_stream_text_message(&mut websocket);
            assert_eq!(complete_message["type"], "stream.complete");
            assert_eq!(complete_message["streamId"], Value::Number(10.into()));

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.open",
                        "streamId": 11,
                        "channel": {
                            "kind": "fileUpload",
                            "threadId": upload_thread_id_for_gateway,
                            "mimeType": "image/png",
                            "originalFilename": "image.png",
                            "sizeBytes": 8
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open a declared image upload stream");
            assert_eq!(
                read_stream_text_message(&mut websocket),
                json!({
                    "type": "stream.open.ok",
                    "streamId": 11
                })
            );

            let encoded_upload = encode_stream_data_frame(11, PAYLOAD_KIND_RAW_BYTES, &file_bytes)
                .expect("declared image upload frame should encode");
            websocket
                .send(Message::Binary(encoded_upload.into()))
                .expect("gateway should send invalid image upload bytes");

            let upload_window = read_stream_text_message(&mut websocket);
            assert_eq!(upload_window["type"], "stream.window");
            assert_eq!(upload_window["streamId"], Value::Number(11.into()));
            assert_eq!(upload_window["bytes"], Value::Number(8.into()));

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.close",
                        "streamId": 11
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should close the invalid image upload stream");

            let reset_message = read_stream_text_message(&mut websocket);
            assert_eq!(reset_message["type"], "stream.reset");
            assert_eq!(reset_message["streamId"], Value::Number(11.into()));
            assert_eq!(reset_message["code"], "invalid_file_type");
            assert_eq!(
                reset_message["message"],
                "uploaded file is not a supported image"
            );

            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
            gateway_done_sender
                .send(persisted_path)
                .expect("gateway should report the persisted path");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [
                    {
                        "clientId": "codex-cli",
                        "setup": {
                            "env": {},
                            "files": []
                        },
                        "processes": [
                            {
                                "processKey": "codex-app-server",
                                "command": {
                                    "args": ["/bin/sh", "-lc", "sleep 30"]
                                },
                                "readiness": {
                                    "type": "ws",
                                    "url": raw_url,
                                    "timeoutMs": 5000
                                },
                                "stop": {
                                    "signal": "sigterm",
                                    "timeoutMs": 10000,
                                    "gracePeriodMs": 2000
                                }
                            }
                        ],
                        "endpoints": [
                            {
                                "endpointKey": "app-server",
                                "processKey": null,
                                "transport": {
                                    "type": "ws",
                                    "url": "ws://127.0.0.1:0/codex"
                                },
                                "connectionMode": "dedicated"
                            }
                        ]
                    }
                ],
                "agentRuntimes": [
                    {
                        "runtimeId": "codex",
                        "runtimeKey": "codex-app-server",
                        "clientId": "codex-cli",
                        "endpointKey": "app-server",
                        "ptyLaunch": {
                            "runtimeId": "codex",
                            "displayName": "Codex",
                            "newLaunch": {
                                "ptySessionId": "pty_new",
                                "cols": 80,
                                "rows": 24,
                                "command": "codex",
                                "args": []
                            },
                            "resumeLaunch": {
                                "ptySessionId": "pty_resume",
                                "cols": 80,
                                "rows": 24,
                                "command": "codex",
                                "args": []
                            }
                        }
                    }
                ]
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let runtime_adapters = RuntimeAdapterRegistry
            .start(
                &startup_input,
                keepalive_manager.clone(),
                runtime_readiness_manager.clone(),
            )
            .expect("runtime adapters should start");
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            Some(runtime_adapters.adapters()[0].listen_url().to_string()),
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        let persisted_path = gateway_done_receiver
            .recv()
            .expect("gateway should complete the live tunnel interaction");

        tunnel_session.close();
        runtime_adapters
            .close()
            .expect("runtime adapters should stop cleanly");
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
        raw_server_thread
            .join()
            .expect("raw codex app-server thread should exit cleanly");

        if let Some(thread_dir) = PathBuf::from(&persisted_path).parent() {
            let _ = fs::remove_dir_all(thread_dir);
        }
    }

    #[test]
    fn keeps_large_agent_responses_open_when_the_response_fits_within_the_stream_window() {
        let large_response_payload = "x".repeat(std::cmp::min(
            1024 * 1024,
            AGENT_STREAM_WINDOW_BYTES.saturating_sub(2048),
        ));
        let large_response_payload_len = large_response_payload.len();

        let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
        let raw_url = format!(
            "ws://127.0.0.1:{}/raw",
            raw_listener
                .local_addr()
                .expect("raw listener should expose an address")
                .port()
        );
        let raw_server_thread = thread::spawn(move || {
            let (monitor_stream, _) = raw_listener
                .accept()
                .expect("raw app-server should accept the monitor connection");
            let mut monitor_socket =
                accept(monitor_stream).expect("monitor handshake should succeed");

            assert_eq!(
                read_json_text_message(&mut monitor_socket)["method"],
                Value::String("initialize".to_string())
            );
            monitor_socket
                .send(Message::Text(
                    json!({
                        "id": 1,
                        "result": {
                            "userAgent": "codex-app-server",
                            "codexHome": "/tmp/codex-home",
                            "platformFamily": "linux",
                            "platformOs": "linux"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("initialize response should send");
            assert_eq!(
                read_json_text_message(&mut monitor_socket)["method"],
                Value::String("initialized".to_string())
            );

            let thread_loaded_list_request = read_json_text_message(&mut monitor_socket);
            assert_eq!(
                thread_loaded_list_request["method"],
                Value::String("thread/loaded/list".to_string())
            );
            monitor_socket
                .send(Message::Text(
                    json!({
                        "id": thread_loaded_list_request["id"],
                        "result": {
                            "data": [],
                            "nextCursor": null
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("thread/loaded/list response should send");

            let (client_stream, _) = raw_listener
                .accept()
                .expect("raw app-server should accept the proxied client connection");
            let mut client_socket =
                accept(client_stream).expect("proxied client handshake should succeed");
            let proxied_request = read_json_text_message(&mut client_socket);
            client_socket
                .send(Message::Text(
                    json!({
                        "id": proxied_request["id"],
                        "result": {
                            "data": large_response_payload
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("proxied response should send");
            match client_socket.read() {
                Ok(Message::Close(_))
                | Err(WebSocketError::ConnectionClosed)
                | Err(WebSocketError::Protocol(_)) => {}
                Ok(other_message) => panic!(
                    "expected proxied client websocket to close after tunnel stream shutdown, got {other_message:?}"
                ),
                Err(error) => panic!(
                    "proxied client websocket should only end because the tunnel stream closed: {error}"
                ),
            }
        });

        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let telemetry_open = read_json_text_message(&mut websocket);
            assert_eq!(telemetry_open["type"], "telemetry.open");
            websocket
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
                let control_message = read_json_text_message(&mut websocket);
                match control_message["type"].as_str() {
                    Some("keepalive.state") => {
                        assert_eq!(control_message["active"], Value::Bool(false));
                        saw_keepalive = true;
                    }
                    Some("runtime.ready") => {
                        if control_message["ready"] == Value::Bool(true) {
                            saw_runtime_ready = true;
                        }
                    }
                    Some("operation.open") => {
                        acknowledge_operation_open(&mut websocket, &control_message);
                    }
                    other => {
                        panic!("unexpected bootstrap control message before streams: {other:?}")
                    }
                }
            }

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.open",
                        "streamId": 7,
                        "channel": {
                            "kind": "agent"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open an agent stream");
            assert_eq!(
                read_stream_text_message(&mut websocket),
                json!({
                    "type": "stream.open.ok",
                    "streamId": 7
                })
            );

            let request_id = REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
            let encoded_request = encode_stream_data_frame(
                7,
                PAYLOAD_KIND_WEBSOCKET_TEXT,
                json!({
                    "id": request_id,
                    "method": "thread/loaded/list",
                    "params": {}
                })
                .to_string()
                .as_bytes(),
            )
            .expect("agent request frame should encode");
            let request_payload_len = encoded_request.len() - 6;
            websocket
                .send(Message::Binary(encoded_request.into()))
                .expect("gateway should send agent request data");

            let request_window = read_stream_text_message(&mut websocket);
            assert_eq!(
                request_window,
                json!({
                    "type": "stream.window",
                    "streamId": 7,
                    "bytes": request_payload_len
                })
            );

            let agent_response = read_non_telemetry_binary_frame(&mut websocket);
            assert_eq!(agent_response.stream_id, 7);
            assert_eq!(agent_response.payload_kind, PAYLOAD_KIND_WEBSOCKET_TEXT);
            let decoded_payload = serde_json::from_slice::<Value>(&agent_response.payload)
                .expect("agent response should be json");
            assert_eq!(decoded_payload["id"], Value::Number(request_id.into()));
            assert_eq!(
                decoded_payload["result"]["data"]
                    .as_str()
                    .expect("agent response should include the large string")
                    .len(),
                large_response_payload_len
            );

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.close",
                        "streamId": 7
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should close the agent stream");

            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
            gateway_done_sender
                .send(())
                .expect("gateway should signal the tunnel session finished");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [
                    {
                        "clientId": "codex-cli",
                        "setup": {
                            "env": {},
                            "files": []
                        },
                        "processes": [
                            {
                                "processKey": "codex-app-server",
                                "command": {
                                    "args": ["/bin/sh", "-lc", "sleep 30"]
                                },
                                "readiness": {
                                    "type": "ws",
                                    "url": raw_url,
                                    "timeoutMs": 5000
                                },
                                "stop": {
                                    "signal": "sigterm",
                                    "timeoutMs": 10000,
                                    "gracePeriodMs": 2000
                                }
                            }
                        ],
                        "endpoints": [
                            {
                                "endpointKey": "app-server",
                                "processKey": null,
                                "transport": {
                                    "type": "ws",
                                    "url": "ws://127.0.0.1:0/codex"
                                },
                                "connectionMode": "dedicated"
                            }
                        ]
                    }
                ],
                "agentRuntimes": [
                    {
                        "runtimeId": "codex",
                        "runtimeKey": "codex-app-server",
                        "clientId": "codex-cli",
                        "endpointKey": "app-server",
                        "ptyLaunch": {
                            "runtimeId": "codex",
                            "displayName": "Codex",
                            "newLaunch": {
                                "ptySessionId": "pty_new",
                                "cols": 80,
                                "rows": 24,
                                "command": "codex",
                                "args": []
                            },
                            "resumeLaunch": {
                                "ptySessionId": "pty_resume",
                                "cols": 80,
                                "rows": 24,
                                "command": "codex",
                                "args": []
                            }
                        }
                    }
                ]
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let runtime_adapters = RuntimeAdapterRegistry
            .start(
                &startup_input,
                keepalive_manager.clone(),
                runtime_readiness_manager.clone(),
            )
            .expect("runtime adapters should start");
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            Some(runtime_adapters.adapters()[0].listen_url().to_string()),
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        gateway_done_receiver
            .recv()
            .expect("gateway should complete the large-response interaction");

        tunnel_session.close();
        runtime_adapters
            .close()
            .expect("runtime adapters should stop cleanly");
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
        raw_server_thread
            .join()
            .expect("raw codex app-server thread should exit cleanly");
    }

    #[test]
    fn drops_invalid_bootstrap_messages_and_keeps_tunnel_alive() {
        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let telemetry_open = read_json_text_message(&mut websocket);
            assert_eq!(telemetry_open["type"], "telemetry.open");
            websocket
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
            while !saw_keepalive {
                let control_message = read_json_text_message(&mut websocket);
                if control_message["type"] == Value::String("keepalive.state".to_string()) {
                    saw_keepalive = true;
                }
            }

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.reset",
                        "streamId": 99,
                        "code": "unexpected",
                        "message": "unexpected control"
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should send an unsupported bootstrap control message");
            let dropped_control_message = read_telemetry_log_line_with_event(
                &mut websocket,
                "bootstrap_control_message_dropped",
            );
            assert_eq!(
                dropped_control_message["event"],
                "bootstrap_control_message_dropped"
            );
            assert_eq!(dropped_control_message["level"], "warn");
            assert_eq!(
                dropped_control_message["message"],
                "sandboxd dropped bootstrap control message: unsupported control message type 'stream.reset'"
            );
            assert_eq!(
                dropped_control_message["reason"],
                "unsupported control message type 'stream.reset'"
            );
            websocket
                .send(Message::Binary(vec![0x01, 0x02, 0x03].into()))
                .expect("gateway should send an invalid bootstrap data frame");
            let dropped_data_frame =
                read_telemetry_log_line_with_event(&mut websocket, "bootstrap_data_frame_dropped");
            assert_eq!(dropped_data_frame["event"], "bootstrap_data_frame_dropped");
            assert_eq!(dropped_data_frame["level"], "warn");
            assert_eq!(
                dropped_data_frame["message"],
                "sandboxd dropped bootstrap data frame: data frame must be at least 6 bytes long"
            );
            assert_eq!(
                dropped_data_frame["reason"],
                "data frame must be at least 6 bytes long"
            );

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.open",
                        "streamId": 9,
                        "channel": {
                            "kind": "fileUpload",
                            "threadId": "thread_invalid_bootstrap",
                            "mimeType": "image/png",
                            "originalFilename": "image.png",
                            "sizeBytes": 8
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open a file upload stream after invalid messages");
            assert_eq!(
                read_stream_text_message(&mut websocket),
                json!({
                    "type": "stream.open.ok",
                    "streamId": 9
                })
            );

            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
            gateway_done_sender
                .send(())
                .expect("gateway should signal the tunnel session finished");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        gateway_done_receiver
            .recv()
            .expect("gateway should complete the bootstrap interaction");

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
    }

    #[test]
    fn forwards_signing_requests_over_the_bootstrap_tunnel_and_returns_gateway_results() {
        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let (gateway_close_sender, gateway_close_receiver) = mpsc::channel::<()>();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            expect_tunnel_connected_publications(&mut websocket);

            let signing_request = read_json_text_message(&mut websocket);
            assert_eq!(
                signing_request,
                json!({
                    "type": "signing.request",
                    "requestId": "sign_req_123",
                    "organizationId": "org_123",
                    "sandboxInstanceId": "sbi_tunnel_session",
                    "actingUserId": "usr_123",
                    "providerFamily": "github",
                    "format": "ssh",
                    "keyRef": "key::ssh-ed25519 AAAA",
                    "grant": "grant-token",
                    "payload": "c2lnbi1tZQ==",
                    "encoding": "base64"
                })
            );

            websocket
                .send(Message::Text(
                    json!({
                        "type": "signing.result",
                        "requestId": "sign_req_123",
                        "ok": false,
                        "code": "signing_backend_not_implemented",
                        "message": "Git signing backend is not implemented yet."
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should return a signing result");

            gateway_done_sender
                .send(())
                .expect("gateway should signal the signing result was sent");
            gateway_close_receiver
                .recv()
                .expect("gateway should wait until the signing result is observed");
            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        let signing_result = tunnel_session
            .request_signing(TunnelSigningRequest {
                request_id: "sign_req_123".to_string(),
                organization_id: "org_123".to_string(),
                sandbox_instance_id: "sbi_tunnel_session".to_string(),
                acting_user_id: "usr_123".to_string(),
                provider_family: "github".to_string(),
                format: "ssh".to_string(),
                key_ref: "key::ssh-ed25519 AAAA".to_string(),
                grant: "grant-token".to_string(),
                payload_base64: "c2lnbi1tZQ==".to_string(),
            })
            .expect("signing request should complete through the tunnel");

        assert_eq!(
            signing_result,
            TunnelSigningResponse::Failure {
                request_id: "sign_req_123".to_string(),
                code: "signing_backend_not_implemented".to_string(),
                message: "Git signing backend is not implemented yet.".to_string(),
            }
        );

        gateway_done_receiver
            .recv()
            .expect("gateway should complete the signing interaction");
        gateway_close_sender
            .send(())
            .expect("gateway should close after the signing response is observed");

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
    }

    #[test]
    fn requests_and_caches_egress_tokens_over_the_bootstrap_tunnel() {
        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let (gateway_close_sender, gateway_close_receiver) = mpsc::channel::<()>();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            expect_tunnel_connected_publications(&mut websocket);

            let token_request = read_json_text_message(&mut websocket);
            assert_eq!(
                token_request,
                json!({
                    "type": "egress.token.request",
                    "requestId": "egress_token_req_1"
                })
            );

            websocket
                .send(Message::Text(
                    json!({
                        "type": "egress.token.response",
                        "requestId": "egress_token_req_1",
                        "token": "short-lived-egress-jwt",
                        "expiresAt": "2100-01-01T00:00:00Z",
                        "ttlMs": 300000
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should return an egress token");

            gateway_done_sender
                .send(())
                .expect("gateway should signal the token response was sent");
            gateway_close_receiver
                .recv()
                .expect("gateway should wait until the cached token is observed");
            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let clock = Arc::new(SystemClock);
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            clock.clone(),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");
        let token_provider = GatewayEgressTokenProvider::new("sbi_tunnel_session");
        tunnel_session.attach_gateway_egress_token_provider(&token_provider);

        let token = token_provider
            .token()
            .expect("egress token request should complete through the tunnel");
        assert_eq!(token.token, "short-lived-egress-jwt");
        assert_eq!(token.expires_at, "2100-01-01T00:00:00Z");
        assert_eq!(token.ttl_ms, 300_000);
        gateway_done_receiver
            .recv()
            .expect("gateway should complete the egress token interaction");

        let cached_token = token_provider
            .token()
            .expect("valid cached egress token should be reused");
        assert_eq!(cached_token, token);
        gateway_close_sender
            .send(())
            .expect("gateway should close after the cached token is observed");

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
    }

    #[test]
    fn refreshes_egress_tokens_from_relative_ttl_not_expires_at_wall_time() {
        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            expect_tunnel_connected_publications(&mut websocket);

            for token_number in 1..=2 {
                let token_request = read_json_text_message(&mut websocket);
                assert_eq!(
                    token_request,
                    json!({
                        "type": "egress.token.request",
                        "requestId": format!("egress_token_req_{token_number}")
                    })
                );

                websocket
                    .send(Message::Text(
                        json!({
                            "type": "egress.token.response",
                            "requestId": format!("egress_token_req_{token_number}"),
                            "token": format!("short-lived-egress-jwt-{token_number}"),
                            "expiresAt": "2100-01-01T00:00:00Z",
                            "ttlMs": 1
                        })
                        .to_string()
                        .into(),
                    ))
                    .expect("gateway should return an egress token");
            }

            gateway_done_sender
                .send(())
                .expect("gateway should signal both token responses were sent");
            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let clock = Arc::new(SystemClock);
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            clock.clone(),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");
        let token_provider = GatewayEgressTokenProvider::new("sbi_tunnel_session");
        tunnel_session.attach_gateway_egress_token_provider(&token_provider);

        let first_token = token_provider
            .token()
            .expect("first egress token request should complete");
        let second_token = token_provider
            .token()
            .expect("expired relative ttl should force a second token request");
        assert_eq!(first_token.token, "short-lived-egress-jwt-1");
        assert_eq!(second_token.token, "short-lived-egress-jwt-2");
        gateway_done_receiver
            .recv()
            .expect("gateway should complete both egress token interactions");

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
    }

    #[test]
    fn operation_stream_opens_records_and_closes_over_the_reserved_stream() {
        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session?operation_id=op_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let (operation_open_sender, operation_open_receiver) = mpsc::channel::<()>();
        let (operation_record_sender, operation_record_receiver) = mpsc::channel::<()>();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let telemetry_open = read_json_text_message(&mut websocket);
            assert_eq!(telemetry_open["type"], "telemetry.open");
            websocket
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

            let operation_open = read_stream_text_message(&mut websocket);
            assert_eq!(
                operation_open,
                json!({
                    "type": "operation.open",
                    "streamId": SANDBOX_OPERATION_STREAM_ID,
                    "operationId": "op_tunnel_session",
                    "operationKind": "start",
                    "format": SANDBOX_OPERATION_STREAM_FORMAT
                })
            );
            acknowledge_operation_open(&mut websocket, &operation_open);
            operation_open_sender
                .send(())
                .expect("gateway should signal operation open acknowledgement");

            let operation_record =
                read_binary_frame_for_stream(&mut websocket, SANDBOX_OPERATION_STREAM_ID);
            assert_eq!(operation_record.stream_id, SANDBOX_OPERATION_STREAM_ID);
            assert_eq!(operation_record.payload_kind, PAYLOAD_KIND_RAW_BYTES);
            let payload = std::str::from_utf8(&operation_record.payload)
                .expect("operation record payload should be utf8");
            assert!(payload.contains(r#""kind":"lifecycle""#));
            assert!(payload.contains(r#""phase":"sandboxd""#));
            operation_record_sender
                .send(())
                .expect("gateway should signal operation record receipt");

            let operation_close = read_stream_text_message(&mut websocket);
            assert_eq!(
                operation_close,
                json!({
                    "type": "operation.close",
                    "streamId": SANDBOX_OPERATION_STREAM_ID
                })
            );

            gateway_done_sender
                .send(())
                .expect("gateway should signal the operation stream was closed");
            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };
        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start_minimal_with_supervisor(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
            test_tunnel_supervisor_handle("sbi_tunnel_session", Arc::new(PanicClock::default())),
        )
        .expect("minimal tunnel session should start");

        operation_open_receiver
            .recv()
            .expect("gateway should acknowledge the operation stream open");
        let operation_sender = tunnel_session.operation_record_sender();
        operation_sender
            .blocking_send(OperationStreamMessage::Record(
                json!({
                    "kind": "lifecycle",
                    "observedAt": "2026-05-13T00:00:00.000Z",
                    "phase": "sandboxd",
                    "status": "started",
                    "source": "sandboxd",
                    "message": "sandboxd init started",
                    "attributes": {}
                })
                .to_string()
                    + "\n",
            ))
            .expect("operation record should enqueue");
        operation_record_receiver
            .recv()
            .expect("gateway should observe the operation record");
        let (close_response_sender, close_response_receiver) = mpsc::channel();
        operation_sender
            .blocking_send(OperationStreamMessage::Close {
                response_sender: close_response_sender,
            })
            .expect("operation close should enqueue");

        gateway_done_receiver
            .recv()
            .expect("gateway should observe the operation stream close");
        close_response_receiver
            .recv()
            .expect("operation close response should be sent")
            .expect("operation close should flush");
        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
    }

    #[test]
    fn operation_stream_flushes_pending_records_before_close_after_open_ack() {
        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session?operation_id=op_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (operation_open_sender, operation_open_receiver) = mpsc::channel::<()>();
        let (ack_operation_open_sender, ack_operation_open_receiver) = mpsc::channel::<()>();
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let telemetry_open = read_json_text_message(&mut websocket);
            assert_eq!(telemetry_open["type"], "telemetry.open");
            websocket
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

            let operation_open = read_stream_text_message(&mut websocket);
            assert_eq!(operation_open["type"], "operation.open");
            operation_open_sender
                .send(())
                .expect("gateway should signal operation open");
            ack_operation_open_receiver
                .recv()
                .expect("test should allow operation open acknowledgement");
            acknowledge_operation_open(&mut websocket, &operation_open);

            let operation_record =
                read_binary_frame_for_stream(&mut websocket, SANDBOX_OPERATION_STREAM_ID);
            let payload = std::str::from_utf8(&operation_record.payload)
                .expect("operation record payload should be utf8");
            assert!(payload.contains(r#""phase":"runtime_adapters""#));

            let operation_close = read_stream_text_message(&mut websocket);
            assert_eq!(
                operation_close,
                json!({
                    "type": "operation.close",
                    "streamId": SANDBOX_OPERATION_STREAM_ID
                })
            );

            gateway_done_sender
                .send(())
                .expect("gateway should signal operation stream close");
            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };
        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start_minimal_with_supervisor(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
            test_tunnel_supervisor_handle("sbi_tunnel_session", Arc::new(PanicClock::default())),
        )
        .expect("minimal tunnel session should start");

        operation_open_receiver
            .recv()
            .expect("gateway should observe operation open");
        let operation_sender = tunnel_session.operation_record_sender();
        operation_sender
            .blocking_send(OperationStreamMessage::Record(
                json!({
                    "kind": "lifecycle",
                    "observedAt": "2026-05-13T00:00:00.000Z",
                    "phase": "runtime_adapters",
                    "status": "completed",
                    "source": "sandboxd",
                    "message": "start_runtime_adapters completed",
                    "attributes": {}
                })
                .to_string()
                    + "\n",
            ))
            .expect("operation record should enqueue before open acknowledgement");
        let (close_response_sender, close_response_receiver) = mpsc::channel();
        operation_sender
            .blocking_send(OperationStreamMessage::Close {
                response_sender: close_response_sender,
            })
            .expect("operation close should enqueue before open acknowledgement");
        ack_operation_open_sender
            .send(())
            .expect("test should allow operation open acknowledgement");

        gateway_done_receiver
            .recv()
            .expect("gateway should observe record before close");
        close_response_receiver
            .recv()
            .expect("operation close response should be sent")
            .expect("operation close should flush");
        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
    }

    #[test]
    fn returns_authorization_failures_from_gateway_signing_results() {
        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let (gateway_close_sender, gateway_close_receiver) = mpsc::channel::<()>();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            expect_tunnel_connected_publications(&mut websocket);
            let _signing_request = read_json_text_message(&mut websocket);

            websocket
                .send(Message::Text(
                    json!({
                        "type": "signing.result",
                        "requestId": "sign_req_123",
                        "ok": false,
                        "code": "invalid_grant",
                        "message": "Signing grant verification failed: token_invalid."
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should return an authorization failure");

            gateway_done_sender
                .send(())
                .expect("gateway should signal the signing result was sent");
            gateway_close_receiver
                .recv()
                .expect("gateway should wait until the signing result is observed");
            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        let signing_result = tunnel_session
            .request_signing(TunnelSigningRequest {
                request_id: "sign_req_123".to_string(),
                organization_id: "org_123".to_string(),
                sandbox_instance_id: "sbi_tunnel_session".to_string(),
                acting_user_id: "usr_123".to_string(),
                provider_family: "github".to_string(),
                format: "ssh".to_string(),
                key_ref: "key::ssh-ed25519 AAAA".to_string(),
                grant: "grant-token".to_string(),
                payload_base64: "c2lnbi1tZQ==".to_string(),
            })
            .expect("signing request should complete through the tunnel");

        assert_eq!(
            signing_result,
            TunnelSigningResponse::Failure {
                request_id: "sign_req_123".to_string(),
                code: "invalid_grant".to_string(),
                message: "Signing grant verification failed: token_invalid.".to_string(),
            }
        );

        gateway_done_receiver
            .recv()
            .expect("gateway should complete the signing interaction");
        gateway_close_sender
            .send(())
            .expect("gateway should close after the signing response is observed");

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
    }

    #[test]
    fn bootstrap_disconnect_leaves_publish_managers_disconnected_until_explicit_close() {
        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let mut saw_keepalive_state = false;
            let mut saw_runtime_ready = false;
            for _ in 0..4 {
                let message = read_json_text_message(&mut websocket);
                let message_type = message["type"]
                    .as_str()
                    .expect("tunnel text message should expose a type");
                if message_type == "keepalive.state" {
                    saw_keepalive_state = true;
                }
                if message_type == "runtime.ready" {
                    saw_runtime_ready = true;
                }
                if saw_keepalive_state && saw_runtime_ready {
                    break;
                }
            }
            assert!(
                saw_keepalive_state,
                "connected session should publish keepalive state after startup"
            );
            assert!(
                saw_runtime_ready,
                "connected session should publish runtime readiness after startup"
            );

            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
            gateway_done_sender
                .send(())
                .expect("gateway should signal the bootstrap disconnect");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager.clone(),
            runtime_readiness_manager.clone(),
            None,
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        gateway_done_receiver
            .recv()
            .expect("gateway should complete the bootstrap disconnect");
        std::thread::sleep(std::time::Duration::from_millis(50));

        {
            let mut keepalive_manager = keepalive_manager
                .lock()
                .expect("keepalive manager lock should not be poisoned");
            keepalive_manager.set_platform_active(true);
            assert!(
                keepalive_manager
                    .take_publishable_state(&SystemClock)
                    .is_none(),
                "disconnected tunnel should suppress keepalive publication"
            );
        }
        {
            let mut runtime_readiness_manager = runtime_readiness_manager
                .lock()
                .expect("runtime readiness manager lock should not be poisoned");
            runtime_readiness_manager.set_ready(true);
            assert!(
                runtime_readiness_manager.take_publishable_state().is_none(),
                "disconnected tunnel should suppress runtime readiness publication"
            );
        }

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
    }

    #[test]
    fn start_returns_error_when_initial_bootstrap_session_never_establishes() {
        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the initial bootstrap socket");
            drop(stream);
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let error = match TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        ) {
            Ok(_) => panic!("initial bootstrap websocket failure should fail start()"),
            Err(error) => error,
        };

        assert!(
            error
                .to_string()
                .contains("failed to configure bootstrap tunnel socket: bootstrap websocket failed to connect to any resolved address"),
            "start() should surface the initial websocket establishment failure"
        );
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
    }

    #[test]
    fn prioritize_ipv4_socket_addresses_sorts_ipv4_before_ipv6() {
        let addresses = vec![
            "[2606:4700:3031::ac43:8542]:443"
                .parse()
                .expect("ipv6 address should parse"),
            "104.21.133.66:443"
                .parse()
                .expect("ipv4 address should parse"),
            "[2606:4700:3032::6815:8542]:443"
                .parse()
                .expect("second ipv6 address should parse"),
            "172.67.133.66:443"
                .parse()
                .expect("second ipv4 address should parse"),
        ];

        let prioritized = prioritize_ipv4_socket_addresses(addresses);

        assert!(prioritized[0].is_ipv4(), "first address should prefer ipv4");
        assert!(
            prioritized[1].is_ipv4(),
            "second address should prefer ipv4"
        );
        assert!(
            prioritized[2].is_ipv6(),
            "third address should fall back to ipv6"
        );
        assert!(
            prioritized[3].is_ipv6(),
            "fourth address should fall back to ipv6"
        );
    }

    #[test]
    fn tunnel_exchange_url_preserves_gateway_query_parameters() {
        let exchange_url = resolve_tunnel_exchange_url(
            "ws://127.0.0.1:5202/tunnel/sandbox/sbi_123?x-mistle-test-environment-id=test_env_123",
        )
        .expect("tunnel exchange URL should be derivable");

        assert_eq!(
            exchange_url,
            "http://127.0.0.1:5202/tunnel/sandbox/sbi_123/token-exchange?x-mistle-test-environment-id=test_env_123"
        );
    }

    #[test]
    fn derives_transparent_passthrough_socket_mark_for_bootstrap_tunnel() {
        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token".to_string(),
            tunnel_gateway_ws_url: "wss://gateway.example.test/tunnel/sandbox/sbi_123".to_string(),
            acting_user_id: None,
            runtime_plan: json!({}),
            git_identity: None,
            transparent_proxy: Some(TransparentProxyConfiguration {
                passthrough_bypass: TransparentProxyBypass {
                    kind: TransparentProxyBypassKind::SocketMark,
                    mark: 38_514,
                },
                exclusions: Vec::new(),
            }),
        };

        assert_eq!(
            startup_transparent_passthrough_socket_mark(&startup_input),
            Some(38_514)
        );
    }

    #[test]
    fn reconnects_after_bootstrap_websocket_loss_and_rolls_exchange_token_forward() {
        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_port = bootstrap_listener
            .local_addr()
            .expect("bootstrap listener should expose an address")
            .port();
        let bootstrap_url = format!(
            "ws://127.0.0.1:{bootstrap_port}/tunnel/sandbox/sbi_tunnel_session?x-mistle-test-environment-id=test_env_reconnect"
        );
        let (gateway_ready_sender, gateway_ready_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (initial_stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the initial bootstrap websocket");
            let (mut initial_websocket, initial_request_uri) =
                accept_bootstrap_websocket(initial_stream);
            assert!(
                initial_request_uri.contains("bootstrap_token=bootstrap-token-initial"),
                "initial bootstrap websocket should include the startup bootstrap token"
            );
            assert!(
                initial_request_uri.contains("x-mistle-test-environment-id=test_env_reconnect"),
                "initial bootstrap websocket should preserve gateway query parameters"
            );
            expect_tunnel_connected_publications(&mut initial_websocket);
            initial_websocket
                .close(None)
                .expect("gateway should close the initial websocket");

            let (mut first_exchange_stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the first token exchange request");
            let first_exchange_request = read_http_request(&mut first_exchange_stream);
            assert!(
                first_exchange_request.starts_with(
                    "POST /tunnel/sandbox/sbi_tunnel_session/token-exchange?x-mistle-test-environment-id=test_env_reconnect HTTP/1.1",
                )
            );
            assert_http_bearer_token(&first_exchange_request, "exchange-token-initial");
            assert_http_header(&first_exchange_request, "content-length", "0");
            write_http_json_response(
                &mut first_exchange_stream,
                200,
                &json!({
                    "bootstrapToken": "bootstrap-token-reconnect-1",
                    "tunnelExchangeToken": "exchange-token-reconnect-1"
                }),
            );

            let (reconnect_stream_one, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the first reconnect websocket");
            let (mut reconnect_websocket_one, reconnect_request_uri_one) =
                accept_bootstrap_websocket(reconnect_stream_one);
            assert!(
                reconnect_request_uri_one.contains("bootstrap_token=bootstrap-token-reconnect-1"),
                "first reconnect websocket should use the exchanged bootstrap token"
            );
            assert!(
                reconnect_request_uri_one
                    .contains("x-mistle-test-environment-id=test_env_reconnect"),
                "first reconnect websocket should preserve gateway query parameters"
            );
            expect_tunnel_connected_publications(&mut reconnect_websocket_one);
            reconnect_websocket_one
                .close(None)
                .expect("gateway should close the first reconnect websocket");

            let (mut second_exchange_stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the second token exchange request");
            let second_exchange_request = read_http_request(&mut second_exchange_stream);
            assert!(
                second_exchange_request.starts_with(
                    "POST /tunnel/sandbox/sbi_tunnel_session/token-exchange?x-mistle-test-environment-id=test_env_reconnect HTTP/1.1",
                )
            );
            assert_http_bearer_token(&second_exchange_request, "exchange-token-reconnect-1");
            assert_http_header(&second_exchange_request, "content-length", "0");
            write_http_json_response(
                &mut second_exchange_stream,
                200,
                &json!({
                    "bootstrapToken": "bootstrap-token-reconnect-2",
                    "tunnelExchangeToken": "exchange-token-reconnect-2"
                }),
            );

            let (reconnect_stream_two, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the second reconnect websocket");
            let (mut reconnect_websocket_two, reconnect_request_uri_two) =
                accept_bootstrap_websocket(reconnect_stream_two);
            assert!(
                reconnect_request_uri_two.contains("bootstrap_token=bootstrap-token-reconnect-2"),
                "second reconnect websocket should use the rolled bootstrap token"
            );
            assert!(
                reconnect_request_uri_two
                    .contains("x-mistle-test-environment-id=test_env_reconnect"),
                "second reconnect websocket should preserve gateway query parameters"
            );
            expect_tunnel_connected_publications(&mut reconnect_websocket_two);
            gateway_ready_sender
                .send(())
                .expect("gateway should report the second reconnect is established");

            loop {
                match reconnect_websocket_two.read() {
                    Ok(Message::Text(payload)) => {
                        let message: Value = serde_json::from_str(payload.as_str())
                            .expect("shutdown control payload should be valid json");
                        assert_eq!(message["type"], "telemetry.close");
                    }
                    Ok(Message::Binary(payload))
                        if decode_telemetry_data_frame(payload.as_ref()).is_ok() => {}
                    Ok(Message::Close(_))
                    | Err(WebSocketError::ConnectionClosed)
                    | Err(WebSocketError::Protocol(_)) => break,
                    Ok(other) => panic!(
                        "expected tunnel_session.close() to end the second reconnect websocket, got {other:?}"
                    ),
                    Err(error) => panic!(
                        "expected tunnel_session.close() to end the second reconnect websocket: {error}"
                    ),
                }
            }
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-initial".to_string(),
            tunnel_exchange_token: "exchange-token-initial".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        gateway_ready_receiver
            .recv()
            .expect("gateway should observe the second reconnect");

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
    }

    #[test]
    fn post_startup_panic_marks_restart_required_and_startup_completed() {
        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_port = bootstrap_listener
            .local_addr()
            .expect("bootstrap listener should expose an address")
            .port();
        let bootstrap_url =
            format!("ws://127.0.0.1:{bootstrap_port}/tunnel/sandbox/sbi_tunnel_session");
        let (initial_connected_sender, initial_connected_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (initial_stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the initial bootstrap websocket");
            let (mut initial_websocket, _) = accept_bootstrap_websocket(initial_stream);
            expect_tunnel_connected_publications(&mut initial_websocket);
            initial_connected_sender
                .send(())
                .expect("gateway should report the initial connected session is established");
            initial_websocket
                .get_mut()
                .set_read_timeout(Some(std::time::Duration::from_millis(250)))
                .expect("bootstrap websocket should accept a read timeout");
            match initial_websocket.read() {
                Ok(Message::Close(_))
                | Err(WebSocketError::ConnectionClosed)
                | Err(WebSocketError::Protocol(_)) => {}
                Err(WebSocketError::Io(error))
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) => {}
                Ok(other) => panic!(
                    "expected the post-startup panic session to end the bootstrap websocket, got {other:?}"
                ),
                Err(error) => panic!(
                    "expected the post-startup panic session to end the bootstrap websocket: {error}"
                ),
            }
        });

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let panic_clock = Arc::new(PanicClock::default());
        let shutdown_requested = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let supervisor_handle =
            test_tunnel_supervisor_handle("sbi_tunnel_session", panic_clock.clone());
        let runtime = TunnelSessionRuntime {
            keepalive_manager,
            runtime_readiness_manager,
            connection_state: Arc::new(RwLock::new(TunnelSessionRuntimeConnectionState {
                agent_endpoint_url: None,
                runtime_env: BTreeMap::new(),
            })),
            cgroup_root: PathBuf::from(crate::cgroups::DEFAULT_CGROUP_ROOT),
            attachment_root: PathBuf::from(DEFAULT_ATTACHMENT_ROOT),
            sandbox_instance_id: "sbi_tunnel_session".to_string(),
            gateway_ws_url: bootstrap_url.clone(),
            operation_id: None,
            operation_kind: "start",
            transparent_passthrough_socket_mark: None,
            shutdown_requested,
            clock: panic_clock.clone(),
            sleeper: Arc::new(ThreadSleeper),
            supervisor_handle,
        };
        let connected_url = resolve_bootstrap_tunnel_url(&bootstrap_url, "bootstrap-token-initial")
            .expect("bootstrap websocket URL should be derivable");
        let runtime_builder = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test tokio runtime should build");
        let (startup_result_sender, startup_result_receiver) =
            std::sync::mpsc::channel::<Result<(), TunnelSessionError>>();
        let session_result = runtime_builder.block_on(async {
            let (bootstrap_socket, _) = connect_bootstrap_websocket(connected_url.as_str(), None)
                .await
                .expect("bootstrap websocket should connect");
            let (_request_sender, mut request_receiver) = tokio::sync::mpsc::unbounded_channel();
            let panic_clock = panic_clock.clone();
            let ready_thread = thread::spawn(move || {
                initial_connected_receiver
                    .recv()
                    .expect("gateway should observe the initial connected session");
                panic_clock.request_panic();
            });
            let session_result = run_connected_tunnel_session_catching_panics(
                &runtime,
                bootstrap_socket,
                &mut request_receiver,
                Some(&startup_result_sender),
            )
            .await;
            ready_thread
                .join()
                .expect("ready-thread should exit cleanly");
            session_result
        });

        assert!(
            startup_result_receiver
                .recv()
                .expect("connected session should report the initial startup result")
                .is_ok(),
            "post-startup panic should not retroactively fail initial startup"
        );
        assert!(
            matches!(
                session_result.outcome,
                ConnectedTunnelSessionOutcome::RestartRequired
            ),
            "post-startup panic should request a reconnect"
        );
        assert!(
            session_result.startup_completed,
            "post-startup panic should preserve the successful startup completion signal"
        );
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
    }

    #[test]
    fn retries_when_token_exchange_response_body_read_fails() {
        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_port = bootstrap_listener
            .local_addr()
            .expect("bootstrap listener should expose an address")
            .port();
        let bootstrap_url =
            format!("ws://127.0.0.1:{bootstrap_port}/tunnel/sandbox/sbi_tunnel_session");
        let (gateway_ready_sender, gateway_ready_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (initial_stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the initial bootstrap websocket");
            let (mut initial_websocket, _) = accept_bootstrap_websocket(initial_stream);
            expect_tunnel_connected_publications(&mut initial_websocket);
            initial_websocket
                .close(None)
                .expect("gateway should close the initial websocket");

            let (mut first_exchange_stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the first token exchange request");
            let first_exchange_request = read_http_request(&mut first_exchange_stream);
            assert_http_bearer_token(&first_exchange_request, "exchange-token-initial");
            assert_http_header(&first_exchange_request, "content-length", "0");
            first_exchange_stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 64\r\nconnection: close\r\n\r\n{\"bootstrapToken\":\"bootstrap-token-reconnect\"",
                )
                .expect("gateway should write the truncated token exchange response");
            first_exchange_stream
                .flush()
                .expect("gateway should flush the truncated token exchange response");
            drop(first_exchange_stream);

            let (mut second_exchange_stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the retried token exchange request");
            let second_exchange_request = read_http_request(&mut second_exchange_stream);
            assert_http_bearer_token(&second_exchange_request, "exchange-token-initial");
            assert_http_header(&second_exchange_request, "content-length", "0");
            write_http_json_response(
                &mut second_exchange_stream,
                200,
                &json!({
                    "bootstrapToken": "bootstrap-token-reconnect",
                    "tunnelExchangeToken": "exchange-token-reconnect"
                }),
            );

            let (reconnect_stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the reconnect websocket");
            let (mut reconnect_websocket, reconnect_request_uri) =
                accept_bootstrap_websocket(reconnect_stream);
            assert!(
                reconnect_request_uri.contains("bootstrap_token=bootstrap-token-reconnect"),
                "reconnect websocket should use the exchanged bootstrap token after the retried token exchange"
            );
            expect_tunnel_connected_publications(&mut reconnect_websocket);
            gateway_ready_sender
                .send(())
                .expect("gateway should report the reconnect session is established");

            loop {
                match reconnect_websocket.read() {
                    Ok(Message::Text(payload)) => {
                        let message: Value = serde_json::from_str(payload.as_str())
                            .expect("shutdown control payload should be valid json");
                        assert_eq!(message["type"], "telemetry.close");
                    }
                    Ok(Message::Binary(payload))
                        if decode_telemetry_data_frame(payload.as_ref()).is_ok() => {}
                    Ok(Message::Close(_))
                    | Err(WebSocketError::ConnectionClosed)
                    | Err(WebSocketError::Protocol(_)) => break,
                    Ok(other) => panic!(
                        "expected tunnel_session.close() to end the reconnect websocket after retrying the token exchange body read failure, got {other:?}"
                    ),
                    Err(error) => panic!(
                        "expected tunnel_session.close() to end the reconnect websocket after retrying the token exchange body read failure: {error}"
                    ),
                }
            }
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-initial".to_string(),
            tunnel_exchange_token: "exchange-token-initial".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        gateway_ready_receiver.recv().expect(
            "gateway should observe reconnect after retrying the token exchange body read failure",
        );

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
    }

    #[test]
    fn stops_retrying_when_token_exchange_returns_terminal_status() {
        for status_code in [401_u16, 404_u16, 409_u16] {
            let bootstrap_listener =
                TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
            let bootstrap_port = bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port();
            let bootstrap_url =
                format!("ws://127.0.0.1:{bootstrap_port}/tunnel/sandbox/sbi_tunnel_session");
            let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
            let gateway_thread = thread::spawn(move || {
                let (initial_stream, _) = bootstrap_listener
                    .accept()
                    .expect("gateway should accept the initial bootstrap websocket");
                let (mut initial_websocket, initial_request_uri) =
                    accept_bootstrap_websocket(initial_stream);
                assert!(
                    initial_request_uri.contains("bootstrap_token=bootstrap-token-initial"),
                    "initial bootstrap websocket should include the startup bootstrap token"
                );
                expect_tunnel_connected_publications(&mut initial_websocket);
                initial_websocket
                    .close(None)
                    .expect("gateway should close the initial websocket");

                let (mut exchange_stream, _) = bootstrap_listener
                    .accept()
                    .expect("gateway should accept the terminal token exchange request");
                let exchange_request = read_http_request(&mut exchange_stream);
                assert!(exchange_request.starts_with(
                    "POST /tunnel/sandbox/sbi_tunnel_session/token-exchange HTTP/1.1"
                ));
                assert_http_bearer_token(&exchange_request, "exchange-token-initial");
                assert_http_header(&exchange_request, "content-length", "0");
                write_http_json_response(
                    &mut exchange_stream,
                    status_code,
                    &json!({
                        "error": format!("terminal-status-{status_code}")
                    }),
                );

                bootstrap_listener
                    .set_nonblocking(true)
                    .expect("listener should allow nonblocking terminal assertions");
                thread::sleep(std::time::Duration::from_millis(150));
                match bootstrap_listener.accept() {
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                    Ok(_) => panic!(
                        "terminal token exchange status {status_code} should prevent further reconnect attempts"
                    ),
                    Err(error) => panic!(
                        "listener should only stop further reconnects by becoming empty: {error}"
                    ),
                }
                gateway_done_sender
                    .send(())
                    .expect("gateway should report the terminal exchange case finished");
            });

            let startup_input = StartupInput {
                startup_mode: StartupMode::New,
                operation_kind: crate::protocol::startup::StartupOperationKind::Start,
                execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
                bootstrap_token: "bootstrap-token-initial".to_string(),
                tunnel_exchange_token: "exchange-token-initial".to_string(),
                tunnel_gateway_ws_url: bootstrap_url,
                acting_user_id: None,
                runtime_plan: serde_json::json!({
                    "sandboxProfileId": "sbp_123",
                    "version": 1,
                    "image": {
                        "source": "base",
                        "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                    },
                    "egressRoutes": [],
                    "artifacts": [],
                    "workspaceSources": [],
                    "runtimeClients": [],
                    "agentRuntimes": []
                }),
                git_identity: None,
                transparent_proxy: None,
            };

            let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
            let runtime_readiness_manager =
                Arc::new(Mutex::new(RuntimeReadinessManager::default()));
            let tunnel_session = TunnelSession::start(
                &startup_input,
                keepalive_manager,
                runtime_readiness_manager,
                None,
                BTreeMap::new(),
                Arc::new(SystemClock),
                Arc::new(ThreadSleeper),
            )
            .expect("tunnel session should start");

            gateway_done_receiver
                .recv()
                .expect("gateway should observe the terminal exchange response");

            tunnel_session.close();
            gateway_thread
                .join()
                .expect("gateway thread should exit cleanly");
        }
    }

    #[test]
    fn refresh_style_agent_open_cancels_slow_prior_dial() {
        let agent_listener =
            TcpListener::bind("127.0.0.1:0").expect("agent runtime listener should bind");
        let agent_url = format!(
            "ws://127.0.0.1:{}/agent",
            agent_listener
                .local_addr()
                .expect("agent listener should expose an address")
                .port()
        );
        let (first_accept_sender, first_accept_receiver) = mpsc::channel();
        let agent_server_thread = thread::spawn(move || {
            let (first_stream, _) = agent_listener
                .accept()
                .expect("agent listener should accept the first hanging connection");
            first_accept_sender
                .send(())
                .expect("agent listener should report the first accepted connection");
            let first_connection_thread = thread::spawn(move || {
                thread::sleep(std::time::Duration::from_millis(250));
                drop(first_stream);
            });

            let (second_stream, _) = agent_listener
                .accept()
                .expect("agent listener should accept the second connection");
            let mut second_socket =
                accept(second_stream).expect("second agent websocket handshake should succeed");
            match second_socket.read() {
                Ok(Message::Close(_))
                | Err(WebSocketError::ConnectionClosed)
                | Err(WebSocketError::Protocol(
                    tokio_tungstenite::tungstenite::error::ProtocolError::ResetWithoutClosingHandshake,
                )) => {}
                Ok(other_message) => panic!(
                    "expected second agent websocket to close after stream shutdown, got {other_message:?}"
                ),
                Err(error) => panic!(
                    "second agent websocket should only end because the tunnel stream closed: {error}"
                ),
            }
            first_connection_thread
                .join()
                .expect("first hanging connection thread should exit cleanly");
        });

        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let telemetry_open = read_json_text_message(&mut websocket);
            assert_eq!(telemetry_open["type"], "telemetry.open");
            websocket
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
            while !saw_keepalive {
                let control_message = read_json_text_message(&mut websocket);
                if control_message["type"] == Value::String("keepalive.state".to_string()) {
                    saw_keepalive = true;
                }
            }

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.open",
                        "streamId": 7,
                        "channel": {
                            "kind": "agent"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open the first agent stream");

            first_accept_receiver
                .recv_timeout(std::time::Duration::from_secs(1))
                .expect("gateway should observe the first agent dial before simulating refresh");

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.close",
                        "streamId": 7
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should close the first agent stream");

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.open",
                        "streamId": 8,
                        "channel": {
                            "kind": "agent"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open the second agent stream");

            websocket
                .get_mut()
                .set_read_timeout(Some(std::time::Duration::from_secs(1)))
                .expect("gateway bootstrap socket should accept a read timeout");
            assert_eq!(
                read_stream_text_message(&mut websocket),
                json!({
                    "type": "stream.open.ok",
                    "streamId": 8
                })
            );

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.close",
                        "streamId": 8
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should close the second agent stream");

            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
            gateway_done_sender
                .send(())
                .expect("gateway should signal the tunnel session finished");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            Some(agent_url),
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        gateway_done_receiver
            .recv()
            .expect("gateway should complete the bootstrap interaction");

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
        agent_server_thread
            .join()
            .expect("agent server thread should exit cleanly");
    }

    #[test]
    fn agent_dial_failure_returns_stream_open_error_without_dropping_tunnel() {
        let agent_listener =
            TcpListener::bind("127.0.0.1:0").expect("agent runtime listener should bind");
        let agent_url = format!(
            "ws://127.0.0.1:{}/agent",
            agent_listener
                .local_addr()
                .expect("agent listener should expose an address")
                .port()
        );
        let agent_server_thread = thread::spawn(move || {
            let (stream, _) = agent_listener
                .accept()
                .expect("agent listener should accept one failing connection");
            drop(stream);
        });

        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let telemetry_open = read_json_text_message(&mut websocket);
            assert_eq!(telemetry_open["type"], "telemetry.open");
            websocket
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
            while !saw_keepalive {
                let control_message = read_json_text_message(&mut websocket);
                if control_message["type"] == Value::String("keepalive.state".to_string()) {
                    saw_keepalive = true;
                }
            }

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.open",
                        "streamId": 7,
                        "channel": {
                            "kind": "agent"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open the agent stream");

            let agent_open_error = read_stream_text_message(&mut websocket);
            assert_eq!(
                agent_open_error["type"],
                Value::String("stream.open.error".to_string())
            );
            assert_eq!(agent_open_error["streamId"], Value::Number(7.into()));
            assert_eq!(
                agent_open_error["code"],
                Value::String("agent_endpoint_dial_failed".to_string())
            );

            send_websocket_ping_and_expect_pong(
                &mut websocket,
                b"bootstrap-still-open-after-agent-dial-failure",
            );

            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
            gateway_done_sender
                .send(())
                .expect("gateway should signal the tunnel session finished");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            Some(agent_url),
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        gateway_done_receiver
            .recv()
            .expect("gateway should complete the bootstrap interaction");

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
        agent_server_thread
            .join()
            .expect("agent server thread should exit cleanly");
    }

    #[test]
    fn starts_live_tunnel_session_for_exec_streams() {
        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let telemetry_open = read_json_text_message(&mut websocket);
            assert_eq!(telemetry_open["type"], "telemetry.open");
            websocket
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
            while !saw_keepalive {
                let control_message = read_json_text_message(&mut websocket);
                if control_message["type"] == Value::String("keepalive.state".to_string()) {
                    saw_keepalive = true;
                }
            }

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.open",
                        "streamId": 11,
                        "channel": {
                            "kind": "exec",
                            "command": "sh",
                            "args": ["-c", "cat"],
                            "stdin": "exec stdin\n",
                            "timeoutMs": 1000,
                            "maxOutputBytes": 4096
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open the exec stream");

            let exec_open_ok = read_stream_text_message(&mut websocket);
            assert_eq!(
                exec_open_ok["type"],
                Value::String("stream.open.ok".to_string())
            );
            assert_eq!(exec_open_ok["streamId"], Value::Number(11.into()));

            let exec_result = read_stream_text_message(&mut websocket);
            assert_eq!(
                exec_result["type"],
                Value::String("stream.event".to_string())
            );
            assert_eq!(exec_result["streamId"], Value::Number(11.into()));
            assert_eq!(
                exec_result["event"]["type"],
                Value::String("exec.result".to_string())
            );
            assert_eq!(exec_result["event"]["exitCode"], Value::Number(0.into()));
            assert_eq!(exec_result["event"]["stderr"], Value::String(String::new()));
            assert_eq!(exec_result["event"]["truncated"], Value::Bool(false));
            assert_eq!(
                exec_result["event"]["stdout"],
                Value::String("exec stdin\n".to_string())
            );

            let exec_complete = read_stream_text_message(&mut websocket);
            assert_eq!(
                exec_complete["type"],
                Value::String("stream.complete".to_string())
            );
            assert_eq!(exec_complete["streamId"], Value::Number(11.into()));

            let large_stdin = "x".repeat(1024 * 1024);
            let background_exec_started = Instant::now();
            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.open",
                        "streamId": 12,
                        "channel": {
                            "kind": "exec",
                            "command": "sh",
                            "args": ["-c", "sleep 5 >/dev/null 2>/dev/null & exit 0"],
                            "stdin": large_stdin,
                            "timeoutMs": 1000,
                            "maxOutputBytes": 4096
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open the background exec stream");

            let background_exec_open_ok = read_stream_text_message(&mut websocket);
            assert_eq!(
                background_exec_open_ok["type"],
                Value::String("stream.open.ok".to_string())
            );
            assert_eq!(
                background_exec_open_ok["streamId"],
                Value::Number(12.into())
            );

            let background_exec_result = read_stream_text_message(&mut websocket);
            assert_eq!(
                background_exec_result["type"],
                Value::String("stream.event".to_string())
            );
            assert_eq!(background_exec_result["streamId"], Value::Number(12.into()));
            assert_eq!(
                background_exec_result["event"]["type"],
                Value::String("exec.result".to_string())
            );
            assert_eq!(
                background_exec_result["event"]["exitCode"],
                Value::Number(0.into())
            );

            let background_exec_complete = read_stream_text_message(&mut websocket);
            assert_eq!(
                background_exec_complete["type"],
                Value::String("stream.complete".to_string())
            );
            assert_eq!(
                background_exec_complete["streamId"],
                Value::Number(12.into())
            );
            assert!(
                background_exec_started.elapsed() < Duration::from_secs(2),
                "exec stream should complete after the foreground command exits"
            );

            send_websocket_ping_and_expect_pong(&mut websocket, b"bootstrap-still-open-after-exec");

            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
            gateway_done_sender
                .send(())
                .expect("gateway should signal the tunnel session finished");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        gateway_done_receiver
            .recv()
            .expect("gateway should complete the bootstrap interaction");

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn starts_live_tunnel_session_for_processes_streams() {
        let listener_port = reserve_available_port();
        let server_marker = format!("mistle_processes_stream_server_{}", std::process::id());
        let idle_marker = format!("mistle_processes_stream_idle_{}", std::process::id());
        let mut server = spawn_node_fixture(
            "http-listener.js",
            &[&listener_port.to_string(), &server_marker, "0.0.0.0"],
        );
        let mut idle = spawn_node_fixture("idle-process.js", &[&idle_marker]);
        wait_until_listening(listener_port);

        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let telemetry_open = read_json_text_message(&mut websocket);
            assert_eq!(telemetry_open["type"], "telemetry.open");
            websocket
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
            while !saw_keepalive {
                let control_message = read_json_text_message(&mut websocket);
                if control_message["type"] == Value::String("keepalive.state".to_string()) {
                    saw_keepalive = true;
                }
            }

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.open",
                        "streamId": 21,
                        "channel": {
                            "kind": "processes"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open the first processes stream");
            assert_eq!(
                read_stream_text_message(&mut websocket),
                json!({
                    "type": "stream.open.ok",
                    "streamId": 21
                })
            );
            let first_snapshot = read_processes_snapshot(&mut websocket);
            assert_eq!(first_snapshot.0, 21);
            assert_processes_snapshot_contains(
                &first_snapshot.1,
                &server_marker,
                &idle_marker,
                listener_port,
            );

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.open",
                        "streamId": 22,
                        "channel": {
                            "kind": "processes"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open the second processes stream");
            assert_eq!(
                read_stream_text_message(&mut websocket),
                json!({
                    "type": "stream.open.ok",
                    "streamId": 22
                })
            );
            let second_snapshot = read_processes_snapshot_for_stream(&mut websocket, 22);
            assert_processes_snapshot_contains(
                &second_snapshot.1,
                &server_marker,
                &idle_marker,
                listener_port,
            );

            websocket
                .get_mut()
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .expect("gateway bootstrap socket should accept a read timeout");
            let periodic_snapshot_a = read_processes_snapshot(&mut websocket);
            let periodic_snapshot_b = read_processes_snapshot(&mut websocket);
            assert_eq!(
                stream_ids_from_snapshots(&[periodic_snapshot_a.0, periodic_snapshot_b.0]),
                vec![21, 22]
            );

            let refresh_payload = encode_stream_data_frame(
                21,
                PAYLOAD_KIND_WEBSOCKET_TEXT,
                json!({
                    "type": "processes.refresh"
                })
                .to_string()
                .as_bytes(),
            )
            .expect("processes.refresh frame should encode");
            let refresh_payload_len = refresh_payload.len() - 6;
            websocket
                .send(Message::Binary(refresh_payload.into()))
                .expect("gateway should send processes.refresh");
            assert_eq!(
                read_stream_text_message(&mut websocket),
                json!({
                    "type": "stream.window",
                    "streamId": 21,
                    "bytes": refresh_payload_len
                })
            );

            let refresh_snapshot_a = read_processes_snapshot(&mut websocket);
            let refresh_snapshot_b = read_processes_snapshot(&mut websocket);
            assert_eq!(
                stream_ids_from_snapshots(&[refresh_snapshot_a.0, refresh_snapshot_b.0]),
                vec![21, 22]
            );

            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
            gateway_done_sender
                .send(())
                .expect("gateway should signal the tunnel session finished");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        gateway_done_receiver
            .recv()
            .expect("gateway should complete the processes stream interaction");

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
        terminate_child(&mut server);
        terminate_child(&mut idle);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn starts_live_tunnel_session_for_ports_target_authorize() {
        let listener_port = reserve_available_port();
        let mut server = spawn_node_fixture(
            "http-ws-listener.js",
            &[&listener_port.to_string(), "authorize-http"],
        );
        wait_until_listening(listener_port);

        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let telemetry_open = read_json_text_message(&mut websocket);
            assert_eq!(telemetry_open["type"], "telemetry.open");
            websocket
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

            while read_json_text_message(&mut websocket)["type"]
                != Value::String("keepalive.state".to_string())
            {}

            websocket
                .send(Message::Text(
                    json!({
                        "type": "ports.target.authorize",
                        "requestId": "req_port_access_1",
                        "target": {
                            "kind": "port",
                            "port": listener_port
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should request exact-port authorization");

            assert_eq!(
                read_stream_text_message(&mut websocket),
                json!({
                    "type": "ports.target.authorize.result",
                    "requestId": "req_port_access_1",
                    "authorized": true,
                    "upstreamProtocol": "http",
                    "websocketCapable": true
                })
            );

            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
            gateway_done_sender
                .send(())
                .expect("gateway should signal the authorize interaction finished");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        gateway_done_receiver
            .recv()
            .expect("gateway should complete the authorize interaction");

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
        terminate_child(&mut server);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn starts_live_tunnel_session_for_ports_http_transport() {
        let listener_port = reserve_available_port();
        let fixture_marker = format!("mistle_http_transport_{}", std::process::id());
        let mut server = spawn_node_fixture(
            "http-transport-listener.js",
            &[&listener_port.to_string(), &fixture_marker],
        );
        wait_until_listening(listener_port);

        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let telemetry_open = read_json_text_message(&mut websocket);
            assert_eq!(telemetry_open["type"], "telemetry.open");
            websocket
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

            while read_json_text_message(&mut websocket)["type"]
                != Value::String("keepalive.state".to_string())
            {}

            websocket
                .send(Message::Text(
                    json!({
                        "type": "ports.http.open",
                        "streamId": 31,
                        "target": {
                            "kind": "port",
                            "port": listener_port
                        },
                        "upstreamProtocol": "http",
                        "request": {
                            "method": "POST",
                            "path": "/echo",
                            "query": "mode=full",
                            "headers": {
                                "host": [format!("127.0.0.1:{listener_port}")],
                                "content-type": ["text/plain; charset=utf-8"],
                                "x-forwarded-host": ["p-5173--sandbox.mistle.localhost"],
                                "x-forwarded-proto": ["https"],
                                "x-forwarded-port": ["443"],
                                "x-request-marker": [fixture_marker.clone()]
                            }
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open the port access http stream");
            websocket
                .send(Message::Text(
                    json!({
                        "type": "ports.http.body.chunk",
                        "streamId": 31,
                        "direction": "request",
                        "bytes": base64::engine::general_purpose::STANDARD.encode("hello from gateway"),
                        "encoding": "base64"
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should send the request body chunk");
            websocket
                .send(Message::Text(
                    json!({
                        "type": "ports.http.body.end",
                        "streamId": 31,
                        "direction": "request"
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should send the request body end");

            let response_start = read_port_access_message_for_stream(&mut websocket, 31);
            assert_eq!(response_start["type"], "ports.http.response.start");
            assert_eq!(response_start["status"], 201);
            assert_eq!(
                response_start["headers"]["content-type"],
                json!(["application/json; charset=utf-8"])
            );
            assert_eq!(
                response_start["headers"]["x-fixture"],
                json!([fixture_marker.clone()])
            );
            assert_eq!(
                response_start["headers"].get("connection"),
                None,
                "hop-by-hop response headers must be stripped before tunneling",
            );

            let mut response_body = Vec::new();
            loop {
                let message = read_port_access_message_for_stream(&mut websocket, 31);
                match message["type"].as_str() {
                    Some("ports.http.body.chunk") => {
                        response_body.extend_from_slice(&decode_port_access_body_chunk(&message));
                    }
                    Some("ports.http.body.end") => break,
                    other => panic!("unexpected port access response message: {other:?}"),
                }
            }

            let echoed_request: Value =
                serde_json::from_slice(&response_body).expect("response body should be json");
            assert_eq!(echoed_request["method"], "POST");
            assert_eq!(echoed_request["url"], "/echo?mode=full");
            assert_eq!(echoed_request["body"], "hello from gateway");
            assert_eq!(
                echoed_request["headers"]["host"],
                format!("127.0.0.1:{listener_port}")
            );
            assert_eq!(
                echoed_request["headers"]["x-forwarded-host"],
                "p-5173--sandbox.mistle.localhost"
            );
            assert_eq!(echoed_request["headers"]["x-forwarded-proto"], "https");
            assert_eq!(echoed_request["headers"]["x-forwarded-port"], "443");
            assert_eq!(
                echoed_request["headers"]["x-request-marker"],
                fixture_marker
            );

            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
            gateway_done_sender
                .send(())
                .expect("gateway should signal the http transport interaction finished");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        gateway_done_receiver
            .recv()
            .expect("gateway should complete the http transport interaction");

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
        terminate_child(&mut server);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn sends_ports_stream_error_when_http_transport_cannot_connect_upstream() {
        let listener_port = reserve_available_port();

        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let telemetry_open = read_json_text_message(&mut websocket);
            assert_eq!(telemetry_open["type"], "telemetry.open");
            websocket
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

            while read_json_text_message(&mut websocket)["type"]
                != Value::String("keepalive.state".to_string())
            {}

            websocket
                .send(Message::Text(
                    json!({
                        "type": "ports.http.open",
                        "streamId": 32,
                        "target": {
                            "kind": "port",
                            "port": listener_port
                        },
                        "upstreamProtocol": "http",
                        "request": {
                            "method": "GET",
                            "path": "/echo",
                            "headers": {
                                "host": [format!("127.0.0.1:{listener_port}")]
                            }
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open the port access http stream");
            websocket
                .send(Message::Text(
                    json!({
                        "type": "ports.http.body.end",
                        "streamId": 32,
                        "direction": "request"
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should end the empty request body");

            let error_message = read_port_access_message_for_stream(&mut websocket, 32);
            assert_eq!(error_message["type"], "ports.stream.error");
            assert_eq!(error_message["streamId"], 32);
            assert_eq!(error_message["code"], "upstream_connect_failed");
            assert!(
                error_message["message"]
                    .as_str()
                    .is_some_and(|message| !message.is_empty()),
                "connect failures should surface a non-empty error message",
            );

            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
            gateway_done_sender
                .send(())
                .expect("gateway should signal the failed http transport interaction finished");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        gateway_done_receiver
            .recv()
            .expect("gateway should complete the failed http transport interaction");

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn sends_ports_stream_error_when_http_transport_upstream_closes_mid_response() {
        let listener_port = reserve_available_port();
        let fixture_marker = format!("mistle_http_transport_close_{}", std::process::id());
        let mut server = spawn_node_fixture(
            "http-transport-listener.js",
            &[&listener_port.to_string(), &fixture_marker],
        );
        wait_until_listening(listener_port);

        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let telemetry_open = read_json_text_message(&mut websocket);
            assert_eq!(telemetry_open["type"], "telemetry.open");
            websocket
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

            while read_json_text_message(&mut websocket)["type"]
                != Value::String("keepalive.state".to_string())
            {}

            websocket
                .send(Message::Text(
                    json!({
                        "type": "ports.http.open",
                        "streamId": 33,
                        "target": {
                            "kind": "port",
                            "port": listener_port
                        },
                        "upstreamProtocol": "http",
                        "request": {
                            "method": "GET",
                            "path": "/close-early",
                            "headers": {
                                "host": [format!("127.0.0.1:{listener_port}")]
                            }
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open the port access http stream");
            websocket
                .send(Message::Text(
                    json!({
                        "type": "ports.http.body.end",
                        "streamId": 33,
                        "direction": "request"
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should end the empty request body");

            let response_start = read_port_access_message_for_stream(&mut websocket, 33);
            assert_eq!(response_start["type"], "ports.http.response.start");
            assert_eq!(response_start["status"], 200);

            loop {
                let message = read_port_access_message_for_stream(&mut websocket, 33);
                match message["type"].as_str() {
                    Some("ports.http.body.chunk") => continue,
                    Some("ports.stream.error") => {
                        assert_eq!(message["code"], "upstream_io_error");
                        break;
                    }
                    other => panic!("unexpected port access response message: {other:?}"),
                }
            }

            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
            gateway_done_sender
                .send(())
                .expect("gateway should signal the mid-response failure interaction finished");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        gateway_done_receiver
            .recv()
            .expect("gateway should complete the mid-response failure interaction");

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
        terminate_child(&mut server);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn relays_port_access_tcp_bytes_and_directional_closes() {
        let upstream_listener =
            TcpListener::bind("127.0.0.1:0").expect("upstream tcp listener should bind");
        let listener_port = upstream_listener
            .local_addr()
            .expect("upstream tcp listener should expose an address")
            .port();
        let upstream_thread = thread::spawn(move || {
            let (mut stream, _) = upstream_listener
                .accept()
                .expect("upstream tcp listener should accept one connection");
            let mut request = [0u8; 4];
            stream
                .read_exact(&mut request)
                .expect("upstream should receive tcp request bytes");
            assert_eq!(&request, b"ping");
            stream
                .write_all(b"pong")
                .expect("upstream should write tcp response bytes");
            stream
                .shutdown(std::net::Shutdown::Write)
                .expect("upstream should close tcp response direction");
            let mut trailing = Vec::new();
            stream
                .read_to_end(&mut trailing)
                .expect("upstream should observe request direction close");
            assert!(
                trailing.is_empty(),
                "gateway should not send trailing bytes"
            );
        });

        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let telemetry_open = read_json_text_message(&mut websocket);
            assert_eq!(telemetry_open["type"], "telemetry.open");
            websocket
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

            while read_json_text_message(&mut websocket)["type"]
                != Value::String("keepalive.state".to_string())
            {}

            websocket
                .send(Message::Text(
                    json!({
                        "type": "ports.tcp.open",
                        "streamId": 51,
                        "target": {
                            "kind": "port",
                            "port": listener_port
                        },
                        "upstreamProtocol": "http"
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open the port access tcp stream");

            let connected = read_port_access_message_for_stream(&mut websocket, 51);
            assert_eq!(connected["type"], "ports.tcp.connected");

            websocket
                .send(Message::Binary(
                    encode_stream_data_frame(51, PAYLOAD_KIND_RAW_BYTES, b"ping")
                        .expect("tcp request data frame should encode")
                        .into(),
                ))
                .expect("gateway should send tcp request bytes");

            let mut saw_input_window = false;
            let mut saw_response_data = false;
            while !(saw_input_window && saw_response_data) {
                match read_tunnel_message_for_stream(&mut websocket, 51) {
                    TunnelGatewayTestMessage::Text(message) => {
                        assert_eq!(message["type"], "stream.window");
                        assert_eq!(message["bytes"], 4);
                        saw_input_window = true;
                    }
                    TunnelGatewayTestMessage::Binary(frame) => {
                        assert_eq!(frame.payload_kind, PAYLOAD_KIND_RAW_BYTES);
                        assert_eq!(frame.payload, b"pong");
                        saw_response_data = true;
                    }
                }
            }

            websocket
                .send(Message::Text(
                    json!({
                        "type": "ports.tcp.close",
                        "streamId": 51,
                        "direction": "request"
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should close the tcp request direction");

            let mut saw_request_close = false;
            let mut saw_response_close = false;
            while !(saw_request_close && saw_response_close) {
                let message = read_port_access_message_for_stream(&mut websocket, 51);
                assert_eq!(message["type"], "ports.tcp.close");
                match message["direction"].as_str() {
                    Some("request") => saw_request_close = true,
                    Some("response") => saw_response_close = true,
                    other => panic!("unexpected tcp close direction: {other:?}"),
                }
            }

            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
            gateway_done_sender
                .send(())
                .expect("gateway should signal the tcp transport interaction finished");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            acting_user_id: None,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": crate::test_support::local_prepared_runtime_sandbox_base_image_ref()
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [],
                "agentRuntimes": []
            }),
            git_identity: None,
            transparent_proxy: None,
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        gateway_done_receiver
            .recv()
            .expect("gateway should complete the tcp transport interaction");

        tunnel_session.close();
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
        upstream_thread
            .join()
            .expect("upstream thread should exit cleanly");
    }

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
                Message::Binary(payload)
                    if decode_telemetry_data_frame(payload.as_ref()).is_ok() =>
                {
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
                    let message: Value = serde_json::from_str(payload.as_str())
                        .expect("text payload should be json");
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
        let payload = serde_json::from_slice::<Value>(&frame.payload)
            .expect("snapshot payload should be json");
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
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("port reservation listener should bind");
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

    fn read_telemetry_log_line_with_event<S>(
        socket: &mut WebSocket<S>,
        expected_event: &str,
    ) -> Value
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

    fn create_temp_test_dir(prefix: &str) -> PathBuf {
        let path = PathBuf::from("/tmp").join(format!(
            "sbd_{prefix}_{}_{}",
            std::process::id(),
            REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir_all(&path).expect("temp test dir should be creatable");
        path
    }
}
