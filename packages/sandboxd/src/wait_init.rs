//! Thin local client for waiting until detached `sandboxd init` completes.

use std::fmt;
use std::io::Write;
use std::path::Path;

use crate::control;
use crate::protocol::startup::{StartupInitErrorResponse, StartupInitOkResponse};

/// Describes why `sandboxd wait-init` failed to submit to the daemon or write
/// its JSON response.
#[derive(Debug)]
pub enum WaitInitError {
    SubmitWaitInit(String),
    WriteResponse(std::io::Error),
    SerializeResponse(serde_json::Error),
}

impl fmt::Display for WaitInitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SubmitWaitInit(error) => {
                write!(f, "failed to wait for sandbox init completion: {error}")
            }
            Self::WriteResponse(error) => {
                write!(f, "failed to write sandbox wait-init response: {error}")
            }
            Self::SerializeResponse(error) => {
                write!(f, "failed to serialize sandbox wait-init response: {error}")
            }
        }
    }
}

impl std::error::Error for WaitInitError {}

/// Waits for the daemon's in-flight initialization worker and writes a JSON
/// response matching `sandboxd init`.
pub fn run_wait_init<W>(writer: &mut W, control_socket_path: &Path) -> Result<(), WaitInitError>
where
    W: Write,
{
    match control::submit_wait_init(control_socket_path) {
        Ok(()) => {
            write_response(writer, &StartupInitOkResponse { ok: true })?;
            Ok(())
        }
        Err(error) => {
            let error = WaitInitError::SubmitWaitInit(error.to_string());
            write_response(
                writer,
                &StartupInitErrorResponse {
                    ok: false,
                    error: error.to_string(),
                },
            )?;
            Err(error)
        }
    }
}

fn write_response<W, T>(writer: &mut W, response: &T) -> Result<(), WaitInitError>
where
    W: Write,
    T: serde::Serialize,
{
    let response_bytes = serde_json::to_vec(response).map_err(WaitInitError::SerializeResponse)?;
    writer
        .write_all(&response_bytes)
        .map_err(WaitInitError::WriteResponse)?;
    writer
        .write_all(b"\n")
        .map_err(WaitInitError::WriteResponse)?;
    writer.flush().map_err(WaitInitError::WriteResponse)
}
