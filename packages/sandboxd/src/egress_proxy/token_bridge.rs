//! Inherited-fd token bridge between parent `sandboxd` and the egress proxy child.
//!
//! The bridge is capability-style: the parent gives the child one connected Unix
//! socket fd at spawn time. There is no filesystem socket path for sandbox-root
//! workload processes to discover and connect to.

use std::io::{Read, Write};
use std::os::fd::{FromRawFd, RawFd};
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use serde::{Deserialize, Serialize};

use crate::egress_proxy::EgressProxyError;
use crate::tunnel::session::{GatewayEgressTokenProvider, TunnelEgressToken};

const EGRESS_TOKEN_BRIDGE_MAX_FRAME_BYTES: usize = 64 * 1024;

#[derive(Clone)]
pub(super) struct EgressTokenBridgeClient {
    stream: Arc<Mutex<UnixStream>>,
    next_request_id: Arc<AtomicU64>,
}

pub(super) struct EgressTokenBridgeServer {
    stream: Option<UnixStream>,
    thread: Option<JoinHandle<Result<(), EgressProxyError>>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type", deny_unknown_fields)]
enum EgressTokenBridgeRequest {
    #[serde(rename = "egressToken.request")]
    Request { request_id: String },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type", deny_unknown_fields)]
enum EgressTokenBridgeResponse {
    #[serde(rename = "egressToken.response")]
    Response {
        request_id: String,
        token: String,
        expires_at: String,
        ttl_ms: u64,
    },
    #[serde(rename = "egressToken.error")]
    Error { request_id: String, message: String },
}

impl EgressTokenBridgeClient {
    pub(super) fn from_inherited_fd(fd: RawFd) -> Result<Self, EgressProxyError> {
        if fd < 0 {
            return Err(EgressProxyError::new(
                "egress token bridge fd must be non-negative",
            ));
        }

        let stream = unsafe { UnixStream::from_raw_fd(fd) };
        Ok(Self {
            stream: Arc::new(Mutex::new(stream)),
            next_request_id: Arc::new(AtomicU64::new(1)),
        })
    }

    pub(super) fn token(&self) -> Result<TunnelEgressToken, EgressProxyError> {
        let request_id = format!(
            "egress_token_bridge_req_{}",
            self.next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        let request = EgressTokenBridgeRequest::Request {
            request_id: request_id.clone(),
        };
        let mut stream = self.stream.lock().map_err(|error| {
            EgressProxyError::new(format!("egress token bridge lock is poisoned: {error}"))
        })?;

        write_json_line(&mut stream, &request)?;
        let response: EgressTokenBridgeResponse = read_json_line(&mut stream)?;
        match response {
            EgressTokenBridgeResponse::Response {
                request_id: response_request_id,
                token,
                expires_at,
                ttl_ms,
            } if response_request_id == request_id => Ok(TunnelEgressToken {
                token,
                expires_at,
                ttl_ms,
            }),
            EgressTokenBridgeResponse::Response {
                request_id: response_request_id,
                ..
            } => Err(EgressProxyError::new(format!(
                "egress token bridge response id mismatch: expected {request_id}, got {response_request_id}"
            ))),
            EgressTokenBridgeResponse::Error {
                request_id: response_request_id,
                message,
            } if response_request_id == request_id => Err(EgressProxyError::new(message)),
            EgressTokenBridgeResponse::Error {
                request_id: response_request_id,
                ..
            } => Err(EgressProxyError::new(format!(
                "egress token bridge error id mismatch: expected {request_id}, got {response_request_id}"
            ))),
        }
    }
}

impl EgressTokenBridgeServer {
    pub(super) fn start(
        stream: UnixStream,
        token_provider: GatewayEgressTokenProvider,
    ) -> Result<Self, EgressProxyError> {
        let thread_stream = stream.try_clone().map_err(|error| {
            EgressProxyError::new(format!(
                "failed to clone egress token bridge stream: {error}"
            ))
        })?;
        let thread = thread::Builder::new()
            .name("egress-token-bridge".to_string())
            .spawn(move || run_bridge_server(thread_stream, token_provider))
            .map_err(|error| {
                EgressProxyError::new(format!("failed to start egress token bridge: {error}"))
            })?;
        Ok(Self {
            stream: Some(stream),
            thread: Some(thread),
        })
    }

