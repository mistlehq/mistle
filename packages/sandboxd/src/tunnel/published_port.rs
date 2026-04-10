use std::sync::Arc;
use std::time::Duration as StdDuration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_rustls::TlsConnector;
use tokio_rustls::rustls::client::danger::{
    HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier,
};
use tokio_rustls::rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use tokio_rustls::rustls::{ClientConfig, DigitallySignedStruct, Error, SignatureScheme};

use crate::time::Clock;
use crate::tunnel::runtime_processes::collect_processes_snapshot;

const PROBE_TIMEOUT: StdDuration = StdDuration::from_millis(250);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublishedPortProtocol {
    Http,
    Https,
}

impl PublishedPortProtocol {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Http => "http",
            Self::Https => "https",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishedPortAuthorization {
    pub protocol: PublishedPortProtocol,
    pub websocket_capable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublishedPortAuthorizeFailure {
    PortUnreachable,
    UnsupportedProtocol,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PublishedPortProbeFailure {
    PortUnreachable,
    UnsupportedProtocol,
}

pub async fn authorize_published_port(
    port: u16,
    clock: &dyn Clock,
) -> Result<PublishedPortAuthorization, PublishedPortAuthorizeFailure> {
    let snapshot = collect_processes_snapshot(clock)
        .map_err(|_error| PublishedPortAuthorizeFailure::PortUnreachable)?;
    let has_listener = snapshot
        .processes
        .iter()
        .flat_map(|process| process.listeners.iter())
        .any(|listener| listener.port == port);
    if !has_listener {
        return Err(PublishedPortAuthorizeFailure::PortUnreachable);
    }

    let http_probe = probe_http_port(port).await;
    if let Ok(websocket_capable) = http_probe {
        return Ok(PublishedPortAuthorization {
            protocol: PublishedPortProtocol::Http,
            websocket_capable,
        });
    }

    let https_probe = probe_https_port(port).await;
    if let Ok(websocket_capable) = https_probe {
        return Ok(PublishedPortAuthorization {
            protocol: PublishedPortProtocol::Https,
            websocket_capable,
        });
    }

    if matches!(http_probe, Err(PublishedPortProbeFailure::PortUnreachable))
        && matches!(https_probe, Err(PublishedPortProbeFailure::PortUnreachable))
    {
        return Err(PublishedPortAuthorizeFailure::PortUnreachable);
    }

    Err(PublishedPortAuthorizeFailure::UnsupportedProtocol)
}

async fn probe_http_port(port: u16) -> Result<bool, PublishedPortProbeFailure> {
    let status = probe_http_status_over_tcp(port, false).await?;
    if !(100..=599).contains(&status) {
        return Err(PublishedPortProbeFailure::UnsupportedProtocol);
    }

    let websocket_capable = matches!(probe_http_status_over_tcp(port, true).await, Ok(101));
    Ok(websocket_capable)
}

async fn probe_https_port(port: u16) -> Result<bool, PublishedPortProbeFailure> {
    let status = probe_http_status_over_tls(port, false).await?;
    if !(100..=599).contains(&status) {
        return Err(PublishedPortProbeFailure::UnsupportedProtocol);
    }

    let websocket_capable = matches!(probe_http_status_over_tls(port, true).await, Ok(101));
    Ok(websocket_capable)
}

async fn probe_http_status_over_tcp(
    port: u16,
    websocket_upgrade: bool,
) -> Result<u16, PublishedPortProbeFailure> {
    let stream = timeout(PROBE_TIMEOUT, TcpStream::connect(("127.0.0.1", port)))
        .await
        .map_err(|_elapsed| PublishedPortProbeFailure::PortUnreachable)?
        .map_err(|_error| PublishedPortProbeFailure::PortUnreachable)?;

    probe_http_status(stream, websocket_upgrade).await
}

async fn probe_http_status_over_tls(
    port: u16,
    websocket_upgrade: bool,
) -> Result<u16, PublishedPortProbeFailure> {
    let tcp_stream = timeout(PROBE_TIMEOUT, TcpStream::connect(("127.0.0.1", port)))
        .await
        .map_err(|_elapsed| PublishedPortProbeFailure::PortUnreachable)?
        .map_err(|_error| PublishedPortProbeFailure::PortUnreachable)?;
    let tls_connector = TlsConnector::from(Arc::new(
        ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoVerifier))
            .with_no_client_auth(),
    ));
    let server_name = ServerName::try_from("localhost")
        .map_err(|_error| PublishedPortProbeFailure::UnsupportedProtocol)?;
    let tls_stream = timeout(PROBE_TIMEOUT, tls_connector.connect(server_name, tcp_stream))
        .await
        .map_err(|_elapsed| PublishedPortProbeFailure::PortUnreachable)?
        .map_err(|_error| PublishedPortProbeFailure::UnsupportedProtocol)?;

    probe_http_status(tls_stream, websocket_upgrade).await
}

async fn probe_http_status<T>(
    mut stream: T,
    websocket_upgrade: bool,
) -> Result<u16, PublishedPortProbeFailure>
where
    T: AsyncRead + AsyncWrite + Unpin,
{
    let mut request = "GET / HTTP/1.1\r\nHost: localhost\r\n".to_string();
    if websocket_upgrade {
        request.push_str("Connection: Upgrade\r\n");
        request.push_str("Upgrade: websocket\r\n");
        request.push_str("Sec-WebSocket-Key: c2FuZGJveGQtcHVibGlzaA==\r\n");
        request.push_str("Sec-WebSocket-Version: 13\r\n");
    } else {
        request.push_str("Connection: close\r\n");
    }
    request.push_str("\r\n");

    timeout(PROBE_TIMEOUT, stream.write_all(request.as_bytes()))
        .await
        .map_err(|_elapsed| PublishedPortProbeFailure::PortUnreachable)?
        .map_err(|_error| PublishedPortProbeFailure::PortUnreachable)?;

    let mut response_bytes = vec![0_u8; 1024];
    let byte_count = timeout(PROBE_TIMEOUT, stream.read(&mut response_bytes))
        .await
        .map_err(|_elapsed| PublishedPortProbeFailure::PortUnreachable)?
        .map_err(|_error| PublishedPortProbeFailure::PortUnreachable)?;
    if byte_count == 0 {
        return Err(PublishedPortProbeFailure::PortUnreachable);
    }

    let response = std::str::from_utf8(&response_bytes[..byte_count])
        .map_err(|_error| PublishedPortProbeFailure::UnsupportedProtocol)?;
    parse_http_status(response)
}

fn parse_http_status(response: &str) -> Result<u16, PublishedPortProbeFailure> {
    let status_line = response
        .lines()
        .next()
        .ok_or(PublishedPortProbeFailure::UnsupportedProtocol)?;
    let mut parts = status_line.split_whitespace();
    let _http_version = parts
        .next()
        .ok_or(PublishedPortProbeFailure::UnsupportedProtocol)?;
    let status = parts
        .next()
        .ok_or(PublishedPortProbeFailure::UnsupportedProtocol)?;

    status
        .parse::<u16>()
        .map_err(|_error| PublishedPortProbeFailure::UnsupportedProtocol)
}

#[derive(Debug)]
struct NoVerifier;

impl ServerCertVerifier for NoVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::RSA_PKCS1_SHA1,
            SignatureScheme::ECDSA_SHA1_Legacy,
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::ECDSA_NISTP521_SHA512,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::ED25519,
            SignatureScheme::ED448,
        ]
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "linux")]
    use std::net::TcpStream as StdTcpStream;
    #[cfg(target_os = "linux")]
    use std::net::TcpListener;
    #[cfg(target_os = "linux")]
    use std::thread;
    #[cfg(target_os = "linux")]
    use std::time::{Duration, Instant};

    #[cfg(target_os = "linux")]
    use crate::time::testing::MutableClock;
    #[cfg(target_os = "linux")]
    use crate::tunnel::runtime_processes::collect_processes_snapshot;

    #[cfg(target_os = "linux")]
    use super::{
        PublishedPortAuthorizeFailure, PublishedPortProtocol, authorize_published_port,
    };

    #[cfg(target_os = "linux")]
    fn reserve_available_port() -> u16 {
        TcpListener::bind("127.0.0.1:0")
            .expect("ephemeral listener should bind")
            .local_addr()
            .expect("ephemeral listener should expose local address")
            .port()
    }

    #[cfg(target_os = "linux")]
    fn spawn_fixture_process(script_name: &str, port: u16) -> std::process::Child {
        let script_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join(script_name);
        std::process::Command::new("node")
            .arg(script_path)
            .arg(port.to_string())
            .spawn()
            .expect("fixture process should spawn")
    }

    #[cfg(target_os = "linux")]
    fn wait_until_listening(port: u16) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if StdTcpStream::connect(("127.0.0.1", port)).is_ok() {
                return;
            }

            thread::sleep(Duration::from_millis(10));
        }

        panic!("listener on port {port} did not become ready");
    }

    #[cfg(target_os = "linux")]
    fn terminate_child(child: &mut std::process::Child) {
        let _ = child.kill();
        let _ = child.wait();
    }

    #[cfg(target_os = "linux")]
    fn wait_until_snapshot_contains_port(port: u16, clock: &MutableClock) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            let snapshot = collect_processes_snapshot(clock)
                .expect("process snapshot collection should succeed in tests");
            if snapshot
                .processes
                .iter()
                .flat_map(|process| process.listeners.iter())
                .any(|listener| listener.port == port)
            {
                return;
            }

            thread::sleep(Duration::from_millis(10));
        }

        panic!("process snapshot did not include port {port}");
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn authorizes_http_ports_and_detects_websocket_support() {
        let port = reserve_available_port();
        let mut process = spawn_fixture_process("published_port_http_server.cjs", port);
        wait_until_listening(port);

        let clock = MutableClock::new(1_000);
        wait_until_snapshot_contains_port(port, &clock);
        let authorization = authorize_published_port(port, &clock)
            .await
            .expect("http port should authorize");

        assert_eq!(authorization.protocol, PublishedPortProtocol::Http);
        assert!(authorization.websocket_capable);

        terminate_child(&mut process);
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn rejects_ports_that_speak_unsupported_protocols() {
        let port = reserve_available_port();
        let mut process = spawn_fixture_process("published_port_raw_server.cjs", port);
        wait_until_listening(port);

        let clock = MutableClock::new(1_000);
        wait_until_snapshot_contains_port(port, &clock);
        let result = authorize_published_port(port, &clock).await;

        assert_eq!(result, Err(PublishedPortAuthorizeFailure::UnsupportedProtocol));

        terminate_child(&mut process);
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn rejects_unreachable_ports() {
        let port = reserve_available_port();
        let clock = MutableClock::new(1_000);

        let result = authorize_published_port(port, &clock).await;

        assert_eq!(result, Err(PublishedPortAuthorizeFailure::PortUnreachable));
    }
}
