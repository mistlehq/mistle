//! Shared bootstrap-tunnel stream protocol helpers.
//!
//! The gateway tunnel multiplexes several stream kinds over one websocket:
//! PTY sessions, agent-runtime websocket sessions, file uploads, and telemetry.
//! This module owns the shared parsing, validation, frame encoding, flow-control,
//! and JSON serialization used by those channel implementations.

use std::collections::BTreeMap;
use std::fmt::{self, Display};

use serde::{Deserialize, Serialize};

/// Default byte credit available for outbound stream data.
pub const DEFAULT_STREAM_WINDOW_BYTES: usize = 16 * 1024 * 1024;
/// Larger initial byte credit for bursty agent-runtime websocket output.
pub const AGENT_STREAM_WINDOW_BYTES: usize = 16 * 1024 * 1024;
/// Maximum byte credit available for outbound stream data.
pub const MAX_STREAM_WINDOW_BYTES: usize = AGENT_STREAM_WINDOW_BYTES;

/// Binary frame kind for websocket stream data.
pub const DATA_FRAME_KIND: u8 = 0x01;
/// Binary frame header length.
pub const DATA_FRAME_HEADER_LEN: usize = 6;
/// Raw byte payload kind for file upload and telemetry data.
pub const PAYLOAD_KIND_RAW_BYTES: u8 = 0x01;
/// Text websocket payload kind for proxied agent traffic.
pub const PAYLOAD_KIND_WEBSOCKET_TEXT: u8 = 0x02;
/// Binary websocket payload kind for proxied agent traffic.
pub const PAYLOAD_KIND_WEBSOCKET_BINARY: u8 = 0x03;

/// `stream.open.error` code for malformed `stream.open` requests.
pub const CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST: &str = "invalid_connect_request";
/// `stream.open.error` code for unknown channel kinds.
pub const CONNECT_ERROR_CODE_UNSUPPORTED_CHANNEL: &str = "unsupported_channel";
/// `stream.open.error` code for failed agent-endpoint websocket dials.
pub const CONNECT_ERROR_CODE_AGENT_ENDPOINT_DIAL_FAILED: &str = "agent_endpoint_dial_failed";
/// `stream.open.error` code for one-shot exec requests that cannot be started.
pub const CONNECT_ERROR_CODE_EXEC_COMMAND_START_FAILED: &str = "exec_command_start_failed";
/// `stream.open.error` code for processes streams that cannot be serviced.
pub const CONNECT_ERROR_CODE_PROCESSES_STREAM_UNAVAILABLE: &str = "processes_stream_unavailable";

/// `stream.reset` code for invalid `stream.signal` messages.
pub const STREAM_RESET_CODE_INVALID_STREAM_SIGNAL: &str = "invalid_stream_signal";
/// `stream.reset` code for invalid `stream.close` messages.
pub const STREAM_RESET_CODE_INVALID_STREAM_CLOSE: &str = "invalid_stream_close";
/// `stream.reset` code for invalid binary or control data routed to a stream.
pub const STREAM_RESET_CODE_INVALID_STREAM_DATA: &str = "invalid_stream_data";
/// `stream.reset` code for malformed `stream.window` messages.
pub const STREAM_RESET_CODE_INVALID_STREAM_WINDOW: &str = "invalid_stream_window";
/// `stream.reset` code for PTY termination failures triggered by `stream.close`.
pub const STREAM_RESET_CODE_STREAM_CLOSE_FAILED: &str = "stream_close_failed";
/// `stream.reset` code for targets that terminate before the protocol does.
pub const STREAM_RESET_CODE_TARGET_CLOSED: &str = "target_closed";
/// `stream.reset` code for outbound data that exceeds available stream credit.
pub const STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED: &str = "stream_window_exhausted";
/// `stream.reset` code for one-shot exec requests that fail after opening.
pub const STREAM_RESET_CODE_EXEC_COMMAND_FAILED: &str = "exec_command_failed";
/// `stream.reset` code for processes streams whose snapshot cannot be produced.
pub const STREAM_RESET_CODE_PROCESSES_SNAPSHOT_FAILED: &str = "processes_snapshot_failed";
/// `ports.target.authorize.result` failure reason for targets that cannot be reached.
pub const PORT_ACCESS_AUTHORIZE_REASON_PORT_UNREACHABLE: &str = "port_unreachable";
/// `ports.target.authorize.result` failure reason for reachable non-HTTP(S) targets.
pub const PORT_ACCESS_AUTHORIZE_REASON_UNSUPPORTED_PROTOCOL: &str = "unsupported_protocol";

/// `stream.reset` code for file uploads whose declared size is exceeded.
pub const FILE_UPLOAD_RESET_CODE_BYTE_COUNT_EXCEEDED: &str = "byte_count_exceeded";
/// `stream.reset` code for file uploads whose final byte count mismatches the declaration.
pub const FILE_UPLOAD_RESET_CODE_BYTE_COUNT_MISMATCH: &str = "byte_count_mismatch";
/// `stream.reset` code for unsupported uploaded image types.
pub const FILE_UPLOAD_RESET_CODE_INVALID_FILE_TYPE: &str = "invalid_file_type";
/// `stream.reset` code for declared image MIME types that do not match the content signature.
pub const FILE_UPLOAD_RESET_CODE_MIME_TYPE_MISMATCH: &str = "mime_type_mismatch";

/// Describes why one websocket stream message could not be parsed or encoded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TunnelProtocolError {
    message: String,
}

impl TunnelProtocolError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for TunnelProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for TunnelProtocolError {}

/// Agent channel payload accepted by `stream.open`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentStreamChannel {
    pub kind: String,
}

/// Processes channel payload accepted by `stream.open`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessesStreamChannel {
    pub kind: String,
}

/// File-upload channel payload accepted by `stream.open`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileUploadStreamChannel {
    pub kind: String,
    pub thread_id: String,
    pub mime_type: String,
    pub original_filename: String,
    pub size_bytes: usize,
}

/// Exec channel payload accepted by `stream.open`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecStreamChannel {
    pub kind: String,
    pub command: String,
    pub args: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub stdin: Option<String>,
    pub timeout_ms: Option<u64>,
    pub max_output_bytes: Option<usize>,
}

/// Agent `stream.open` message accepted by the relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentStreamOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub channel: AgentStreamChannel,
}

/// Processes `stream.open` message accepted by the relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessesStreamOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub channel: ProcessesStreamChannel,
}

/// File-upload `stream.open` message accepted by the relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileUploadStreamOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub channel: FileUploadStreamChannel,
}

/// Exec `stream.open` message accepted by the relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecStreamOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub channel: ExecStreamChannel,
}

/// PTY resize payload carried in `stream.signal`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PtyResizeSignal {
    #[serde(rename = "type")]
    pub signal_type: String,
    pub cols: u16,
    pub rows: u16,
}

/// PTY `stream.signal` message accepted by the relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PtyStreamSignal {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub signal: PtyResizeSignal,
}

/// `stream.close` message accepted by the tunnel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StreamClose {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
}

/// `stream.window` message accepted by the tunnel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StreamWindow {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub bytes: usize,
}

/// Stream control messages decoded from websocket text frames.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamControlMessage {
    OpenAgent(AgentStreamOpen),
    OpenProcesses(ProcessesStreamOpen),
    OpenFileUpload(FileUploadStreamOpen),
    OpenExec(ExecStreamOpen),
    Signal(PtyStreamSignal),
    Close(StreamClose),
    Window(StreamWindow),
}

/// One loopback listener attached to a running process.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessListener {
    pub port: u16,
    pub bind_address: String,
}

/// One running process plus any discovered loopback listeners.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessEntry {
    pub pid: u32,
    pub command: Option<String>,
    pub listeners: Vec<ProcessListener>,
}

/// Inbound refresh request accepted on a `processes` stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessesRefresh {
    #[serde(rename = "type")]
    pub message_type: String,
}

/// Outbound snapshot payload sent on a `processes` stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessesSnapshot {
    #[serde(rename = "type")]
    pub message_type: String,
    pub observed_at: String,
    pub processes: Vec<ProcessEntry>,
}

/// Application messages carried over a `processes` stream's text data frames.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessesStreamMessage {
    Refresh(ProcessesRefresh),
    Snapshot(ProcessesSnapshot),
}

/// Exact port target carried by `ports.*` control and transport messages.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortAccessTarget {
    pub kind: String,
    pub port: u16,
}

/// Inbound `ports.target.authorize` request from the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortsTargetAuthorize {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub target: PortAccessTarget,
}

/// Outbound successful `ports.target.authorize.result`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortsTargetAuthorizeSuccessResult {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub authorized: bool,
    pub upstream_protocol: String,
    pub websocket_capable: bool,
}

/// Outbound failed `ports.target.authorize.result`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortsTargetAuthorizeFailureResult {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub authorized: bool,
    pub reason: String,
}

/// Repeated HTTP header values carried by `ports.http.*` messages.
pub type RepeatedHeaderValues = BTreeMap<String, Vec<String>>;

/// Inbound `ports.tcp.open` request from the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortsTcpOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub target: PortAccessTarget,
    pub upstream_protocol: String,
}

/// Outbound `ports.tcp.connected` sent after the target connection is ready.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortsTcpConnected {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
}

/// Directional TCP write close.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortsTcpClose {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub direction: String,
}

/// TCP stream error message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortsTcpError {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub code: String,
    pub message: String,
}

/// Inbound `ports.http.open` request from the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortsHttpOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub target: PortAccessTarget,
    pub upstream_protocol: String,
    pub request: PortsHttpRequest,
}

