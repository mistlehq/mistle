//! Gateway egress-token request handling for the live tunnel session.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

use serde_json::Value;
use tokio::sync::mpsc;
use tracing::info;

use crate::time::Clock;
use crate::tunnel::protocol::{
    EgressTokenControlMessage, EgressTokenRequest, egress_token_request,
};
use crate::tunnel::session::bootstrap::{TunnelWriterMessage, write_tunnel_text};
use crate::tunnel::session::error::TunnelSessionError;
use crate::tunnel::session::operation::record_egress_token_event;
use crate::tunnel::session::state::{TunnelSessionMutableState, TunnelSessionRequest};

const DEFAULT_EGRESS_TOKEN_REQUEST_TIMEOUT: std::time::Duration =
    std::time::Duration::from_secs(10);
const EGRESS_TOKEN_REFRESH_SKEW_MS: u64 = 30_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TunnelEgressToken {
    pub token: String,
    pub expires_at: String,
    pub ttl_ms: u64,
}

#[derive(Debug, Clone)]
struct CachedEgressToken {
    token: TunnelEgressToken,
    stored_at: Instant,
    cache_ttl_ms: u64,
    source_request_id: String,
}

#[derive(Clone)]
pub struct GatewayEgressTokenProvider {
    request_sender: Arc<RwLock<Option<mpsc::UnboundedSender<TunnelSessionRequest>>>>,
    cached_token: Arc<Mutex<Option<CachedEgressToken>>>,
    next_request_id: Arc<AtomicU64>,
    sandbox_instance_id: String,
}

impl GatewayEgressTokenProvider {
    pub fn new(sandbox_instance_id: impl Into<String>) -> Self {
        Self {
            request_sender: Arc::new(RwLock::new(None)),
            cached_token: Arc::new(Mutex::new(None)),
            next_request_id: Arc::new(AtomicU64::new(1)),
            sandbox_instance_id: sandbox_instance_id.into(),
        }
    }

    pub(in crate::tunnel::session) fn attach(
        &self,
        request_sender: mpsc::UnboundedSender<TunnelSessionRequest>,
    ) {
        match self.request_sender.write() {
            Ok(mut sender) => *sender = Some(request_sender),
            Err(error) => {
                eprintln!("sandboxd failed to attach gateway egress token provider: {error}");
            }
        }
    }

    pub fn token(&self) -> Result<TunnelEgressToken, TunnelSessionError> {
        if let Some(token) = self.cached_token()? {
            return Ok(token);
        }

        let request_sender = self
            .request_sender
            .read()
            .map_err(|error| TunnelSessionError::EgressToken(error.to_string()))?
            .clone()
            .ok_or_else(|| {
                TunnelSessionError::EgressToken(
                    "gateway egress token provider is not attached to the bootstrap session"
                        .to_string(),
                )
            })?;
        let request_id = format!(
            "egress_token_req_{}",
            self.next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        let (response_sender, response_receiver) = std::sync::mpsc::channel();
        request_sender
            .send(TunnelSessionRequest::EgressToken {
                request_id: request_id.clone(),
                response_sender,
            })
            .map_err(|error| TunnelSessionError::EgressToken(error.to_string()))?;

        match response_receiver.recv_timeout(DEFAULT_EGRESS_TOKEN_REQUEST_TIMEOUT) {
            Ok(Ok(token)) => {
                self.store_token(token.clone(), &request_id)?;
                Ok(token)
            }
            Ok(Err(error)) => Err(error),
            Err(error) => Err(TunnelSessionError::EgressToken(format!(
                "egress token request {request_id} timed out or disconnected: {error}"
            ))),
        }
    }

    fn cached_token(&self) -> Result<Option<TunnelEgressToken>, TunnelSessionError> {
        let cached_token = self
            .cached_token
            .lock()
            .map_err(|error| TunnelSessionError::EgressToken(error.to_string()))?
            .clone();
        let Some(cached_token) = cached_token else {
            return Ok(None);
        };
        let elapsed_ms = cached_token
            .stored_at
            .elapsed()
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX);
        if elapsed_ms >= cached_token.cache_ttl_ms {
            return Ok(None);
        }
        info!(
            event = "egress_token_cache_hit",
            request_id = cached_token.source_request_id.as_str(),
            sandbox_instance_id = self.sandbox_instance_id.as_str(),
            expires_at = cached_token.token.expires_at.as_str(),
            ttl_ms = cached_token.token.ttl_ms,
            cache_ttl_ms = cached_token.cache_ttl_ms,
            elapsed_ms = elapsed_ms,
            "using cached gateway egress token"
        );
        Ok(Some(cached_token.token))
    }

