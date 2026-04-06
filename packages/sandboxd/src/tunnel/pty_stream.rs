//! PTY tunnel relay for `sandboxd`.
//!
//! This module binds one PTY-backed child process to the existing websocket
//! `stream.*` contract: create the PTY on `stream.open`, accept attach/resize
//! and stdin data messages, forward PTY output as binary data frames, and emit
//! PTY exit events when the child exits or the primary stream closes.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{self, Display};
use std::io;
use std::net::TcpStream;
use std::path::Path;

use tungstenite::{Error as WebSocketError, Message, WebSocket};

use crate::pty::{
    DEFAULT_PTY_TERMINATE_POLL_INTERVAL, DEFAULT_PTY_TERMINATE_TIMEOUT_MS, PtyEvent,
    PtySpawnRequest, start_scoped_pty_session,
};
use crate::time::{Clock, Duration, Sleeper};
use crate::tunnel::protocol::{
    CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST, CONNECT_ERROR_CODE_PTY_SESSION_CREATE_FAILED,
    CONNECT_ERROR_CODE_PTY_SESSION_EXISTS, CONNECT_ERROR_CODE_PTY_SESSION_UNAVAILABLE,
    PtyControlMessage, PtySessionMode, STREAM_RESET_CODE_INVALID_STREAM_CLOSE,
    STREAM_RESET_CODE_INVALID_STREAM_DATA, STREAM_RESET_CODE_INVALID_STREAM_SIGNAL,
    STREAM_RESET_CODE_INVALID_STREAM_WINDOW, STREAM_RESET_CODE_STREAM_CLOSE_FAILED,
    STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED, STREAM_RESET_CODE_TARGET_CLOSED, StreamSendWindow,
    decode_stream_data_frame, encode_stream_data_frame, parse_pty_control_message, pty_exit_event,
    stream_open_error, stream_open_ok, stream_reset, stream_window,
};

/// Default idle poll interval for interleaving nonblocking tunnel reads and PTY output.
pub const DEFAULT_PTY_STREAM_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// Describes why one PTY relay step failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PtyStreamError {
    message: String,
}

impl PtyStreamError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for PtyStreamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for PtyStreamError {}

#[derive(Debug)]
struct PtyStreamRelay {
    pty_session_id: String,
    primary_stream_id: u32,
    attached_stream_ids: BTreeSet<u32>,
    send_windows_by_stream_id: BTreeMap<u32, StreamSendWindow>,
}

impl PtyStreamRelay {
    fn new(pty_session_id: String, primary_stream_id: u32) -> Self {
        let mut attached_stream_ids = BTreeSet::new();
        attached_stream_ids.insert(primary_stream_id);

        let mut send_windows_by_stream_id = BTreeMap::new();
        send_windows_by_stream_id.insert(primary_stream_id, StreamSendWindow::default());

        Self {
            pty_session_id,
            primary_stream_id,
            attached_stream_ids,
            send_windows_by_stream_id,
        }
    }

    fn attach_stream(&mut self, stream_id: u32) {
        self.attached_stream_ids.insert(stream_id);
        self.send_windows_by_stream_id.entry(stream_id).or_default();
    }

    fn detach_stream(&mut self, stream_id: u32) {
        self.attached_stream_ids.remove(&stream_id);
        self.send_windows_by_stream_id.remove(&stream_id);
    }
}