/// Request metadata carried by `ports.http.open`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortsHttpRequest {
    pub method: String,
    pub path: String,
    pub query: Option<String>,
    pub headers: RepeatedHeaderValues,
}

/// Outbound `ports.http.response.start` payload sent by sandboxd.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortsHttpResponseStart {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub status: u16,
    pub headers: RepeatedHeaderValues,
}

/// One base64-encoded HTTP body chunk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortsHttpBodyChunk {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub direction: String,
    pub bytes: String,
    pub encoding: String,
}

/// One HTTP body completion signal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortsHttpBodyEnd {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub direction: String,
}

/// One semantic HTTP transport-close signal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortsStreamClose {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
}

/// One semantic HTTP transport error message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortsStreamError {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub code: String,
    pub message: String,
}

/// Inbound `ports.*` control messages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PortsControlMessage {
    TargetAuthorize(PortsTargetAuthorize),
}

/// `ports.http.*` transport messages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PortsTransportMessage {
    TcpOpen(PortsTcpOpen),
    TcpConnected(PortsTcpConnected),
    TcpClose(PortsTcpClose),
    TcpError(PortsTcpError),
    HttpOpen(PortsHttpOpen),
    HttpResponseStart(PortsHttpResponseStart),
    HttpBodyChunk(PortsHttpBodyChunk),
    HttpBodyEnd(PortsHttpBodyEnd),
    StreamClose(PortsStreamClose),
    StreamError(PortsStreamError),
}

/// PTY-specific control messages consumed by the PTY relay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtyControlMessage {
    Signal(PtyStreamSignal),
    Close(StreamClose),
    Window(StreamWindow),
}

/// `telemetry.open` message sent when a tunnel connection starts accepting log traffic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub signal: String,
    pub format: String,
}

/// `telemetry.open.ok` response from the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryOpenOk {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub initial_window_bytes: usize,
}

/// `telemetry.open.error` response from the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryOpenError {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub code: String,
    pub message: String,
}

/// `telemetry.window` response from the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryWindow {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub bytes: usize,
}

/// `telemetry.close` message sent when a tunnel connection stops accepting log traffic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryClose {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
}

/// `telemetry.reset` response from the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryReset {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub code: String,
    pub message: String,
}

/// Outbound `signing.request` payload sent from sandboxd to the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SigningRequest {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub organization_id: String,
    pub sandbox_instance_id: String,
    pub acting_user_id: String,
    pub provider_family: String,
    pub format: String,
    pub key_ref: String,
    pub grant: String,
    pub payload: String,
    pub encoding: String,
}

/// Successful `signing.result` payload sent by the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SigningSuccessResult {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub ok: bool,
    pub signature: String,
    pub encoding: String,
}

/// Failed `signing.result` payload sent by the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SigningFailureResult {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub ok: bool,
    pub code: String,
    pub message: String,
}

/// Outbound `egress.token.request` payload sent from sandboxd to the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EgressTokenRequest {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
}

/// Successful `egress.token.response` payload sent by the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EgressTokenResponse {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub token: String,
    pub expires_at: String,
    pub ttl_ms: u64,
}

/// Failed `egress.token.error` payload sent by the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EgressTokenError {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub code: String,
    pub message: String,
}

/// Egress-token control messages exchanged over the bootstrap tunnel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EgressTokenControlMessage {
    Request(EgressTokenRequest),
    Response(EgressTokenResponse),
    Error(EgressTokenError),
}

/// PTY session selection mode carried in direct PTY transport control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PtySessionLaunchMode {
    Create,
    Attach,
}

/// Direct PTY launch parameters sent over the bootstrap tunnel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PtySessionLaunch {
    pub session: PtySessionLaunchMode,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub cwd: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
}

/// Gateway command asking sandboxd to open a dedicated PTY transport websocket.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PtySessionOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub pty_session_id: String,
    pub transport_url: String,
    pub transport_token: String,
    pub launch: PtySessionLaunch,
}

/// Sandboxd acknowledgement that the PTY transport websocket has opened.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PtySessionOpened {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub pty_session_id: String,
}

/// Sandboxd failure response for a direct PTY session open command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PtySessionError {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub pty_session_id: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PtySessionOpenedResponse<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    request_id: &'a str,
    pty_session_id: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PtySessionErrorResponse<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    request_id: &'a str,
    pty_session_id: &'a str,
    code: &'a str,
    message: String,
}

/// Direct PTY control messages exchanged over the bootstrap tunnel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtySessionControlMessage {
    Open(PtySessionOpen),
    Opened(PtySessionOpened),
    Error(PtySessionError),
}

/// Signing control messages exchanged over the bootstrap tunnel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SigningControlMessage {
    Request(SigningRequest),
    ResultSuccess(SigningSuccessResult),
    ResultFailure(SigningFailureResult),
}

/// Telemetry control messages accepted by the bootstrap tunnel side of the protocol.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BootstrapTelemetryControlMessage {
    OpenOk(TelemetryOpenOk),
    OpenError(TelemetryOpenError),
    Window(TelemetryWindow),
    Reset(TelemetryReset),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StreamOpenOk<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    stream_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StreamOpenError<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    stream_id: u32,
    code: &'a str,
    message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StreamReset<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    stream_id: u32,
    code: &'a str,
    message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StreamWindowResponse<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    stream_id: u32,
    bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StreamComplete<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    stream_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PtyExitEvent<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    exit_code: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileUploadCompletedEvent<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    kind: &'a str,
    attachment_id: &'a str,
    thread_id: &'a str,
    original_filename: &'a str,
    mime_type: &'a str,
    size_bytes: usize,
    path: &'a str,
}

pub struct FileUploadCompletedEventInput<'a> {
    pub stream_id: u32,
    pub kind: &'a str,
    pub attachment_id: &'a str,
    pub thread_id: &'a str,
    pub original_filename: &'a str,
    pub mime_type: &'a str,
    pub size_bytes: usize,
    pub path: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecResultEvent<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    exit_code: i32,
    stdout: &'a str,
    stderr: &'a str,
    truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StreamEvent<'a, T> {
    #[serde(rename = "type")]
    message_type: &'a str,
    stream_id: u32,
    event: T,
}

/// One decoded binary stream data frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamDataFrame {
    pub stream_id: u32,
    pub payload_kind: u8,
    pub payload: Vec<u8>,
}

/// Stream send-window accounting for one attached websocket stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamSendWindow {
    available_bytes: usize,
}

impl Default for StreamSendWindow {
    fn default() -> Self {
        Self {
            available_bytes: DEFAULT_STREAM_WINDOW_BYTES,
        }
    }
}

impl StreamSendWindow {
    /// Creates a send window with explicit starting credit.
    pub fn new(available_bytes: usize) -> Self {
        Self { available_bytes }
    }

    /// Returns the currently available byte credit.
    pub fn available_bytes(&self) -> usize {
        self.available_bytes
    }

    /// Adds new outbound credit after the peer acknowledges consumed bytes.
    pub fn add(&mut self, bytes: usize) -> Result<(), TunnelProtocolError> {
        if bytes == 0 {
            return Err(TunnelProtocolError::new(
                "stream.window bytes must be a positive integer",
            ));
        }
        if self.available_bytes > MAX_STREAM_WINDOW_BYTES.saturating_sub(bytes) {
            return Err(TunnelProtocolError::new(format!(
                "stream.window credit exceeds configured maximum of {MAX_STREAM_WINDOW_BYTES} bytes"
            )));
        }

        self.available_bytes += bytes;
        Ok(())
    }

    /// Attempts to consume outbound credit before sending a stream data frame.
    pub fn try_consume(&mut self, bytes: usize) -> bool {
        if bytes > self.available_bytes {
            return false;
        }

        self.available_bytes -= bytes;
        true
    }
}

/// Parses one inbound stream control frame from a websocket text payload.
pub fn parse_stream_control_message(
    payload: &str,
) -> Result<StreamControlMessage, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!("control message must be valid json: {error}"))
    })?;
    let message_type = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| TunnelProtocolError::new("control message type is required"))?;

    match message_type {
        "stream.open" => {
            let channel_kind = parsed_payload
                .get("channel")
                .and_then(|channel| channel.get("kind"))
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| {
                    TunnelProtocolError::new("stream.open request channel.kind is required")
                })?;

            match channel_kind {
                "agent" => {
                    let message: AgentStreamOpen = serde_json::from_value(parsed_payload)
                        .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
                    validate_agent_stream_open(&message)?;
                    Ok(StreamControlMessage::OpenAgent(message))
                }
                "processes" => {
                    let message: ProcessesStreamOpen = serde_json::from_value(parsed_payload)
                        .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
                    validate_processes_stream_open(&message)?;
                    Ok(StreamControlMessage::OpenProcesses(message))
                }
                "fileUpload" => {
                    let message: FileUploadStreamOpen = serde_json::from_value(parsed_payload)
                        .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
                    validate_file_upload_stream_open(&message)?;
                    Ok(StreamControlMessage::OpenFileUpload(message))
                }
                "exec" => {
                    let message: ExecStreamOpen = serde_json::from_value(parsed_payload)
                        .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
                    validate_exec_stream_open(&message)?;
                    Ok(StreamControlMessage::OpenExec(message))
                }
                _ => Err(TunnelProtocolError::new(format!(
                    "stream.open request channel.kind '{channel_kind}' is not supported"
                ))),
            }
        }
        "stream.signal" => {
            let message: PtyStreamSignal = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_stream_signal(&message)?;
            Ok(StreamControlMessage::Signal(message))
        }
        "stream.close" => {
            let message: StreamClose = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_stream_close(&message)?;
            Ok(StreamControlMessage::Close(message))
        }
        "stream.window" => {
            let message: StreamWindow = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_stream_window(&message)?;
            Ok(StreamControlMessage::Window(message))
        }
        _ => Err(TunnelProtocolError::new(format!(
            "unsupported control message type '{message_type}'"
        ))),
    }
}

