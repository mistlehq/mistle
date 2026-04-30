//! Localhost HTTP and TCP transport for port access.
//!
//! This module owns the exact-port relays that run inside `sandboxd`. The
//! gateway speaks semantic HTTP over the bootstrap tunnel and raw TCP over
//! reserved tunnel streams. This module dials the local upstream listener and
//! emits transport events back toward the tunnel session.

use std::collections::BTreeMap;
use std::convert::Infallible;
use std::fmt::{self, Display};
use std::sync::Arc;

use base64::Engine;
use bytes::Bytes;
use http_body_util::{
    BodyExt,
    channel::{Channel, Sender},
};
use hyper::header::{HeaderName, HeaderValue};
use hyper::{Request, Uri};
use hyper_rustls::{HttpsConnector, HttpsConnectorBuilder};
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::TokioExecutor;
use tokio::io::{AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_rustls::TlsConnector;
use tokio_rustls::rustls::client::danger::{
    HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier,
};
use tokio_rustls::rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use tokio_rustls::rustls::{ClientConfig, DigitallySignedStruct, Error, SignatureScheme};
use tokio_tungstenite::MaybeTlsStream;

use crate::tunnel::protocol::{
    PortAccessTarget, PortsHttpBodyChunk, PortsHttpBodyEnd, PortsHttpOpen, PortsHttpResponseStart,
    PortsStreamError, PortsTcpClose, PortsTcpConnected, PortsTcpError, PortsTcpOpen,
    StreamSendWindow,
};

const UPSTREAM_LOCALHOST: &str = "localhost";
const PORT_ACCESS_HTTP_BODY_CHANNEL_CAPACITY: usize = 16;
const TCP_READ_BUFFER_BYTES: usize = 16 * 1024;

type PortAccessHttpClient = Client<HttpsConnector<HttpConnector>, Channel<Bytes, Infallible>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortAccessTransportError {
    code: &'static str,
    message: String,
}

impl PortAccessTransportError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl Display for PortAccessTransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for PortAccessTransportError {}

#[derive(Debug)]
pub enum PortAccessHttpCommand {
    RequestBodyChunk { bytes: Vec<u8> },
    RequestBodyEnd,
    Close,
}

#[derive(Debug)]
pub enum PortAccessTcpCommand {
    Data { bytes: Vec<u8> },
    Close { direction: String },
    Window { bytes: usize },
    Terminate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PortAccessTransportEvent {
    HttpResponseStart(PortsHttpResponseStart),
    HttpBodyChunk(PortsHttpBodyChunk),
    HttpBodyEnd(PortsHttpBodyEnd),
    TcpConnected(PortsTcpConnected),
    TcpData { stream_id: u32, bytes: Vec<u8> },
    TcpInputWindow { stream_id: u32, bytes: usize },
    TcpClose(PortsTcpClose),
    TcpError(PortsTcpError),
    StreamError(PortsStreamError),
}

/// Starts one localhost HTTP relay for a previously authorized target port.
pub fn spawn_http_transport(
    open: PortsHttpOpen,
    event_sender: mpsc::UnboundedSender<PortAccessTransportEvent>,
) -> mpsc::UnboundedSender<PortAccessHttpCommand> {
    let (command_sender, command_receiver) = mpsc::unbounded_channel();
    let stream_id = open.stream_id;
    tokio::spawn(async move {
        if let Err(error) = run_http_transport(open, command_receiver, event_sender.clone()).await {
            let _ = event_sender.send(PortAccessTransportEvent::StreamError(PortsStreamError {
                message_type: "ports.stream.error".to_string(),
                stream_id,
                code: error.code.to_string(),
                message: error.to_string(),
            }));
        }
    });
    command_sender
}

/// Starts one localhost raw TCP relay for a previously authorized target port.
pub fn spawn_tcp_transport(
    open: PortsTcpOpen,
    event_sender: mpsc::UnboundedSender<PortAccessTransportEvent>,
) -> mpsc::UnboundedSender<PortAccessTcpCommand> {
    let (command_sender, command_receiver) = mpsc::unbounded_channel();
    let stream_id = open.stream_id;
    tokio::spawn(async move {
        if let Err(error) = run_tcp_transport(open, command_receiver, event_sender.clone()).await {
            let _ = event_sender.send(PortAccessTransportEvent::TcpError(PortsTcpError {
                message_type: "ports.tcp.error".to_string(),
                stream_id,
                code: error.code.to_string(),
                message: error.to_string(),
            }));
        }
    });
    command_sender
}

async fn run_http_transport(
    open: PortsHttpOpen,
    mut command_receiver: mpsc::UnboundedReceiver<PortAccessHttpCommand>,
    event_sender: mpsc::UnboundedSender<PortAccessTransportEvent>,
) -> Result<(), PortAccessTransportError> {
    let client = build_http_client()?;
    let request_uri = build_request_uri(
        &open.target,
        &open.upstream_protocol,
        &open.request.path,
        open.request.query.as_deref(),
    )?;
    let request_builder = build_upstream_request_builder(&open, request_uri)?;

    let (request_body_sender, request_body) =
        Channel::<Bytes, Infallible>::new(PORT_ACCESS_HTTP_BODY_CHANNEL_CAPACITY);
    let request = request_builder.body(request_body).map_err(|error| {
        PortAccessTransportError::new(
            "upstream_handshake_failed",
            format!("failed to build upstream request body: {error}"),
        )
    })?;
    let mut response_future = Box::pin(client.request(request));
    let mut response: Option<hyper::Response<hyper::body::Incoming>> = None;
    let mut response_started = false;
    let mut request_body_sender = Some(request_body_sender);

    loop {
        if let Some(upstream_response) = response.as_mut() {
            tokio::select! {
                command = command_receiver.recv() => {
                    if handle_http_command(
                        command,
                        &mut request_body_sender,
                    )
                    .await? {
                        return Ok(());
                    }
                }
                frame = upstream_response.frame() => {
                    let Some(frame_result) = frame else {
                        event_sender.send(PortAccessTransportEvent::HttpBodyEnd(PortsHttpBodyEnd {
                            message_type: "ports.http.body.end".to_string(),
                            stream_id: open.stream_id,
                            direction: "response".to_string(),
                        })).map_err(|error| {
                            PortAccessTransportError::new("upstream_io_error", format!(
                                "failed to publish ports.http.body.end: {error}"
                            ))
                        })?;
                        return Ok(());
                    };

                    let frame = frame_result.map_err(|error| {
                        PortAccessTransportError::new("upstream_io_error", format!(
                            "failed to read upstream http response body: {error}"
                        ))
                    });
                    match frame {
                        Ok(frame) => {
                            if let Ok(bytes) = frame.into_data() {
                                event_sender.send(PortAccessTransportEvent::HttpBodyChunk(
                                    PortsHttpBodyChunk {
                                        message_type: "ports.http.body.chunk".to_string(),
                                        stream_id: open.stream_id,
                                        direction: "response".to_string(),
                                        bytes: base64::engine::general_purpose::STANDARD
                                            .encode(bytes.as_ref()),
                                        encoding: "base64".to_string(),
                                    },
                                )).map_err(|error| {
                                    PortAccessTransportError::new("upstream_io_error", format!(
                                        "failed to publish ports.http.body.chunk: {error}"
                                    ))
                                })?;
                            }
                        }
                        Err(error) => {
                            event_sender.send(PortAccessTransportEvent::StreamError(
                                PortsStreamError {
                                    message_type: "ports.stream.error".to_string(),
                                    stream_id: open.stream_id,
                                    code: "upstream_io_error".to_string(),
                                    message: error.to_string(),
                                },
                            )).map_err(|send_error| {
                                PortAccessTransportError::new("upstream_io_error", format!(
                                    "failed to publish ports.stream.error: {send_error}"
                                ))
                            })?;
                            return Ok(());
                        }
                    }
                }
            }
            continue;
        }

        tokio::select! {
            command = command_receiver.recv() => {
                if handle_http_command(
                    command,
                    &mut request_body_sender,
                )
                .await? {
                    return Ok(());
                }
            }
            response_result = &mut response_future, if !response_started => {
                let upstream_response = response_result.map_err(classify_open_error)?;
                let response_headers = strip_hop_by_hop_response_headers(upstream_response.headers());
                let response_start = PortsHttpResponseStart {
                    message_type: "ports.http.response.start".to_string(),
                    stream_id: open.stream_id,
                    status: upstream_response.status().as_u16(),
                    headers: response_headers,
                };
                event_sender.send(PortAccessTransportEvent::HttpResponseStart(response_start)).map_err(|error| {
                    PortAccessTransportError::new(
                        "upstream_io_error",
                        format!("failed to publish ports.http.response.start: {error}")
                    )
                })?;
                response_started = true;
                response = Some(upstream_response);
            }
        }
    }
}

async fn run_tcp_transport(
    open: PortsTcpOpen,
    mut command_receiver: mpsc::UnboundedReceiver<PortAccessTcpCommand>,
    event_sender: mpsc::UnboundedSender<PortAccessTransportEvent>,
) -> Result<(), PortAccessTransportError> {
    let upstream_stream =
        connect_upstream_tcp_stream(&open.target, &open.upstream_protocol).await?;
    let (mut upstream_reader, mut upstream_writer) = tokio::io::split(upstream_stream);
    let mut response_send_window = StreamSendWindow::default();
    let mut read_buffer = vec![0u8; TCP_READ_BUFFER_BYTES];
    let mut request_closed = false;
    let mut response_closed = false;

    event_sender
        .send(PortAccessTransportEvent::TcpConnected(PortsTcpConnected {
            message_type: "ports.tcp.connected".to_string(),
            stream_id: open.stream_id,
        }))
        .map_err(|error| {
            PortAccessTransportError::new(
                "upstream_io_error",
                format!("failed to publish ports.tcp.connected: {error}"),
            )
        })?;

    loop {
        if request_closed && response_closed {
            return Ok(());
        }

        if response_closed || response_send_window.available_bytes() == 0 {
            let command = command_receiver.recv().await;
            if handle_tcp_command(
                command,
                &mut upstream_writer,
                &event_sender,
                open.stream_id,
                &mut response_send_window,
                &mut request_closed,
            )
            .await?
            {
                return Ok(());
            }
            continue;
        }

        let max_read = response_send_window
            .available_bytes()
            .min(TCP_READ_BUFFER_BYTES);
        tokio::select! {
            command = command_receiver.recv() => {
                if handle_tcp_command(
                    command,
                    &mut upstream_writer,
                    &event_sender,
                    open.stream_id,
                    &mut response_send_window,
                    &mut request_closed,
                )
                .await? {
                    return Ok(());
                }
            }
            read_result = upstream_reader.read(&mut read_buffer[..max_read]) => {
                let bytes_read = read_result.map_err(|error| {
                    PortAccessTransportError::new(
                        "upstream_io_error",
                        format!("failed to read upstream tcp bytes: {error}"),
                    )
                })?;
                if bytes_read == 0 {
                    publish_tcp_close(&event_sender, open.stream_id, "response")?;
                    response_closed = true;
                    continue;
                }
                if !response_send_window.try_consume(bytes_read) {
                    return Err(PortAccessTransportError::new(
                        "upstream_io_error",
                        "tcp response stream send window is exhausted",
                    ));
                }
                event_sender
                    .send(PortAccessTransportEvent::TcpData {
                        stream_id: open.stream_id,
                        bytes: read_buffer[..bytes_read].to_vec(),
                    })
                    .map_err(|error| {
                        PortAccessTransportError::new(
                            "upstream_io_error",
                            format!("failed to publish tcp response bytes: {error}"),
                        )
                    })?;
            }
        }
    }
}

async fn handle_tcp_command(
    command: Option<PortAccessTcpCommand>,
    upstream_writer: &mut (impl AsyncWrite + Unpin),
    event_sender: &mpsc::UnboundedSender<PortAccessTransportEvent>,
    stream_id: u32,
    response_send_window: &mut StreamSendWindow,
    request_closed: &mut bool,
) -> Result<bool, PortAccessTransportError> {
    match command {
        Some(PortAccessTcpCommand::Data { bytes }) => {
            if *request_closed {
                return Err(PortAccessTransportError::new(
                    "upstream_io_error",
                    "received tcp request bytes after request direction closed",
                ));
            }
            upstream_writer.write_all(&bytes).await.map_err(|error| {
                PortAccessTransportError::new(
                    "upstream_io_error",
                    format!("failed to write upstream tcp bytes: {error}"),
                )
            })?;
            upstream_writer.flush().await.map_err(|error| {
                PortAccessTransportError::new(
                    "upstream_io_error",
                    format!("failed to flush upstream tcp bytes: {error}"),
                )
            })?;
            event_sender
                .send(PortAccessTransportEvent::TcpInputWindow {
                    stream_id,
                    bytes: bytes.len(),
                })
                .map_err(|error| {
                    PortAccessTransportError::new(
                        "upstream_io_error",
                        format!("failed to publish tcp input stream.window: {error}"),
                    )
                })?;
            Ok(false)
        }
        Some(PortAccessTcpCommand::Close { direction }) => {
            if direction != "request" {
                return Err(PortAccessTransportError::new(
                    "upstream_io_error",
                    format!("tcp command close direction '{direction}' is not supported"),
                ));
            }
            if !*request_closed {
                upstream_writer.shutdown().await.map_err(|error| {
                    PortAccessTransportError::new(
                        "upstream_io_error",
                        format!("failed to close upstream tcp request direction: {error}"),
                    )
                })?;
                *request_closed = true;
                publish_tcp_close(event_sender, stream_id, "request")?;
            }
            Ok(false)
        }
        Some(PortAccessTcpCommand::Window { bytes }) => {
            response_send_window.add(bytes).map_err(|error| {
                PortAccessTransportError::new("upstream_io_error", error.to_string())
            })?;
            Ok(false)
        }
        Some(PortAccessTcpCommand::Terminate) => Ok(true),
        None => Ok(true),
    }
}

async fn connect_upstream_tcp_stream(
    target: &PortAccessTarget,
    upstream_protocol: &str,
) -> Result<MaybeTlsStream<TcpStream>, PortAccessTransportError> {
    let tcp_stream = TcpStream::connect((UPSTREAM_LOCALHOST, target.port))
        .await
        .map_err(|error| {
            PortAccessTransportError::new(
                "upstream_connect_failed",
                format!(
                    "failed to connect to upstream tcp target on port {}: {error}",
                    target.port
                ),
            )
        })?;
    match upstream_protocol {
        "http" => Ok(MaybeTlsStream::Plain(tcp_stream)),
        "https" => connect_tls_stream(tcp_stream, "tcp").await,
        other => Err(PortAccessTransportError::new(
            "upstream_handshake_failed",
            format!("unsupported tcp upstream protocol '{other}'"),
        )),
    }
}

async fn connect_tls_stream(
    tcp_stream: TcpStream,
    transport_name: &str,
) -> Result<MaybeTlsStream<TcpStream>, PortAccessTransportError> {
    let tls_connector = TlsConnector::from(Arc::new(build_insecure_tls_client_config()));
    let server_name = ServerName::try_from(UPSTREAM_LOCALHOST)
        .map_err(|error| {
            PortAccessTransportError::new(
                "upstream_handshake_failed",
                format!("failed to build upstream {transport_name} tls server name: {error}"),
            )
        })?
        .to_owned();
    let tls_stream = tls_connector
        .connect(server_name, tcp_stream)
        .await
        .map_err(|error| {
            PortAccessTransportError::new(
                "upstream_handshake_failed",
                format!("failed to complete upstream {transport_name} tls handshake: {error}"),
            )
        })?;
    Ok(MaybeTlsStream::Rustls(tls_stream))
}

async fn handle_http_command(
    command: Option<PortAccessHttpCommand>,
    request_body_sender: &mut Option<Sender<Bytes, Infallible>>,
) -> Result<bool, PortAccessTransportError> {
    match command {
        Some(PortAccessHttpCommand::RequestBodyChunk { bytes }) => {
            let Some(body_sender) = request_body_sender.as_mut() else {
                return Err(PortAccessTransportError::new(
                    "upstream_io_error",
                    "received request body chunk after the upstream request body closed",
                ));
            };
            body_sender
                .send_data(Bytes::from(bytes))
                .await
                .map_err(|error| {
                    PortAccessTransportError::new(
                        "upstream_io_error",
                        format!("failed to forward request body chunk upstream: {error}"),
                    )
                })?;
            Ok(false)
        }
        Some(PortAccessHttpCommand::RequestBodyEnd) => {
            request_body_sender.take();
            Ok(false)
        }
        None => Ok(true),
        Some(PortAccessHttpCommand::Close) => Ok(true),
    }
}

fn publish_tcp_close(
    event_sender: &mpsc::UnboundedSender<PortAccessTransportEvent>,
    stream_id: u32,
    direction: &str,
) -> Result<(), PortAccessTransportError> {
    event_sender
        .send(PortAccessTransportEvent::TcpClose(PortsTcpClose {
            message_type: "ports.tcp.close".to_string(),
            stream_id,
            direction: direction.to_string(),
        }))
        .map_err(|error| {
            PortAccessTransportError::new(
                "upstream_io_error",
                format!("failed to publish ports.tcp.close: {error}"),
            )
        })
}

fn build_http_client() -> Result<PortAccessHttpClient, PortAccessTransportError> {
    let mut http_connector = HttpConnector::new();
    http_connector.enforce_http(false);

    let tls_config = build_insecure_tls_client_config();
    let https_connector = HttpsConnectorBuilder::new()
        .with_tls_config(tls_config)
        .https_or_http()
        .enable_http1()
        .wrap_connector(http_connector);

    Ok(Client::builder(TokioExecutor::new()).build(https_connector))
}

fn build_insecure_tls_client_config() -> ClientConfig {
    ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptAnyServerCertVerifier))
        .with_no_client_auth()
}

