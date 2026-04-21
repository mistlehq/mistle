//! Telemetry stream buffering for the bootstrap tunnel.
//!
//! The sandbox supervisor emits its own diagnostic lines locally, but the
//! gateway can subscribe to a bounded subset of those logs over the dedicated
//! telemetry stream. This module owns the telemetry stream state machine,
//! send-window accounting, and bounded buffering needed to publish those log
//! lines over the existing bootstrap websocket.

use std::fmt::{self, Display};

use serde_json::{Map, Value};

use crate::time::{Clock, format_rfc3339_timestamp};
use crate::tunnel::protocol::{
    BootstrapTelemetryControlMessage, MAX_STREAM_WINDOW_BYTES, PAYLOAD_KIND_RAW_BYTES,
    StreamSendWindow, decode_stream_data_frame, encode_stream_data_frame,
    parse_bootstrap_telemetry_control_message, telemetry_close, telemetry_open,
};

/// Reserved bootstrap-tunnel stream id for sandbox diagnostics.
pub const SANDBOX_TELEMETRY_LOG_STREAM_ID: u32 = 0xffff_fffe;
const TELEMETRY_LOGS_SIGNAL: &str = "logs";
const TELEMETRY_LOGS_FORMAT: &str = "mistle.sandbox-runtime.log.v1";
const RESERVED_LOG_FIELDS: [&str; 3] = ["timestamp", "level", "event"];

/// Supported log severities for sandbox telemetry log lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxTelemetryLogLevel {
    Info,
    Warn,
    Error,
}

impl SandboxTelemetryLogLevel {
    fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
        }
    }
}

/// Describes why one telemetry relay step failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TelemetryRelayError {
    message: String,
}

impl TelemetryRelayError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for TelemetryRelayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for TelemetryRelayError {}