/// Parses one inbound PTY control frame from a websocket text payload.
pub fn parse_pty_control_message(payload: &str) -> Result<PtyControlMessage, TunnelProtocolError> {
    match parse_stream_control_message(payload)? {
        StreamControlMessage::Signal(message) => Ok(PtyControlMessage::Signal(message)),
        StreamControlMessage::Close(message) => Ok(PtyControlMessage::Close(message)),
        StreamControlMessage::Window(message) => Ok(PtyControlMessage::Window(message)),
        StreamControlMessage::OpenAgent(_)
        | StreamControlMessage::OpenProcesses(_)
        | StreamControlMessage::OpenFileUpload(_)
        | StreamControlMessage::OpenExec(_) => Err(TunnelProtocolError::new(
            "expected PTY control message, got a different channel kind",
        )),
    }
}

/// Parses one inbound `processes` stream text payload.
pub fn parse_processes_stream_message(
    payload: &str,
) -> Result<ProcessesStreamMessage, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!(
            "processes stream message must be valid json: {error}"
        ))
    })?;
    let message_type = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| TunnelProtocolError::new("processes stream message type is required"))?;

    match message_type {
        "processes.refresh" => {
            let message: ProcessesRefresh = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            Ok(ProcessesStreamMessage::Refresh(message))
        }
        "processes.snapshot" => {
            let message: ProcessesSnapshot = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            Ok(ProcessesStreamMessage::Snapshot(message))
        }
        _ => Err(TunnelProtocolError::new(format!(
            "unsupported processes stream message type '{message_type}'"
        ))),
    }
}

/// Parses one inbound `ports.*` control message.
pub fn parse_ports_control_message(
    payload: &str,
) -> Result<Option<PortsControlMessage>, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!("ports control message must be valid json: {error}"))
    })?;
    let Some(message_type) = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
    else {
        return Ok(None);
    };

    match message_type {
        "ports.target.authorize" => {
            let message: PortsTargetAuthorize = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_target_authorize(&message)?;
            Ok(Some(PortsControlMessage::TargetAuthorize(message)))
        }
        _ => Ok(None),
    }
}

/// Parses one inbound `ports.http.*` transport message.
pub fn parse_ports_transport_message(
    payload: &str,
) -> Result<Option<PortsTransportMessage>, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!(
            "ports transport message must be valid json: {error}"
        ))
    })?;
    let Some(message_type) = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
    else {
        return Ok(None);
    };

    match message_type {
        "ports.tcp.open" => {
            let message: PortsTcpOpen = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_tcp_open(&message)?;
            Ok(Some(PortsTransportMessage::TcpOpen(message)))
        }
        "ports.tcp.connected" => {
            let message: PortsTcpConnected = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_tcp_connected(&message)?;
            Ok(Some(PortsTransportMessage::TcpConnected(message)))
        }
        "ports.tcp.close" => {
            let message: PortsTcpClose = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_tcp_close(&message)?;
            Ok(Some(PortsTransportMessage::TcpClose(message)))
        }
        "ports.tcp.error" => {
            let message: PortsTcpError = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_tcp_error(&message)?;
            Ok(Some(PortsTransportMessage::TcpError(message)))
        }
        "ports.http.open" => {
            let message: PortsHttpOpen = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_http_open(&message)?;
            Ok(Some(PortsTransportMessage::HttpOpen(message)))
        }
        "ports.http.response.start" => {
            let message: PortsHttpResponseStart = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_http_response_start(&message)?;
            Ok(Some(PortsTransportMessage::HttpResponseStart(message)))
        }
        "ports.http.body.chunk" => {
            let message: PortsHttpBodyChunk = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_http_body_chunk(&message)?;
            Ok(Some(PortsTransportMessage::HttpBodyChunk(message)))
        }
        "ports.http.body.end" => {
            let message: PortsHttpBodyEnd = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_http_body_end(&message)?;
            Ok(Some(PortsTransportMessage::HttpBodyEnd(message)))
        }
        "ports.stream.close" => {
            let message: PortsStreamClose = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_stream_close(&message)?;
            Ok(Some(PortsTransportMessage::StreamClose(message)))
        }
        "ports.stream.error" => {
            let message: PortsStreamError = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_stream_error(&message)?;
            Ok(Some(PortsTransportMessage::StreamError(message)))
        }
        _ => Ok(None),
    }
}

/// Parses one inbound bootstrap telemetry control message.
pub fn parse_bootstrap_telemetry_control_message(
    payload: &str,
) -> Result<Option<BootstrapTelemetryControlMessage>, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!("control message must be valid json: {error}"))
    })?;
    let message_type = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| TunnelProtocolError::new("control message type is required"))?;

    match message_type {
        "telemetry.open.ok" => {
            let message: TelemetryOpenOk = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_telemetry_open_ok(&message)?;
            Ok(Some(BootstrapTelemetryControlMessage::OpenOk(message)))
        }
        "telemetry.open.error" => {
            let message: TelemetryOpenError = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_telemetry_open_error(&message)?;
            Ok(Some(BootstrapTelemetryControlMessage::OpenError(message)))
        }
        "telemetry.window" => {
            let message: TelemetryWindow = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_telemetry_window(&message)?;
            Ok(Some(BootstrapTelemetryControlMessage::Window(message)))
        }
        "telemetry.reset" => {
            let message: TelemetryReset = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_telemetry_reset(&message)?;
            Ok(Some(BootstrapTelemetryControlMessage::Reset(message)))
        }
        _ => Ok(None),
    }
}

/// Parses one inbound `signing.*` control message.
pub fn parse_signing_control_message(
    payload: &str,
) -> Result<Option<SigningControlMessage>, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!(
            "signing control message must be valid json: {error}"
        ))
    })?;
    let Some(message_type) = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
    else {
        return Ok(None);
    };

    match message_type {
        "signing.request" => {
            let message: SigningRequest = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_signing_request(&message)?;
            Ok(Some(SigningControlMessage::Request(message)))
        }
        "signing.result" => {
            let is_ok = parsed_payload
                .get("ok")
                .and_then(serde_json::Value::as_bool)
                .ok_or_else(|| TunnelProtocolError::new("signing.result ok flag is required"))?;

            if is_ok {
                let message: SigningSuccessResult = serde_json::from_value(parsed_payload)
                    .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
                validate_signing_success_result(&message)?;
                Ok(Some(SigningControlMessage::ResultSuccess(message)))
            } else {
                let message: SigningFailureResult = serde_json::from_value(parsed_payload)
                    .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
                validate_signing_failure_result(&message)?;
                Ok(Some(SigningControlMessage::ResultFailure(message)))
            }
        }
        _ => Ok(None),
    }
}

/// Parses one inbound `egress.token.*` control message.
pub fn parse_egress_token_control_message(
    payload: &str,
) -> Result<Option<EgressTokenControlMessage>, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!(
            "egress token control message must be valid json: {error}"
        ))
    })?;
    let Some(message_type) = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
    else {
        return Ok(None);
    };

    match message_type {
        "egress.token.request" => {
            let message: EgressTokenRequest = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_egress_token_request(&message)?;
            Ok(Some(EgressTokenControlMessage::Request(message)))
        }
        "egress.token.response" => {
            let message: EgressTokenResponse = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_egress_token_response(&message)?;
            Ok(Some(EgressTokenControlMessage::Response(message)))
        }
        "egress.token.error" => {
            let message: EgressTokenError = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_egress_token_error(&message)?;
            Ok(Some(EgressTokenControlMessage::Error(message)))
        }
        _ => Ok(None),
    }
}

/// Parses one inbound `pty.session.*` control message.
pub fn parse_pty_session_control_message(
    payload: &str,
) -> Result<Option<PtySessionControlMessage>, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!(
            "pty session control message must be valid json: {error}"
        ))
    })?;
    let Some(message_type) = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
    else {
        return Ok(None);
    };

    match message_type {
        "pty.session.open" => {
            let message: PtySessionOpen = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_pty_session_open(&message)?;
            Ok(Some(PtySessionControlMessage::Open(message)))
        }
        "pty.session.opened" => {
            let message: PtySessionOpened = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_pty_session_opened(&message)?;
            Ok(Some(PtySessionControlMessage::Opened(message)))
        }
        "pty.session.error" => {
            let message: PtySessionError = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_pty_session_error(&message)?;
            Ok(Some(PtySessionControlMessage::Error(message)))
        }
        _ => Ok(None),
    }
}

/// Encodes one outbound stream data frame for websocket binary transport.
pub fn encode_stream_data_frame(
    stream_id: u32,
    payload_kind: u8,
    payload: &[u8],
) -> Result<Vec<u8>, TunnelProtocolError> {
    validate_stream_id(stream_id)?;
    validate_payload_kind(payload_kind)?;

    let mut encoded = Vec::with_capacity(DATA_FRAME_HEADER_LEN + payload.len());
    encoded.push(DATA_FRAME_KIND);
    encoded.extend_from_slice(&stream_id.to_be_bytes());
    encoded.push(payload_kind);
    encoded.extend_from_slice(payload);
    Ok(encoded)
}