fn build_request_uri(
    target: &PortAccessTarget,
    upstream_protocol: &str,
    path: &str,
    query: Option<&str>,
) -> Result<Uri, PortAccessTransportError> {
    let mut request_uri = format!(
        "{upstream_protocol}://{UPSTREAM_LOCALHOST}:{}{}",
        target.port, path
    );
    if let Some(query) = query {
        request_uri.push('?');
        request_uri.push_str(query);
    }

    request_uri.parse::<Uri>().map_err(|error| {
        PortAccessTransportError::new(
            "upstream_handshake_failed",
            format!("failed to build upstream request uri '{request_uri}': {error}"),
        )
    })
}

fn build_upstream_request_builder(
    open: &PortsHttpOpen,
    request_uri: Uri,
) -> Result<hyper::http::request::Builder, PortAccessTransportError> {
    let mut builder = Request::builder()
        .method(open.request.method.as_str())
        .uri(request_uri);
    for (header_name, values) in &open.request.headers {
        let parsed_header_name = HeaderName::try_from(header_name.as_str()).map_err(|error| {
            PortAccessTransportError::new(
                "upstream_handshake_failed",
                format!("upstream request header name '{header_name}' is invalid: {error}"),
            )
        })?;
        for value in values {
            let parsed_header_value = HeaderValue::from_str(value).map_err(|error| {
                PortAccessTransportError::new(
                    "upstream_handshake_failed",
                    format!(
                        "upstream request header value for '{header_name}' is invalid: {error}"
                    ),
                )
            })?;
            builder = builder.header(parsed_header_name.clone(), parsed_header_value);
        }
    }

    Ok(builder)
}

