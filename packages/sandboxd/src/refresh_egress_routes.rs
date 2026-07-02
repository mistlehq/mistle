//! Thin local route-refresh submission client for `sandboxd`.
//!
//! `sandboxd refresh-egress-routes` accepts non-secret route matchers and asks
//! the already-running daemon to update its sandbox-local egress route table.

use std::fmt;
use std::path::Path;

use crate::control::{self, ControlRefreshEgressRoutesRequest};

#[derive(Debug)]
pub enum RefreshEgressRoutesError {
    InvalidRequest(serde_json::Error),
    SubmitRefresh(String),
}

impl fmt::Display for RefreshEgressRoutesError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRequest(error) => {
                write!(
                    f,
                    "sandbox refresh egress routes request must be valid json: {error}"
                )
            }
            Self::SubmitRefresh(error) => {
                write!(
                    f,
                    "failed to submit sandbox refresh egress routes request: {error}"
                )
            }
        }
    }
}

impl std::error::Error for RefreshEgressRoutesError {}

pub fn run_refresh_egress_routes(
    routes_json: &str,
    control_socket_path: &Path,
) -> Result<(), RefreshEgressRoutesError> {
    let refresh_request = serde_json::from_str::<ControlRefreshEgressRoutesRequest>(routes_json)
        .map_err(RefreshEgressRoutesError::InvalidRequest)?;

    control::submit_refresh_egress_routes(control_socket_path, &refresh_request)
        .map_err(|error| RefreshEgressRoutesError::SubmitRefresh(error.to_string()))
}