/// Decodes one inbound websocket binary stream data frame.
pub fn decode_stream_data_frame(payload: &[u8]) -> Result<StreamDataFrame, TunnelProtocolError> {
    if payload.len() < DATA_FRAME_HEADER_LEN {
        return Err(TunnelProtocolError::new(format!(
            "data frame must be at least {DATA_FRAME_HEADER_LEN} bytes long"
        )));
    }
    if payload[0] != DATA_FRAME_KIND {
        return Err(TunnelProtocolError::new(format!(
            "frameKind is not supported: {}",
            payload[0]
        )));
    }

    let stream_id = u32::from_be_bytes([payload[1], payload[2], payload[3], payload[4]]);
    validate_stream_id(stream_id)?;
    validate_payload_kind(payload[5])?;

    Ok(StreamDataFrame {
        stream_id,
        payload_kind: payload[5],
        payload: payload[DATA_FRAME_HEADER_LEN..].to_vec(),
    })
}

/// Builds one `stream.open.ok` response payload.
pub fn stream_open_ok(stream_id: u32) -> String {
    serialize_json(&StreamOpenOk {
        message_type: "stream.open.ok",
        stream_id,
    })
}

/// Builds one `stream.open.error` response payload.
pub fn stream_open_error(stream_id: u32, code: &'static str, message: impl Into<String>) -> String {
    serialize_json(&StreamOpenError {
        message_type: "stream.open.error",
        stream_id,
        code,
        message: message.into(),
    })
}

/// Builds one `stream.reset` response payload.
pub fn stream_reset(stream_id: u32, code: &'static str, message: impl Into<String>) -> String {
    serialize_json(&StreamReset {
        message_type: "stream.reset",
        stream_id,
        code,
        message: message.into(),
    })
}

/// Builds one `stream.window` response payload.
pub fn stream_window(stream_id: u32, bytes: usize) -> String {
    serialize_json(&StreamWindowResponse {
        message_type: "stream.window",
        stream_id,
        bytes,
    })
}

/// Builds one `stream.complete` response payload.
pub fn stream_complete(stream_id: u32) -> String {
    serialize_json(&StreamComplete {
        message_type: "stream.complete",
        stream_id,
    })
}

/// Builds one outbound `signing.request` payload.
pub fn signing_request(request: &SigningRequest) -> String {
    serialize_json(request)
}

/// Builds one outbound `egress.token.request` payload.
pub fn egress_token_request(request: &EgressTokenRequest) -> String {
    serialize_json(request)
}

/// Builds one successful `ports.target.authorize.result` payload.
pub fn ports_target_authorize_success_result(
    request_id: &str,
    upstream_protocol: &str,
    websocket_capable: bool,
) -> String {
    serialize_json(&PortsTargetAuthorizeSuccessResult {
        message_type: "ports.target.authorize.result".to_string(),
        request_id: request_id.to_string(),
        authorized: true,
        upstream_protocol: upstream_protocol.to_string(),
        websocket_capable,
    })
}

/// Builds one failed `ports.target.authorize.result` payload.
pub fn ports_target_authorize_failure_result(request_id: &str, reason: &str) -> String {
    serialize_json(&PortsTargetAuthorizeFailureResult {
        message_type: "ports.target.authorize.result".to_string(),
        request_id: request_id.to_string(),
        authorized: false,
        reason: reason.to_string(),
    })
}

/// Builds one `stream.event` PTY exit payload.
pub fn pty_exit_event(stream_id: u32, exit_code: i32) -> String {
    serialize_json(&StreamEvent {
        message_type: "stream.event",
        stream_id,
        event: PtyExitEvent {
            message_type: "pty.exit",
            exit_code,
        },
    })
}

/// Builds one `pty.session.opened` response payload.
pub fn pty_session_opened(request_id: &str, pty_session_id: &str) -> String {
    serialize_json(&PtySessionOpenedResponse {
        message_type: "pty.session.opened",
        request_id,
        pty_session_id,
    })
}

/// Builds one `pty.session.error` response payload.
pub fn pty_session_error(
    request_id: &str,
    pty_session_id: &str,
    code: &'static str,
    message: impl Into<String>,
) -> String {
    serialize_json(&PtySessionErrorResponse {
        message_type: "pty.session.error",
        request_id,
        pty_session_id,
        code,
        message: message.into(),
    })
}

/// Builds one `stream.event` file-upload completion payload.
pub fn file_upload_completed_event(input: FileUploadCompletedEventInput<'_>) -> String {
    serialize_json(&StreamEvent {
        message_type: "stream.event",
        stream_id: input.stream_id,
        event: FileUploadCompletedEvent {
            message_type: "fileUpload.completed",
            kind: input.kind,
            attachment_id: input.attachment_id,
            thread_id: input.thread_id,
            original_filename: input.original_filename,
            mime_type: input.mime_type,
            size_bytes: input.size_bytes,
            path: input.path,
        },
    })
}

/// Builds one `stream.event` exec result payload.
pub fn exec_result_event(
    stream_id: u32,
    exit_code: i32,
    stdout: &str,
    stderr: &str,
    truncated: bool,
) -> String {
    serialize_json(&StreamEvent {
        message_type: "stream.event",
        stream_id,
        event: ExecResultEvent {
            message_type: "exec.result",
            exit_code,
            stdout,
            stderr,
            truncated,
        },
    })
}

/// Builds one `telemetry.open` request payload.
pub fn telemetry_open(stream_id: u32, signal: &str, format: &str) -> String {
    serialize_json(&TelemetryOpen {
        message_type: "telemetry.open".to_string(),
        stream_id,
        signal: signal.to_string(),
        format: format.to_string(),
    })
}

/// Builds one `telemetry.close` request payload.
pub fn telemetry_close(stream_id: u32) -> String {
    serialize_json(&TelemetryClose {
        message_type: "telemetry.close".to_string(),
        stream_id,
    })
}

fn serialize_json<T>(value: &T) -> String
where
    T: Serialize,
{
    serde_json::to_string(value).expect("tunnel protocol payload should serialize")
}

fn validate_stream_id(stream_id: u32) -> Result<(), TunnelProtocolError> {
    if stream_id == 0 {
        return Err(TunnelProtocolError::new(
            "streamId must be an integer between 1 and 4294967295",
        ));
    }

    Ok(())
}

fn validate_payload_kind(payload_kind: u8) -> Result<(), TunnelProtocolError> {
    match payload_kind {
        PAYLOAD_KIND_RAW_BYTES | PAYLOAD_KIND_WEBSOCKET_TEXT | PAYLOAD_KIND_WEBSOCKET_BINARY => {
            Ok(())
        }
        _ => Err(TunnelProtocolError::new(format!(
            "payloadKind is not supported: {payload_kind}"
        ))),
    }
}

fn validate_agent_stream_open(message: &AgentStreamOpen) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.open" {
        return Err(TunnelProtocolError::new(
            "agent stream.open request type must be 'stream.open'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.channel.kind != "agent" {
        return Err(TunnelProtocolError::new(
            "agent stream.open request channel.kind must be 'agent'",
        ));
    }

    Ok(())
}

fn validate_processes_stream_open(
    message: &ProcessesStreamOpen,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.open" {
        return Err(TunnelProtocolError::new(
            "processes stream.open request type must be 'stream.open'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.channel.kind != "processes" {
        return Err(TunnelProtocolError::new(
            "processes stream.open request channel.kind must be 'processes'",
        ));
    }

    Ok(())
}

fn validate_file_upload_stream_open(
    message: &FileUploadStreamOpen,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.open" {
        return Err(TunnelProtocolError::new(
            "file upload stream.open request type must be 'stream.open'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.channel.kind != "fileUpload" {
        return Err(TunnelProtocolError::new(
            "file upload stream.open request channel.kind must be 'fileUpload'",
        ));
    }
    if message.channel.thread_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "file upload stream.open request channel.threadId is required",
        ));
    }
    if message.channel.mime_type.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "file upload stream.open request channel.mimeType is required",
        ));
    }
    if message.channel.original_filename.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "file upload stream.open request channel.originalFilename is required",
        ));
    }
    if message.channel.size_bytes == 0 {
        return Err(TunnelProtocolError::new(
            "file upload stream.open request channel.sizeBytes must be a positive integer",
        ));
    }

    Ok(())
}

fn validate_exec_stream_open(message: &ExecStreamOpen) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.open" {
        return Err(TunnelProtocolError::new(
            "exec stream.open request type must be 'stream.open'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.channel.kind != "exec" {
        return Err(TunnelProtocolError::new(
            "exec stream.open request channel.kind must be 'exec'",
        ));
    }
    if message.channel.command.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "exec stream.open request channel.command is required",
        ));
    }
    if let Some(args) = message.channel.args.as_ref()
        && args.iter().any(|value| value.trim().is_empty())
    {
        return Err(TunnelProtocolError::new(
            "exec stream.open request args must contain only non-empty strings",
        ));
    }
    if matches!(message.channel.timeout_ms, Some(0)) {
        return Err(TunnelProtocolError::new(
            "exec stream.open request timeoutMs must be a positive integer",
        ));
    }
    if matches!(message.channel.max_output_bytes, Some(0)) {
        return Err(TunnelProtocolError::new(
            "exec stream.open request maxOutputBytes must be a positive integer",
        ));
    }

    Ok(())
}

fn validate_stream_signal(message: &PtyStreamSignal) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.signal" {
        return Err(TunnelProtocolError::new(
            "stream.signal request type must be 'stream.signal'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.signal.signal_type != "pty.resize" {
        return Err(TunnelProtocolError::new(
            "stream.signal signal.type must be 'pty.resize'",
        ));
    }
    if message.signal.cols == 0 || message.signal.rows == 0 {
        return Err(TunnelProtocolError::new(
            "pty resize signal cols and rows must be greater than or equal to 1",
        ));
    }

    Ok(())
}

