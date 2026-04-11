//! Exact-port authorization and lightweight protocol preflight for port access.

use std::fmt::{self, Display};
use std::sync::Arc;

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
use crate::tunnel::protocol::{
    PORT_ACCESS_AUTHORIZE_REASON_PORT_UNREACHABLE,
    PORT_ACCESS_AUTHORIZE_REASON_UNSUPPORTED_PROTOCOL, PortAccessTarget,
};
use crate::tunnel::runtime_processes::collect_processes_snapshot;

const DEFAULT_PORT_ACCESS_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
const PROBE_RESPONSE_BUFFER_BYTES: usize = 1024;
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortAccessAuthorizeError {
    message: String,
}

impl PortAccessAuthorizeError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for PortAccessAuthorizeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for PortAccessAuthorizeError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PortAccessAuthorizeDecision {
    Authorized {
        upstream_protocol: &'static str,
        websocket_capable: bool,
    },
    Rejected {
        reason: &'static str,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProbeOutcome {
    Supported {
        upstream_protocol: &'static str,
        websocket_capable: bool,
    },
    PortUnreachable,
    UnsupportedProtocol,
}

/// Validates that the exact target port is still live and speaks a supported
/// browser-facing protocol family.
pub async fn authorize_target_port(
    clock: &dyn Clock,
    target: &PortAccessTarget,
) -> Result<PortAccessAuthorizeDecision, PortAccessAuthorizeError> {
    if !port_exists_in_processes_snapshot(clock, target.port)? {
        return Ok(PortAccessAuthorizeDecision::Rejected {
            reason: PORT_ACCESS_AUTHORIZE_REASON_PORT_UNREACHABLE,
        });
    }

    let http_outcome = probe_http(target.port).await;
    if let ProbeOutcome::Supported {
        upstream_protocol,
        websocket_capable,
    } = http_outcome
    {
        return Ok(PortAccessAuthorizeDecision::Authorized {
            upstream_protocol,
            websocket_capable,
        });
    }

    let https_outcome = probe_https(target.port).await;
    if let ProbeOutcome::Supported {
        upstream_protocol,
        websocket_capable,
    } = https_outcome
    {
        return Ok(PortAccessAuthorizeDecision::Authorized {
            upstream_protocol,
            websocket_capable,
        });
    }

    if http_outcome.is_port_unreachable() && https_outcome.is_port_unreachable() {
        return Ok(PortAccessAuthorizeDecision::Rejected {
            reason: PORT_ACCESS_AUTHORIZE_REASON_PORT_UNREACHABLE,
        });
    }

    Ok(PortAccessAuthorizeDecision::Rejected {
        reason: PORT_ACCESS_AUTHORIZE_REASON_UNSUPPORTED_PROTOCOL,
    })
}

fn port_exists_in_processes_snapshot(
    clock: &dyn Clock,
    port: u16,
) -> Result<bool, PortAccessAuthorizeError> {
    let snapshot = collect_processes_snapshot(clock)
        .map_err(|error| PortAccessAuthorizeError::new(error.to_string()))?;

    Ok(snapshot.processes.iter().any(|process| {
        process
            .listeners
            .iter()
            .any(|listener| listener.port == port)
    }))
}

async fn probe_http(port: u16) -> ProbeOutcome {
    let Ok(mut stream) = connect_loopback(port).await else {
        return ProbeOutcome::PortUnreachable;
    };

    if !probe_http_like_response(&mut stream, port).await {
        return ProbeOutcome::UnsupportedProtocol;
    }

    ProbeOutcome::Supported {
        upstream_protocol: "http",
        websocket_capable: probe_websocket_http(port).await,
    }
}

async fn probe_https(port: u16) -> ProbeOutcome {
    let Ok(stream) = connect_loopback(port).await else {
        return ProbeOutcome::PortUnreachable;
    };

    let tls_connector = build_tls_connector();
    let Ok(server_name) = server_name() else {
        return ProbeOutcome::UnsupportedProtocol;
    };
    let Ok(handshake_result) = timeout(
        DEFAULT_PORT_ACCESS_PROBE_TIMEOUT,
        tls_connector.connect(server_name, stream),
    )
    .await
    else {
        return ProbeOutcome::UnsupportedProtocol;
    };
    let Ok(mut tls_stream) = handshake_result else {
        return ProbeOutcome::UnsupportedProtocol;
    };

    if !probe_http_like_response(&mut tls_stream, port).await {
        return ProbeOutcome::UnsupportedProtocol;
    }

    ProbeOutcome::Supported {
        upstream_protocol: "https",
        websocket_capable: probe_websocket_https(port).await,
    }
}

async fn connect_loopback(port: u16) -> Result<TcpStream, PortAccessAuthorizeError> {
    let connect_result = timeout(
        DEFAULT_PORT_ACCESS_PROBE_TIMEOUT,
        TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    .map_err(|_| PortAccessAuthorizeError::new("port probe timed out"))?;

    connect_result.map_err(|error| PortAccessAuthorizeError::new(error.to_string()))
}

async fn probe_http_like_response<S>(stream: &mut S, port: u16) -> bool
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let request = format!(
        "GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    if timeout(
        DEFAULT_PORT_ACCESS_PROBE_TIMEOUT,
        stream.write_all(request.as_bytes()),
    )
    .await
    .is_err()
    {
        return false;
    }

    let mut response = vec![0; PROBE_RESPONSE_BUFFER_BYTES];
    let read_result = timeout(
        DEFAULT_PORT_ACCESS_PROBE_TIMEOUT,
        stream.read(&mut response),
    )
    .await;
    let Ok(Ok(bytes_read)) = read_result else {
        return false;
    };
    if bytes_read == 0 {
        return false;
    }

    response[..bytes_read].starts_with(b"HTTP/1.")
}

async fn probe_websocket_http(port: u16) -> bool {
    let Ok(mut stream) = connect_loopback(port).await else {
        return false;
    };

    probe_websocket_upgrade_response(&mut stream, port).await
}

async fn probe_websocket_https(port: u16) -> bool {
    let Ok(stream) = connect_loopback(port).await else {
        return false;
    };
    let tls_connector = build_tls_connector();
    let Ok(server_name) = server_name() else {
        return false;
    };
    let Ok(handshake_result) = timeout(
        DEFAULT_PORT_ACCESS_PROBE_TIMEOUT,
        tls_connector.connect(server_name, stream),
    )
    .await
    else {
        return false;
    };
    let Ok(mut tls_stream) = handshake_result else {
        return false;
    };

    probe_websocket_upgrade_response(&mut tls_stream, port).await
}

fn build_tls_connector() -> TlsConnector {
    TlsConnector::from(Arc::new(
        ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(AcceptAnyServerCertVerifier))
            .with_no_client_auth(),
    ))
}

