//! Tunnel protocol constants, DTOs, and error types.
//!
//! Parsing, serialization, and validation are split into sibling modules; this
//! file contains the shared protocol vocabulary they operate on.

use super::*;

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
/// `stream.open.error` code for file-search streams that cannot be serviced.
pub const CONNECT_ERROR_CODE_FILE_SEARCH_STREAM_UNAVAILABLE: &str =
    "file_search_stream_unavailable";

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
    pub(super) fn new(message: impl Into<String>) -> Self {
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
#[serde(rename_all = "camelCase")]
pub struct AgentStreamChannel {
    pub kind: String,
}

/// Processes channel payload accepted by `stream.open`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessesStreamChannel {
    pub kind: String,
}

/// File-upload channel payload accepted by `stream.open`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileUploadStreamChannel {
    pub kind: String,
    pub thread_id: String,
    pub mime_type: String,
    pub original_filename: String,
    pub size_bytes: usize,
}

/// Exec channel payload accepted by `stream.open`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecStreamChannel {
    pub kind: String,
    pub command: String,
    pub args: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub stdin: Option<String>,
    pub timeout_ms: Option<u64>,
    pub max_output_bytes: Option<usize>,
}

/// File-search channel payload accepted by `stream.open`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchStreamChannel {
    pub kind: String,
    pub cwd: String,
}

/// Agent `stream.open` message accepted by the relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStreamOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub channel: AgentStreamChannel,
}

/// Processes `stream.open` message accepted by the relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessesStreamOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub channel: ProcessesStreamChannel,
}

/// File-upload `stream.open` message accepted by the relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileUploadStreamOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub channel: FileUploadStreamChannel,
}

/// Exec `stream.open` message accepted by the relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecStreamOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub channel: ExecStreamChannel,
}

/// File-search `stream.open` message accepted by the relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchStreamOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub channel: FileSearchStreamChannel,
}

/// PTY resize payload carried in `stream.signal`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyResizeSignal {
    #[serde(rename = "type")]
    pub signal_type: String,
    pub cols: u16,
    pub rows: u16,
}

/// PTY `stream.signal` message accepted by the relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyStreamSignal {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub signal: PtyResizeSignal,
}

/// `stream.close` message accepted by the tunnel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamClose {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
}

/// `stream.window` message accepted by the tunnel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    OpenFileSearch(FileSearchStreamOpen),
    Signal(PtyStreamSignal),
    Close(StreamClose),
    Window(StreamWindow),
}

/// One loopback listener attached to a running process.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessListener {
    pub port: u16,
    pub bind_address: String,
}

/// One running process plus any discovered loopback listeners.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessEntry {
    pub pid: u32,
    pub command: Option<String>,
    pub listeners: Vec<ProcessListener>,
}

/// Inbound refresh request accepted on a `processes` stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessesRefresh {
    #[serde(rename = "type")]
    pub message_type: String,
}

/// Outbound snapshot payload sent on a `processes` stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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

/// Inbound query request accepted on a `fileSearch` stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchQuery {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub query: String,
    pub limit: Option<usize>,
}

/// Kind of one `fileSearch.results` item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileSearchResultKind {
    #[serde(rename = "file")]
    File,
    #[serde(rename = "directory")]
    Directory,
}

/// One `fileSearch.results` item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResultItem {
    pub path: String,
    pub kind: FileSearchResultKind,
}

/// Outbound search results sent on a `fileSearch` stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResults {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub query: String,
    pub items: Vec<FileSearchResultItem>,
}

/// File-search error sent on a `fileSearch` stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchError {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub code: String,
    pub message: String,
}

/// File selection notification accepted on a `fileSearch` stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchSelect {
    #[serde(rename = "type")]
    pub message_type: String,
    pub query: String,
    pub path: String,
}

/// Application messages carried over a `fileSearch` stream's text data frames.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileSearchStreamMessage {
    Query(FileSearchQuery),
    Results(FileSearchResults),
    Error(FileSearchError),
    Select(FileSearchSelect),
}

/// Exact port target carried by `ports.*` control and transport messages.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortAccessTarget {
    pub kind: String,
    pub port: u16,
}

/// Inbound `ports.target.authorize` request from the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortsTargetAuthorize {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub target: PortAccessTarget,
}

/// Outbound successful `ports.target.authorize.result`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct PortsTcpOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub target: PortAccessTarget,
    pub upstream_protocol: String,
}

