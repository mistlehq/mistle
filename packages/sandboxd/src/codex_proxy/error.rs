use std::fmt;

use tungstenite::Error as WebSocketError;

/// Describes why Codex proxy startup, relay, or monitor handling failed.
#[derive(Debug)]
pub enum CodexProxyError {
    ParseListenUrl(String),
    ParseRawUrl(String),
    ListenUrlMustUseWebSocket {
        url: String,
    },
    RawUrlMustUseWebSocket {
        url: String,
    },
    ListenUrlMissingHost {
        url: String,
    },
    ListenUrlMissingPort {
        url: String,
    },
    BindListener {
        address: String,
        error: std::io::Error,
    },
    ConfigureListener(std::io::Error),
    AcceptClient(std::io::Error),
    AcceptHandshake(String),
    ConfigureRuntime(String),
    ConnectRaw(WebSocketError),
    InvalidJson(serde_json::Error),
    MissingResponseId {
        expected_id: u64,
    },
    InvalidThreadLoadedList(String),
    InvalidThreadRead(String),
    ReadSocket(WebSocketError),
    WriteSocket(WebSocketError),
    RuntimePanicked,
    SessionPanicked,
}

impl fmt::Display for CodexProxyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ParseListenUrl(error) => {
                write!(f, "failed to parse Codex proxy listen URL: {error}")
            }
            Self::ParseRawUrl(error) => {
                write!(f, "failed to parse raw Codex app-server URL: {error}")
            }
            Self::ListenUrlMustUseWebSocket { url } => {
                write!(f, "Codex proxy listen URL must use ws scheme: {url}")
            }
            Self::RawUrlMustUseWebSocket { url } => {
                write!(f, "raw Codex app-server URL must use ws scheme: {url}")
            }
            Self::ListenUrlMissingHost { url } => {
                write!(f, "Codex proxy listen URL must include a host: {url}")
            }
            Self::ListenUrlMissingPort { url } => {
                write!(f, "Codex proxy listen URL must include a port: {url}")
            }
            Self::BindListener { address, error } => {
                write!(f, "failed to bind Codex proxy listener {address}: {error}")
            }
            Self::ConfigureListener(error) => {
                write!(f, "failed to configure Codex proxy listener: {error}")
            }
            Self::AcceptClient(error) => {
                write!(f, "failed to accept Codex proxy client: {error}")
            }
            Self::AcceptHandshake(error) => {
                write!(
                    f,
                    "failed to accept Codex proxy websocket handshake: {error}"
                )
            }
            Self::ConfigureRuntime(error) => {
                write!(f, "failed to configure Codex proxy runtime: {error}")
            }
            Self::ConnectRaw(error) => {
                write!(f, "failed to connect to raw Codex app-server: {error}")
            }
            Self::InvalidJson(error) => {
                write!(f, "Codex proxy received invalid JSON-RPC payload: {error}")
            }
            Self::MissingResponseId { expected_id } => {
                write!(f, "Codex monitor did not receive response id {expected_id}")
            }
            Self::InvalidThreadLoadedList(message) => {
                write!(
                    f,
                    "Codex monitor received invalid thread/loaded/list response: {message}"
                )
            }
            Self::InvalidThreadRead(message) => {
                write!(
                    f,
                    "Codex monitor received invalid thread/read response: {message}"
                )
            }
            Self::ReadSocket(error) => write!(f, "failed to read Codex websocket message: {error}"),
            Self::WriteSocket(error) => {
                write!(f, "failed to write Codex websocket message: {error}")
            }
            Self::RuntimePanicked => write!(f, "Codex proxy runtime thread panicked"),
            Self::SessionPanicked => write!(f, "Codex proxy task panicked"),
        }
    }
}

impl std::error::Error for CodexProxyError {}

pub(crate) fn normalize_codex_proxy_exit_result(
    exit_result: Result<(), CodexProxyError>,
) -> CodexProxyError {
    match exit_result {
        Ok(()) => {
            CodexProxyError::ConfigureRuntime("Codex proxy runtime exited unexpectedly".to_string())
        }
        Err(error) => error,
    }
}

pub(crate) fn clone_codex_proxy_error(error: &CodexProxyError) -> CodexProxyError {
    match error {
        CodexProxyError::ParseListenUrl(message) => {
            CodexProxyError::ParseListenUrl(message.clone())
        }
        CodexProxyError::ParseRawUrl(message) => CodexProxyError::ParseRawUrl(message.clone()),
        CodexProxyError::ListenUrlMustUseWebSocket { url } => {
            CodexProxyError::ListenUrlMustUseWebSocket { url: url.clone() }
        }
        CodexProxyError::RawUrlMustUseWebSocket { url } => {
            CodexProxyError::RawUrlMustUseWebSocket { url: url.clone() }
        }
        CodexProxyError::ListenUrlMissingHost { url } => {
            CodexProxyError::ListenUrlMissingHost { url: url.clone() }
        }
        CodexProxyError::ListenUrlMissingPort { url } => {
            CodexProxyError::ListenUrlMissingPort { url: url.clone() }
        }
        CodexProxyError::BindListener { address, error } => CodexProxyError::BindListener {
            address: address.clone(),
            error: std::io::Error::new(error.kind(), error.to_string()),
        },
        CodexProxyError::ConfigureListener(error) => {
            CodexProxyError::ConfigureListener(std::io::Error::new(error.kind(), error.to_string()))
        }
        CodexProxyError::AcceptClient(error) => {
            CodexProxyError::AcceptClient(std::io::Error::new(error.kind(), error.to_string()))
        }
        CodexProxyError::AcceptHandshake(message) => {
            CodexProxyError::AcceptHandshake(message.clone())
        }
        CodexProxyError::ConfigureRuntime(message) => {
            CodexProxyError::ConfigureRuntime(message.clone())
        }
        CodexProxyError::ConnectRaw(error) => {
            CodexProxyError::ConnectRaw(clone_websocket_error(error))
        }
        CodexProxyError::InvalidJson(error) => CodexProxyError::InvalidJson(serde_json::Error::io(
            std::io::Error::other(error.to_string()),
        )),
        CodexProxyError::MissingResponseId { expected_id } => CodexProxyError::MissingResponseId {
            expected_id: *expected_id,
        },
        CodexProxyError::InvalidThreadLoadedList(message) => {
            CodexProxyError::InvalidThreadLoadedList(message.clone())
        }
        CodexProxyError::InvalidThreadRead(message) => {
            CodexProxyError::InvalidThreadRead(message.clone())
        }
        CodexProxyError::ReadSocket(error) => {
            CodexProxyError::ReadSocket(clone_websocket_error(error))
        }
        CodexProxyError::WriteSocket(error) => {
            CodexProxyError::WriteSocket(clone_websocket_error(error))
        }
        CodexProxyError::RuntimePanicked => CodexProxyError::RuntimePanicked,
        CodexProxyError::SessionPanicked => CodexProxyError::SessionPanicked,
    }
}

fn clone_websocket_error(error: &WebSocketError) -> WebSocketError {
    WebSocketError::Io(std::io::Error::other(error.to_string()))
}
