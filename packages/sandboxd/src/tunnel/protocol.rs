//! PTY-focused tunnel protocol helpers for `sandboxd`.
//!
//! This module mirrors the existing websocket stream contract closely enough
//! for the Rust PTY relay to parse inbound control messages, validate stream
//! windows and payload frames, and serialize PTY-specific responses back to the
//! gateway.

use std::fmt::{self, Display};

use serde::{Deserialize, Serialize};

/// Default byte credit available for outbound PTY stream data.
pub const DEFAULT_STREAM_WINDOW_BYTES: usize = 64 * 1024;

/// `stream.open.error` code for malformed PTY `stream.open` requests.
pub const CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST: &str = "invalid_connect_request";
/// `stream.open.error` code for PTY create requests that collide with a live session.
pub const CONNECT_ERROR_CODE_PTY_SESSION_EXISTS: &str = "pty_session_exists";
/// `stream.open.error` code for PTY create requests that fail during spawn.
pub const CONNECT_ERROR_CODE_PTY_SESSION_CREATE_FAILED: &str = "pty_session_create_failed";
/// `stream.open.error` code for PTY attach requests without a live session.
pub const CONNECT_ERROR_CODE_PTY_SESSION_UNAVAILABLE: &str = "pty_session_unavailable";
/// `stream.reset` code for invalid `stream.signal` messages routed to a PTY session.
pub const STREAM_RESET_CODE_INVALID_STREAM_SIGNAL: &str = "invalid_stream_signal";
/// `stream.reset` code for invalid `stream.close` messages routed to a PTY session.
pub const STREAM_RESET_CODE_INVALID_STREAM_CLOSE: &str = "invalid_stream_close";
/// `stream.reset` code for invalid binary data frames routed to a PTY session.
pub const STREAM_RESET_CODE_INVALID_STREAM_DATA: &str = "invalid_stream_data";
/// `stream.reset` code for malformed `stream.window` messages.
pub const STREAM_RESET_CODE_INVALID_STREAM_WINDOW: &str = "invalid_stream_window";
/// `stream.reset` code for PTY termination failures triggered by `stream.close`.
pub const STREAM_RESET_CODE_STREAM_CLOSE_FAILED: &str = "stream_close_failed";
/// `stream.reset` code for PTY sessions that close before the protocol does.
pub const STREAM_RESET_CODE_TARGET_CLOSED: &str = "target_closed";
/// `stream.reset` code for outbound PTY data that exceeds available stream credit.
pub const STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED: &str = "stream_window_exhausted";

const DATA_FRAME_KIND: u8 = 0x01;
const DATA_FRAME_HEADER_LEN: usize = 6;
const PAYLOAD_KIND_RAW_BYTES: u8 = 0x01;

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

/// PTY `stream.open` message accepted by the relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PtyStreamOpen {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub channel: PtyStreamChannel,
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

/// `stream.close` message accepted by the PTY relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StreamClose {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
}

/// `stream.window` message accepted by the PTY relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StreamWindow {
    #[serde(rename = "type")]
    pub message_type: String,
    pub stream_id: u32,
    pub bytes: usize,
}

/// Unified PTY relay control messages decoded from websocket text frames.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtyControlMessage {
    Open(PtyStreamOpen),
    Signal(PtyStreamSignal),
    Close(StreamClose),
    Window(StreamWindow),
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
struct PtyExitEvent<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    exit_code: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StreamEvent<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    stream_id: u32,
    event: PtyExitEvent<'a>,
}

/// One decoded binary stream data frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamDataFrame {
    pub stream_id: u32,
    pub payload: Vec<u8>,
}

/// PTY send-window accounting for one attached websocket stream.
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
    /// Adds new outbound credit after the peer acknowledges consumed bytes.
    pub fn add(&mut self, bytes: usize) -> Result<(), TunnelProtocolError> {
        if bytes == 0 {
            return Err(TunnelProtocolError::new(
                "stream.window bytes must be a positive integer",
            ));
        }
        if self.available_bytes > DEFAULT_STREAM_WINDOW_BYTES.saturating_sub(bytes) {
            return Err(TunnelProtocolError::new(format!(
                "stream.window credit exceeds configured maximum of {DEFAULT_STREAM_WINDOW_BYTES} bytes"
            )));
        }

        self.available_bytes += bytes;
        Ok(())
    }

    /// Attempts to consume outbound credit before sending a PTY output chunk.
    pub fn try_consume(&mut self, bytes: usize) -> bool {
        if bytes > self.available_bytes {
            return false;
        }

        self.available_bytes -= bytes;
        true
    }
}

