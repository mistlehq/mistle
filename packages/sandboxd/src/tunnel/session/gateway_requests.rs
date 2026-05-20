//! Gateway signing and egress-token request handling for the live tunnel session.

use serde_json::Value;
use tokio::sync::mpsc;

use crate::time::Clock;
use crate::tunnel::protocol::{
    EgressTokenControlMessage, EgressTokenRequest, SigningControlMessage, SigningRequest,
    egress_token_request, signing_request,
};
use crate::tunnel::session::operation::record_egress_token_event;
use crate::tunnel::session::{
    TunnelEgressToken, TunnelSessionError, TunnelSessionMutableState, TunnelSigningRequest,
    TunnelSigningResponse, TunnelWriterMessage, write_tunnel_text,
};

pub(super) fn fail_pending_signing_requests(
    session_state: &mut TunnelSessionMutableState,
    message: &str,
) {
    for response_sender in std::mem::take(&mut session_state.pending_signing_requests).into_values()
    {
        let _ = response_sender.send(Err(TunnelSessionError::Signing(message.to_string())));
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

pub(super) fn handle_signing_session_request(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
    request: TunnelSigningRequest,
    response_sender: std::sync::mpsc::Sender<Result<TunnelSigningResponse, TunnelSessionError>>,
) -> Result<(), TunnelSessionError> {
    if request.request_id.trim().is_empty() {
        let _ = response_sender.send(Err(TunnelSessionError::Signing(
            "signing request id is required".to_string(),
        )));
        return Ok(());
    }

    if session_state
        .pending_signing_requests
        .contains_key(&request.request_id)
    {
        let _ = response_sender.send(Err(TunnelSessionError::Signing(
            "duplicate signing request id".to_string(),
        )));
        return Ok(());
    }

    session_state
        .pending_signing_requests
        .insert(request.request_id.clone(), response_sender);
    let request_id = request.request_id.clone();

    let payload = signing_request(&SigningRequest {
        message_type: "signing.request".to_string(),
        request_id: request.request_id,
        organization_id: request.organization_id,
        sandbox_instance_id: request.sandbox_instance_id,
        acting_user_id: request.acting_user_id,
        provider_family: request.provider_family,
        format: request.format,
        key_ref: request.key_ref,
        grant: request.grant,
        payload: request.payload_base64,
        encoding: "base64".to_string(),
    });

    match write_tunnel_text(tunnel_writer_sender, payload) {
        Ok(()) => Ok(()),
        Err(error) => {
            if let Some(response_sender) =
                session_state.pending_signing_requests.remove(&request_id)
            {
                let _ = response_sender.send(Err(TunnelSessionError::Signing(error.to_string())));
            }
            Err(error)
        }
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

pub(super) fn handle_signing_control_message(
    session_state: &mut TunnelSessionMutableState,
    message: SigningControlMessage,
) {
    match message {
        SigningControlMessage::Request(request) => {
            eprintln!(
                "sandboxd dropped unexpected signing request '{}' from the gateway",
                request.request_id
            );
        }
        SigningControlMessage::ResultSuccess(result) => {
            if let Some(response_sender) = session_state
                .pending_signing_requests
                .remove(&result.request_id)
            {
                let _ = response_sender.send(Ok(TunnelSigningResponse::Success {
                    request_id: result.request_id,
                    signature_base64: result.signature,
                }));
            }
        }
        SigningControlMessage::ResultFailure(result) => {
            if let Some(response_sender) = session_state
                .pending_signing_requests
                .remove(&result.request_id)
            {
                let _ = response_sender.send(Ok(TunnelSigningResponse::Failure {
                    request_id: result.request_id,
                    code: result.code,
                    message: result.message,
                }));
            }
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
