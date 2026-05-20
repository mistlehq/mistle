//! Gateway signing request handling for the live tunnel session.

use tokio::sync::mpsc;

use crate::tunnel::protocol::{SigningControlMessage, SigningRequest, signing_request};
use crate::tunnel::session::{
    TunnelSessionError, TunnelSessionMutableState, TunnelSigningRequest, TunnelSigningResponse,
    TunnelWriterMessage, write_tunnel_text,
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
