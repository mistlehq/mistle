//! Localhost HTTP and websocket transport for browser-based port access.
//!
//! This module owns the exact-port relays that run inside `sandboxd`. The
//! gateway speaks `ports.http.*` and `ports.ws.*` over the bootstrap tunnel;
//! this module dials the local upstream listener, forwards the request or
//! websocket frames into it, and emits transport events back toward the tunnel
//! session.

use std::collections::BTreeMap;
use std::convert::Infallible;
use std::fmt::{self, Display};
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use base64::Engine;
use bytes::Bytes;
use http_body_util::{
    BodyExt,
    channel::{Channel, Sender},
};
use hyper::StatusCode;
use hyper::header::{HeaderName, HeaderValue};
use hyper::{Request, Uri};
use hyper_rustls::{HttpsConnector, HttpsConnectorBuilder};
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::TokioExecutor;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_rustls::TlsConnector;
use tokio_rustls::rustls::client::danger::{
    HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier,
};
use tokio_rustls::rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use tokio_rustls::rustls::{ClientConfig, DigitallySignedStruct, Error, SignatureScheme};
use tokio_tungstenite::MaybeTlsStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::{Response, generate_request};
use tokio_tungstenite::tungstenite::handshake::derive_accept_key;
use tokio_tungstenite::tungstenite::handshake::machine::TryParse;
use tokio_tungstenite::tungstenite::http::Request as WebSocketRequest;

use crate::tunnel::protocol::{
    PortAccessTarget, PortsHttpBodyChunk, PortsHttpBodyEnd, PortsHttpOpen, PortsHttpResponseStart,
    PortsStreamError, PortsTcpClose, PortsTcpConnected, PortsTcpError, PortsTcpOpen, PortsWsAccept,
    PortsWsClose, PortsWsFrame, PortsWsOpen, StreamSendWindow,
};

