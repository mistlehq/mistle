//! Thin local egress-grant refresh submission client for `sandboxd`.
//!
//! `sandboxd refresh-egress-grants` reads one narrow refresh payload from stdin,
//! forwards that payload to the running daemon over the local control socket,
//! writes the daemon response to stdout, and exits.

use std::fmt;
use std::io::{Read, Write};
use std::path::Path;

use crate::control;
use crate::protocol::egress_refresh::EgressGrantRefreshInput;
use crate::protocol::startup::{StartupInitErrorResponse, StartupInitOkResponse};

#[derive(Debug)]
pub enum RefreshEgressGrantsError {
    ReadRequest(std::io::Error),
    InvalidRequest(serde_json::Error),
    SubmitRefresh(String),
    WriteResponse(std::io::Error),
    SerializeResponse(serde_json::Error),
}

impl fmt::Display for RefreshEgressGrantsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ReadRequest(error) => {
                write!(
                    f,
                    "failed to read sandbox egress grant refresh request: {error}"
                )
            }
            Self::InvalidRequest(error) => {
                write!(
                    f,
                    "sandbox egress grant refresh request must be valid json: {error}"
                )
            }
            Self::SubmitRefresh(error) => {
                write!(
                    f,
                    "failed to submit sandbox egress grant refresh request: {error}"
                )
            }
            Self::WriteResponse(error) => {
                write!(
                    f,
                    "failed to write sandbox egress grant refresh response: {error}"
                )
            }
            Self::SerializeResponse(error) => {
                write!(
                    f,
                    "failed to serialize sandbox egress grant refresh response: {error}"
                )
            }
        }
    }
}

impl std::error::Error for RefreshEgressGrantsError {}

pub fn run_refresh_egress_grants<R, W>(
    reader: &mut R,
    writer: &mut W,
    control_socket_path: &Path,
) -> Result<(), RefreshEgressGrantsError>
where
    R: Read,
    W: Write,
{
    let mut raw_request = Vec::new();
    let refresh_input = match reader.read_to_end(&mut raw_request) {
        Ok(_) => match serde_json::from_slice::<EgressGrantRefreshInput>(&raw_request) {
            Ok(refresh_input) => refresh_input,
            Err(error) => {
                let error = RefreshEgressGrantsError::InvalidRequest(error);
                write_response(
                    writer,
                    &StartupInitErrorResponse {
                        ok: false,
                        error: error.to_string(),
                    },
                )?;
                return Err(error);
            }
        },
        Err(error) => {
            let error = RefreshEgressGrantsError::ReadRequest(error);
            write_response(
                writer,
                &StartupInitErrorResponse {
                    ok: false,
                    error: error.to_string(),
                },
            )?;
            return Err(error);
        }
    };

    match control::submit_egress_grant_refresh(control_socket_path, &refresh_input) {
        Ok(()) => {
            write_response(writer, &StartupInitOkResponse { ok: true })?;
            Ok(())
        }
        Err(error) => {
            let error = RefreshEgressGrantsError::SubmitRefresh(error.to_string());
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

fn write_response<W, T>(writer: &mut W, response: &T) -> Result<(), RefreshEgressGrantsError>
where
    W: Write,
    T: serde::Serialize,
{
    let response_bytes =
        serde_json::to_vec(response).map_err(RefreshEgressGrantsError::SerializeResponse)?;
    writer
        .write_all(&response_bytes)
        .map_err(RefreshEgressGrantsError::WriteResponse)?;
    writer
        .write_all(b"\n")
        .map_err(RefreshEgressGrantsError::WriteResponse)?;
    writer
        .flush()
        .map_err(RefreshEgressGrantsError::WriteResponse)
}