/// One serialized bootstrap-tunnel frame produced by the telemetry relay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TelemetryRelayFrame {
    Text(String),
    Binary(Vec<u8>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TelemetryRelayState {
    Disconnected,
    Opening,
    Open,
}

/// Buffers telemetry log lines until the gateway has granted enough send window.
#[derive(Debug)]
pub struct TelemetryRelay {
    state: TelemetryRelayState,
    send_window: StreamSendWindow,
    buffered_lines: Vec<Vec<u8>>,
    buffered_bytes: usize,
}

impl Default for TelemetryRelay {
    fn default() -> Self {
        Self {
            state: TelemetryRelayState::Disconnected,
            send_window: StreamSendWindow::new(0),
            buffered_lines: Vec::new(),
            buffered_bytes: 0,
        }
    }
}

impl TelemetryRelay {
    /// Starts telemetry negotiation on the current tunnel connection.
    pub fn attach_tunnel_connection(
        &mut self,
    ) -> Result<Vec<TelemetryRelayFrame>, TelemetryRelayError> {
        self.state = TelemetryRelayState::Opening;
        self.send_window = StreamSendWindow::new(0);
        self.buffered_lines.clear();
        self.buffered_bytes = 0;
        Ok(vec![TelemetryRelayFrame::Text(telemetry_open(
            SANDBOX_TELEMETRY_LOG_STREAM_ID,
            TELEMETRY_LOGS_SIGNAL,
            TELEMETRY_LOGS_FORMAT,
        ))])
    }

    /// Stops telemetry publication on the current tunnel connection.
    pub fn detach_tunnel_connection(
        &mut self,
    ) -> Result<Vec<TelemetryRelayFrame>, TelemetryRelayError> {
        let mut frames = Vec::new();
        if matches!(
            self.state,
            TelemetryRelayState::Opening | TelemetryRelayState::Open
        ) {
            frames.push(TelemetryRelayFrame::Text(telemetry_close(
                SANDBOX_TELEMETRY_LOG_STREAM_ID,
            )));
        }

        self.state = TelemetryRelayState::Disconnected;
        self.send_window = StreamSendWindow::new(0);
        self.buffered_lines.clear();
        self.buffered_bytes = 0;
        Ok(frames)
    }

    /// Applies one telemetry control response from the gateway.
    pub fn handle_control_message(
        &mut self,
        payload: &str,
    ) -> Result<Option<Vec<TelemetryRelayFrame>>, TelemetryRelayError> {
        let Some(message) = parse_bootstrap_telemetry_control_message(payload)
            .map_err(|error| TelemetryRelayError::new(error.to_string()))?
        else {
            return Ok(None);
        };

        match message {
            BootstrapTelemetryControlMessage::OpenOk(message) => {
                if message.stream_id != SANDBOX_TELEMETRY_LOG_STREAM_ID {
                    return Ok(None);
                }
                self.send_window = StreamSendWindow::new(message.initial_window_bytes);
                self.state = TelemetryRelayState::Open;
                Ok(Some(self.flush()?))
            }
            BootstrapTelemetryControlMessage::Window(message) => {
                if message.stream_id != SANDBOX_TELEMETRY_LOG_STREAM_ID {
                    return Ok(None);
                }
                self.send_window
                    .add(message.bytes)
                    .map_err(|error| TelemetryRelayError::new(error.to_string()))?;
                Ok(Some(self.flush()?))
            }
            BootstrapTelemetryControlMessage::OpenError(message) => {
                if message.stream_id != SANDBOX_TELEMETRY_LOG_STREAM_ID {
                    return Ok(None);
                }
                Err(TelemetryRelayError::new(format!(
                    "gateway rejected telemetry stream: {} ({})",
                    message.message, message.code
                )))
            }
            BootstrapTelemetryControlMessage::Reset(message) => {
                if message.stream_id != SANDBOX_TELEMETRY_LOG_STREAM_ID {
                    return Ok(None);
                }
                Err(TelemetryRelayError::new(format!(
                    "gateway reset telemetry stream: {} ({})",
                    message.message, message.code
                )))
            }
        }
    }

    /// Queues one telemetry log line for transmission.
    pub fn enqueue_log_line(
        &mut self,
        line: &str,
    ) -> Result<Vec<TelemetryRelayFrame>, TelemetryRelayError> {
        if self.buffered_bytes.saturating_add(line.len()) > MAX_STREAM_WINDOW_BYTES {
            return Err(TelemetryRelayError::new(
                "telemetry buffer exceeded the configured capacity",
            ));
        }

        self.buffered_bytes = self.buffered_bytes.saturating_add(line.len());
        self.buffered_lines.push(line.as_bytes().to_vec());
        self.flush()
    }

    /// Serializes one structured telemetry log record and queues it for transmission.
    pub fn enqueue_log_record(
        &mut self,
        clock: &dyn Clock,
        level: SandboxTelemetryLogLevel,
        event: &str,
        extra_fields: &[(&str, Value)],
    ) -> Result<Vec<TelemetryRelayFrame>, TelemetryRelayError> {
        let line = encode_sandbox_telemetry_log_line(clock, level, event, extra_fields)?;
        self.enqueue_log_line(&line)
    }

    fn flush(&mut self) -> Result<Vec<TelemetryRelayFrame>, TelemetryRelayError> {
        if self.state != TelemetryRelayState::Open {
            return Ok(Vec::new());
        }

        let mut frames = Vec::new();
        while let Some(next_line) = self.buffered_lines.first() {
            if !self.send_window.try_consume(next_line.len()) {
                return Ok(frames);
            }

            let line = self.buffered_lines.remove(0);
            self.buffered_bytes = self.buffered_bytes.saturating_sub(line.len());
            let encoded = encode_stream_data_frame(
                SANDBOX_TELEMETRY_LOG_STREAM_ID,
                PAYLOAD_KIND_RAW_BYTES,
                &line,
            )
            .map_err(|error| TelemetryRelayError::new(error.to_string()))?;
            frames.push(TelemetryRelayFrame::Binary(encoded));
        }

        Ok(frames)
    }
}

/// Decodes one telemetry data frame routed back from the tunnel.
pub fn decode_telemetry_data_frame(payload: &[u8]) -> Result<Vec<u8>, TelemetryRelayError> {
    let frame = decode_stream_data_frame(payload)
        .map_err(|error| TelemetryRelayError::new(error.to_string()))?;
    if frame.stream_id != SANDBOX_TELEMETRY_LOG_STREAM_ID {
        return Err(TelemetryRelayError::new(format!(
            "unexpected telemetry streamId {}",
            frame.stream_id
        )));
    }
    if frame.payload_kind != PAYLOAD_KIND_RAW_BYTES {
        return Err(TelemetryRelayError::new(
            "telemetry stream only accepts raw byte payloads",
        ));
    }
    Ok(frame.payload)
}

/// Serializes one newline-delimited `mistle.sandbox-runtime.log.v1` log line.
pub fn encode_sandbox_telemetry_log_line(
    clock: &dyn Clock,
    level: SandboxTelemetryLogLevel,
    event: &str,
    extra_fields: &[(&str, Value)],
) -> Result<String, TelemetryRelayError> {
    if event.trim().is_empty() {
        return Err(TelemetryRelayError::new(
            "sandbox telemetry log event must not be empty",
        ));
    }

    let mut payload = Map::new();
    payload.insert(
        "timestamp".to_string(),
        Value::String(
            format_rfc3339_timestamp(clock.now_system_time())
                .map_err(|error| TelemetryRelayError::new(error.to_string()))?,
        ),
    );
    payload.insert(
        "level".to_string(),
        Value::String(level.as_str().to_string()),
    );
    payload.insert("event".to_string(), Value::String(event.to_string()));

    for (field_name, field_value) in extra_fields {
        if field_name.trim().is_empty() {
            return Err(TelemetryRelayError::new(
                "sandbox telemetry log field name must not be empty",
            ));
        }
        if RESERVED_LOG_FIELDS.contains(field_name) {
            return Err(TelemetryRelayError::new(format!(
                "sandbox telemetry log field '{field_name}' is reserved",
            )));
        }
        if !matches!(
            field_value,
            Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_)
        ) {
            return Err(TelemetryRelayError::new(format!(
                "sandbox telemetry log field '{field_name}' must be scalar",
            )));
        }

        payload.insert((*field_name).to_string(), field_value.clone());
    }

    let mut line = serde_json::to_string(&Value::Object(payload))
        .map_err(|error| TelemetryRelayError::new(error.to_string()))?;
    line.push('\n');
    Ok(line)
}