fn server_name() -> Result<ServerName<'static>, PortAccessAuthorizeError> {
    ServerName::try_from("localhost")
        .map(|server_name| server_name.to_owned())
        .map_err(|error| PortAccessAuthorizeError::new(error.to_string()))
}

async fn probe_websocket_upgrade_response<S>(stream: &mut S, port: u16) -> bool
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let request = format!(
        "GET / HTTP/1.1\r\n\
         Host: 127.0.0.1:{port}\r\n\
         Connection: Upgrade\r\n\
         Upgrade: websocket\r\n\
         Sec-WebSocket-Version: 13\r\n\
         Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
    );
    if timeout(
        DEFAULT_PORT_ACCESS_PROBE_TIMEOUT,
        stream.write_all(request.as_bytes()),
    )
    .await
    .is_err()
    {
        return false;
    }

    let mut response = vec![0; PROBE_RESPONSE_BUFFER_BYTES];
    let Ok(Ok(bytes_read)) = timeout(
        DEFAULT_PORT_ACCESS_PROBE_TIMEOUT,
        stream.read(&mut response),
    )
    .await
    else {
        return false;
    };
    if bytes_read == 0 {
        return false;
    }

    response[..bytes_read].starts_with(b"HTTP/1.1 101")
        || response[..bytes_read].starts_with(b"HTTP/1.0 101")
}

