//! Gateway-facing bootstrap tunnel helpers for `sandboxd`.
//!
//! The tunnel has two layers of responsibility:
//! - establish and close the outer websocket connection to the gateway
//! - host the stream-level channel implementations that run over that socket
//!   for PTY, agent runtime, file upload, telemetry, and port-access traffic

use std::fmt::{self, Display};
use std::net::TcpStream;

use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket, connect};
use url::Url;

pub mod agent_stream;
pub mod file_search;
pub mod file_upload;
pub mod port_access;
pub mod port_access_transport;
pub mod protocol;
pub mod runtime_processes;
pub mod session;
pub mod telemetry;
pub(crate) mod upload_classification;

/// Describes why bootstrap tunnel setup or shutdown failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TunnelError {
    message: String,
}

impl TunnelError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for TunnelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for TunnelError {}

#[derive(Debug)]
/// Owns one established bootstrap websocket connection.
pub struct BootstrapTunnel {
    connected_url: String,
    socket: Option<WebSocket<MaybeTlsStream<TcpStream>>>,
}

impl BootstrapTunnel {
    /// Returns the final websocket URL used to connect to the gateway.
    pub fn connected_url(&self) -> &str {
        &self.connected_url
    }

    /// Sends one text control frame over the bootstrap websocket.
    pub fn send_text(&mut self, payload: &str) -> Result<(), TunnelError> {
        let Some(socket) = self.socket.as_mut() else {
            return Err(TunnelError::new("bootstrap tunnel is already closed"));
        };

        socket
            .send(Message::Text(payload.to_string().into()))
            .map_err(|error| {
                TunnelError::new(format!(
                    "failed to write bootstrap tunnel text frame: {error}"
                ))
            })
    }

    /// Sends a websocket close frame and closes the underlying socket.
    pub fn close(&mut self) -> Result<(), TunnelError> {
        let Some(mut socket) = self.socket.take() else {
            return Ok(());
        };

        socket.send(Message::Close(None)).map_err(|error| {
            TunnelError::new(format!("failed to close bootstrap tunnel: {error}"))
        })?;
        socket.close(None).map_err(|error| {
            TunnelError::new(format!("failed to close bootstrap tunnel: {error}"))
        })?;

        Ok(())
    }
}

/// Connects `sandboxd` to the gateway bootstrap tunnel using the provided token.
pub fn connect_bootstrap_tunnel(
    gateway_ws_url: &str,
    bootstrap_token: &str,
) -> Result<BootstrapTunnel, TunnelError> {
    let normalized_token = bootstrap_token.trim();
    if normalized_token.is_empty() {
        return Err(TunnelError::new(
            "sandbox tunnel bootstrap token is required",
        ));
    }

    let mut parsed_url = Url::parse(gateway_ws_url).map_err(|error| {
        TunnelError::new(format!(
            "failed to parse sandbox tunnel gateway ws url: {error}"
        ))
    })?;
    match parsed_url.scheme() {
        "ws" | "wss" => {}
        _ => {
            return Err(TunnelError::new(
                "sandbox tunnel gateway ws url must use ws or wss scheme",
            ));
        }
    }

    // The bootstrap token travels on the initial websocket request so the
    // gateway can authenticate tunnel setup before exchanging tunnel frames.
    parsed_url
        .query_pairs_mut()
        .append_pair("bootstrap_token", normalized_token);
    let connected_url = parsed_url.to_string();

    let (socket, _) = connect(&connected_url).map_err(|error| {
        TunnelError::new(format!("failed to connect bootstrap tunnel: {error}"))
    })?;

    Ok(BootstrapTunnel {
        connected_url,
        socket: Some(socket),
    })
}
