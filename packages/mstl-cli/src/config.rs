use std::env::{self, VarError};

use mstl_core::auth::{API_KEY_ENV_VAR, CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR};
use mstl_core::client::{MistleClient, MistleClientAuthorizationHeaderConfig};

use crate::auth_file;
use crate::error::CliError;
use crate::login::{current_unix_seconds, refresh_oauth_auth};

#[cfg(debug_assertions)]
const DEFAULT_CONTROL_PLANE_API_PUBLIC_URL: &str = "http://localhost:5100";

#[cfg(not(debug_assertions))]
const DEFAULT_CONTROL_PLANE_API_PUBLIC_URL: &str = "https://api.mistle.dev";

pub(crate) fn mistle_client() -> Result<MistleClient, CliError> {
    let base_url = control_plane_api_public_url()?;
    let authorization_header = resolve_authorization_header(&base_url)?;

    MistleClient::new_with_authorization_header(MistleClientAuthorizationHeaderConfig {
        base_url,
        authorization_header,
    })
    .map_err(|source| CliError::Client {
        action: "configure Mistle client",
        source,
    })
}

pub(crate) fn control_plane_api_public_url() -> Result<String, CliError> {
    optional_env_var(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)
        .map(|value| value.unwrap_or_else(|| DEFAULT_CONTROL_PLANE_API_PUBLIC_URL.to_owned()))
}

fn resolve_authorization_header(base_url: &str) -> Result<String, CliError> {
    match optional_env_var(API_KEY_ENV_VAR)? {
        Some(api_key) => Ok(format!("Bearer {api_key}")),
        None => match auth_file::read_auth_credential()? {
            auth_file::AuthCredential::ApiKey(api_key) => Ok(format!("Bearer {api_key}")),
            auth_file::AuthCredential::OAuth(oauth) => {
                let current_time = current_unix_seconds()?;
                if oauth.expires_at_unix_seconds > current_time + 60 {
                    return Ok(format!("Bearer {}", oauth.access_token));
                }

                let refreshed_oauth = refresh_oauth_auth(base_url, &oauth.refresh_token)?;
                let access_token = refreshed_oauth.access_token.clone();
                auth_file::write_oauth(refreshed_oauth)?;
                Ok(format!("Bearer {access_token}"))
            }
        },
    }
}

fn optional_env_var(name: &'static str) -> Result<Option<String>, CliError> {
    match env::var(name) {
        Ok(value) if value.trim().is_empty() => Err(CliError::BlankEnvironmentVariable { name }),
        Ok(value) => Ok(Some(value)),
        Err(VarError::NotPresent) => Ok(None),
        Err(VarError::NotUnicode(_)) => Err(CliError::NonUnicodeEnvironmentVariable { name }),
    }
}

#[cfg(test)]
mod tests {
    use crate::config::DEFAULT_CONTROL_PLANE_API_PUBLIC_URL;

    #[test]
    fn debug_build_defaults_to_local_control_plane_api() {
        assert_eq!(
            DEFAULT_CONTROL_PLANE_API_PUBLIC_URL,
            "http://localhost:5100"
        );
    }
}