impl ProbeOutcome {
    fn is_port_unreachable(self) -> bool {
        matches!(self, Self::PortUnreachable)
    }
}

#[derive(Debug)]
struct AcceptAnyServerCertVerifier;

impl ServerCertVerifier for AcceptAnyServerCertVerifier {
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
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::ED25519,
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
        ]
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use std::path::PathBuf;
    use std::process::{Child, Command, Stdio};
    use std::thread;
    use std::time::Duration;

    use tokio::runtime::Builder;

    use crate::time::SystemClock;
    use crate::tunnel::port_access::{PortAccessAuthorizeDecision, authorize_target_port};
    use crate::tunnel::protocol::PortAccessTarget;

    fn fixture_path(script_name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(script_name)
    }

    fn spawn_node_fixture(script_name: &str, args: &[&str]) -> Child {
        Command::new("node")
            .arg(fixture_path(script_name))
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("node fixture should spawn")
    }

    fn reserve_available_port() -> u16 {
        let listener =
            std::net::TcpListener::bind("127.0.0.1:0").expect("port reservation listener should bind");
        let port = listener
            .local_addr()
            .expect("reserved listener should expose its address")
            .port();
        drop(listener);
        port
    }

    fn wait_until_listening(port: u16) {
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "timed out waiting for fixture port {port} to accept connections"
            );
            thread::sleep(Duration::from_millis(25));
        }
    }

    fn terminate_child(child: &mut Child) {
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn authorizes_reachable_http_ports() {
        let port = reserve_available_port();
        let mut server = spawn_node_fixture("http-listener.js", &[&port.to_string(), "authorize-http"]);
        wait_until_listening(port);

        let runtime = Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime should build");
        let decision = runtime
            .block_on(authorize_target_port(
                &SystemClock,
                &PortAccessTarget {
                    kind: "port".to_string(),
                    port,
                },
            ))
            .expect("authorize_target_port should succeed");

        assert_eq!(
            decision,
            PortAccessAuthorizeDecision::Authorized {
                upstream_protocol: "http",
                websocket_capable: false,
            }
        );

        terminate_child(&mut server);
    }

    #[test]
    fn authorizes_reachable_http_ports_with_websocket_upgrade_support() {
        let port = reserve_available_port();
        let mut server =
            spawn_node_fixture("http-ws-listener.js", &[&port.to_string(), "authorize-http-ws"]);
        wait_until_listening(port);

        let runtime = Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime should build");
        let decision = runtime
            .block_on(authorize_target_port(
                &SystemClock,
                &PortAccessTarget {
                    kind: "port".to_string(),
                    port,
                },
            ))
            .expect("authorize_target_port should succeed");

        assert_eq!(
            decision,
            PortAccessAuthorizeDecision::Authorized {
                upstream_protocol: "http",
                websocket_capable: true,
            }
        );

        terminate_child(&mut server);
    }

    #[test]
    fn rejects_reachable_unsupported_protocols() {
        let port = reserve_available_port();
        let mut server = spawn_node_fixture("raw-tcp-listener.js", &[&port.to_string()]);
        wait_until_listening(port);

        let runtime = Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime should build");
        let decision = runtime
            .block_on(authorize_target_port(
                &SystemClock,
                &PortAccessTarget {
                    kind: "port".to_string(),
                    port,
                },
            ))
            .expect("authorize_target_port should succeed");

        assert_eq!(
            decision,
            PortAccessAuthorizeDecision::Rejected {
                reason: "unsupported_protocol",
            }
        );

        terminate_child(&mut server);
    }

    #[test]
    fn rejects_unreachable_ports() {
        let port = reserve_available_port();
        let runtime = Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime should build");
        let decision = runtime
            .block_on(authorize_target_port(
                &SystemClock,
                &PortAccessTarget {
                    kind: "port".to_string(),
                    port,
                },
            ))
            .expect("authorize_target_port should succeed");

        assert_eq!(
            decision,
            PortAccessAuthorizeDecision::Rejected {
                reason: "port_unreachable",
            }
        );
    }
}