/// Outbound `ports.tcp.connected` sent after the target connection is ready.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortsTcpConnected {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
}

/// Directional TCP write close.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortsTcpClose {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub direction: String,
}

/// TCP stream error message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortsTcpError {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub code: String,
    pub message: String,
}

/// Inbound `ports.http.open` request from the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct PortsHttpRequest {
    pub method: String,
    pub path: String,
    pub query: Option<String>,
    pub headers: RepeatedHeaderValues,
}

/// Outbound `ports.http.response.start` payload sent by sandboxd.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortsHttpResponseStart {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub status: u16,
    pub headers: RepeatedHeaderValues,
}

/// One base64-encoded HTTP body chunk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct PortsHttpBodyEnd {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub direction: String,
}

/// One semantic HTTP transport-close signal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortsStreamClose {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
}

/// One semantic HTTP transport error message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct TelemetryOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub signal: String,
    pub format: String,
}

/// `telemetry.open.ok` response from the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryOpenOk {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub initial_window_bytes: usize,
}

/// `telemetry.open.error` response from the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryOpenError {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub code: String,
    pub message: String,
}

/// `telemetry.window` response from the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryWindow {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub bytes: usize,
}

/// `telemetry.close` message sent when a tunnel connection stops accepting log traffic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryClose {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
}

/// `telemetry.reset` response from the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryReset {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub code: String,
    pub message: String,
}

/// Outbound `signing.request` payload sent from sandboxd to the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SigningRequest {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub organization_id: String,
    pub sandbox_instance_id: String,
    pub acting_user_id: String,
    pub provider_family: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integration_connection_id: Option<String>,
    pub format: String,
    pub key_ref: String,
    pub grant: String,
    pub payload: String,
    pub encoding: String,
}

/// Successful `signing.result` payload sent by the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct EgressTokenRequest {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acting_user_id: Option<String>,
}

/// Successful `egress.token.response` payload sent by the gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct PtySessionOpened {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub pty_session_id: String,
}

/// Sandboxd failure response for a direct PTY session open command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySessionError {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub pty_session_id: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PtySessionOpenedResponse<'a> {
    #[serde(rename = "type")]
    pub(super) message_type: &'a str,
    pub(super) request_id: &'a str,
    pub(super) pty_session_id: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PtySessionErrorResponse<'a> {
    #[serde(rename = "type")]
    pub(super) message_type: &'a str,
    pub(super) request_id: &'a str,
    pub(super) pty_session_id: &'a str,
    pub(super) code: &'a str,
    pub(super) message: String,
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
#[serde(rename_all = "camelCase")]
pub(super) struct StreamOpenOk<'a> {
    #[serde(rename = "type")]
    pub(super) message_type: &'a str,
    pub(super) stream_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StreamOpenError<'a> {
    #[serde(rename = "type")]
    pub(super) message_type: &'a str,
    pub(super) stream_id: u32,
    pub(super) code: &'a str,
    pub(super) message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StreamReset<'a> {
    #[serde(rename = "type")]
    pub(super) message_type: &'a str,
    pub(super) stream_id: u32,
    pub(super) code: &'a str,
    pub(super) message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StreamWindowResponse<'a> {
    #[serde(rename = "type")]
    pub(super) message_type: &'a str,
    pub(super) stream_id: u32,
    pub(super) bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StreamComplete<'a> {
    #[serde(rename = "type")]
    pub(super) message_type: &'a str,
    pub(super) stream_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PtyExitEvent<'a> {
    #[serde(rename = "type")]
    pub(super) message_type: &'a str,
    pub(super) exit_code: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FileUploadCompletedEvent<'a> {
    #[serde(rename = "type")]
    pub(super) message_type: &'a str,
    pub(super) kind: &'a str,
    pub(super) attachment_id: &'a str,
    pub(super) thread_id: &'a str,
    pub(super) original_filename: &'a str,
    pub(super) mime_type: &'a str,
    pub(super) size_bytes: usize,
    pub(super) path: &'a str,
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
#[serde(rename_all = "camelCase")]
pub(super) struct ExecResultEvent<'a> {
    #[serde(rename = "type")]
    pub(super) message_type: &'a str,
    pub(super) exit_code: i32,
    pub(super) stdout: &'a str,
    pub(super) stderr: &'a str,
    pub(super) truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StreamEvent<'a, T> {
    #[serde(rename = "type")]
    pub(super) message_type: &'a str,
    pub(super) stream_id: u32,
    pub(super) event: T,
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
