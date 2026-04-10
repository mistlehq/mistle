//! Shared bootstrap-tunnel stream protocol helpers.
//!
//! The gateway tunnel multiplexes several stream kinds over one websocket:
//! PTY sessions, agent-runtime websocket sessions, file uploads, and telemetry.
//! This module owns the shared parsing, validation, frame encoding, flow-control,
//! and JSON serialization used by those channel implementations.

use std::fmt::{self, Display};

use serde::{Deserialize, Serialize};

/// Default byte credit available for outbound stream data.
pub const DEFAULT_STREAM_WINDOW_BYTES: usize = 64 * 1024;
/// Larger initial byte credit for bursty agent-runtime websocket output.
pub const AGENT_STREAM_WINDOW_BYTES: usize = 1024 * 1024;
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
/// `stream.open.error` code for PTY create requests that collide with a live session.
pub const CONNECT_ERROR_CODE_PTY_SESSION_EXISTS: &str = "pty_session_exists";
/// `stream.open.error` code for PTY create requests that fail during spawn.
pub const CONNECT_ERROR_CODE_PTY_SESSION_CREATE_FAILED: &str = "pty_session_create_failed";
/// `stream.open.error` code for PTY attach requests without a live session.
pub const CONNECT_ERROR_CODE_PTY_SESSION_UNAVAILABLE: &str = "pty_session_unavailable";
/// `stream.open.error` code for rejected one-shot exec requests.
pub const CONNECT_ERROR_CODE_EXEC_COMMAND_REJECTED: &str = "exec_command_rejected";
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

/// PTY session selection mode carried in `stream.open`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PtySessionMode {
    Create,
    Attach,
}

/// PTY channel payload accepted by `stream.open`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PtyStreamChannel {
    pub kind: String,
    pub session: PtySessionMode,
    pub pty_session_id: String,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub cwd: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
}

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
    pub timeout_ms: Option<u64>,
    pub max_output_bytes: Option<usize>,
}

/// PTY `stream.open` message accepted by the relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PtyStreamOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub channel: PtyStreamChannel,
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
    OpenPty(PtyStreamOpen),
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

/// PTY-specific control messages consumed by the PTY relay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtyControlMessage {
    Open(PtyStreamOpen),
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
    attachment_id: &'a str,
    thread_id: &'a str,
    original_filename: &'a str,
    mime_type: &'a str,
    size_bytes: usize,
    path: &'a str,
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
                "pty" => {
                    let message: PtyStreamOpen = serde_json::from_value(parsed_payload)
                        .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
                    validate_pty_stream_open(&message)?;
                    Ok(StreamControlMessage::OpenPty(message))
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
        StreamControlMessage::OpenPty(message) => Ok(PtyControlMessage::Open(message)),
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

/// Builds one `stream.event` file-upload completion payload.
pub fn file_upload_completed_event(
    stream_id: u32,
    attachment_id: &str,
    thread_id: &str,
    original_filename: &str,
    mime_type: &str,
    size_bytes: usize,
    path: &str,
) -> String {
    serialize_json(&StreamEvent {
        message_type: "stream.event",
        stream_id,
        event: FileUploadCompletedEvent {
            message_type: "fileUpload.completed",
            attachment_id,
            thread_id,
            original_filename,
            mime_type,
            size_bytes,
            path,
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

fn validate_pty_stream_open(message: &PtyStreamOpen) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.open" {
        return Err(TunnelProtocolError::new(
            "pty stream.open request type must be 'stream.open'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.channel.kind != "pty" {
        return Err(TunnelProtocolError::new(
            "pty stream.open request channel.kind must be 'pty'",
        ));
    }
    if message.channel.pty_session_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty stream.open request channel.ptySessionId is required",
        ));
    }
    if message.channel.cols.is_some() != message.channel.rows.is_some() {
        return Err(TunnelProtocolError::new(
            "pty stream.open request cols and rows must both be provided when either is set",
        ));
    }
    if matches!(message.channel.cols, Some(0)) || matches!(message.channel.rows, Some(0)) {
        return Err(TunnelProtocolError::new(
            "pty stream.open request cols and rows must be greater than or equal to 1",
        ));
    }
    if let Some(command) = message.channel.command.as_ref()
        && command.trim().is_empty()
    {
        return Err(TunnelProtocolError::new(
            "pty stream.open request command must be a non-empty string",
        ));
    }
    if let Some(args) = message.channel.args.as_ref()
        && args.iter().any(|value| value.trim().is_empty())
    {
        return Err(TunnelProtocolError::new(
            "pty stream.open request args must contain only non-empty strings",
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

#[cfg(test)]
mod tests {
    use crate::tunnel::protocol::{
        BootstrapTelemetryControlMessage, PAYLOAD_KIND_RAW_BYTES, PAYLOAD_KIND_WEBSOCKET_TEXT,
        ProcessesStreamMessage, PtyControlMessage, StreamControlMessage, StreamSendWindow,
        decode_stream_data_frame, encode_stream_data_frame, exec_result_event,
        file_upload_completed_event, parse_bootstrap_telemetry_control_message,
        parse_processes_stream_message, parse_pty_control_message, parse_stream_control_message,
        pty_exit_event, stream_complete, stream_open_error, stream_open_ok, stream_reset,
        stream_window, telemetry_close, telemetry_open,
    };

    #[test]
    fn parses_valid_stream_opens() {
        let agent = parse_stream_control_message(
            r#"{"type":"stream.open","streamId":7,"channel":{"kind":"agent"}}"#,
        )
        .expect("agent stream.open should parse");
        assert!(matches!(agent, StreamControlMessage::OpenAgent(_)));

        let pty = parse_stream_control_message(
            r#"{"type":"stream.open","streamId":7,"channel":{"kind":"pty","session":"create","ptySessionId":"terminal","cols":80,"rows":24}}"#,
        )
        .expect("pty stream.open should parse");
        assert!(matches!(pty, StreamControlMessage::OpenPty(_)));

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
            r#"{"type":"stream.open","streamId":8,"channel":{"kind":"exec","command":"git","args":["status","--short"],"cwd":"/workspace/repo","timeoutMs":15000,"maxOutputBytes":65536}}"#,
        )
        .expect("exec stream.open should parse");
        assert!(matches!(exec, StreamControlMessage::OpenExec(_)));
    }

    #[test]
    fn parses_valid_pty_control_messages() {
        let message = parse_pty_control_message(
            r#"{"type":"stream.open","streamId":7,"channel":{"kind":"pty","session":"create","ptySessionId":"terminal","cols":80,"rows":24}}"#,
        )
        .expect("pty stream.open should parse");

        assert!(matches!(message, PtyControlMessage::Open(_)));
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
            pty_exit_event(7, 3),
            r#"{"type":"stream.event","streamId":7,"event":{"type":"pty.exit","exitCode":3}}"#
        );
        assert_eq!(
            file_upload_completed_event(
                7,
                "att_123",
                "thread_123",
                "image.png",
                "image/png",
                8,
                "/tmp/attachments/thread_123/file.png",
            ),
            r#"{"type":"stream.event","streamId":7,"event":{"type":"fileUpload.completed","attachmentId":"att_123","threadId":"thread_123","originalFilename":"image.png","mimeType":"image/png","sizeBytes":8,"path":"/tmp/attachments/thread_123/file.png"}}"#
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
