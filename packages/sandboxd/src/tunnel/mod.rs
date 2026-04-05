use std::fmt::{self, Display};
use std::net::TcpStream;

use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket, connect};
use url::Url;

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

pub struct StartedBootstrapTunnel {
    connected_url: String,
    socket: Option<WebSocket<MaybeTlsStream<TcpStream>>>,
}

impl StartedBootstrapTunnel {
    pub fn connected_url(&self) -> &str {
        &self.connected_url
    }

    pub fn close(mut self) -> Result<(), TunnelError> {
        let Some(mut socket) = self.socket.take() else {
            return Ok(());
        };

        socket
            .send(Message::Close(None))
            .map_err(|error| TunnelError::new(format!("failed to close bootstrap tunnel: {error}")))?;
        socket
            .close(None)
            .map_err(|error| TunnelError::new(format!("failed to close bootstrap tunnel: {error}")))?;

        Ok(())
    }
}

pub fn normalize_bootstrap_token(bootstrap_token: &str) -> Result<String, TunnelError> {
    let normalized_token = bootstrap_token.trim();
    if normalized_token.is_empty() {
        return Err(TunnelError::new(
            "sandbox tunnel bootstrap token is required",
        ));
    }

    Ok(normalized_token.to_string())
}

pub fn parse_gateway_ws_url(gateway_ws_url: &str) -> Result<Url, TunnelError> {
    let parsed_url = Url::parse(gateway_ws_url).map_err(|error| {
        TunnelError::new(format!(
            "failed to parse sandbox tunnel gateway ws url: {error}"
        ))
    })?;

    match parsed_url.scheme() {
        "ws" | "wss" => Ok(parsed_url),
        _ => Err(TunnelError::new(
            "sandbox tunnel gateway ws url must use ws or wss scheme",
        )),
    }
}

pub fn build_bootstrap_tunnel_url(
    gateway_ws_url: &str,
    bootstrap_token: &str,
) -> Result<String, TunnelError> {
    let mut parsed_url = parse_gateway_ws_url(gateway_ws_url)?;
    parsed_url
        .query_pairs_mut()
        .append_pair("bootstrap_token", &normalize_bootstrap_token(bootstrap_token)?);

    Ok(parsed_url.to_string())
}

pub fn connect_bootstrap_tunnel(
    gateway_ws_url: &str,
    bootstrap_token: &str,
) -> Result<StartedBootstrapTunnel, TunnelError> {
    let connected_url = build_bootstrap_tunnel_url(gateway_ws_url, bootstrap_token)?;
    let (socket, _) = connect(&connected_url)
        .map_err(|error| TunnelError::new(format!("failed to connect bootstrap tunnel: {error}")))?;

    Ok(StartedBootstrapTunnel {
        connected_url,
        socket: Some(socket),
    })
}
