//! Blocking websocket listener for the Pi proxy component.
//!
//! The listener accepts local websocket clients, runs one session per
//! connection, and reports readiness through the same component surface as the
//! other runtime adapters.

use std::net::{SocketAddr, TcpListener};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender, TryRecvError, channel};
use std::sync::{Arc, Mutex};
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
                stream
                    .set_nonblocking(false)
                    .map_err(PiProxyError::ConfigureListener)?;
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
    let (response_sender, response_receiver) = channel::<String>();
    let regular_request_lock = Arc::new(Mutex::new(()));
    loop {
        send_queued_websocket_text_messages(&mut websocket, &event_receiver)?;
        send_queued_websocket_text_messages(&mut websocket, &response_receiver)?;
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
                spawn_json_rpc_request_handler(
                    state.clone(),
                    response_sender.clone(),
                    regular_request_lock.clone(),
                    payload,
                );
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

fn spawn_json_rpc_request_handler(
    state: Arc<PiProxyState>,
    response_sender: Sender<String>,
    regular_request_lock: Arc<Mutex<()>>,
    payload: tungstenite::Utf8Bytes,
) {
    thread::spawn(move || {
        if is_pi_extension_ui_response_request(&payload) {
            send_json_rpc_responses(&state, &response_sender, &payload);
        } else {
            let Ok(_guard) = regular_request_lock.lock() else {
                return;
            };
            send_json_rpc_responses(&state, &response_sender, &payload);
        }
    });
}

fn is_pi_extension_ui_response_request(payload: &str) -> bool {
    match serde_json::from_str::<serde_json::Value>(payload) {
        Ok(value) => {
            value.get("method").and_then(serde_json::Value::as_str)
                == Some("pi/respondToExtensionUI")
        }
        Err(_) => false,
    }
}

fn send_json_rpc_responses(
    state: &Arc<PiProxyState>,
    response_sender: &Sender<String>,
    payload: &str,
) {
    for response in handle_json_rpc_request(state, payload) {
        if response_sender.send(response).is_err() {
            return;
        }
    }
}

fn send_queued_websocket_text_messages(
    websocket: &mut tungstenite::WebSocket<std::net::TcpStream>,
    receiver: &Receiver<String>,
) -> Result<(), PiProxyError> {
    loop {
        match receiver.try_recv() {
            Ok(message) => websocket
                .send(Message::Text(message.into()))
                .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?,
            Err(TryRecvError::Empty) => return Ok(()),
            Err(TryRecvError::Disconnected) => return Ok(()),
        }
    }
}
