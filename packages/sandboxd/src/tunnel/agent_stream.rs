//! Agent-runtime websocket relay for the bootstrap tunnel.
//!
//! The gateway speaks the generic `stream.*` protocol, while agent runtimes
//! expose plain websocket endpoints. This module bridges the two: it accepts an
//! `agent` `stream.open`, dials the runtime endpoint, forwards tunnel binary
//! frames into websocket text/binary messages, and relays endpoint output back
//! onto the tunnel with stream-window flow control.

use std::fmt::{self, Display};
use std::io;
use std::net::TcpStream;

use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Error as WebSocketError, Message, WebSocket, connect};

use crate::time::{Duration, Sleeper};
use crate::tunnel::protocol::{
    CONNECT_ERROR_CODE_AGENT_ENDPOINT_DIAL_FAILED, CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST,
    PAYLOAD_KIND_WEBSOCKET_BINARY, PAYLOAD_KIND_WEBSOCKET_TEXT,
    STREAM_RESET_CODE_INVALID_STREAM_CLOSE, STREAM_RESET_CODE_INVALID_STREAM_DATA,
    STREAM_RESET_CODE_INVALID_STREAM_WINDOW, STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
    StreamControlMessage, StreamSendWindow, decode_stream_data_frame, encode_stream_data_frame,
    parse_stream_control_message, stream_open_error, stream_open_ok, stream_reset,
};

/// Default idle poll interval while waiting for tunnel input or runtime output.
pub const DEFAULT_AGENT_STREAM_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// Describes why one agent relay step failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentStreamError {
    message: String,
}

impl AgentStreamError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for AgentStreamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for AgentStreamError {}