fn validate_stream_close(message: &StreamClose) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.close" {
        return Err(TunnelProtocolError::new(
            "stream.close request type must be 'stream.close'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    Ok(())
}

fn validate_stream_window(message: &StreamWindow) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.window" {
        return Err(TunnelProtocolError::new(
            "stream.window request type must be 'stream.window'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.bytes == 0 {
        return Err(TunnelProtocolError::new(
            "stream.window bytes must be a positive integer",
        ));
    }
    Ok(())
}

fn validate_port_access_target(target: &PortAccessTarget) -> Result<(), TunnelProtocolError> {
    if target.kind != "port" {
        return Err(TunnelProtocolError::new(format!(
            "ports target kind must be 'port', got '{}'",
            target.kind
        )));
    }
    if target.port == 0 {
        return Err(TunnelProtocolError::new(
            "ports target port must be greater than zero",
        ));
    }

    Ok(())
}

fn validate_ports_target_authorize(
    message: &PortsTargetAuthorize,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.target.authorize" {
        return Err(TunnelProtocolError::new(format!(
            "ports.target.authorize message type must be 'ports.target.authorize', got '{}'",
            message.message_type
        )));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "ports.target.authorize requestId is required",
        ));
    }
    validate_port_access_target(&message.target)
}

fn validate_repeated_header_values(
    headers: &RepeatedHeaderValues,
    field_name: &str,
) -> Result<(), TunnelProtocolError> {
    for header_name in headers.keys() {
        if header_name.trim().is_empty() {
            return Err(TunnelProtocolError::new(format!(
                "{field_name} header names must be non-empty",
            )));
        }
    }

    Ok(())
}

fn validate_tcp_upstream_protocol(
    message_type: &str,
    upstream_protocol: &str,
) -> Result<(), TunnelProtocolError> {
    if upstream_protocol != "http" && upstream_protocol != "https" {
        return Err(TunnelProtocolError::new(format!(
            "{message_type} upstreamProtocol must be 'http' or 'https', got '{upstream_protocol}'"
        )));
    }

    Ok(())
}

fn validate_ports_tcp_open(message: &PortsTcpOpen) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.tcp.open" {
        return Err(TunnelProtocolError::new(format!(
            "ports.tcp.open message type must be 'ports.tcp.open', got '{}'",
            message.message_type
        )));
    }
    validate_stream_id(message.stream_id)?;
    validate_port_access_target(&message.target)?;
    validate_tcp_upstream_protocol("ports.tcp.open", &message.upstream_protocol)
}

fn validate_ports_tcp_connected(message: &PortsTcpConnected) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.tcp.connected" {
        return Err(TunnelProtocolError::new(format!(
            "ports.tcp.connected message type must be 'ports.tcp.connected', got '{}'",
            message.message_type
        )));
    }
    validate_stream_id(message.stream_id)
}

fn validate_ports_tcp_close(message: &PortsTcpClose) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.tcp.close" {
        return Err(TunnelProtocolError::new(format!(
            "ports.tcp.close message type must be 'ports.tcp.close', got '{}'",
            message.message_type
        )));
    }
    validate_stream_id(message.stream_id)?;
    if message.direction != "request" && message.direction != "response" {
        return Err(TunnelProtocolError::new(format!(
            "ports.tcp.close direction must be 'request' or 'response', got '{}'",
            message.direction
        )));
    }

    Ok(())
}

fn validate_ports_tcp_error(message: &PortsTcpError) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.tcp.error" {
        return Err(TunnelProtocolError::new(format!(
            "ports.tcp.error message type must be 'ports.tcp.error', got '{}'",
            message.message_type
        )));
    }
    validate_stream_id(message.stream_id)?;
    if message.code != "upstream_connect_failed"
        && message.code != "upstream_handshake_failed"
        && message.code != "upstream_io_error"
    {
        return Err(TunnelProtocolError::new(format!(
            "ports.tcp.error code is invalid: '{}'",
            message.code
        )));
    }
    if message.message.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "ports.tcp.error message is required",
        ));
    }

    Ok(())
}

fn validate_ports_http_open(message: &PortsHttpOpen) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.http.open" {
        return Err(TunnelProtocolError::new(format!(
            "ports.http.open message type must be 'ports.http.open', got '{}'",
            message.message_type
        )));
    }
    validate_port_access_target(&message.target)?;
    validate_tcp_upstream_protocol("ports.http.open", &message.upstream_protocol)?;
    if message.request.method.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "ports.http.open request method is required",
        ));
    }
    if message.request.path.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "ports.http.open request path is required",
        ));
    }
    if message
        .request
        .query
        .as_ref()
        .is_some_and(|query| query.trim().is_empty())
    {
        return Err(TunnelProtocolError::new(
            "ports.http.open request query must be non-empty when present",
        ));
    }
    validate_repeated_header_values(&message.request.headers, "ports.http.open request")
}

fn validate_ports_http_response_start(
    message: &PortsHttpResponseStart,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.http.response.start" {
        return Err(TunnelProtocolError::new(format!(
            "ports.http.response.start message type must be 'ports.http.response.start', got '{}'",
            message.message_type
        )));
    }
    if !(200..=599).contains(&message.status) {
        return Err(TunnelProtocolError::new(
            "ports.http.response.start status must be between 200 and 599",
        ));
    }
    validate_repeated_header_values(&message.headers, "ports.http.response.start")
}

fn validate_ports_http_body_chunk(message: &PortsHttpBodyChunk) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.http.body.chunk" {
        return Err(TunnelProtocolError::new(format!(
            "ports.http.body.chunk message type must be 'ports.http.body.chunk', got '{}'",
            message.message_type
        )));
    }
    if message.direction != "request" && message.direction != "response" {
        return Err(TunnelProtocolError::new(format!(
            "ports.http.body.chunk direction must be 'request' or 'response', got '{}'",
            message.direction
        )));
    }
    if message.encoding != "base64" {
        return Err(TunnelProtocolError::new(format!(
            "ports.http.body.chunk encoding must be 'base64', got '{}'",
            message.encoding
        )));
    }

    Ok(())
}

fn validate_ports_http_body_end(message: &PortsHttpBodyEnd) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.http.body.end" {
        return Err(TunnelProtocolError::new(format!(
            "ports.http.body.end message type must be 'ports.http.body.end', got '{}'",
            message.message_type
        )));
    }
    if message.direction != "request" && message.direction != "response" {
        return Err(TunnelProtocolError::new(format!(
            "ports.http.body.end direction must be 'request' or 'response', got '{}'",
            message.direction
        )));
    }

    Ok(())
}

fn validate_ports_stream_close(message: &PortsStreamClose) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.stream.close" {
        return Err(TunnelProtocolError::new(format!(
            "ports.stream.close message type must be 'ports.stream.close', got '{}'",
            message.message_type
        )));
    }

    Ok(())
}

fn validate_ports_stream_error(message: &PortsStreamError) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.stream.error" {
        return Err(TunnelProtocolError::new(format!(
            "ports.stream.error message type must be 'ports.stream.error', got '{}'",
            message.message_type
        )));
    }
    if message.code != "upstream_connect_failed"
        && message.code != "upstream_handshake_failed"
        && message.code != "upstream_io_error"
    {
        return Err(TunnelProtocolError::new(format!(
            "ports.stream.error code is invalid: '{}'",
            message.code
        )));
    }
    if message.message.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "ports.stream.error message is required",
        ));
    }

    Ok(())
}

fn validate_telemetry_open_ok(message: &TelemetryOpenOk) -> Result<(), TunnelProtocolError> {
    if message.message_type != "telemetry.open.ok" {
        return Err(TunnelProtocolError::new(
            "telemetry.open.ok response type must be 'telemetry.open.ok'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.initial_window_bytes == 0 {
        return Err(TunnelProtocolError::new(
            "telemetry.open.ok initialWindowBytes must be a positive integer",
        ));
    }
    Ok(())
}

fn validate_telemetry_open_error(message: &TelemetryOpenError) -> Result<(), TunnelProtocolError> {
    if message.message_type != "telemetry.open.error" {
        return Err(TunnelProtocolError::new(
            "telemetry.open.error response type must be 'telemetry.open.error'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.code.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "telemetry.open.error code is required",
        ));
    }
    if message.message.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "telemetry.open.error message is required",
        ));
    }
    Ok(())
}

fn validate_telemetry_window(message: &TelemetryWindow) -> Result<(), TunnelProtocolError> {
    if message.message_type != "telemetry.window" {
        return Err(TunnelProtocolError::new(
            "telemetry.window response type must be 'telemetry.window'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.bytes == 0 {
        return Err(TunnelProtocolError::new(
            "telemetry.window bytes must be a positive integer",
        ));
    }
    Ok(())
}

fn validate_telemetry_reset(message: &TelemetryReset) -> Result<(), TunnelProtocolError> {
    if message.message_type != "telemetry.reset" {
        return Err(TunnelProtocolError::new(
            "telemetry.reset response type must be 'telemetry.reset'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.code.trim().is_empty() {
        return Err(TunnelProtocolError::new("telemetry.reset code is required"));
    }
    if message.message.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "telemetry.reset message is required",
        ));
    }
    Ok(())
}

fn validate_signing_request(message: &SigningRequest) -> Result<(), TunnelProtocolError> {
    if message.message_type != "signing.request" {
        return Err(TunnelProtocolError::new(
            "signing.request message type must be 'signing.request'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.request requestId is required",
        ));
    }
    if message.organization_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.request organizationId is required",
        ));
    }
    if message.sandbox_instance_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.request sandboxInstanceId is required",
        ));
    }
    if message.acting_user_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.request actingUserId is required",
        ));
    }
    if message.provider_family.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.request providerFamily is required",
        ));
    }
    if message.format.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.request format is required",
        ));
    }
    if message.key_ref.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.request keyRef is required",
        ));
    }
    if message.grant.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.request grant is required",
        ));
    }
    if message.encoding != "base64" {
        return Err(TunnelProtocolError::new(
            "signing.request encoding must be 'base64'",
        ));
    }
    Ok(())
}

