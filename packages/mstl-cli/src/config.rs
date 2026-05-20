use std::env::{self, VarError};

use mstl_core::auth::{API_KEY_ENV_VAR, CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR};
use mstl_core::client::{MistleClient, MistleClientConfig};

use crate::error::CliError;

pub(crate) fn mistle_client() -> Result<MistleClient, CliError> {
    let api_key = required_env_var(API_KEY_ENV_VAR)?;
    let base_url = control_plane_api_public_url()?;

    MistleClient::new(MistleClientConfig { base_url, api_key }).map_err(|source| CliError::Client {
        action: "configure Mistle client",
        source,
    })
}

pub(crate) fn control_plane_api_public_url() -> Result<String, CliError> {
    required_env_var(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)
}

fn required_env_var(name: &'static str) -> Result<String, CliError> {
    match env::var(name) {
        Ok(value) if value.trim().is_empty() => Err(CliError::BlankEnvironmentVariable { name }),
        Ok(value) => Ok(value),
        Err(VarError::NotPresent) => Err(CliError::MissingEnvironmentVariable { name }),
        Err(VarError::NotUnicode(_)) => Err(CliError::NonUnicodeEnvironmentVariable { name }),
    }
}