    fn store_token(
        &self,
        token: TunnelEgressToken,
        request_id: &str,
    ) -> Result<(), TunnelSessionError> {
        let mut cached_token = self
            .cached_token
            .lock()
            .map_err(|error| TunnelSessionError::EgressToken(error.to_string()))?;
        *cached_token = Some(CachedEgressToken {
            cache_ttl_ms: token.ttl_ms.saturating_sub(EGRESS_TOKEN_REFRESH_SKEW_MS),
            token,
            stored_at: Instant::now(),
            source_request_id: request_id.to_string(),
        });
        Ok(())
    }
}

pub(super) fn fail_pending_egress_token_requests(
    session_state: &mut TunnelSessionMutableState,
    message: &str,
) {
    for response_sender in
        std::mem::take(&mut session_state.pending_egress_token_requests).into_values()
    {
        let _ = response_sender.send(Err(TunnelSessionError::EgressToken(message.to_string())));
    }
}

pub(super) fn handle_egress_token_session_request(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
    clock: &dyn Clock,
    sandbox_instance_id: &str,
    request_id: String,
    response_sender: std::sync::mpsc::Sender<Result<TunnelEgressToken, TunnelSessionError>>,
) -> Result<(), TunnelSessionError> {
    if request_id.trim().is_empty() {
        let _ = response_sender.send(Err(TunnelSessionError::EgressToken(
            "egress token request id is required".to_string(),
        )));
        return Ok(());
    }

    if session_state
        .pending_egress_token_requests
        .contains_key(&request_id)
    {
        let _ = response_sender.send(Err(TunnelSessionError::EgressToken(
            "duplicate egress token request id".to_string(),
        )));
        return Ok(());
    }

    record_egress_token_event(
        tunnel_writer_sender,
        session_state,
        clock,
        sandbox_instance_id,
        "egress_token_request_started",
        &request_id,
        &[],
    );
    session_state
        .pending_egress_token_requests
        .insert(request_id.clone(), response_sender);
    let payload = egress_token_request(&EgressTokenRequest {
        message_type: "egress.token.request".to_string(),
        request_id: request_id.clone(),
    });

    match write_tunnel_text(tunnel_writer_sender, payload) {
        Ok(()) => Ok(()),
        Err(error) => {
            if let Some(response_sender) = session_state
                .pending_egress_token_requests
                .remove(&request_id)
            {
                let _ =
                    response_sender.send(Err(TunnelSessionError::EgressToken(error.to_string())));
            }
            record_egress_token_event(
                tunnel_writer_sender,
                session_state,
                clock,
                sandbox_instance_id,
                "egress_token_request_failed",
                &request_id,
                &[("error", Value::String(error.to_string()))],
            );
            Err(error)
        }
    }
}

pub(super) fn handle_egress_token_control_message(
    session_state: &mut TunnelSessionMutableState,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    clock: &dyn Clock,
    sandbox_instance_id: &str,
    message: EgressTokenControlMessage,
) {
    match message {
        EgressTokenControlMessage::Request(request) => {
            eprintln!(
                "sandboxd dropped unexpected egress token request '{}' from the gateway",
                request.request_id
            );
        }
        EgressTokenControlMessage::Response(response) => {
            if let Some(response_sender) = session_state
                .pending_egress_token_requests
                .remove(&response.request_id)
            {
                let request_id = response.request_id;
                let expires_at = response.expires_at;
                let ttl_ms = response.ttl_ms;
                let _ = response_sender.send(Ok(TunnelEgressToken {
                    token: response.token,
                    expires_at: expires_at.clone(),
                    ttl_ms,
                }));
                record_egress_token_event(
                    tunnel_writer_sender,
                    session_state,
                    clock,
                    sandbox_instance_id,
                    "egress_token_request_completed",
                    &request_id,
                    &[
                        ("expiresAt", Value::String(expires_at)),
                        ("ttlMs", Value::from(ttl_ms)),
                    ],
                );
            }
        }
        EgressTokenControlMessage::Error(error) => {
            if let Some(response_sender) = session_state
                .pending_egress_token_requests
                .remove(&error.request_id)
            {
                let _ = response_sender.send(Err(TunnelSessionError::EgressToken(format!(
                    "{}: {}",
                    error.code, error.message
                ))));
                record_egress_token_event(
                    tunnel_writer_sender,
                    session_state,
                    clock,
                    sandbox_instance_id,
                    "egress_token_request_failed",
                    &error.request_id,
                    &[
                        ("code", Value::String(error.code)),
                        ("error", Value::String(error.message)),
                    ],
                );
            }
        }
    }
}
