use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;

/// Performs a bare TCP connect check against one readiness endpoint.
pub(super) fn check_tcp_readiness(host: &str, port: u16) -> Result<(), String> {
    let address = resolve_socket_address(host, port)?;
    TcpStream::connect_timeout(&address, Duration::from_millis(250))
        .map(|_| ())
        .map_err(|error| format!("tcp readiness failed: {error}"))
}

/// Performs a minimal HTTP GET readiness probe and verifies the expected status.
pub(super) fn check_http_readiness(url: &str, expected_status: u16) -> Result<(), String> {
    check_http_readiness_with_timeout(url, expected_status, Duration::from_millis(250))
}

pub(super) fn check_http_readiness_with_timeout(
    url: &str,
    expected_status: u16,
    timeout: Duration,
) -> Result<(), String> {
    let status = readiness_probe_request(url, None, timeout)?;
    if status == expected_status {
        return Ok(());
    }

    Err(format!(
        "http readiness returned status {status}, expected {expected_status}"
    ))
}

/// Performs a minimal WebSocket handshake against the configured readiness URL.
pub(super) fn check_ws_readiness(url: &str) -> Result<(), String> {
    let status = readiness_probe_request(url, Some("websocket"), Duration::from_millis(250))?;
    if status == 101 {
        return Ok(());
    }

    Err(format!(
        "websocket readiness returned status {status}, expected 101"
    ))
}

/// Issues one plain-text readiness probe and returns the response status code.
pub(super) fn readiness_probe_request(
    url: &str,
    expected_upgrade: Option<&str>,
    timeout: Duration,
) -> Result<u16, String> {
    let parsed_url = ParsedReadinessUrl::parse(url)?;
    if parsed_url.scheme == "https" || parsed_url.scheme == "wss" {
        return Err(format!(
            "readiness url scheme '{}' is not supported yet",
            parsed_url.scheme
        ));
    }

    let address = resolve_socket_address(&parsed_url.host, parsed_url.port)?;
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| format!("readiness request failed: {error}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| format!("failed to configure readiness request timeout: {error}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|error| format!("failed to configure readiness request timeout: {error}"))?;

    let mut request = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\n",
        parsed_url.path, parsed_url.host
    );
    if let Some(expected_upgrade) = expected_upgrade {
        request.push_str("Connection: Upgrade\r\n");
        request.push_str(&format!("Upgrade: {expected_upgrade}\r\n"));
        request.push_str("Sec-WebSocket-Key: c2FuZGJveGQtcHJvY2Vzcw==\r\n");
        request.push_str("Sec-WebSocket-Version: 13\r\n");
    } else {
        request.push_str("Connection: close\r\n");
    }
    request.push_str("\r\n");

    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("failed to write readiness request: {error}"))?;

    let mut response_bytes = [0u8; 1024];
    let byte_count = stream
        .read(&mut response_bytes)
        .map_err(|error| format!("failed to read readiness response: {error}"))?;
    let response = std::str::from_utf8(&response_bytes[..byte_count])
        .map_err(|error| format!("readiness response was not valid utf-8: {error}"))?;
    parse_http_status(response)
}

pub(super) fn codex_app_server_readyz_url(readiness_url: &str) -> Result<String, String> {
    let parsed_url = ParsedReadinessUrl::parse(readiness_url)?;
    match parsed_url.scheme.as_str() {
        "ws" | "http" => Ok(format!(
            "http://{}:{}/readyz",
            parsed_url.host, parsed_url.port
        )),
        scheme => Err(format!(
            "unsupported Codex app-server readiness scheme '{scheme}'"
        )),
    }
}

/// Parses the HTTP status code from the first line of a readiness response.
pub(super) fn parse_http_status(response: &str) -> Result<u16, String> {
    let status_line = response
        .lines()
        .next()
        .ok_or_else(|| "readiness response was empty".to_string())?;
    let mut parts = status_line.split_whitespace();
    let _http_version = parts
        .next()
        .ok_or_else(|| "readiness response status line was incomplete".to_string())?;
    let status = parts
        .next()
        .ok_or_else(|| "readiness response status line was incomplete".to_string())?;
    status
        .parse::<u16>()
        .map_err(|error| format!("readiness response status was invalid: {error}"))
}