fn validate_signing_success_result(
    message: &SigningSuccessResult,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "signing.result" {
        return Err(TunnelProtocolError::new(
            "signing.result message type must be 'signing.result'",
        ));
    }
    if !message.ok {
        return Err(TunnelProtocolError::new(
            "successful signing.result payload must set ok=true",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.result requestId is required",
        ));
    }
    if message.encoding != "base64" {
        return Err(TunnelProtocolError::new(
            "successful signing.result encoding must be 'base64'",
        ));
    }
    Ok(())
}

fn validate_signing_failure_result(
    message: &SigningFailureResult,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "signing.result" {
        return Err(TunnelProtocolError::new(
            "signing.result message type must be 'signing.result'",
        ));
    }
    if message.ok {
        return Err(TunnelProtocolError::new(
            "failed signing.result payload must set ok=false",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.result requestId is required",
        ));
    }
    if message.code.trim().is_empty() {
        return Err(TunnelProtocolError::new("signing.result code is required"));
    }
    if message.message.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.result message is required",
        ));
    }
    Ok(())
}

fn validate_egress_token_request(message: &EgressTokenRequest) -> Result<(), TunnelProtocolError> {
    if message.message_type != "egress.token.request" {
        return Err(TunnelProtocolError::new(
            "egress.token.request message type must be 'egress.token.request'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "egress.token.request requestId is required",
        ));
    }
    Ok(())
}

fn validate_egress_token_response(
    message: &EgressTokenResponse,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "egress.token.response" {
        return Err(TunnelProtocolError::new(
            "egress.token.response message type must be 'egress.token.response'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "egress.token.response requestId is required",
        ));
    }
    if message.token.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "egress.token.response token is required",
        ));
    }
    if message.expires_at.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "egress.token.response expiresAt is required",
        ));
    }
    if message.ttl_ms == 0 {
        return Err(TunnelProtocolError::new(
            "egress.token.response ttlMs must be positive",
        ));
    }
    Ok(())
}

fn validate_egress_token_error(message: &EgressTokenError) -> Result<(), TunnelProtocolError> {
    if message.message_type != "egress.token.error" {
        return Err(TunnelProtocolError::new(
            "egress.token.error message type must be 'egress.token.error'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "egress.token.error requestId is required",
        ));
    }
    if message.code != "invalid_sandbox_state" && message.code != "internal_error" {
        return Err(TunnelProtocolError::new(
            "egress.token.error code is invalid",
        ));
    }
    if message.message.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "egress.token.error message is required",
        ));
    }
    Ok(())
}

fn validate_pty_session_launch(launch: &PtySessionLaunch) -> Result<(), TunnelProtocolError> {
    if launch.cols.is_some() != launch.rows.is_some() {
        return Err(TunnelProtocolError::new(
            "pty.session.open launch cols and rows must both be provided when either is set",
        ));
    }
    if matches!(launch.cols, Some(0)) || matches!(launch.rows, Some(0)) {
        return Err(TunnelProtocolError::new(
            "pty.session.open launch cols and rows must be greater than or equal to 1",
        ));
    }
    if let Some(command) = launch.command.as_ref()
        && command.trim().is_empty()
    {
        return Err(TunnelProtocolError::new(
            "pty.session.open launch command must be a non-empty string",
        ));
    }
    if let Some(args) = launch.args.as_ref()
        && args.iter().any(|value| value.trim().is_empty())
    {
        return Err(TunnelProtocolError::new(
            "pty.session.open launch args must contain only non-empty strings",
        ));
    }

    Ok(())
}

fn validate_pty_session_open(message: &PtySessionOpen) -> Result<(), TunnelProtocolError> {
    if message.message_type != "pty.session.open" {
        return Err(TunnelProtocolError::new(
            "pty.session.open message type must be 'pty.session.open'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty.session.open requestId is required",
        ));
    }
    if message.pty_session_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty.session.open ptySessionId is required",
        ));
    }
    if !message.transport_url.starts_with("ws://") && !message.transport_url.starts_with("wss://") {
        return Err(TunnelProtocolError::new(
            "pty.session.open transportUrl must use ws or wss",
        ));
    }
    if message.transport_token.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty.session.open transportToken is required",
        ));
    }
    validate_pty_session_launch(&message.launch)?;
    Ok(())
}

fn validate_pty_session_opened(message: &PtySessionOpened) -> Result<(), TunnelProtocolError> {
    if message.message_type != "pty.session.opened" {
        return Err(TunnelProtocolError::new(
            "pty.session.opened message type must be 'pty.session.opened'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty.session.opened requestId is required",
        ));
    }
    if message.pty_session_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty.session.opened ptySessionId is required",
        ));
    }
    Ok(())
}

