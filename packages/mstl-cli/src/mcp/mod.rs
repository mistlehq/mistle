use std::fmt;
use std::io::Write;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use axum::Router;
use rmcp::ServerHandler;
use rmcp::model::{Implementation, ServerCapabilities, ServerInfo};
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use tokio::net::TcpListener;

const MCP_PATH: &str = "/mcp";

pub(crate) async fn run_serve<W, E>(host: &str, port: u16, stdout: &mut W, stderr: &mut E) -> i32
where
    W: Write,
    E: Write,
{
    match serve(host, port, stdout).await {
        Ok(()) => 0,
        Err(error) => {
            let _ = writeln!(stderr, "{error}");
            1
        }
    }
}

async fn serve<W>(host: &str, port: u16, stdout: &mut W) -> Result<(), McpServerError>
where
    W: Write,
{
    let bind_addr = bind_addr(host, port)?;
    let service: StreamableHttpService<MistleMcpServer, LocalSessionManager> =
        StreamableHttpService::new(
            || Ok(MistleMcpServer),
            Arc::new(LocalSessionManager::default()),
            StreamableHttpServerConfig::default(),
        );
    let router = Router::new().nest_service(MCP_PATH, service);
    let listener = TcpListener::bind(bind_addr)
        .await
        .map_err(|source| McpServerError::Bind { bind_addr, source })?;
    let local_addr = listener
        .local_addr()
        .map_err(McpServerError::ReadLocalAddr)?;

    writeln!(
        stdout,
        "Mistle MCP server listening on http://{local_addr}{MCP_PATH}"
    )
    .map_err(McpServerError::WriteStatus)?;

    axum::serve(listener, router)
        .await
        .map_err(McpServerError::Serve)
}

fn bind_addr(host: &str, port: u16) -> Result<SocketAddr, McpServerError> {
    let host = host
        .parse::<IpAddr>()
        .map_err(|source| McpServerError::InvalidHost {
            host: host.to_owned(),
            source,
        })?;

    Ok(SocketAddr::new(host, port))
}

#[derive(Clone)]
struct MistleMcpServer;

impl ServerHandler for MistleMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::default())
            .with_server_info(Implementation::new("mistle", env!("CARGO_PKG_VERSION")))
    }
}

#[derive(Debug)]
enum McpServerError {
    InvalidHost {
        host: String,
        source: std::net::AddrParseError,
    },
    Bind {
        bind_addr: SocketAddr,
        source: std::io::Error,
    },
    ReadLocalAddr(std::io::Error),
    WriteStatus(std::io::Error),
    Serve(std::io::Error),
}

impl fmt::Display for McpServerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidHost { host, source } => {
                write!(formatter, "invalid MCP server host `{host}`: {source}")
            }
            Self::Bind { bind_addr, source } => {
                write!(
                    formatter,
                    "failed to bind MCP server to {bind_addr}: {source}"
                )
            }
            Self::ReadLocalAddr(source) => {
                write!(
                    formatter,
                    "failed to read MCP server local address: {source}"
                )
            }
            Self::WriteStatus(source) => {
                write!(formatter, "failed to write MCP server status: {source}")
            }
            Self::Serve(source) => {
                write!(formatter, "MCP server failed: {source}")
            }
        }
    }
}

impl std::error::Error for McpServerError {}

#[cfg(test)]
mod tests {
    use crate::mcp::bind_addr;

    #[test]
    fn binds_loopback_by_default_shape() {
        let bind_addr = bind_addr("127.0.0.1", 3000).expect("valid bind address");

        assert_eq!(bind_addr.to_string(), "127.0.0.1:3000");
    }

    #[test]
    fn allows_wildcard_host() {
        let bind_addr = bind_addr("0.0.0.0", 3000).expect("valid bind address");

        assert_eq!(bind_addr.to_string(), "0.0.0.0:3000");
    }

    #[test]
    fn rejects_invalid_host() {
        assert!(bind_addr("localhost", 3000).is_err());
    }
}