    pub(super) fn close(mut self) -> Result<(), EgressProxyError> {
        let _ = self.stream.take();
        if let Some(thread) = self.thread.take() {
            return thread
                .join()
                .map_err(|_| EgressProxyError::new("egress token bridge thread panicked"))?;
        }
        Ok(())
    }
}

pub(super) fn create_token_bridge_pair() -> Result<(UnixStream, UnixStream), EgressProxyError> {
    UnixStream::pair().map_err(|error| {
        EgressProxyError::new(format!("failed to create token bridge pair: {error}"))
    })
}

fn run_bridge_server(
    mut stream: UnixStream,
    token_provider: GatewayEgressTokenProvider,
) -> Result<(), EgressProxyError> {
    loop {
        let request = match read_json_line::<EgressTokenBridgeRequest>(&mut stream) {
            Ok(request) => request,
            Err(error) if error.to_string().contains("closed") => return Ok(()),
            Err(error) => return Err(error),
        };

        match request {
            EgressTokenBridgeRequest::Request { request_id } => {
                let response = match token_provider.token() {
                    Ok(token) => EgressTokenBridgeResponse::Response {
                        request_id,
                        token: token.token,
                        expires_at: token.expires_at,
                        ttl_ms: token.ttl_ms,
                    },
                    Err(error) => EgressTokenBridgeResponse::Error {
                        request_id,
                        message: error.to_string(),
                    },
                };
                write_json_line(&mut stream, &response)?;
            }
        }
    }
}

fn write_json_line<T: Serialize>(
    stream: &mut UnixStream,
    payload: &T,
) -> Result<(), EgressProxyError> {
    serde_json::to_writer(&mut *stream, payload).map_err(|error| {
        EgressProxyError::new(format!("failed to write token bridge json: {error}"))
    })?;
    stream.write_all(b"\n").map_err(|error| {
        EgressProxyError::new(format!("failed to write token bridge newline: {error}"))
    })?;
    stream.flush().map_err(|error| {
        EgressProxyError::new(format!("failed to flush token bridge stream: {error}"))
    })
}

fn read_json_line<T: for<'de> Deserialize<'de>>(
    stream: &mut UnixStream,
) -> Result<T, EgressProxyError> {
    let mut line = Vec::new();
    let mut byte = [0_u8; 1];
    loop {
        match stream.read(&mut byte) {
            Ok(0) if line.is_empty() => {
                return Err(EgressProxyError::new("egress token bridge stream closed"));
            }
            Ok(0) => {
                return Err(EgressProxyError::new(
                    "egress token bridge stream closed mid-message",
                ));
            }
            Ok(_) if byte[0] == b'\n' => break,
            Ok(_) if line.len() < EGRESS_TOKEN_BRIDGE_MAX_FRAME_BYTES => line.push(byte[0]),
            Ok(_) => {
                return Err(EgressProxyError::new(format!(
                    "egress token bridge frame exceeds {EGRESS_TOKEN_BRIDGE_MAX_FRAME_BYTES} bytes"
                )));
            }
            Err(error) => {
                return Err(EgressProxyError::new(format!(
                    "failed to read token bridge stream: {error}"
                )));
            }
        }
    }

    serde_json::from_slice(&line).map_err(|error| {
        EgressProxyError::new(format!("failed to parse token bridge json: {error}"))
    })
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::os::unix::net::UnixStream;
    use std::thread;

    use crate::egress_proxy::token_bridge::{
        EGRESS_TOKEN_BRIDGE_MAX_FRAME_BYTES, EgressTokenBridgeRequest, read_json_line,
    };

    #[test]
    fn read_json_line_rejects_frames_that_exceed_the_protocol_limit() {
        let (mut writer, mut reader) =
            UnixStream::pair().expect("token bridge pair should be created");
        let writer_thread = thread::spawn(move || {
            writer
                .write_all(&vec![b'x'; EGRESS_TOKEN_BRIDGE_MAX_FRAME_BYTES + 1])
                .expect("oversized token bridge frame should write");
        });

        let error = read_json_line::<EgressTokenBridgeRequest>(&mut reader)
            .expect_err("oversized token bridge frame should be rejected");
        writer_thread
            .join()
            .expect("oversized frame writer should finish");

        assert_eq!(
            error.to_string(),
            format!(
                "egress token bridge frame exceeds {EGRESS_TOKEN_BRIDGE_MAX_FRAME_BYTES} bytes"
            )
        );
    }

    #[test]
    fn read_json_line_accepts_frames_at_the_protocol_limit() {
        let (mut writer, mut reader) =
            UnixStream::pair().expect("token bridge pair should be created");
        let frame_prefix = "{\"type\":\"egressToken.request\",\"request_id\":\"";
        let frame_suffix = "\"}\n";
        let request_id = "x".repeat(
            EGRESS_TOKEN_BRIDGE_MAX_FRAME_BYTES - frame_prefix.len() - frame_suffix.len() + 1,
        );
        let frame = format!("{frame_prefix}{request_id}{frame_suffix}");
        assert_eq!(frame.len(), EGRESS_TOKEN_BRIDGE_MAX_FRAME_BYTES + 1);
        let writer_thread = thread::spawn(move || {
            writer
                .write_all(frame.as_bytes())
                .expect("limit-sized token bridge frame should write");
        });

        let request = read_json_line::<EgressTokenBridgeRequest>(&mut reader)
            .expect("limit-sized token bridge frame should parse");
        writer_thread
            .join()
            .expect("limit-sized frame writer should finish");

        assert!(matches!(
            request,
            EgressTokenBridgeRequest::Request { request_id: parsed_request_id } if parsed_request_id == request_id
        ));
    }
}
