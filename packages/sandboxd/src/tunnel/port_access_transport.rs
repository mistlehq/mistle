//! Localhost HTTP transport for browser-based port access.
//!
//! This module owns the exact-port HTTP relay that runs inside `sandboxd`.
//! The gateway speaks `ports.http.*` over the bootstrap tunnel; this module
//! dials the local upstream listener, streams request bodies into it, and
//! emits response events back toward the tunnel session.

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
use tokio::sync::mpsc;
use tokio_rustls::rustls::client::danger::{
    HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier,
};
use tokio_rustls::rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use tokio_rustls::rustls::{ClientConfig, DigitallySignedStruct, Error, SignatureScheme};

use crate::tunnel::protocol::{
    PortAccessTarget, PortsHttpBodyChunk, PortsHttpBodyEnd, PortsHttpOpen, PortsHttpResponseStart,
    PortsStreamError,
};

const UPSTREAM_LOOPBACK_HOST: &str = "127.0.0.1";
const PORT_ACCESS_HTTP_BODY_CHANNEL_CAPACITY: usize = 16;

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
    RequestBodyChunk {
        bytes: Vec<u8>,
    },
    RequestBodyEnd,
    Close,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PortAccessTransportEvent {
    HttpResponseStart(PortsHttpResponseStart),
    HttpBodyChunk(PortsHttpBodyChunk),
    HttpBodyEnd(PortsHttpBodyEnd),
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

async fn run_http_transport(
    open: PortsHttpOpen,
    mut command_receiver: mpsc::UnboundedReceiver<PortAccessHttpCommand>,
    event_sender: mpsc::UnboundedSender<PortAccessTransportEvent>,
) -> Result<(), PortAccessTransportError> {
    let client = build_http_client()?;
    let request_uri = build_request_uri(&open.target, &open.upstream_protocol, &open.request.path, open.request.query.as_deref())?;
    let request_builder = build_upstream_request_builder(&open, request_uri)?;

    let (request_body_sender, request_body) = Channel::<Bytes, Infallible>::new(
        PORT_ACCESS_HTTP_BODY_CHANNEL_CAPACITY,
    );
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
            body_sender.send_data(Bytes::from(bytes)).await.map_err(|error| {
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

fn build_http_client() -> Result<PortAccessHttpClient, PortAccessTransportError> {
    let mut http_connector = HttpConnector::new();
    http_connector.enforce_http(false);

    let tls_config = ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptAnyServerCertVerifier))
        .with_no_client_auth();
    let https_connector = HttpsConnectorBuilder::new()
        .with_tls_config(tls_config)
        .https_or_http()
        .enable_http1()
        .wrap_connector(http_connector);

    Ok(Client::builder(TokioExecutor::new()).build(https_connector))
}

fn build_request_uri(
    target: &PortAccessTarget,
    upstream_protocol: &str,
    path: &str,
    query: Option<&str>,
) -> Result<Uri, PortAccessTransportError> {
    let mut request_uri = format!(
        "{upstream_protocol}://{UPSTREAM_LOOPBACK_HOST}:{}{}",
        target.port, path
    );
    if let Some(query) = query {
        request_uri.push('?');
        request_uri.push_str(query);
    }

    request_uri.parse::<Uri>().map_err(|error| {
        PortAccessTransportError::new("upstream_handshake_failed", format!(
            "failed to build upstream request uri '{request_uri}': {error}"
        ))
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
        let parsed_header_name =
            HeaderName::try_from(header_name.as_str()).map_err(|error| {
                PortAccessTransportError::new("upstream_handshake_failed", format!(
                    "upstream request header name '{header_name}' is invalid: {error}"
                ))
            })?;
        for value in values {
            let parsed_header_value = HeaderValue::from_str(value).map_err(|error| {
                PortAccessTransportError::new("upstream_handshake_failed", format!(
                    "upstream request header value for '{header_name}' is invalid: {error}"
                ))
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
