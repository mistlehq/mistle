//! Port-access stream state owned by the live tunnel session.

use tokio::sync::mpsc;

use crate::tunnel::port_access_transport::PortAccessTcpCommand;
use crate::tunnel::protocol::StreamSendWindow;
use crate::tunnel::session::{TunnelSessionMutableState, tunnel_stream_is_active};

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