fn strip_hop_by_hop_response_headers(
    headers: &hyper::HeaderMap<HeaderValue>,
) -> BTreeMap<String, Vec<String>> {
    let mut repeated_headers = BTreeMap::new();
    for (header_name, header_value) in headers {
        if is_hop_by_hop_header(header_name.as_str()) {
            continue;
        }
        let Ok(header_value) = header_value.to_str() else {
            continue;
        };
        repeated_headers
            .entry(header_name.as_str().to_string())
            .or_insert_with(Vec::new)
            .push(header_value.to_string());
    }

    repeated_headers
}

fn is_hop_by_hop_header(header_name: &str) -> bool {
    matches!(
        header_name.to_ascii_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn classify_open_error(error: hyper_util::client::legacy::Error) -> PortAccessTransportError {
    let code = if error.is_connect() {
        "upstream_connect_failed"
    } else {
        "upstream_handshake_failed"
    };
    PortAccessTransportError::new(code, error.to_string())
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
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::{
        PortAccessTcpCommand, PortAccessTransportEvent, build_request_uri, spawn_tcp_transport,
    };
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::mpsc;
    use tokio::time::{Duration, timeout};
    use tokio_rustls::TlsAcceptor;
    use tokio_rustls::rustls::ServerConfig;
    use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};

    use crate::tunnel::protocol::{DEFAULT_STREAM_WINDOW_BYTES, PortAccessTarget, PortsTcpOpen};

    #[test]
    fn builds_http_request_uri_against_localhost() {
        let request_uri = build_request_uri(
            &PortAccessTarget {
                kind: "port".to_string(),
                port: 3000,
            },
            "http",
            "/",
            Some("import=1"),
        )
        .expect("request uri should build");

        assert_eq!(request_uri.to_string(), "http://localhost:3000/?import=1");
    }

    #[tokio::test]
    async fn tcp_transport_relays_bytes_and_directional_closes() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("tcp listener should bind");
        let port = listener
            .local_addr()
            .expect("tcp listener should expose an address")
            .port();
        let server_task = tokio::spawn(async move {
            let (mut stream, _) = listener
                .accept()
                .await
                .expect("tcp listener should accept one connection");
            let mut request = [0u8; 4];
            stream
                .read_exact(&mut request)
                .await
                .expect("upstream should receive request bytes");
            assert_eq!(&request, b"ping");
            stream
                .write_all(b"pong")
                .await
                .expect("upstream should write response bytes");
            stream
                .shutdown()
                .await
                .expect("upstream should close response direction");
        });

        let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
        let command_sender = spawn_tcp_transport(
            PortsTcpOpen {
                message_type: "ports.tcp.open".to_string(),
                stream_id: 91,
                target: PortAccessTarget {
                    kind: "port".to_string(),
                    port,
                },
                upstream_protocol: "http".to_string(),
            },
            event_sender,
        );

        assert_eq!(
            receive_port_access_event(&mut event_receiver).await,
            PortAccessTransportEvent::TcpConnected(crate::tunnel::protocol::PortsTcpConnected {
                message_type: "ports.tcp.connected".to_string(),
                stream_id: 91,
            })
        );
        command_sender
            .send(PortAccessTcpCommand::Data {
                bytes: b"ping".to_vec(),
            })
            .expect("tcp command channel should accept request bytes");
        command_sender
            .send(PortAccessTcpCommand::Close {
                direction: "request".to_string(),
            })
            .expect("tcp command channel should accept request close");

        let mut saw_input_window = false;
        let mut saw_request_close = false;
        let mut saw_response_data = false;
        let mut saw_response_close = false;
        while !(saw_input_window && saw_request_close && saw_response_data && saw_response_close) {
            match receive_port_access_event(&mut event_receiver).await {
                PortAccessTransportEvent::TcpInputWindow { stream_id, bytes } => {
                    assert_eq!(stream_id, 91);
                    assert_eq!(bytes, 4);
                    saw_input_window = true;
                }
                PortAccessTransportEvent::TcpClose(message) if message.direction == "request" => {
                    assert_eq!(message.stream_id, 91);
                    saw_request_close = true;
                }
                PortAccessTransportEvent::TcpData { stream_id, bytes } => {
                    assert_eq!(stream_id, 91);
                    assert_eq!(bytes, b"pong");
                    saw_response_data = true;
                }
                PortAccessTransportEvent::TcpClose(message) if message.direction == "response" => {
                    assert_eq!(message.stream_id, 91);
                    saw_response_close = true;
                }
                event => panic!("unexpected port access tcp event: {event:?}"),
            }
        }

        server_task.await.expect("upstream task should finish");
    }

    #[tokio::test]
    async fn tcp_transport_preserves_target_write_half_close_while_request_continues() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("tcp listener should bind");
        let port = listener
            .local_addr()
            .expect("tcp listener should expose an address")
            .port();
        let server_task = tokio::spawn(async move {
            let (mut stream, _) = listener
                .accept()
                .await
                .expect("tcp listener should accept one connection");
            stream
                .write_all(b"ready")
                .await
                .expect("upstream should write response bytes");
            stream
                .shutdown()
                .await
                .expect("upstream should close response direction");
            let mut request = [0u8; 4];
            stream
                .read_exact(&mut request)
                .await
                .expect("upstream should still receive request bytes after response close");
            assert_eq!(&request, b"ping");
        });

        let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
        let command_sender = spawn_tcp_transport(
            PortsTcpOpen {
                message_type: "ports.tcp.open".to_string(),
                stream_id: 93,
                target: PortAccessTarget {
                    kind: "port".to_string(),
                    port,
                },
                upstream_protocol: "http".to_string(),
            },
            event_sender,
        );

        assert_eq!(
            receive_port_access_event(&mut event_receiver).await,
            PortAccessTransportEvent::TcpConnected(crate::tunnel::protocol::PortsTcpConnected {
                message_type: "ports.tcp.connected".to_string(),
                stream_id: 93,
            })
        );
        let mut saw_response_data = false;
        let mut saw_response_close = false;
        while !(saw_response_data && saw_response_close) {
            match receive_port_access_event(&mut event_receiver).await {
                PortAccessTransportEvent::TcpData { stream_id, bytes } => {
                    assert_eq!(stream_id, 93);
                    assert_eq!(bytes, b"ready");
                    saw_response_data = true;
                }
                PortAccessTransportEvent::TcpClose(message) if message.direction == "response" => {
                    assert_eq!(message.stream_id, 93);
                    saw_response_close = true;
                }
                event => panic!("unexpected port access tcp event: {event:?}"),
            }
        }

        command_sender
            .send(PortAccessTcpCommand::Data {
                bytes: b"ping".to_vec(),
            })
            .expect("tcp command channel should accept request bytes after response close");
        command_sender
            .send(PortAccessTcpCommand::Close {
                direction: "request".to_string(),
            })
            .expect("tcp command channel should accept request close");

        server_task.await.expect("upstream task should finish");
    }

    #[tokio::test]
    async fn tcp_transport_wraps_https_upstream_with_accept_any_tls() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("tls listener should bind");
        let port = listener
            .local_addr()
            .expect("tls listener should expose an address")
            .port();
        let tls_acceptor = build_test_tls_acceptor();
        let server_task = tokio::spawn(async move {
            let (stream, _) = listener
                .accept()
                .await
                .expect("tls listener should accept one connection");
            let mut stream = tls_acceptor
                .accept(stream)
                .await
                .expect("sandboxd tcp transport should complete tls handshake");
            let mut request = [0u8; 4];
            stream
                .read_exact(&mut request)
                .await
                .expect("tls upstream should receive request bytes");
            assert_eq!(&request, b"ping");
            stream
                .write_all(b"pong")
                .await
                .expect("tls upstream should write response bytes");
            stream
                .shutdown()
                .await
                .expect("tls upstream should close response direction");
        });

        let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
        let command_sender = spawn_tcp_transport(
            PortsTcpOpen {
                message_type: "ports.tcp.open".to_string(),
                stream_id: 94,
                target: PortAccessTarget {
                    kind: "port".to_string(),
                    port,
                },
                upstream_protocol: "https".to_string(),
            },
            event_sender,
        );

        assert_eq!(
            receive_port_access_event(&mut event_receiver).await,
            PortAccessTransportEvent::TcpConnected(crate::tunnel::protocol::PortsTcpConnected {
                message_type: "ports.tcp.connected".to_string(),
                stream_id: 94,
            })
        );
        command_sender
            .send(PortAccessTcpCommand::Data {
                bytes: b"ping".to_vec(),
            })
            .expect("tcp command channel should accept tls request bytes");

        loop {
            match receive_port_access_event(&mut event_receiver).await {
                PortAccessTransportEvent::TcpInputWindow { .. } => {}
                PortAccessTransportEvent::TcpData { stream_id, bytes } => {
                    assert_eq!(stream_id, 94);
                    assert_eq!(bytes, b"pong");
                    break;
                }
                event => panic!("unexpected port access tcp event: {event:?}"),
            }
        }

        server_task.await.expect("tls upstream task should finish");
    }

    #[tokio::test]
    async fn tcp_transport_pauses_and_resumes_response_reads_with_stream_window() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("tcp listener should bind");
        let port = listener
            .local_addr()
            .expect("tcp listener should expose an address")
            .port();
        let response = vec![b'x'; DEFAULT_STREAM_WINDOW_BYTES + 1];
        let server_task = tokio::spawn(async move {
            let (mut stream, _) = listener
                .accept()
                .await
                .expect("tcp listener should accept one connection");
            stream
                .write_all(&response)
                .await
                .expect("upstream should write response bytes");
            stream
                .shutdown()
                .await
                .expect("upstream should close response direction");
        });

        let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
        let command_sender = spawn_tcp_transport(
            PortsTcpOpen {
                message_type: "ports.tcp.open".to_string(),
                stream_id: 95,
                target: PortAccessTarget {
                    kind: "port".to_string(),
                    port,
                },
                upstream_protocol: "http".to_string(),
            },
            event_sender,
        );

        assert_eq!(
            receive_port_access_event(&mut event_receiver).await,
            PortAccessTransportEvent::TcpConnected(crate::tunnel::protocol::PortsTcpConnected {
                message_type: "ports.tcp.connected".to_string(),
                stream_id: 95,
            })
        );

        let mut received_bytes = 0usize;
        while received_bytes < DEFAULT_STREAM_WINDOW_BYTES {
            match receive_port_access_event(&mut event_receiver).await {
                PortAccessTransportEvent::TcpData { stream_id, bytes } => {
                    assert_eq!(stream_id, 95);
                    received_bytes = received_bytes.saturating_add(bytes.len());
                    assert!(
                        received_bytes <= DEFAULT_STREAM_WINDOW_BYTES,
                        "tcp transport must not read past available response window",
                    );
                }
                event => panic!("unexpected port access tcp event: {event:?}"),
            }
        }

        assert!(
            timeout(Duration::from_millis(100), event_receiver.recv())
                .await
                .is_err(),
            "tcp transport should pause response reads while window credit is exhausted",
        );

        command_sender
            .send(PortAccessTcpCommand::Window { bytes: 1 })
            .expect("tcp command channel should accept one byte of response credit");
        match receive_port_access_event(&mut event_receiver).await {
            PortAccessTransportEvent::TcpData { stream_id, bytes } => {
                assert_eq!(stream_id, 95);
                assert_eq!(bytes.len(), 1);
            }
            event => panic!("unexpected event after response window resumed: {event:?}"),
        }

        server_task.await.expect("upstream task should finish");
    }

    #[tokio::test]
    async fn tcp_transport_emits_tcp_error_when_upstream_connect_fails() {
        let port = reserve_unbound_port().await;
        let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
        let _command_sender = spawn_tcp_transport(
            PortsTcpOpen {
                message_type: "ports.tcp.open".to_string(),
                stream_id: 92,
                target: PortAccessTarget {
                    kind: "port".to_string(),
                    port,
                },
                upstream_protocol: "http".to_string(),
            },
            event_sender,
        );

        match receive_port_access_event(&mut event_receiver).await {
            PortAccessTransportEvent::TcpError(message) => {
                assert_eq!(message.stream_id, 92);
                assert_eq!(message.code, "upstream_connect_failed");
                assert!(
                    !message.message.is_empty(),
                    "tcp connect failures should preserve an error message",
                );
            }
            event => panic!("expected tcp error event, got {event:?}"),
        }
    }

    async fn receive_port_access_event(
        event_receiver: &mut mpsc::UnboundedReceiver<PortAccessTransportEvent>,
    ) -> PortAccessTransportEvent {
        timeout(Duration::from_secs(5), event_receiver.recv())
            .await
            .expect("port access event should arrive before timeout")
            .expect("port access event channel should stay open")
    }

    async fn reserve_unbound_port() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("port reservation listener should bind");
        let port = listener
            .local_addr()
            .expect("port reservation listener should expose an address")
            .port();
        drop(listener);
        port
    }

    fn build_test_tls_acceptor() -> TlsAcceptor {
        let rcgen::CertifiedKey { cert, key_pair } =
            rcgen::generate_simple_self_signed(vec!["localhost".to_string()])
                .expect("self-signed tls certificate should generate");
        let cert_chain = vec![CertificateDer::from(cert.der().to_vec())];
        let private_key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key_pair.serialize_der()));
        let server_config = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(cert_chain, private_key)
            .expect("test tls server config should build");
        TlsAcceptor::from(Arc::new(server_config))
    }
}