fn validate_pty_session_error(message: &PtySessionError) -> Result<(), TunnelProtocolError> {
    if message.message_type != "pty.session.error" {
        return Err(TunnelProtocolError::new(
            "pty.session.error message type must be 'pty.session.error'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty.session.error requestId is required",
        ));
    }
    if message.pty_session_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty.session.error ptySessionId is required",
        ));
    }
    if message.code != "transport_connect_failed"
        && message.code != "pty_create_failed"
        && message.code != "pty_attach_failed"
        && message.code != "internal_error"
    {
        return Err(TunnelProtocolError::new(
            "pty.session.error code is invalid",
        ));
    }
    if message.message.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty.session.error message is required",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::tunnel::protocol::{
        BootstrapTelemetryControlMessage, EgressTokenControlMessage, EgressTokenRequest,
        FileUploadCompletedEventInput, PAYLOAD_KIND_RAW_BYTES, PAYLOAD_KIND_WEBSOCKET_TEXT,
        ProcessesStreamMessage, PtyControlMessage, PtySessionControlMessage, SigningControlMessage,
        SigningRequest, StreamControlMessage, StreamSendWindow, decode_stream_data_frame,
        egress_token_request, encode_stream_data_frame, exec_result_event,
        file_upload_completed_event, parse_bootstrap_telemetry_control_message,
        parse_egress_token_control_message, parse_ports_control_message,
        parse_ports_transport_message, parse_processes_stream_message, parse_pty_control_message,
        parse_pty_session_control_message, parse_signing_control_message,
        parse_stream_control_message, ports_target_authorize_failure_result,
        ports_target_authorize_success_result, pty_exit_event, signing_request, stream_complete,
        stream_open_error, stream_open_ok, stream_reset, stream_window, telemetry_close,
        telemetry_open,
    };

    #[test]
    fn parses_valid_stream_opens() {
        let agent = parse_stream_control_message(
            r#"{"type":"stream.open","streamId":7,"channel":{"kind":"agent"}}"#,
        )
        .expect("agent stream.open should parse");
        assert!(matches!(agent, StreamControlMessage::OpenAgent(_)));

        let processes = parse_stream_control_message(
            r#"{"type":"stream.open","streamId":11,"channel":{"kind":"processes"}}"#,
        )
        .expect("processes stream.open should parse");
        assert!(matches!(processes, StreamControlMessage::OpenProcesses(_)));

        let upload = parse_stream_control_message(
            r#"{"type":"stream.open","streamId":7,"channel":{"kind":"fileUpload","threadId":"thread_123","mimeType":"image/png","originalFilename":"image.png","sizeBytes":8}}"#,
        )
        .expect("file upload stream.open should parse");
        assert!(matches!(upload, StreamControlMessage::OpenFileUpload(_)));

        let exec = parse_stream_control_message(
            r#"{"type":"stream.open","streamId":8,"channel":{"kind":"exec","command":"git","args":["status","--short"],"cwd":"/workspace/repo","stdin":"prompt text","timeoutMs":15000,"maxOutputBytes":65536}}"#,
        )
        .expect("exec stream.open should parse");
        assert!(matches!(exec, StreamControlMessage::OpenExec(_)));
    }

    #[test]
    fn parses_valid_pty_control_messages() {
        let message = parse_pty_control_message(
            r#"{"type":"stream.signal","streamId":7,"signal":{"type":"pty.resize","cols":80,"rows":24}}"#,
        )
        .expect("pty stream.signal should parse");

        assert!(matches!(message, PtyControlMessage::Signal(_)));
    }

    #[test]
    fn parses_valid_processes_stream_messages() {
        let refresh = parse_processes_stream_message(r#"{"type":"processes.refresh"}"#)
            .expect("processes.refresh should parse");
        assert!(matches!(refresh, ProcessesStreamMessage::Refresh(_)));

        let snapshot = parse_processes_stream_message(
            r#"{"type":"processes.snapshot","observedAt":"2026-04-10T00:00:00Z","processes":[{"pid":7,"command":"node server","listeners":[{"port":5173,"bindAddress":"127.0.0.1"}]}]}"#,
        )
        .expect("processes.snapshot should parse");
        assert!(matches!(snapshot, ProcessesStreamMessage::Snapshot(_)));
    }

    #[test]
    fn parses_valid_ports_control_messages() {
        let authorize = parse_ports_control_message(
            r#"{"type":"ports.target.authorize","requestId":"req_port_access_1","target":{"kind":"port","port":5173}}"#,
        )
        .expect("ports.target.authorize should parse");
        assert!(matches!(
            authorize,
            Some(crate::tunnel::protocol::PortsControlMessage::TargetAuthorize(_))
        ));
    }

    #[test]
    fn parses_valid_ports_tcp_transport_messages() {
        let tcp_open = parse_ports_transport_message(
            r#"{"type":"ports.tcp.open","streamId":61,"target":{"kind":"port","port":5173},"upstreamProtocol":"https"}"#,
        )
        .expect("ports.tcp.open should parse");
        assert!(matches!(
            tcp_open,
            Some(crate::tunnel::protocol::PortsTransportMessage::TcpOpen(_))
        ));

        let connected =
            parse_ports_transport_message(r#"{"type":"ports.tcp.connected","streamId":61}"#)
                .expect("ports.tcp.connected should parse");
        assert!(matches!(
            connected,
            Some(crate::tunnel::protocol::PortsTransportMessage::TcpConnected(_))
        ));

        let close = parse_ports_transport_message(
            r#"{"type":"ports.tcp.close","streamId":61,"direction":"request"}"#,
        )
        .expect("ports.tcp.close should parse");
        assert!(matches!(
            close,
            Some(crate::tunnel::protocol::PortsTransportMessage::TcpClose(_))
        ));

        let error = parse_ports_transport_message(
            r#"{"type":"ports.tcp.error","streamId":61,"code":"upstream_connect_failed","message":"target refused connection"}"#,
        )
        .expect("ports.tcp.error should parse");
        assert!(matches!(
            error,
            Some(crate::tunnel::protocol::PortsTransportMessage::TcpError(_))
        ));
    }

    #[test]
    fn rejects_invalid_ports_tcp_transport_messages() {
        let unsupported_protocol = parse_ports_transport_message(
            r#"{"type":"ports.tcp.open","streamId":61,"target":{"kind":"port","port":5173},"upstreamProtocol":"ftp"}"#,
        );
        assert!(
            unsupported_protocol
                .expect_err("unsupported protocol should fail validation")
                .to_string()
                .contains("ports.tcp.open upstreamProtocol must be 'http' or 'https'")
        );

        let invalid_target_kind = parse_ports_transport_message(
            r#"{"type":"ports.tcp.open","streamId":61,"target":{"kind":"host","port":5173},"upstreamProtocol":"http"}"#,
        );
        assert!(
            invalid_target_kind
                .expect_err("invalid target kind should fail validation")
                .to_string()
                .contains("ports target kind must be 'port'")
        );

        let invalid_target_port = parse_ports_transport_message(
            r#"{"type":"ports.tcp.open","streamId":61,"target":{"kind":"port","port":0},"upstreamProtocol":"http"}"#,
        );
        assert!(
            invalid_target_port
                .expect_err("invalid target port should fail validation")
                .to_string()
                .contains("ports target port must be greater than zero")
        );

        let invalid_direction = parse_ports_transport_message(
            r#"{"type":"ports.tcp.close","streamId":61,"direction":"both"}"#,
        );
        assert!(
            invalid_direction
                .expect_err("invalid direction should fail validation")
                .to_string()
                .contains("ports.tcp.close direction must be 'request' or 'response'")
        );
    }

    #[test]
    fn parses_valid_ports_http_transport_messages() {
        let http_open = parse_ports_transport_message(
            r#"{"type":"ports.http.open","streamId":41,"target":{"kind":"port","port":5173},"upstreamProtocol":"https","request":{"method":"GET","path":"/src/main.ts","query":"import=1","headers":{"accept":["text/plain"]}}}"#,
        )
        .expect("ports.http.open should parse");
        assert!(matches!(
            http_open,
            Some(crate::tunnel::protocol::PortsTransportMessage::HttpOpen(_))
        ));

        let response_start = parse_ports_transport_message(
            r#"{"type":"ports.http.response.start","streamId":41,"status":200,"headers":{"content-type":["text/plain"]}}"#,
        )
        .expect("ports.http.response.start should parse");
        assert!(matches!(
            response_start,
            Some(crate::tunnel::protocol::PortsTransportMessage::HttpResponseStart(_))
        ));

        let body_chunk = parse_ports_transport_message(
            r#"{"type":"ports.http.body.chunk","streamId":41,"direction":"response","bytes":"SGVsbG8=","encoding":"base64"}"#,
        )
        .expect("ports.http.body.chunk should parse");
        assert!(matches!(
            body_chunk,
            Some(crate::tunnel::protocol::PortsTransportMessage::HttpBodyChunk(_))
        ));

        let body_end = parse_ports_transport_message(
            r#"{"type":"ports.http.body.end","streamId":41,"direction":"response"}"#,
        )
        .expect("ports.http.body.end should parse");
        assert!(matches!(
            body_end,
            Some(crate::tunnel::protocol::PortsTransportMessage::HttpBodyEnd(
                _
            ))
        ));

        let stream_close =
            parse_ports_transport_message(r#"{"type":"ports.stream.close","streamId":41}"#)
                .expect("ports.stream.close should parse");
        assert!(matches!(
            stream_close,
            Some(crate::tunnel::protocol::PortsTransportMessage::StreamClose(
                _
            ))
        ));

        let stream_error = parse_ports_transport_message(
            r#"{"type":"ports.stream.error","streamId":41,"code":"upstream_io_error","message":"upstream closed early"}"#,
        )
        .expect("ports.stream.error should parse");
        assert!(matches!(
            stream_error,
            Some(crate::tunnel::protocol::PortsTransportMessage::StreamError(
                _
            ))
        ));
    }

    #[test]
    fn parses_valid_signing_control_messages() {
        let request = parse_signing_control_message(
            r#"{"type":"signing.request","requestId":"sign_req_123","organizationId":"org_123","sandboxInstanceId":"sbi_123","actingUserId":"usr_123","providerFamily":"github","format":"ssh","keyRef":"key::ssh-ed25519 AAAA","grant":"grant-token","payload":"c2lnbi1tZQ==","encoding":"base64"}"#,
        )
        .expect("signing.request should parse");
        assert!(matches!(request, Some(SigningControlMessage::Request(_))));

        let result = parse_signing_control_message(
            r#"{"type":"signing.result","requestId":"sign_req_123","ok":false,"code":"signing_backend_not_implemented","message":"Git signing backend is not implemented yet."}"#,
        )
        .expect("signing.result should parse");
        assert!(matches!(
            result,
            Some(SigningControlMessage::ResultFailure(_))
        ));
    }

    #[test]
    fn parses_valid_egress_token_control_messages() {
        let request = parse_egress_token_control_message(
            r#"{"type":"egress.token.request","requestId":"egress_token_req_123"}"#,
        )
        .expect("egress.token.request should parse");
        assert!(matches!(
            request,
            Some(EgressTokenControlMessage::Request(_))
        ));

        let response = parse_egress_token_control_message(
            r#"{"type":"egress.token.response","requestId":"egress_token_req_123","token":"jwt-token","expiresAt":"2026-05-17T00:05:00Z","ttlMs":300000}"#,
        )
        .expect("egress.token.response should parse");
        assert!(matches!(
            response,
            Some(EgressTokenControlMessage::Response(_))
        ));

        let error = parse_egress_token_control_message(
            r#"{"type":"egress.token.error","requestId":"egress_token_req_123","code":"invalid_sandbox_state","message":"Sandbox instance is not active."}"#,
        )
        .expect("egress.token.error should parse");
        assert!(matches!(error, Some(EgressTokenControlMessage::Error(_))));
    }

    #[test]
    fn rejects_invalid_egress_token_errors() {
        let invalid_code = parse_egress_token_control_message(
            r#"{"type":"egress.token.error","requestId":"egress_token_req_123","code":"not_in_contract","message":"Nope."}"#,
        );

        assert!(
            invalid_code
                .expect_err("invalid error code should fail validation")
                .to_string()
                .contains("egress.token.error code is invalid")
        );
    }

    #[test]
    fn parses_valid_pty_session_control_messages() {
        let open = parse_pty_session_control_message(
            r#"{"type":"pty.session.open","requestId":"pty_open_req_123","ptySessionId":"pty_123","transportUrl":"wss://gateway.example.com/pty","transportToken":"jwt-token","launch":{"session":"create","cols":120,"rows":40,"cwd":"/workspace/repo","command":"codex","args":["resume","thread_123"]}}"#,
        )
        .expect("pty.session.open should parse");
        assert!(matches!(open, Some(PtySessionControlMessage::Open(_))));

        let opened = parse_pty_session_control_message(
            r#"{"type":"pty.session.opened","requestId":"pty_open_req_123","ptySessionId":"pty_123"}"#,
        )
        .expect("pty.session.opened should parse");
        assert!(matches!(opened, Some(PtySessionControlMessage::Opened(_))));

        let error = parse_pty_session_control_message(
            r#"{"type":"pty.session.error","requestId":"pty_open_req_123","ptySessionId":"pty_123","code":"transport_connect_failed","message":"gateway websocket failed"}"#,
        )
        .expect("pty.session.error should parse");
        assert!(matches!(error, Some(PtySessionControlMessage::Error(_))));
    }

    #[test]
    fn rejects_invalid_pty_session_control_messages() {
        let invalid_transport_url = parse_pty_session_control_message(
            r#"{"type":"pty.session.open","requestId":"pty_open_req_123","ptySessionId":"pty_123","transportUrl":"https://gateway.example.com/pty","transportToken":"jwt-token","launch":{"session":"create","cols":120,"rows":40}}"#,
        );
        assert!(
            invalid_transport_url
                .expect_err("invalid transport url should fail validation")
                .to_string()
                .contains("pty.session.open transportUrl must use ws or wss")
        );

        let invalid_error_code = parse_pty_session_control_message(
            r#"{"type":"pty.session.error","requestId":"pty_open_req_123","ptySessionId":"pty_123","code":"not_in_contract","message":"Nope."}"#,
        );
        assert!(
            invalid_error_code
                .expect_err("invalid error code should fail validation")
                .to_string()
                .contains("pty.session.error code is invalid")
        );
    }

    #[test]
    fn round_trips_data_frames() {
        let encoded = encode_stream_data_frame(9, PAYLOAD_KIND_WEBSOCKET_TEXT, b"hello")
            .expect("frame should encode");
        let decoded = decode_stream_data_frame(&encoded).expect("frame should decode");

        assert_eq!(decoded.stream_id, 9);
        assert_eq!(decoded.payload_kind, PAYLOAD_KIND_WEBSOCKET_TEXT);
        assert_eq!(decoded.payload, b"hello");
    }

    #[test]
    fn serializes_stream_responses() {
        assert_eq!(
            stream_open_ok(7),
            r#"{"type":"stream.open.ok","streamId":7}"#
        );
        assert_eq!(
            stream_open_error(7, "invalid_connect_request", "bad request"),
            r#"{"type":"stream.open.error","streamId":7,"code":"invalid_connect_request","message":"bad request"}"#
        );
        assert_eq!(
            stream_reset(7, "target_closed", "target closed stream"),
            r#"{"type":"stream.reset","streamId":7,"code":"target_closed","message":"target closed stream"}"#
        );
        assert_eq!(
            stream_window(7, 128),
            r#"{"type":"stream.window","streamId":7,"bytes":128}"#
        );
        assert_eq!(
            stream_complete(7),
            r#"{"type":"stream.complete","streamId":7}"#
        );
        assert_eq!(
            signing_request(&SigningRequest {
                message_type: "signing.request".to_string(),
                request_id: "sign_req_123".to_string(),
                organization_id: "org_123".to_string(),
                sandbox_instance_id: "sbi_123".to_string(),
                acting_user_id: "usr_123".to_string(),
                provider_family: "github".to_string(),
                format: "ssh".to_string(),
                key_ref: "key::ssh-ed25519 AAAA".to_string(),
                grant: "grant-token".to_string(),
                payload: "c2lnbi1tZQ==".to_string(),
                encoding: "base64".to_string(),
            }),
            r#"{"type":"signing.request","requestId":"sign_req_123","organizationId":"org_123","sandboxInstanceId":"sbi_123","actingUserId":"usr_123","providerFamily":"github","format":"ssh","keyRef":"key::ssh-ed25519 AAAA","grant":"grant-token","payload":"c2lnbi1tZQ==","encoding":"base64"}"#
        );
        assert_eq!(
            egress_token_request(&EgressTokenRequest {
                message_type: "egress.token.request".to_string(),
                request_id: "egress_token_req_123".to_string(),
            }),
            r#"{"type":"egress.token.request","requestId":"egress_token_req_123"}"#
        );
        assert_eq!(
            ports_target_authorize_success_result("req_port_access_1", "https", true),
            r#"{"type":"ports.target.authorize.result","requestId":"req_port_access_1","authorized":true,"upstreamProtocol":"https","websocketCapable":true}"#
        );
        assert_eq!(
            ports_target_authorize_failure_result("req_port_access_2", "unsupported_protocol"),
            r#"{"type":"ports.target.authorize.result","requestId":"req_port_access_2","authorized":false,"reason":"unsupported_protocol"}"#
        );
        assert_eq!(
            pty_exit_event(7, 3),
            r#"{"type":"stream.event","streamId":7,"event":{"type":"pty.exit","exitCode":3}}"#
        );
        assert_eq!(
            file_upload_completed_event(FileUploadCompletedEventInput {
                stream_id: 7,
                kind: "image",
                attachment_id: "att_123",
                thread_id: "thread_123",
                original_filename: "image.png",
                mime_type: "image/png",
                size_bytes: 8,
                path: "/root/.local/attachments/thread_123/file.png",
            }),
            r#"{"type":"stream.event","streamId":7,"event":{"type":"fileUpload.completed","kind":"image","attachmentId":"att_123","threadId":"thread_123","originalFilename":"image.png","mimeType":"image/png","sizeBytes":8,"path":"/root/.local/attachments/thread_123/file.png"}}"#
        );
        assert_eq!(
            exec_result_event(9, 0, "stdout", "stderr", true),
            r#"{"type":"stream.event","streamId":9,"event":{"type":"exec.result","exitCode":0,"stdout":"stdout","stderr":"stderr","truncated":true}}"#
        );
        assert_eq!(
            telemetry_open(42, "logs", "mistle.sandbox-runtime.log.v1"),
            r#"{"type":"telemetry.open","streamId":42,"signal":"logs","format":"mistle.sandbox-runtime.log.v1"}"#
        );
        assert_eq!(
            telemetry_close(42),
            r#"{"type":"telemetry.close","streamId":42}"#
        );
    }

    #[test]
    fn serializes_ports_http_transport_messages() {
        assert_eq!(
            super::serialize_json(&super::PortsHttpOpen {
                message_type: "ports.http.open".to_string(),
                stream_id: 41,
                target: super::PortAccessTarget {
                    kind: "port".to_string(),
                    port: 5173,
                },
                upstream_protocol: "https".to_string(),
                request: super::PortsHttpRequest {
                    method: "GET".to_string(),
                    path: "/src/main.ts".to_string(),
                    query: Some("import=1".to_string()),
                    headers: std::collections::BTreeMap::from([(
                        "accept".to_string(),
                        vec!["text/plain".to_string()],
                    )]),
                },
            }),
            r#"{"type":"ports.http.open","streamId":41,"target":{"kind":"port","port":5173},"upstreamProtocol":"https","request":{"method":"GET","path":"/src/main.ts","query":"import=1","headers":{"accept":["text/plain"]}}}"#
        );
        assert_eq!(
            super::serialize_json(&super::PortsHttpResponseStart {
                message_type: "ports.http.response.start".to_string(),
                stream_id: 41,
                status: 200,
                headers: std::collections::BTreeMap::from([(
                    "content-type".to_string(),
                    vec!["text/plain".to_string()],
                )]),
            }),
            r#"{"type":"ports.http.response.start","streamId":41,"status":200,"headers":{"content-type":["text/plain"]}}"#
        );
        assert_eq!(
            super::serialize_json(&super::PortsHttpBodyChunk {
                message_type: "ports.http.body.chunk".to_string(),
                stream_id: 41,
                direction: "response".to_string(),
                bytes: "SGVsbG8=".to_string(),
                encoding: "base64".to_string(),
            }),
            r#"{"type":"ports.http.body.chunk","streamId":41,"direction":"response","bytes":"SGVsbG8=","encoding":"base64"}"#
        );
        assert_eq!(
            super::serialize_json(&super::PortsHttpBodyEnd {
                message_type: "ports.http.body.end".to_string(),
                stream_id: 41,
                direction: "response".to_string(),
            }),
            r#"{"type":"ports.http.body.end","streamId":41,"direction":"response"}"#
        );
        assert_eq!(
            super::serialize_json(&super::PortsStreamClose {
                message_type: "ports.stream.close".to_string(),
                stream_id: 41,
            }),
            r#"{"type":"ports.stream.close","streamId":41}"#
        );
        assert_eq!(
            super::serialize_json(&super::PortsStreamError {
                message_type: "ports.stream.error".to_string(),
                stream_id: 41,
                code: "upstream_io_error".to_string(),
                message: "upstream closed early".to_string(),
            }),
            r#"{"type":"ports.stream.error","streamId":41,"code":"upstream_io_error","message":"upstream closed early"}"#
        );
    }

    #[test]
    fn parses_bootstrap_telemetry_control_messages() {
        let message = parse_bootstrap_telemetry_control_message(
            r#"{"type":"telemetry.open.ok","streamId":42,"initialWindowBytes":1024}"#,
        )
        .expect("telemetry.open.ok should parse");
        assert!(matches!(
            message,
            Some(BootstrapTelemetryControlMessage::OpenOk(_))
        ));

        let non_telemetry = parse_bootstrap_telemetry_control_message(
            r#"{"type":"stream.window","streamId":42,"bytes":10}"#,
        )
        .expect("non-telemetry control message should parse");
        assert!(non_telemetry.is_none());
    }

    #[test]
    fn enforces_stream_send_window_capacity() {
        let mut window = StreamSendWindow::new(0);

        window.add(32).expect("window credit should be added");
        assert!(window.try_consume(16));
        assert_eq!(window.available_bytes(), 16);
        assert!(!window.try_consume(17));
    }

    #[test]
    fn rejects_unsupported_payload_kinds() {
        let error =
            encode_stream_data_frame(1, 9, b"x").expect_err("payload kind should be rejected");
        assert_eq!(error.to_string(), "payloadKind is not supported: 9");

        let encoded = vec![1, 0, 0, 0, 1, 9, b'x'];
        let error =
            decode_stream_data_frame(&encoded).expect_err("payload kind should be rejected");
        assert_eq!(error.to_string(), "payloadKind is not supported: 9");
    }

    #[test]
    fn preserves_raw_bytes_payload_kind() {
        let encoded = encode_stream_data_frame(2, PAYLOAD_KIND_RAW_BYTES, b"bytes")
            .expect("frame should encode");
        let decoded = decode_stream_data_frame(&encoded).expect("frame should decode");

        assert_eq!(decoded.payload_kind, PAYLOAD_KIND_RAW_BYTES);
        assert_eq!(decoded.payload, b"bytes");
    }
}