/// Parses one inbound PTY control frame from a websocket text payload.
pub fn parse_pty_control_message(payload: &str) -> Result<PtyControlMessage, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!("control message must be valid json: {error}"))
    })?;
    let message_type = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| TunnelProtocolError::new("control message type is required"))?;

    match message_type {
        "stream.open" => {
            let message: PtyStreamOpen = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_stream_open(&message)?;
            Ok(PtyControlMessage::Open(message))
        }
        "stream.signal" => {
            let message: PtyStreamSignal = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_stream_signal(&message)?;
            Ok(PtyControlMessage::Signal(message))
        }
        "stream.close" => {
            let message: StreamClose = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_stream_close(&message)?;
            Ok(PtyControlMessage::Close(message))
        }
        "stream.window" => {
            let message: StreamWindow = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_stream_window(&message)?;
            Ok(PtyControlMessage::Window(message))
        }
        _ => Err(TunnelProtocolError::new(format!(
            "unsupported pty control message type '{message_type}'"
        ))),
    }
}

/// Encodes one outbound PTY data frame for websocket binary transport.
pub fn encode_stream_data_frame(
    stream_id: u32,
    payload: &[u8],
) -> Result<Vec<u8>, TunnelProtocolError> {
    if stream_id == 0 {
        return Err(TunnelProtocolError::new(
            "streamId must be an integer between 1 and 4294967295",
        ));
    }

    let mut encoded = Vec::with_capacity(DATA_FRAME_HEADER_LEN + payload.len());
    encoded.push(DATA_FRAME_KIND);
    encoded.extend_from_slice(&stream_id.to_be_bytes());
    encoded.push(PAYLOAD_KIND_RAW_BYTES);
    encoded.extend_from_slice(payload);
    Ok(encoded)
}

/// Decodes one inbound websocket binary PTY data frame.
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
    if stream_id == 0 {
        return Err(TunnelProtocolError::new(
            "streamId must be an integer between 1 and 4294967295",
        ));
    }
    if payload[5] != PAYLOAD_KIND_RAW_BYTES {
        return Err(TunnelProtocolError::new(format!(
            "payloadKind is not supported: {}",
            payload[5]
        )));
    }

    Ok(StreamDataFrame {
        stream_id,
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

fn serialize_json<T>(value: &T) -> String
where
    T: Serialize,
{
    serde_json::to_string(value).expect("tunnel protocol payload should serialize")
}

fn validate_stream_open(message: &PtyStreamOpen) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.open" {
        return Err(TunnelProtocolError::new(
            "pty stream.open request type must be 'stream.open'",
        ));
    }
    if message.stream_id == 0 {
        return Err(TunnelProtocolError::new(
            "pty stream.open request streamId must be a positive integer",
        ));
    }
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
    if (message.channel.cols.is_some()) != (message.channel.rows.is_some()) {
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

fn validate_stream_signal(message: &PtyStreamSignal) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.signal" {
        return Err(TunnelProtocolError::new(
            "stream.signal request type must be 'stream.signal'",
        ));
    }
    if message.stream_id == 0 {
        return Err(TunnelProtocolError::new(
            "stream.signal request streamId must be a positive integer",
        ));
    }
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
    if message.stream_id == 0 {
        return Err(TunnelProtocolError::new(
            "stream.close request streamId must be a positive integer",
        ));
    }

    Ok(())
}

fn validate_stream_window(message: &StreamWindow) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.window" {
        return Err(TunnelProtocolError::new(
            "stream.window request type must be 'stream.window'",
        ));
    }
    if message.stream_id == 0 {
        return Err(TunnelProtocolError::new(
            "stream.window request streamId must be a positive integer",
        ));
    }
    if message.bytes == 0 {
        return Err(TunnelProtocolError::new(
            "stream.window bytes must be a positive integer",
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::tunnel::protocol::{
        PtyControlMessage, decode_stream_data_frame, encode_stream_data_frame,
        parse_pty_control_message, pty_exit_event, stream_open_error, stream_open_ok, stream_reset,
        stream_window,
    };

    #[test]
    fn parses_valid_pty_stream_open() {
        let message = parse_pty_control_message(
            r#"{"type":"stream.open","streamId":7,"channel":{"kind":"pty","session":"create","ptySessionId":"terminal","cols":80,"rows":24}}"#,
        )
        .expect("stream.open should parse");

        assert!(matches!(message, PtyControlMessage::Open(_)));
    }

    #[test]
    fn round_trips_raw_bytes_data_frame() {
        let encoded = encode_stream_data_frame(9, b"hello").expect("frame should encode");
        let decoded = decode_stream_data_frame(&encoded).expect("frame should decode");

        assert_eq!(decoded.stream_id, 9);
        assert_eq!(decoded.payload, b"hello");
    }

    #[test]
    fn serializes_pty_stream_responses() {
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
            pty_exit_event(7, 3),
            r#"{"type":"stream.event","streamId":7,"event":{"type":"pty.exit","exitCode":3}}"#
        );
    }
}
