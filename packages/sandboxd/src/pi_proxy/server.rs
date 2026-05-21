use std::net::{SocketAddr, TcpListener};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, TryRecvError};
use std::thread;
use std::time::Duration;

use tungstenite::{Message, accept};
use url::Url;

use crate::pi_proxy::{PiProxyError, PiProxyState, json_rpc::handle_json_rpc_request};

const PI_PROXY_ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(100);
const PI_PROXY_CLIENT_READ_TIMEOUT: Duration = Duration::from_millis(100);

pub(super) fn parse_pi_proxy_listener_address(
    listen_url: &str,
) -> Result<SocketAddr, PiProxyError> {
    let url =
        Url::parse(listen_url).map_err(|error| PiProxyError::ParseListenUrl(error.to_string()))?;
    if url.scheme() != "ws" {
        return Err(PiProxyError::ListenUrlMustUseWebSocket {
            url: listen_url.to_string(),
        });
    }
    let host = url
        .host_str()
        .ok_or_else(|| PiProxyError::ListenUrlMissingHost {
            url: listen_url.to_string(),
        })?;
    let port = url
        .port()
        .ok_or_else(|| PiProxyError::ListenUrlMissingPort {
            url: listen_url.to_string(),
        })?;
    let address = format!("{host}:{port}");
    address
        .parse::<SocketAddr>()
        .map_err(|error| PiProxyError::ParseListenUrl(error.to_string()))
}

pub(super) fn run_pi_proxy_listener(
    listener: TcpListener,
    state: Arc<PiProxyState>,
    shutdown_requested: Arc<AtomicBool>,
) -> Result<(), PiProxyError> {
    while !shutdown_requested.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _address)) => {
                let session_state = state.clone();
                thread::spawn(move || {
                    let _ = handle_pi_proxy_client(stream, session_state);
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(PI_PROXY_ACCEPT_POLL_INTERVAL);
            }
            Err(error) => return Err(PiProxyError::AcceptClient(error)),
        }
    }
    Ok(())
}

fn handle_pi_proxy_client(
    stream: std::net::TcpStream,
    state: Arc<PiProxyState>,
) -> Result<(), PiProxyError> {
    let mut websocket =
        accept(stream).map_err(|error| PiProxyError::AcceptHandshake(error.to_string()))?;
    websocket
        .get_mut()
        .set_read_timeout(Some(PI_PROXY_CLIENT_READ_TIMEOUT))
        .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
    let event_receiver = state.subscribe_pi_events();
    loop {
        send_queued_pi_events(&mut websocket, &event_receiver)?;
        let message = match websocket.read() {
            Ok(message) => message,
            Err(tungstenite::Error::ConnectionClosed) => return Ok(()),
            Err(tungstenite::Error::AlreadyClosed) => return Ok(()),
            Err(tungstenite::Error::Io(error))
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut =>
            {
                continue;
            }
            Err(error) => return Err(PiProxyError::InvalidRequest(error.to_string())),
        };
        match message {
            Message::Text(payload) => {
                for response in handle_json_rpc_request(&state, &payload) {
                    websocket
                        .send(Message::Text(response.into()))
                        .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
                }
            }
            Message::Ping(payload) => {
                websocket
                    .send(Message::Pong(payload))
                    .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
            }
            Message::Close(frame) => {
                websocket
                    .close(frame)
                    .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
                return Ok(());
            }
            Message::Binary(_) | Message::Pong(_) | Message::Frame(_) => {}
        }
    }
}

fn send_queued_pi_events(
    websocket: &mut tungstenite::WebSocket<std::net::TcpStream>,
    event_receiver: &Receiver<String>,
) -> Result<(), PiProxyError> {
    loop {
        match event_receiver.try_recv() {
            Ok(notification) => websocket
                .send(Message::Text(notification.into()))
                .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?,
            Err(TryRecvError::Empty) => return Ok(()),
            Err(TryRecvError::Disconnected) => return Ok(()),
        }
    }
}
