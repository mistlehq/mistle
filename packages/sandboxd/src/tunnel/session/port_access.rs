//! Port-access stream state and routing owned by the live tunnel session.

use base64::Engine;
use tokio::sync::mpsc;

use crate::tunnel::port_access_transport::{
    PortAccessHttpCommand, PortAccessTcpCommand, PortAccessTransportEvent, spawn_http_transport,
    spawn_tcp_transport,
};
use crate::tunnel::protocol::{
    PAYLOAD_KIND_RAW_BYTES, STREAM_RESET_CODE_INVALID_STREAM_DATA,
    STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED, StreamDataFrame, StreamSendWindow,
    encode_stream_data_frame, stream_reset, stream_window,
};
use crate::tunnel::session::{
    TunnelSessionError, TunnelSessionEvent, TunnelSessionMutableState, TunnelWriterMessage,
    spawn_port_access_transport_event_sender, tunnel_stream_is_active, write_tunnel_binary,
    write_tunnel_text,
};

pub(super) struct PortAccessTcpStreamState {
    pub(super) sender: mpsc::UnboundedSender<PortAccessTcpCommand>,
    pub(super) request_window: StreamSendWindow,
    pub(super) request_closed: bool,
    pub(super) response_closed: bool,
}

impl PortAccessTcpStreamState {
    pub(super) fn new(sender: mpsc::UnboundedSender<PortAccessTcpCommand>) -> Self {
        Self {
            sender,
            request_window: StreamSendWindow::default(),
            request_closed: false,
            response_closed: false,
        }
    }
}

pub(super) fn port_access_stream_is_active(
    session_state: &TunnelSessionMutableState,
    stream_id: u32,
) -> bool {
    session_state
        .port_access_http_streams
        .contains_key(&stream_id)
        || session_state
            .port_access_tcp_streams
            .contains_key(&stream_id)
        || tunnel_stream_is_active(session_state, stream_id)
}

pub(super) fn mark_port_access_tcp_direction_closed(
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

pub(super) fn close_port_access_tcp_streams(session_state: &mut TunnelSessionMutableState) {
    for (_, stream_state) in std::mem::take(&mut session_state.port_access_tcp_streams) {
        let _ = stream_state.sender.send(PortAccessTcpCommand::Terminate);
    }
}

pub(super) fn handle_port_access_transport_event(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    event: PortAccessTransportEvent,
    session_state: &mut TunnelSessionMutableState,
) -> Result<(), TunnelSessionError> {
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
        PortAccessTransportEvent::HttpResponseStart(message) => serde_json::to_string(&message),
        PortAccessTransportEvent::HttpBodyChunk(message) => serde_json::to_string(&message),
        PortAccessTransportEvent::HttpBodyEnd(message) => serde_json::to_string(&message),
        PortAccessTransportEvent::TcpConnected(message) => serde_json::to_string(&message),
        PortAccessTransportEvent::TcpData { stream_id, bytes } => {
            let encoded = encode_stream_data_frame(stream_id, PAYLOAD_KIND_RAW_BYTES, &bytes)
                .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;
            return write_tunnel_binary(tunnel_writer_sender, encoded);
        }
        PortAccessTransportEvent::TcpInputWindow { stream_id, bytes } => {
            let Some(stream_state) = session_state.port_access_tcp_streams.get_mut(&stream_id)
            else {
                return Ok(());
            };
            stream_state
                .request_window
                .add(bytes)
                .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;
            return write_tunnel_text(tunnel_writer_sender, stream_window(stream_id, bytes));
        }
        PortAccessTransportEvent::TcpClose(message) => serde_json::to_string(&message),
        PortAccessTransportEvent::TcpError(message) => serde_json::to_string(&message),
        PortAccessTransportEvent::StreamError(message) => serde_json::to_string(&message),
    }
    .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;
    write_tunnel_text(tunnel_writer_sender, payload)
}

pub(super) fn handle_ports_transport_message(
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
                PortAccessTcpStreamState::new(stream_sender),
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

pub(super) fn handle_port_access_tcp_data_frame(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    frame: StreamDataFrame,
    session_state: &mut TunnelSessionMutableState,
) -> Result<(), TunnelSessionError> {
    if frame.payload_kind != PAYLOAD_KIND_RAW_BYTES {
        write_tunnel_text(
            tunnel_writer_sender,
            stream_reset(
                frame.stream_id,
                STREAM_RESET_CODE_INVALID_STREAM_DATA,
                "port access tcp stream only accepts raw byte data frames",
            ),
        )?;
        terminate_port_access_tcp_stream(session_state, frame.stream_id);
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
        terminate_port_access_tcp_stream(session_state, frame.stream_id);
        return Ok(());
    }
    stream_state
        .sender
        .send(PortAccessTcpCommand::Data {
            bytes: frame.payload,
        })
        .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;
    Ok(())
}

fn terminate_port_access_tcp_stream(session_state: &mut TunnelSessionMutableState, stream_id: u32) {
    if let Some(stream_state) = session_state.port_access_tcp_streams.remove(&stream_id) {
        let _ = stream_state.sender.send(PortAccessTcpCommand::Terminate);
    }
}
