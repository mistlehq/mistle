//! Telemetry stream buffering for the bootstrap tunnel.
//!
//! The sandbox supervisor emits its own diagnostic lines locally, but the
//! gateway can subscribe to a bounded subset of those logs over the dedicated
//! telemetry stream. This module owns the telemetry stream state machine,
//! send-window accounting, and bounded buffering needed to publish those log
//! lines over the existing bootstrap websocket.

use std::fmt::{self, Display};
use std::io;

use tungstenite::{Message, WebSocket};

use crate::tunnel::protocol::{
    BootstrapTelemetryControlMessage, MAX_STREAM_WINDOW_BYTES, PAYLOAD_KIND_RAW_BYTES,
    StreamSendWindow, decode_stream_data_frame, encode_stream_data_frame,
    parse_bootstrap_telemetry_control_message, telemetry_close, telemetry_open,
};

/// Reserved bootstrap-tunnel stream id for sandbox diagnostics.
pub const SANDBOX_TELEMETRY_LOG_STREAM_ID: u32 = 0xffff_fffe;
const TELEMETRY_LOGS_SIGNAL: &str = "logs";
const TELEMETRY_LOGS_FORMAT: &str = "mistle.sandbox-runtime.log.v1";

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
    pub fn attach_tunnel_connection<S>(
        &mut self,
        socket: &mut WebSocket<S>,
    ) -> Result<(), TelemetryRelayError>
    where
        S: io::Read + io::Write,
    {
        self.state = TelemetryRelayState::Opening;
        self.send_window = StreamSendWindow::new(0);
        self.buffered_lines.clear();
        self.buffered_bytes = 0;
        write_text_frame(
            socket,
            telemetry_open(
                SANDBOX_TELEMETRY_LOG_STREAM_ID,
                TELEMETRY_LOGS_SIGNAL,
                TELEMETRY_LOGS_FORMAT,
            ),
        )
    }

    /// Stops telemetry publication on the current tunnel connection.
    pub fn detach_tunnel_connection<S>(
        &mut self,
        socket: &mut WebSocket<S>,
    ) -> Result<(), TelemetryRelayError>
    where
        S: io::Read + io::Write,
    {
        if matches!(
            self.state,
            TelemetryRelayState::Opening | TelemetryRelayState::Open
        ) {
            write_text_frame(socket, telemetry_close(SANDBOX_TELEMETRY_LOG_STREAM_ID))?;
        }

        self.state = TelemetryRelayState::Disconnected;
        self.send_window = StreamSendWindow::new(0);
        self.buffered_lines.clear();
        self.buffered_bytes = 0;
        Ok(())
    }

    /// Applies one telemetry control response from the gateway.
    pub fn handle_control_message<S>(
        &mut self,
        payload: &str,
        socket: &mut WebSocket<S>,
    ) -> Result<bool, TelemetryRelayError>
    where
        S: io::Read + io::Write,
    {
        let Some(message) = parse_bootstrap_telemetry_control_message(payload)
            .map_err(|error| TelemetryRelayError::new(error.to_string()))?
        else {
            return Ok(false);
        };

        match message {
            BootstrapTelemetryControlMessage::OpenOk(message) => {
                if message.stream_id != SANDBOX_TELEMETRY_LOG_STREAM_ID {
                    return Ok(false);
                }
                self.send_window = StreamSendWindow::new(message.initial_window_bytes);
                self.state = TelemetryRelayState::Open;
                self.flush(socket)?;
                Ok(true)
            }
            BootstrapTelemetryControlMessage::Window(message) => {
                if message.stream_id != SANDBOX_TELEMETRY_LOG_STREAM_ID {
                    return Ok(false);
                }
                self.send_window
                    .add(message.bytes)
                    .map_err(|error| TelemetryRelayError::new(error.to_string()))?;
                self.flush(socket)?;
                Ok(true)
            }
            BootstrapTelemetryControlMessage::OpenError(message) => {
                if message.stream_id != SANDBOX_TELEMETRY_LOG_STREAM_ID {
                    return Ok(false);
                }
                Err(TelemetryRelayError::new(format!(
                    "gateway rejected telemetry stream: {} ({})",
                    message.message, message.code
                )))
            }
            BootstrapTelemetryControlMessage::Reset(message) => {
                if message.stream_id != SANDBOX_TELEMETRY_LOG_STREAM_ID {
                    return Ok(false);
                }
                Err(TelemetryRelayError::new(format!(
                    "gateway reset telemetry stream: {} ({})",
                    message.message, message.code
                )))
            }
        }
    }

    /// Queues one telemetry log line for transmission.
    pub fn enqueue_log_line<S>(
        &mut self,
        line: &str,
        socket: &mut WebSocket<S>,
    ) -> Result<(), TelemetryRelayError>
    where
        S: io::Read + io::Write,
    {
        if self.buffered_bytes.saturating_add(line.len()) > MAX_STREAM_WINDOW_BYTES {
            return Err(TelemetryRelayError::new(
                "telemetry buffer exceeded the configured capacity",
            ));
        }

        self.buffered_bytes = self.buffered_bytes.saturating_add(line.len());
        self.buffered_lines.push(line.as_bytes().to_vec());
        self.flush(socket)
    }

    fn flush<S>(&mut self, socket: &mut WebSocket<S>) -> Result<(), TelemetryRelayError>
    where
        S: io::Read + io::Write,
    {
        if self.state != TelemetryRelayState::Open {
            return Ok(());
        }

        while let Some(next_line) = self.buffered_lines.first() {
            if !self.send_window.try_consume(next_line.len()) {
                return Ok(());
            }

            let line = self.buffered_lines.remove(0);
            self.buffered_bytes = self.buffered_bytes.saturating_sub(line.len());
            let encoded = encode_stream_data_frame(
                SANDBOX_TELEMETRY_LOG_STREAM_ID,
                PAYLOAD_KIND_RAW_BYTES,
                &line,
            )
            .map_err(|error| TelemetryRelayError::new(error.to_string()))?;
            socket.send(Message::Binary(encoded.into())).map_err(|error| {
                TelemetryRelayError::new(format!(
                    "failed to write telemetry binary frame: {error}"
                ))
            })?;
        }

        Ok(())
    }
}

fn write_text_frame<S>(socket: &mut WebSocket<S>, payload: String) -> Result<(), TelemetryRelayError>
where
    S: io::Read + io::Write,
{
    socket.send(Message::Text(payload.into())).map_err(|error| {
        TelemetryRelayError::new(format!("failed to write telemetry control frame: {error}"))
    })
}

/// Decodes one telemetry data frame routed back from the tunnel.
pub fn decode_telemetry_data_frame(
    payload: &[u8],
) -> Result<Vec<u8>, TelemetryRelayError> {
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