/// Starts one agent-runtime relay from an initial `stream.open` payload.
pub fn relay_agent_stream(
    socket: &mut WebSocket<TcpStream>,
    open_payload: &str,
    runtime_endpoint_url: &str,
    sleeper: &dyn Sleeper,
    poll_interval: Duration,
) -> Result<(), AgentStreamError> {
    socket.get_mut().set_nonblocking(true).map_err(|error| {
        AgentStreamError::new(format!("failed to configure agent tunnel socket: {error}"))
    })?;

    let open_message = match parse_stream_control_message(open_payload) {
        Ok(StreamControlMessage::OpenAgent(message)) => message,
        Ok(_) => {
            return Err(AgentStreamError::new(
                "expected initial agent stream.open control message",
            ));
        }
        Err(error) => {
            return Err(AgentStreamError::new(error.to_string()));
        }
    };
    let stream_id = open_message.stream_id;

    let mut agent_socket = match connect(runtime_endpoint_url) {
        Ok((socket, _)) => socket,
        Err(error) => {
            write_text_frame(
                socket,
                stream_open_error(
                    stream_id,
                    CONNECT_ERROR_CODE_AGENT_ENDPOINT_DIAL_FAILED,
                    format!("failed to connect agent endpoint: {error}"),
                ),
            )?;
            return Ok(());
        }
    };
    set_agent_socket_nonblocking(&mut agent_socket)?;

    let mut send_window = StreamSendWindow::default();
    write_text_frame(socket, stream_open_ok(stream_id))?;

    loop {
        loop {
            match agent_socket.read() {
                Ok(Message::Text(payload)) => {
                    if !send_window.try_consume(payload.len()) {
                        write_text_frame(
                            socket,
                            stream_reset(
                                stream_id,
                                STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
                                "agent stream send window is exhausted",
                            ),
                        )?;
                        return Ok(());
                    }

                    let encoded = encode_stream_data_frame(
                        stream_id,
                        PAYLOAD_KIND_WEBSOCKET_TEXT,
                        payload.as_bytes(),
                    )
                    .map_err(|error| AgentStreamError::new(error.to_string()))?;
                    socket.send(Message::Binary(encoded.into())).map_err(|error| {
                        AgentStreamError::new(format!("failed to write agent binary frame: {error}"))
                    })?;
                }
                Ok(Message::Binary(payload)) => {
                    if !send_window.try_consume(payload.len()) {
                        write_text_frame(
                            socket,
                            stream_reset(
                                stream_id,
                                STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
                                "agent stream send window is exhausted",
                            ),
                        )?;
                        return Ok(());
                    }

                    let encoded = encode_stream_data_frame(
                        stream_id,
                        PAYLOAD_KIND_WEBSOCKET_BINARY,
                        payload.as_ref(),
                    )
                    .map_err(|error| AgentStreamError::new(error.to_string()))?;
                    socket.send(Message::Binary(encoded.into())).map_err(|error| {
                        AgentStreamError::new(format!("failed to write agent binary frame: {error}"))
                    })?;
                }
                Ok(Message::Close(_)) | Err(WebSocketError::ConnectionClosed) => {
                    return Ok(());
                }
                Err(WebSocketError::Io(error))
                    if matches!(
                        error.kind(),
                        io::ErrorKind::ConnectionReset
                            | io::ErrorKind::BrokenPipe
                            | io::ErrorKind::UnexpectedEof
                    ) =>
                {
                    return Ok(());
                }
                Ok(Message::Ping(payload)) => {
                    agent_socket.send(Message::Pong(payload)).map_err(|error| {
                        AgentStreamError::new(format!(
                            "failed to reply to agent websocket ping: {error}"
                        ))
                    })?;
                }
                Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => {}
                Err(WebSocketError::Io(error)) if error.kind() == io::ErrorKind::WouldBlock => {
                    break;
                }
                Err(error) => {
                    return Err(AgentStreamError::new(format!(
                        "failed to read agent websocket message: {error}"
                    )));
                }
            }
        }

        match socket.read() {
            Ok(Message::Text(payload)) => {
                let control_message = match parse_stream_control_message(payload.as_str()) {
                    Ok(message) => message,
                    Err(error) => {
                        write_text_frame(
                            socket,
                            stream_open_error(
                                stream_id,
                                CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST,
                                error.to_string(),
                            ),
                        )?;
                        return Ok(());
                    }
                };

                match control_message {
                    StreamControlMessage::Window(message) => {
                        if message.stream_id != stream_id {
                            write_text_frame(
                                socket,
                                stream_reset(
                                    message.stream_id,
                                    STREAM_RESET_CODE_INVALID_STREAM_WINDOW,
                                    format!(
                                        "stream.window streamId {} does not match active agent stream {}",
                                        message.stream_id, stream_id
                                    ),
                                ),
                            )?;
                            return Ok(());
                        }

                        send_window
                            .add(message.bytes)
                            .map_err(|error| AgentStreamError::new(error.to_string()))?;
                    }
                    StreamControlMessage::Close(message) => {
                        if message.stream_id != stream_id {
                            write_text_frame(
                                socket,
                                stream_reset(
                                    message.stream_id,
                                    STREAM_RESET_CODE_INVALID_STREAM_CLOSE,
                                    format!(
                                        "stream.close streamId {} does not match active agent stream {}",
                                        message.stream_id, stream_id
                                    ),
                                ),
                            )?;
                            return Ok(());
                        }

                        return Ok(());
                    }
                    _ => {
                        write_text_frame(
                            socket,
                            stream_reset(
                                stream_id,
                                STREAM_RESET_CODE_INVALID_STREAM_DATA,
                                "agent stream only accepts binary data frames after stream.open",
                            ),
                        )?;
                        return Ok(());
                    }
                }
            }
            Ok(Message::Binary(payload)) => {
                let frame = match decode_stream_data_frame(payload.as_ref()) {
                    Ok(frame) => frame,
                    Err(error) => {
                        write_text_frame(
                            socket,
                            stream_reset(
                                stream_id,
                                STREAM_RESET_CODE_INVALID_STREAM_DATA,
                                error.to_string(),
                            ),
                        )?;
                        return Ok(());
                    }
                };
                if frame.stream_id != stream_id {
                    write_text_frame(
                        socket,
                        stream_reset(
                            frame.stream_id,
                            STREAM_RESET_CODE_INVALID_STREAM_DATA,
                            format!(
                                "stream data frame streamId {} does not match active agent stream {}",
                                frame.stream_id, stream_id
                            ),
                        ),
                    )?;
                    return Ok(());
                }

                match frame.payload_kind {
                    PAYLOAD_KIND_WEBSOCKET_TEXT => {
                        let text_payload = String::from_utf8(frame.payload).map_err(|error| {
                            AgentStreamError::new(format!(
                                "failed to decode agent text frame as utf-8: {error}"
                            ))
                        })?;
                        agent_socket
                            .send(Message::Text(text_payload.into()))
                            .map_err(|error| {
                                AgentStreamError::new(format!(
                                    "failed to write agent websocket text frame: {error}"
                                ))
                            })?;
                    }
                    PAYLOAD_KIND_WEBSOCKET_BINARY => {
                        agent_socket
                            .send(Message::Binary(frame.payload.into()))
                            .map_err(|error| {
                                AgentStreamError::new(format!(
                                    "failed to write agent websocket binary frame: {error}"
                                ))
                            })?;
                    }
                    _ => {
                        write_text_frame(
                            socket,
                            stream_reset(
                                stream_id,
                                STREAM_RESET_CODE_INVALID_STREAM_DATA,
                                "agent stream only accepts websocket text or binary payload kinds",
                            ),
                        )?;
                        return Ok(());
                    }
                }
            }
            Ok(Message::Close(_)) | Err(WebSocketError::ConnectionClosed) => {
                return Ok(());
            }
            Ok(Message::Ping(payload)) => {
                socket.send(Message::Pong(payload)).map_err(|error| {
                    AgentStreamError::new(format!("failed to reply to tunnel ping: {error}"))
                })?;
            }
            Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => {}
            Err(WebSocketError::Io(error)) if error.kind() == io::ErrorKind::WouldBlock => {
                sleeper.sleep(poll_interval);
            }
            Err(error) => {
                return Err(AgentStreamError::new(format!(
                    "failed to read agent tunnel message: {error}"
                )));
            }
        }
    }
}

fn set_agent_socket_nonblocking(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
) -> Result<(), AgentStreamError> {
    match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => stream.set_nonblocking(true).map_err(|error| {
            AgentStreamError::new(format!("failed to configure agent endpoint socket: {error}"))
        }),
        _ => Err(AgentStreamError::new(
            "agent relay only supports ws runtime endpoints",
        )),
    }
}

fn write_text_frame<S>(socket: &mut WebSocket<S>, payload: String) -> Result<(), AgentStreamError>
where
    S: io::Read + io::Write,
{
    socket.send(Message::Text(payload.into())).map_err(|error| {
        AgentStreamError::new(format!("failed to write agent control frame: {error}"))
    })
}
