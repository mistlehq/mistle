//! Client helpers for the local `sandboxd` control socket.
//!
//! These functions are used by one-shot helper commands to submit lifecycle and
//! signing requests to the already-running daemon without exposing the socket
//! framing details outside the control module.

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;

use crate::control::error::ControlError;
use crate::control::protocol::{ControlRequest, ControlResponse, ControlSignRequest};
use crate::protocol::activation::ActivationInput;

/// Checks that the daemon's local control socket is reachable.
pub fn submit_ready(socket_path: &Path) -> Result<(), ControlError> {
    submit_control_request(socket_path, ControlRequest::Ready).map(|_| ())
}

/// Activates a sandbox, initializing or refreshing runtime resources as needed.
pub fn submit_activate(
    socket_path: &Path,
    activation_input: &ActivationInput,
) -> Result<(), ControlError> {
    submit_startup_request(
        socket_path,
        ControlRequest::Activate {
            activation_input: Box::new(activation_input.clone()),
        },
    )
}

/// Submits one signing request to an activated daemon and returns the signature.
pub fn submit_signing(
    socket_path: &Path,
    sign_request: &ControlSignRequest,
) -> Result<String, ControlError> {
    let mut stream =
        UnixStream::connect(socket_path).map_err(|error| ControlError::ConnectSocket {
            path: socket_path.to_path_buf(),
            error,
        })?;
    let request = serde_json::to_vec(&ControlRequest::Sign {
        sign_request: sign_request.clone(),
    })
    .map_err(ControlError::SerializeResponse)?;
    stream
        .write_all(&request)
        .map_err(ControlError::WriteResponse)?;
    stream
        .shutdown(std::net::Shutdown::Write)
        .map_err(ControlError::WriteResponse)?;

    let mut raw_response = Vec::new();
    stream
        .read_to_end(&mut raw_response)
        .map_err(ControlError::ReadRequest)?;
    let response: ControlResponse =
        serde_json::from_slice(&raw_response).map_err(ControlError::InvalidResponse)?;

    if !response.ok {
        return Err(ControlError::ResponseError(response.error.unwrap_or_else(
            || "control socket returned ok=false without an error".to_string(),
        )));
    }

    response.signature_base64.ok_or_else(|| {
        ControlError::ResponseError(
            "control socket signing response did not include a signature".to_string(),
        )
    })
}

fn submit_startup_request(socket_path: &Path, request: ControlRequest) -> Result<(), ControlError> {
    submit_control_request(socket_path, request).map(|_| ())
}

fn submit_control_request(
    socket_path: &Path,
    request: ControlRequest,
) -> Result<Option<String>, ControlError> {
    let mut stream =
        UnixStream::connect(socket_path).map_err(|error| ControlError::ConnectSocket {
            path: socket_path.to_path_buf(),
            error,
        })?;
    let request = serde_json::to_vec(&request).map_err(ControlError::SerializeResponse)?;
    stream
        .write_all(&request)
        .map_err(ControlError::WriteResponse)?;
    stream
        .shutdown(std::net::Shutdown::Write)
        .map_err(ControlError::WriteResponse)?;

    let mut raw_response = Vec::new();
    stream
        .read_to_end(&mut raw_response)
        .map_err(ControlError::ReadRequest)?;
    let response: ControlResponse =
        serde_json::from_slice(&raw_response).map_err(ControlError::InvalidResponse)?;

    if !response.ok {
        return Err(ControlError::ResponseError(response.error.unwrap_or_else(
            || "control socket returned ok=false without an error".to_string(),
        )));
    }

    Ok(response.signature_base64)
}