/// Resolves one host and port into the first socket address available for probing.
pub(super) fn resolve_socket_address(host: &str, port: u16) -> Result<SocketAddr, String> {
    (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("failed to resolve socket address {host}:{port}: {error}"))?
        .next()
        .ok_or_else(|| format!("failed to resolve socket address {host}:{port}"))
}

/// Splits a readiness URL into the scheme, host, port, and path to probe.
#[derive(Debug)]
struct ParsedReadinessUrl {
    scheme: String,
    host: String,
    port: u16,
    path: String,
}

impl ParsedReadinessUrl {
    /// Parses one readiness URL and fills in the default port for its scheme.
    pub(super) fn parse(url: &str) -> Result<Self, String> {
        let (scheme, rest) = url
            .split_once("://")
            .ok_or_else(|| format!("readiness url '{url}' is missing a scheme"))?;
        let (authority, path) = match rest.split_once('/') {
            Some((authority, path)) => (authority, format!("/{path}")),
            None => (rest, "/".to_string()),
        };
        if authority.is_empty() {
            return Err(format!("readiness url '{url}' is missing a host"));
        }

        let default_port = match scheme {
            "http" | "ws" => 80,
            "https" | "wss" => 443,
            _ => return Err(format!("readiness url scheme '{scheme}' is not supported")),
        };
        let (host, port) = match authority.rsplit_once(':') {
            Some((host, port)) if !host.contains(']') => (
                host.to_string(),
                port.parse::<u16>()
                    .map_err(|error| format!("invalid readiness port in '{url}': {error}"))?,
            ),
            _ => (authority.to_string(), default_port),
        };

        Ok(Self {
            scheme: scheme.to_string(),
            host,
            port,
            path,
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::process::readiness::{
        ParsedReadinessUrl, codex_app_server_readyz_url, parse_http_status,
    };

    #[test]
    fn parses_readiness_url_with_default_port_and_root_path() {
        let parsed_url = ParsedReadinessUrl::parse("ws://127.0.0.1").unwrap();

        assert_eq!(parsed_url.scheme, "ws");
        assert_eq!(parsed_url.host, "127.0.0.1");
        assert_eq!(parsed_url.port, 80);
        assert_eq!(parsed_url.path, "/");
    }

    #[test]
    fn parses_readiness_url_with_explicit_port_and_path() {
        let parsed_url = ParsedReadinessUrl::parse("http://localhost:4200/readyz").unwrap();

        assert_eq!(parsed_url.scheme, "http");
        assert_eq!(parsed_url.host, "localhost");
        assert_eq!(parsed_url.port, 4200);
        assert_eq!(parsed_url.path, "/readyz");
    }

    #[test]
    fn derives_codex_app_server_readyz_url_from_ws_readiness_url() {
        let readyz_url = codex_app_server_readyz_url("ws://127.0.0.1:3900/agent").unwrap();

        assert_eq!(readyz_url, "http://127.0.0.1:3900/readyz");
    }

    #[test]
    fn rejects_readiness_url_without_host() {
        let error = ParsedReadinessUrl::parse("http:///readyz").unwrap_err();

        assert_eq!(error, "readiness url 'http:///readyz' is missing a host");
    }

    #[test]
    fn parses_http_status_from_response_status_line() {
        let status = parse_http_status("HTTP/1.1 204 No Content\r\nConnection: close\r\n").unwrap();

        assert_eq!(status, 204);
    }

    #[test]
    fn rejects_incomplete_http_status_line() {
        let error = parse_http_status("HTTP/1.1\r\n").unwrap_err();

        assert_eq!(error, "readiness response status line was incomplete");
    }
}
