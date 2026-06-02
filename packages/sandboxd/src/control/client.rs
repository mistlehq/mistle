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
use crate::protocol::startup::StartupInput;

/// Submits one startup payload to the running daemon over the local control socket.
pub fn submit_init(
    socket_path: &Path,
    startup_input: &StartupInput,
    wait_for_completion: bool,
) -> Result<(), ControlError> {
    submit_startup_request(
        socket_path,
        ControlRequest::Init {
            startup_input: startup_input.clone(),
            wait_for_completion,
        },
    )
}

/// Checks that the daemon's local control socket is reachable.
pub fn submit_ready(socket_path: &Path) -> Result<(), ControlError> {
    submit_control_request(socket_path, ControlRequest::Ready).map(|_| ())
}

/// Submits a resume payload to an already initialized daemon.
pub fn submit_resume(socket_path: &Path, startup_input: &StartupInput) -> Result<(), ControlError> {
    submit_startup_request(
        socket_path,
        ControlRequest::Resume {
            startup_input: startup_input.clone(),
        },
    )
}

/// Waits for the daemon's current initialization worker to complete.
pub fn submit_wait_init(socket_path: &Path) -> Result<(), ControlError> {
    submit_startup_request(socket_path, ControlRequest::WaitInit)
}

/// Submits one signing request to an initialized daemon and returns the signature.
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