const UPSTREAM_LOCALHOST: &str = "localhost";
const PORT_ACCESS_HTTP_BODY_CHANNEL_CAPACITY: usize = 16;
const TCP_READ_BUFFER_BYTES: usize = 16 * 1024;
const MAX_WEBSOCKET_HANDSHAKE_RESPONSE_BYTES: usize = 64 * 1024;

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
pub enum PortAccessWsCommand {
    Frame {
        opcode: String,
        bytes: Vec<u8>,
    },
    Close {
        code: Option<u16>,
        reason: Option<String>,
    },
    Terminate,
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
    WsAccept(PortsWsAccept),
    WsFrame(PortsWsFrame),
    WsClose(PortsWsClose),
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

/// Starts one localhost websocket relay for a previously authorized target port.
pub fn spawn_websocket_transport(
    open: PortsWsOpen,
    event_sender: mpsc::UnboundedSender<PortAccessTransportEvent>,
) -> mpsc::UnboundedSender<PortAccessWsCommand> {
    let (command_sender, command_receiver) = mpsc::unbounded_channel();
    let stream_id = open.stream_id;
    tokio::spawn(async move {
        if let Err(error) =
            run_websocket_transport(open, command_receiver, event_sender.clone()).await
        {
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

async fn run_websocket_transport(
    open: PortsWsOpen,
    mut command_receiver: mpsc::UnboundedReceiver<PortAccessWsCommand>,
    event_sender: mpsc::UnboundedSender<PortAccessTransportEvent>,
) -> Result<(), PortAccessTransportError> {
    let (upstream_stream, response) = connect_upstream_websocket(&open).await?;
    let (mut upstream_reader, mut upstream_writer) = tokio::io::split(upstream_stream);

    event_sender
        .send(PortAccessTransportEvent::WsAccept(PortsWsAccept {
            message_type: "ports.ws.accept".to_string(),
            stream_id: open.stream_id,
            headers: collect_repeated_headers(response.headers()),
        }))
        .map_err(|error| {
            PortAccessTransportError::new(
                "upstream_io_error",
                format!("failed to publish ports.ws.accept: {error}"),
            )
        })?;

    loop {
        tokio::select! {
            command = command_receiver.recv() => {
                if handle_websocket_command(command, &mut upstream_writer).await? {
                    return Ok(());
                }
            }
            frame = read_websocket_frame(&mut upstream_reader) => {
                let Some(frame) = frame? else {
                    publish_websocket_close(&event_sender, open.stream_id, None, None)?;
                    return Ok(());
                };
                match frame {
                    ReadWebSocketFrame::Text(bytes) => {
                        let _ = std::str::from_utf8(&bytes).map_err(|error| {
                            PortAccessTransportError::new(
                                "upstream_io_error",
                                format!("failed to decode upstream websocket text frame as utf-8: {error}"),
                            )
                        })?;
                        publish_websocket_frame(&event_sender, open.stream_id, "text", &bytes)?;
                    }
                    ReadWebSocketFrame::Binary(bytes) => {
                        publish_websocket_frame(&event_sender, open.stream_id, "binary", &bytes)?;
                    }
                    ReadWebSocketFrame::Ping(bytes) => {
                        publish_websocket_frame(&event_sender, open.stream_id, "ping", &bytes)?;
                    }
                    ReadWebSocketFrame::Pong(bytes) => {
                        publish_websocket_frame(&event_sender, open.stream_id, "pong", &bytes)?;
                    }
                    ReadWebSocketFrame::Close { code, reason } => {
                        publish_websocket_close(&event_sender, open.stream_id, code, reason.as_deref())?;
                        return Ok(());
                    }
                }
            }
        }
    }
}

async fn handle_websocket_command(
    command: Option<PortAccessWsCommand>,
    upstream_writer: &mut (impl AsyncWrite + Unpin),
) -> Result<bool, PortAccessTransportError> {
    match command {
        Some(PortAccessWsCommand::Frame { opcode, bytes }) => {
            let opcode_byte = match opcode.as_str() {
                "text" => {
                    let _ = String::from_utf8(bytes.clone()).map_err(|error| {
                        PortAccessTransportError::new(
                            "upstream_io_error",
                            format!(
                                "failed to decode request websocket text frame as utf-8: {error}"
                            ),
                        )
                    })?;
                    0x1
                }
                "binary" => 0x2,
                "ping" => 0x9,
                "pong" => 0xA,
                _ => {
                    return Err(PortAccessTransportError::new(
                        "upstream_io_error",
                        format!("unsupported websocket opcode '{opcode}'"),
                    ));
                }
            };
            write_masked_websocket_frame(upstream_writer, opcode_byte, &bytes).await?;
            Ok(false)
        }
        Some(PortAccessWsCommand::Close { code, reason }) => {
            write_websocket_close_frame(upstream_writer, code, reason.as_deref()).await?;
            Ok(false)
        }
        Some(PortAccessWsCommand::Terminate) => Ok(true),
        None => Ok(true),
    }
}

enum ReadWebSocketFrame {
    Text(Vec<u8>),
    Binary(Vec<u8>),
    Ping(Vec<u8>),
    Pong(Vec<u8>),
    Close {
        code: Option<u16>,
        reason: Option<String>,
    },
}

async fn read_websocket_frame(
    upstream_reader: &mut (impl AsyncRead + Unpin),
) -> Result<Option<ReadWebSocketFrame>, PortAccessTransportError> {
    let mut header = [0u8; 2];
    match upstream_reader.read_exact(&mut header).await {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => {
            return Err(PortAccessTransportError::new(
                "upstream_io_error",
                format!("failed to read upstream websocket frame header: {error}"),
            ));
        }
    }

    let fin = (header[0] & 0x80) != 0;
    if !fin {
        return Err(PortAccessTransportError::new(
            "upstream_io_error",
            "fragmented upstream websocket frames are not supported",
        ));
    }
    let reserved_bits = header[0] & 0x70;
    if reserved_bits != 0 {
        return Err(PortAccessTransportError::new(
            "upstream_io_error",
            "upstream websocket extensions are not supported",
        ));
    }

    let opcode = header[0] & 0x0f;
    let masked = (header[1] & 0x80) != 0;
    if masked {
        return Err(PortAccessTransportError::new(
            "upstream_io_error",
            "upstream websocket server frames must not be masked",
        ));
    }

    let payload_length = read_websocket_payload_length(upstream_reader, header[1] & 0x7f).await?;
    let mut payload = vec![0u8; payload_length];
    upstream_reader
        .read_exact(&mut payload)
        .await
        .map_err(|error| {
            PortAccessTransportError::new(
                "upstream_io_error",
                format!("failed to read upstream websocket payload: {error}"),
            )
        })?;

    match opcode {
        0x1 => Ok(Some(ReadWebSocketFrame::Text(payload))),
        0x2 => Ok(Some(ReadWebSocketFrame::Binary(payload))),
        0x8 => {
            let (code, reason) = parse_websocket_close_payload(&payload)?;
            Ok(Some(ReadWebSocketFrame::Close { code, reason }))
        }
        0x9 => Ok(Some(ReadWebSocketFrame::Ping(payload))),
        0xA => Ok(Some(ReadWebSocketFrame::Pong(payload))),
        _ => Err(PortAccessTransportError::new(
            "upstream_io_error",
            format!("unsupported upstream websocket opcode '{opcode}'"),
        )),
    }
}

async fn read_websocket_payload_length(
    upstream_reader: &mut (impl AsyncRead + Unpin),
    marker: u8,
) -> Result<usize, PortAccessTransportError> {
    match marker {
        0..=125 => Ok(usize::from(marker)),
        126 => {
            let mut extended = [0u8; 2];
            upstream_reader
                .read_exact(&mut extended)
                .await
                .map_err(|error| {
                    PortAccessTransportError::new(
                        "upstream_io_error",
                        format!(
                            "failed to read upstream websocket extended payload length: {error}"
                        ),
                    )
                })?;
            Ok(usize::from(u16::from_be_bytes(extended)))
        }
        127 => {
            let mut extended = [0u8; 8];
            upstream_reader
                .read_exact(&mut extended)
                .await
                .map_err(|error| {
                    PortAccessTransportError::new(
                        "upstream_io_error",
                        format!(
                            "failed to read upstream websocket extended payload length: {error}"
                        ),
                    )
                })?;
            let length = u64::from_be_bytes(extended);
            usize::try_from(length).map_err(|_| {
                PortAccessTransportError::new(
                    "upstream_io_error",
                    format!("upstream websocket payload length {length} exceeds supported size"),
                )
            })
        }
        _ => Err(PortAccessTransportError::new(
            "upstream_io_error",
            format!("invalid websocket payload length marker '{marker}'"),
        )),
    }
}

fn parse_websocket_close_payload(
    payload: &[u8],
) -> Result<(Option<u16>, Option<String>), PortAccessTransportError> {
    if payload.is_empty() {
        return Ok((None, None));
    }
    if payload.len() == 1 {
        return Err(PortAccessTransportError::new(
            "upstream_io_error",
            "upstream websocket close payload must be empty or include a two-byte close code",
        ));
    }

    let code = u16::from_be_bytes([payload[0], payload[1]]);
    let reason = if payload.len() == 2 {
        None
    } else {
        let reason = std::str::from_utf8(&payload[2..]).map_err(|error| {
            PortAccessTransportError::new(
                "upstream_io_error",
                format!("failed to decode upstream websocket close reason as utf-8: {error}"),
            )
        })?;
        if reason.is_empty() {
            None
        } else {
            Some(reason.to_string())
        }
    };

    Ok((Some(code), reason))
}

async fn write_masked_websocket_frame(
    upstream_writer: &mut (impl AsyncWrite + Unpin),
    opcode: u8,
    payload: &[u8],
) -> Result<(), PortAccessTransportError> {
    let mut encoded = Vec::with_capacity(payload.len().saturating_add(14));
    encoded.push(0x80 | opcode);
    append_websocket_payload_length(&mut encoded, payload.len(), true)?;
    let mask = generate_websocket_mask()?;
    encoded.extend_from_slice(&mask);
    for (index, byte) in payload.iter().enumerate() {
        encoded.push(byte ^ mask[index % 4]);
    }

    upstream_writer.write_all(&encoded).await.map_err(|error| {
        PortAccessTransportError::new(
            "upstream_io_error",
            format!("failed to write upstream websocket frame: {error}"),
        )
    })?;
    upstream_writer.flush().await.map_err(|error| {
        PortAccessTransportError::new(
            "upstream_io_error",
            format!("failed to flush upstream websocket frame: {error}"),
        )
    })
}

fn generate_websocket_mask() -> Result<[u8; 4], PortAccessTransportError> {
    let mut mask = [0u8; 4];
    let mut random = std::fs::File::open("/dev/urandom").map_err(|error| {
        PortAccessTransportError::new(
            "upstream_io_error",
            format!("failed to open /dev/urandom for websocket masking: {error}"),
        )
    })?;
    std::io::Read::read_exact(&mut random, &mut mask).map_err(|error| {
        PortAccessTransportError::new(
            "upstream_io_error",
            format!("failed to read websocket masking key: {error}"),
        )
    })?;
    Ok(mask)
}

async fn write_websocket_close_frame(
    upstream_writer: &mut (impl AsyncWrite + Unpin),
    code: Option<u16>,
    reason: Option<&str>,
) -> Result<(), PortAccessTransportError> {
    let payload = build_websocket_close_payload(code, reason)?;
    write_masked_websocket_frame(upstream_writer, 0x8, &payload).await
}

fn build_websocket_close_payload(
    code: Option<u16>,
    reason: Option<&str>,
) -> Result<Vec<u8>, PortAccessTransportError> {
    let Some(code) = code else {
        return Ok(Vec::new());
    };

    let mut payload = Vec::new();
    payload.extend_from_slice(&code.to_be_bytes());
    if let Some(reason) = reason {
        payload.extend_from_slice(reason.as_bytes());
    }
    Ok(payload)
}

fn append_websocket_payload_length(
    encoded: &mut Vec<u8>,
    payload_length: usize,
    masked: bool,
) -> Result<(), PortAccessTransportError> {
    let mask_bit = if masked { 0x80 } else { 0x00 };
    if payload_length <= 125 {
        encoded.push(
            mask_bit
                | u8::try_from(payload_length).map_err(|_| {
                    PortAccessTransportError::new(
                        "upstream_io_error",
                        format!("websocket payload length {payload_length} exceeds supported size"),
                    )
                })?,
        );
        return Ok(());
    }
    if u16::try_from(payload_length).is_ok() {
        encoded.push(mask_bit | 126);
        encoded.extend_from_slice(
            &u16::try_from(payload_length)
                .map_err(|_| {
                    PortAccessTransportError::new(
                        "upstream_io_error",
                        format!("websocket payload length {payload_length} exceeds supported size"),
                    )
                })?
                .to_be_bytes(),
        );
        return Ok(());
    }

    encoded.push(mask_bit | 127);
    encoded.extend_from_slice(
        &u64::try_from(payload_length)
            .map_err(|_| {
                PortAccessTransportError::new(
                    "upstream_io_error",
                    format!("websocket payload length {payload_length} exceeds supported size"),
                )
            })?
            .to_be_bytes(),
    );
    Ok(())
}

fn publish_websocket_frame(
    event_sender: &mpsc::UnboundedSender<PortAccessTransportEvent>,
    stream_id: u32,
    opcode: &str,
    bytes: &[u8],
) -> Result<(), PortAccessTransportError> {
    event_sender
        .send(PortAccessTransportEvent::WsFrame(PortsWsFrame {
            message_type: "ports.ws.frame".to_string(),
            stream_id,
            direction: "response".to_string(),
            opcode: opcode.to_string(),
            bytes: base64::engine::general_purpose::STANDARD.encode(bytes),
            encoding: "base64".to_string(),
        }))
        .map_err(|error| {
            PortAccessTransportError::new(
                "upstream_io_error",
                format!("failed to publish ports.ws.frame: {error}"),
            )
        })
}

fn publish_websocket_close(
    event_sender: &mpsc::UnboundedSender<PortAccessTransportEvent>,
    stream_id: u32,
    code: Option<u16>,
    reason: Option<&str>,
) -> Result<(), PortAccessTransportError> {
    event_sender
        .send(PortAccessTransportEvent::WsClose(PortsWsClose {
            message_type: "ports.ws.close".to_string(),
            stream_id,
            direction: "response".to_string(),
            code,
            reason: reason.map(std::string::ToString::to_string),
        }))
        .map_err(|error| {
            PortAccessTransportError::new(
                "upstream_io_error",
                format!("failed to publish ports.ws.close: {error}"),
            )
        })
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

fn build_websocket_request(
    open: &PortsWsOpen,
) -> Result<WebSocketRequest<()>, PortAccessTransportError> {
    let request_uri = build_websocket_request_uri(
        &open.target,
        &open.upstream_protocol,
        &open.request.path,
        open.request.query.as_deref(),
    )?;
    let mut builder = WebSocketRequest::builder().method("GET").uri(request_uri);
    for (header_name, values) in &open.request.headers {
        for value in values {
            builder = builder.header(header_name.as_str(), value.as_str());
        }
    }
    builder.body(()).map_err(|error| {
        PortAccessTransportError::new(
            "upstream_handshake_failed",
            format!("failed to build upstream websocket request: {error}"),
        )
    })
}

fn build_websocket_request_uri(
    target: &PortAccessTarget,
    upstream_protocol: &str,
    path: &str,
    query: Option<&str>,
) -> Result<String, PortAccessTransportError> {
    let websocket_protocol = match upstream_protocol {
        "http" => "ws",
        "https" => "wss",
        _ => {
            return Err(PortAccessTransportError::new(
                "upstream_handshake_failed",
                format!("unsupported websocket upstream protocol '{upstream_protocol}'"),
            ));
        }
    };

    let mut request_uri = format!(
        "{websocket_protocol}://{UPSTREAM_LOCALHOST}:{}{}",
        target.port, path
    );
    if let Some(query) = query {
        request_uri.push('?');
        request_uri.push_str(query);
    }

    let _ = request_uri
        .as_str()
        .into_client_request()
        .map_err(|error| {
            PortAccessTransportError::new(
                "upstream_handshake_failed",
                format!("failed to build upstream websocket uri '{request_uri}': {error}"),
            )
        })?;
    Ok(request_uri)
}

async fn connect_upstream_websocket(
    open: &PortsWsOpen,
) -> Result<(ReplayableStream<MaybeTlsStream<TcpStream>>, Response), PortAccessTransportError> {
    let request = build_websocket_request(open)?;
    let requested_subprotocols = extract_requested_subprotocols(&request)?;
    let (request_bytes, request_key) = generate_request(request).map_err(|error| {
        PortAccessTransportError::new(
            "upstream_handshake_failed",
            format!("failed to generate upstream websocket handshake request: {error}"),
        )
    })?;
    let mut upstream_stream =
        connect_upstream_websocket_stream(&open.target, &open.upstream_protocol).await?;
    upstream_stream
        .write_all(&request_bytes)
        .await
        .map_err(|error| {
            PortAccessTransportError::new(
                "upstream_handshake_failed",
                format!("failed to write upstream websocket handshake request: {error}"),
            )
        })?;
    upstream_stream.flush().await.map_err(|error| {
        PortAccessTransportError::new(
            "upstream_handshake_failed",
            format!("failed to flush upstream websocket handshake request: {error}"),
        )
    })?;
    let (response, tail) = read_websocket_handshake_response(&mut upstream_stream).await?;
    verify_websocket_handshake_response(
        &response,
        &derive_accept_key(request_key.as_bytes()),
        requested_subprotocols.as_deref(),
    )?;
    Ok((ReplayableStream::new(upstream_stream, tail), response))
}

async fn connect_upstream_websocket_stream(
    target: &PortAccessTarget,
    upstream_protocol: &str,
) -> Result<MaybeTlsStream<TcpStream>, PortAccessTransportError> {
    let tcp_stream = TcpStream::connect((UPSTREAM_LOCALHOST, target.port))
        .await
        .map_err(|error| {
            PortAccessTransportError::new(
                "upstream_connect_failed",
                format!(
                    "failed to connect to upstream websocket target on port {}: {error}",
                    target.port
                ),
            )
        })?;
    match upstream_protocol {
        "http" => Ok(MaybeTlsStream::Plain(tcp_stream)),
        "https" => connect_tls_stream(tcp_stream, "websocket").await,
        other => Err(PortAccessTransportError::new(
            "upstream_handshake_failed",
            format!("unsupported websocket upstream protocol '{other}'"),
        )),
    }
}

async fn read_websocket_handshake_response(
    upstream_stream: &mut (impl AsyncRead + Unpin),
) -> Result<(Response, Vec<u8>), PortAccessTransportError> {
    let mut response_bytes = Vec::new();
    let mut read_buffer = [0u8; 4096];
    loop {
        let bytes_read = upstream_stream
            .read(&mut read_buffer)
            .await
            .map_err(|error| {
                PortAccessTransportError::new(
                    "upstream_handshake_failed",
                    format!("failed to read upstream websocket handshake response: {error}"),
                )
            })?;
        if bytes_read == 0 {
            return Err(PortAccessTransportError::new(
                "upstream_handshake_failed",
                "upstream websocket closed before completing the handshake response",
            ));
        }

        response_bytes.extend_from_slice(&read_buffer[..bytes_read]);
        if response_bytes.len() > MAX_WEBSOCKET_HANDSHAKE_RESPONSE_BYTES {
            return Err(PortAccessTransportError::new(
                "upstream_handshake_failed",
                format!(
                    "upstream websocket handshake response exceeded {MAX_WEBSOCKET_HANDSHAKE_RESPONSE_BYTES} bytes",
                ),
            ));
        }

        let Some((consumed_bytes, response)) =
            Response::try_parse(&response_bytes).map_err(|error| {
                PortAccessTransportError::new(
                    "upstream_handshake_failed",
                    format!("failed to parse upstream websocket handshake response: {error}"),
                )
            })?
        else {
            continue;
        };

        let tail = response_bytes.split_off(consumed_bytes);
        return Ok((response, tail));
    }
}

fn verify_websocket_handshake_response(
    response: &Response,
    expected_accept_key: &str,
    requested_subprotocols: Option<&[String]>,
) -> Result<(), PortAccessTransportError> {
    if response.status() != StatusCode::SWITCHING_PROTOCOLS {
        return Err(PortAccessTransportError::new(
            "upstream_handshake_failed",
            format!(
                "upstream websocket handshake returned unexpected status {}",
                response.status(),
            ),
        ));
    }

    let headers = response.headers();
    if !headers
        .get("Upgrade")
        .and_then(|header| header.to_str().ok())
        .is_some_and(|header| header.eq_ignore_ascii_case("websocket"))
    {
        return Err(PortAccessTransportError::new(
            "upstream_handshake_failed",
            "upstream websocket handshake response is missing 'Upgrade: websocket'",
        ));
    }

    if !headers
        .get("Connection")
        .and_then(|header| header.to_str().ok())
        .is_some_and(connection_header_contains_upgrade)
    {
        return Err(PortAccessTransportError::new(
            "upstream_handshake_failed",
            "upstream websocket handshake response is missing 'Connection: Upgrade'",
        ));
    }

    if headers
        .get("Sec-WebSocket-Accept")
        .and_then(|header| header.to_str().ok())
        .is_none_or(|header| header != expected_accept_key)
    {
        return Err(PortAccessTransportError::new(
            "upstream_handshake_failed",
            "upstream websocket handshake response has an invalid 'Sec-WebSocket-Accept' header",
        ));
    }

    let returned_subprotocol = headers
        .get("Sec-WebSocket-Protocol")
        .and_then(|header| header.to_str().ok())
        .map(str::to_string);
    match (requested_subprotocols, returned_subprotocol.as_deref()) {
        (Some(_), None) => {
            return Err(PortAccessTransportError::new(
                "upstream_handshake_failed",
                "upstream websocket handshake did not return the requested subprotocol",
            ));
        }
        (None, Some(_)) => {
            return Err(PortAccessTransportError::new(
                "upstream_handshake_failed",
                "upstream websocket handshake returned an unexpected subprotocol",
            ));
        }
        (Some(requested_subprotocols), Some(returned_subprotocol)) => {
            if !requested_subprotocols
                .iter()
                .any(|requested_subprotocol| requested_subprotocol == returned_subprotocol)
            {
                return Err(PortAccessTransportError::new(
                    "upstream_handshake_failed",
                    format!(
                        "upstream websocket handshake returned unexpected subprotocol '{returned_subprotocol}'",
                    ),
                ));
            }
        }
        (None, None) => {}
    }

    Ok(())
}

fn extract_requested_subprotocols(
    request: &WebSocketRequest<()>,
) -> Result<Option<Vec<String>>, PortAccessTransportError> {
    let Some(header_value) = request
        .headers()
        .get("Sec-WebSocket-Protocol")
        .and_then(|header| header.to_str().ok())
    else {
        return Ok(None);
    };

    let requested_subprotocols = header_value
        .split(',')
        .map(str::trim)
        .filter(|subprotocol| !subprotocol.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if requested_subprotocols.is_empty() {
        return Err(PortAccessTransportError::new(
            "upstream_handshake_failed",
            "upstream websocket request declared an empty subprotocol list",
        ));
    }
    Ok(Some(requested_subprotocols))
}

fn connection_header_contains_upgrade(connection_header: &str) -> bool {
    connection_header
        .split(',')
        .any(|token| token.trim().eq_ignore_ascii_case("upgrade"))
}

fn collect_repeated_headers(
    headers: &hyper::HeaderMap<HeaderValue>,
) -> BTreeMap<String, Vec<String>> {
    let mut repeated_headers = BTreeMap::new();
    for (header_name, header_value) in headers {
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

#[derive(Debug)]
struct ReplayableStream<S> {
    inner: S,
    replay_bytes: Vec<u8>,
    replay_offset: usize,
}

impl<S> ReplayableStream<S> {
    fn new(inner: S, replay_bytes: Vec<u8>) -> Self {
        Self {
            inner,
            replay_bytes,
            replay_offset: 0,
        }
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for ReplayableStream<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        if self.replay_offset < self.replay_bytes.len() {
            let replay_bytes = &self.replay_bytes[self.replay_offset..];
            let bytes_to_copy = replay_bytes.len().min(buf.remaining());
            buf.put_slice(&replay_bytes[..bytes_to_copy]);
            self.replay_offset += bytes_to_copy;
            return Poll::Ready(Ok(()));
        }

        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for ReplayableStream<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        PortAccessTcpCommand, PortAccessTransportEvent, build_request_uri,
        build_websocket_request_uri, spawn_tcp_transport,
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

    #[test]
    fn builds_websocket_request_uri_against_localhost() {
        let request_uri = build_websocket_request_uri(
            &PortAccessTarget {
                kind: "port".to_string(),
                port: 3000,
            },
            "https",
            "/@vite/client",
            None,
        )
        .expect("websocket request uri should build");

        assert_eq!(request_uri, "wss://localhost:3000/@vite/client");
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