/// Starts one PTY relay from an initial `stream.open` payload and runs it until exit.
pub fn relay_pty_stream(
    socket: &mut WebSocket<TcpStream>,
    open_payload: &str,
    cgroup_root: &Path,
    sandbox_instance_id: &str,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
    poll_interval: Duration,
) -> Result<(), PtyStreamError> {
    socket.get_mut().set_nonblocking(true).map_err(|error| {
        PtyStreamError::new(format!("failed to configure pty tunnel socket: {error}"))
    })?;

    let open_message = match parse_pty_control_message(open_payload) {
        Ok(PtyControlMessage::Open(message)) => message,
        Ok(_) => {
            return Err(PtyStreamError::new(
                "expected initial PTY stream.open control message",
            ));
        }
        Err(error) => {
            return Err(PtyStreamError::new(error.to_string()));
        }
    };

    let session = if open_message.channel.session == PtySessionMode::Attach {
        write_text_frame(
            socket,
            stream_open_error(
                open_message.stream_id,
                CONNECT_ERROR_CODE_PTY_SESSION_UNAVAILABLE,
                "pty session is not available",
            ),
        )?;
        return Ok(());
    } else {
        match start_scoped_pty_session(
            PtySpawnRequest {
                cwd: open_message.channel.cwd.clone(),
                cols: open_message.channel.cols,
                rows: open_message.channel.rows,
                command: open_message.channel.command.clone(),
                args: open_message.channel.args.clone(),
            },
            cgroup_root,
            sandbox_instance_id,
            clock,
            sleeper,
        ) {
            Ok(session) => session,
            Err(error) => {
                write_text_frame(
                    socket,
                    stream_open_error(
                        open_message.stream_id,
                        CONNECT_ERROR_CODE_PTY_SESSION_CREATE_FAILED,
                        error.to_string(),
                    ),
                )?;
                return Ok(());
            }
        }
    };

    let mut relay = PtyStreamRelay::new(
        open_message.channel.pty_session_id.clone(),
        open_message.stream_id,
    );
    write_text_frame(socket, stream_open_ok(open_message.stream_id))?;

    loop {
        while let Some(event) = session
            .next_event_timeout(Duration::from_millis(0))
            .map_err(|error| PtyStreamError::new(error.to_string()))?
        {
            match event {
                PtyEvent::Output(chunk) => {
                    let attached_stream_ids: Vec<u32> =
                        relay.attached_stream_ids.iter().copied().collect();
                    for stream_id in attached_stream_ids {
                        let Some(send_window) = relay.send_windows_by_stream_id.get_mut(&stream_id)
                        else {
                            continue;
                        };
                        if !send_window.try_consume(chunk.len()) {
                            write_text_frame(
                                socket,
                                stream_reset(
                                    stream_id,
                                    STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
                                    "pty stream send window is exhausted",
                                ),
                            )?;
                            relay.detach_stream(stream_id);
                            if stream_id == relay.primary_stream_id {
                                let _ = session.terminate(
                                    clock,
                                    sleeper,
                                    DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                                    DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
                                );
                                return Ok(());
                            }
                            continue;
                        }

                        let encoded = encode_stream_data_frame(stream_id, &chunk)
                            .map_err(|error| PtyStreamError::new(error.to_string()))?;
                        socket
                            .send(Message::Binary(encoded.into()))
                            .map_err(|error| {
                                PtyStreamError::new(format!(
                                    "failed to write pty binary frame: {error}"
                                ))
                            })?;
                    }
                }
                PtyEvent::Exit(exit_code) => {
                    for stream_id in relay.attached_stream_ids.iter().copied() {
                        write_text_frame(socket, pty_exit_event(stream_id, exit_code))?;
                    }
                    return Ok(());
                }
                PtyEvent::Closed => {
                    if let Some(exit_code) = session.exit_code() {
                        for stream_id in relay.attached_stream_ids.iter().copied() {
                            write_text_frame(socket, pty_exit_event(stream_id, exit_code))?;
                        }
                        return Ok(());
                    }
                }
                PtyEvent::Error(message) => {
                    write_text_frame(
                        socket,
                        stream_reset(
                            relay.primary_stream_id,
                            STREAM_RESET_CODE_TARGET_CLOSED,
                            message,
                        ),
                    )?;
                    return Ok(());
                }
            }
        }

        match socket.read() {
            Ok(Message::Text(payload)) => {
                let control_message = match parse_pty_control_message(payload.as_str()) {
                    Ok(message) => message,
                    Err(error) => {
                        write_text_frame(
                            socket,
                            stream_open_error(
                                relay.primary_stream_id,
                                CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST,
                                error.to_string(),
                            ),
                        )?;
                        return Ok(());
                    }
                };

                match control_message {
                    PtyControlMessage::Open(message) => {
                        if message.channel.pty_session_id != relay.pty_session_id
                            || message.channel.session != PtySessionMode::Attach
                        {
                            write_text_frame(
                                socket,
                                stream_open_error(
                                    message.stream_id,
                                    CONNECT_ERROR_CODE_PTY_SESSION_EXISTS,
                                    "pty session already exists",
                                ),
                            )?;
                            continue;
                        }

                        relay.attach_stream(message.stream_id);
                        write_text_frame(socket, stream_open_ok(message.stream_id))?;
                    }
                    PtyControlMessage::Signal(message) => {
                        if !relay.attached_stream_ids.contains(&message.stream_id) {
                            write_text_frame(
                                socket,
                                stream_reset(
                                    message.stream_id,
                                    STREAM_RESET_CODE_INVALID_STREAM_SIGNAL,
                                    format!(
                                        "stream signal streamId {} is not attached to the active PTY session",
                                        message.stream_id
                                    ),
                                ),
                            )?;
                            return Ok(());
                        }

                        session
                            .resize(message.signal.cols, message.signal.rows)
                            .map_err(|error| PtyStreamError::new(error.to_string()))?;
                    }
                    PtyControlMessage::Close(message) => {
                        if !relay.attached_stream_ids.contains(&message.stream_id) {
                            write_text_frame(
                                socket,
                                stream_reset(
                                    message.stream_id,
                                    STREAM_RESET_CODE_INVALID_STREAM_CLOSE,
                                    format!(
                                        "stream close streamId {} is not attached to the active PTY session",
                                        message.stream_id
                                    ),
                                ),
                            )?;
                            return Ok(());
                        }

                        if message.stream_id != relay.primary_stream_id {
                            relay.detach_stream(message.stream_id);
                            continue;
                        }

                        match session.terminate(
                            clock,
                            sleeper,
                            DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                            DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
                        ) {
                            Ok(exit_code) => {
                                for stream_id in relay.attached_stream_ids.iter().copied() {
                                    write_text_frame(socket, pty_exit_event(stream_id, exit_code))?;
                                }
                                return Ok(());
                            }
                            Err(error) => {
                                write_text_frame(
                                    socket,
                                    stream_reset(
                                        relay.primary_stream_id,
                                        STREAM_RESET_CODE_STREAM_CLOSE_FAILED,
                                        error.to_string(),
                                    ),
                                )?;
                                return Ok(());
                            }
                        }
                    }
                    PtyControlMessage::Window(message) => {
                        let Some(send_window) =
                            relay.send_windows_by_stream_id.get_mut(&message.stream_id)
                        else {
                            write_text_frame(
                                socket,
                                stream_reset(
                                    message.stream_id,
                                    STREAM_RESET_CODE_INVALID_STREAM_WINDOW,
                                    format!(
                                        "stream.window streamId {} is not attached to the active PTY session",
                                        message.stream_id
                                    ),
                                ),
                            )?;
                            return Ok(());
                        };

                        send_window
                            .add(message.bytes)
                            .map_err(|error| PtyStreamError::new(error.to_string()))?;
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
                                relay.primary_stream_id,
                                STREAM_RESET_CODE_INVALID_STREAM_DATA,
                                error.to_string(),
                            ),
                        )?;
                        return Ok(());
                    }
                };
                if !relay.attached_stream_ids.contains(&frame.stream_id) {
                    write_text_frame(
                        socket,
                        stream_reset(
                            frame.stream_id,
                            STREAM_RESET_CODE_INVALID_STREAM_DATA,
                            format!(
                                "stream data frame streamId {} is not attached to the active PTY session",
                                frame.stream_id
                            ),
                        ),
                    )?;
                    return Ok(());
                }

                session
                    .write(&frame.payload)
                    .map_err(|error| PtyStreamError::new(error.to_string()))?;
                write_text_frame(socket, stream_window(frame.stream_id, frame.payload.len()))?;
            }
            Ok(Message::Close(_)) => {
                let _ = session.terminate(
                    clock,
                    sleeper,
                    DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                    DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
                );
                return Ok(());
            }
            Ok(Message::Ping(payload)) => {
                socket.send(Message::Pong(payload)).map_err(|error| {
                    PtyStreamError::new(format!("failed to reply to tunnel ping: {error}"))
                })?;
            }
            Ok(Message::Pong(_)) => {}
            Ok(Message::Frame(_)) => {}
            Err(WebSocketError::Io(error)) if error.kind() == io::ErrorKind::WouldBlock => {
                sleeper.sleep(poll_interval);
            }
            Err(WebSocketError::ConnectionClosed) => {
                let _ = session.terminate(
                    clock,
                    sleeper,
                    DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                    DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
                );
                return Ok(());
            }
            Err(error) => {
                return Err(PtyStreamError::new(format!(
                    "failed to read pty tunnel message: {error}"
                )));
            }
        }
    }
}

fn write_text_frame<S>(socket: &mut WebSocket<S>, payload: String) -> Result<(), PtyStreamError>
where
    S: io::Read + io::Write,
{
    socket
        .send(Message::Text(payload.into()))
        .map_err(|error| PtyStreamError::new(format!("failed to write pty control frame: {error}")))
}
