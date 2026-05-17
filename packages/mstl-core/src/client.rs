use std::error::Error;
use std::fmt::{Display, Formatter};

use serde::Deserialize;
use url::Url;

#[derive(Debug, Clone)]
pub struct MistleClient {
    api_key: String,
    base_url: Url,
}

impl MistleClient {
    pub fn new(config: MistleClientConfig) -> Result<Self, MistleClientError> {
        let base_url = parse_base_url(&config.base_url)?;
        let api_key = validate_required_string("api key is required", config.api_key)?;

        Ok(Self { api_key, base_url })
    }

    pub fn current_actor(&self) -> Result<CurrentActor, MistleClientError> {
        let mut response = ureq::get(self.current_actor_url().as_str())
            .header("authorization", format!("Bearer {}", self.api_key))
            .call()
            .map_err(MistleClientError::Request)?;

        let response_body = response
            .body_mut()
            .read_to_string()
            .map_err(MistleClientError::ReadResponse)?;

        serde_json::from_str(&response_body).map_err(MistleClientError::DecodeResponse)
    }

    fn current_actor_url(&self) -> Url {
        endpoint_url(&self.base_url, "/v1/me")
    }
}

#[derive(Debug, Clone)]
pub struct MistleClientConfig {
    pub base_url: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct CurrentActor {
    pub authentication: CurrentActorAuthentication,
    pub actor: CurrentActorIdentity,
    pub organization: CurrentActorOrganization,
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CurrentActorAuthentication {
    ApiKey {
        #[serde(rename = "apiKey")]
        api_key: CurrentActorApiKey,
    },
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct CurrentActorApiKey {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CurrentActorIdentity {
    ApiKey { id: String, name: String },
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct CurrentActorOrganization {
    pub id: String,
}

#[derive(Debug)]
pub enum MistleClientError {
    InvalidConfig(&'static str),
    InvalidBaseUrl(url::ParseError),
    UnsupportedBaseUrlScheme(String),
    BaseUrlCannotIncludeQuery,
    BaseUrlCannotIncludeFragment,
    Request(ureq::Error),
    ReadResponse(ureq::Error),
    DecodeResponse(serde_json::Error),
}

impl Display for MistleClientError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidConfig(message) => write!(formatter, "{message}"),
            Self::InvalidBaseUrl(error) => write!(formatter, "invalid base URL: {error}"),
            Self::UnsupportedBaseUrlScheme(scheme) => {
                write!(formatter, "unsupported base URL scheme: {scheme}")
            }
            Self::BaseUrlCannotIncludeQuery => write!(formatter, "base URL cannot include a query"),
            Self::BaseUrlCannotIncludeFragment => {
                write!(formatter, "base URL cannot include a fragment")
            }
            Self::Request(error) => write!(formatter, "request failed: {error}"),
            Self::ReadResponse(error) => write!(formatter, "failed to read response: {error}"),
            Self::DecodeResponse(error) => write!(formatter, "failed to decode response: {error}"),
        }
    }
}

impl Error for MistleClientError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::InvalidBaseUrl(error) => Some(error),
            Self::Request(error) | Self::ReadResponse(error) => Some(error),
            Self::DecodeResponse(error) => Some(error),
            Self::InvalidConfig(_)
            | Self::UnsupportedBaseUrlScheme(_)
            | Self::BaseUrlCannotIncludeQuery
            | Self::BaseUrlCannotIncludeFragment => None,
        }
    }
}

fn parse_base_url(base_url: &str) -> Result<Url, MistleClientError> {
    let trimmed_base_url = validate_required_string("base URL is required", base_url.to_owned())?;
    let parsed_url = Url::parse(&trimmed_base_url).map_err(MistleClientError::InvalidBaseUrl)?;

    match parsed_url.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(MistleClientError::UnsupportedBaseUrlScheme(
                scheme.to_owned(),
            ));
        }
    }

    if parsed_url.query().is_some() {
        return Err(MistleClientError::BaseUrlCannotIncludeQuery);
    }

    if parsed_url.fragment().is_some() {
        return Err(MistleClientError::BaseUrlCannotIncludeFragment);
    }

    Ok(parsed_url)
}

fn validate_required_string(
    error_message: &'static str,
    value: String,
) -> Result<String, MistleClientError> {
    let trimmed_value = value.trim().to_owned();

    if trimmed_value.is_empty() {
        return Err(MistleClientError::InvalidConfig(error_message));
    }

    Ok(trimmed_value)
}

fn endpoint_url(base_url: &Url, endpoint_path: &str) -> Url {
    let mut endpoint_url = base_url.clone();
    let base_path = endpoint_url.path().trim_end_matches('/');
    let endpoint_path = endpoint_path.trim_start_matches('/');

    endpoint_url.set_path(&format!("{base_path}/{endpoint_path}"));
    endpoint_url
}

#[cfg(test)]
mod tests {
    use crate::client::{
        CurrentActor, CurrentActorApiKey, CurrentActorAuthentication, CurrentActorIdentity,
        CurrentActorOrganization, MistleClient, MistleClientConfig,
    };

    #[test]
    fn builds_current_actor_url_from_root_base_url() {
        let client = client_with_base_url("https://api.example.test");

        assert_eq!(
            client.current_actor_url().as_str(),
            "https://api.example.test/v1/me"
        );
    }

    #[test]
    fn builds_current_actor_url_from_nested_base_url() {
        let client = client_with_base_url("https://api.example.test/control-plane/");

        assert_eq!(
            client.current_actor_url().as_str(),
            "https://api.example.test/control-plane/v1/me"
        );
    }

    #[test]
    fn trims_required_config_values() {
        let client = MistleClient::new(MistleClientConfig {
            base_url: " https://api.example.test ".to_owned(),
            api_key: " mstl_test_key ".to_owned(),
        })
        .expect("client config should be valid");

        assert_eq!(
            client.current_actor_url().as_str(),
            "https://api.example.test/v1/me"
        );
    }

    #[test]
    fn rejects_blank_base_url() {
        let error = MistleClient::new(MistleClientConfig {
            base_url: " ".to_owned(),
            api_key: "mstl_test_key".to_owned(),
        })
        .expect_err("blank base URL should fail");

        assert_eq!(error.to_string(), "base URL is required");
    }

    #[test]
    fn rejects_blank_api_key() {
        let error = MistleClient::new(MistleClientConfig {
            base_url: "https://api.example.test".to_owned(),
            api_key: " ".to_owned(),
        })
        .expect_err("blank api key should fail");

        assert_eq!(error.to_string(), "api key is required");
    }

    #[test]
    fn rejects_unsupported_base_url_scheme() {
        let error = MistleClient::new(MistleClientConfig {
            base_url: "file:///tmp/mistle.sock".to_owned(),
            api_key: "mstl_test_key".to_owned(),
        })
        .expect_err("unsupported base URL scheme should fail");

        assert_eq!(error.to_string(), "unsupported base URL scheme: file");
    }

    #[test]
    fn rejects_base_url_query() {
        let error = MistleClient::new(MistleClientConfig {
            base_url: "https://api.example.test?workspace=local".to_owned(),
            api_key: "mstl_test_key".to_owned(),
        })
        .expect_err("base URL query should fail");

        assert_eq!(error.to_string(), "base URL cannot include a query");
    }

    #[test]
    fn rejects_base_url_fragment() {
        let error = MistleClient::new(MistleClientConfig {
            base_url: "https://api.example.test#local".to_owned(),
            api_key: "mstl_test_key".to_owned(),
        })
        .expect_err("base URL fragment should fail");

        assert_eq!(error.to_string(), "base URL cannot include a fragment");
    }

    #[test]
    fn decodes_api_key_current_actor_response() {
        let actor = serde_json::from_str::<CurrentActor>(
            r#"{
                "authentication": {
                    "kind": "api_key",
                    "apiKey": {
                        "id": "apk_01",
                        "name": "local"
                    }
                },
                "actor": {
                    "kind": "api_key",
                    "id": "apk_01",
                    "name": "local"
                },
                "organization": {
                    "id": "org_01"
                },
                "permissions": [
                    "organization:api_keys:read",
                    "organization:sandboxes:read"
                ]
            }"#,
        )
        .expect("current actor response should decode");

        assert_eq!(
            actor,
            CurrentActor {
                authentication: CurrentActorAuthentication::ApiKey {
                    api_key: CurrentActorApiKey {
                        id: "apk_01".to_owned(),
                        name: "local".to_owned(),
                    },
                },
                actor: CurrentActorIdentity::ApiKey {
                    id: "apk_01".to_owned(),
                    name: "local".to_owned(),
                },
                organization: CurrentActorOrganization {
                    id: "org_01".to_owned(),
                },
                permissions: vec![
                    "organization:api_keys:read".to_owned(),
                    "organization:sandboxes:read".to_owned(),
                ],
            }
        );
    }

    #[test]
    fn rejects_session_current_actor_response() {
        let error = serde_json::from_str::<CurrentActor>(
            r#"{
                "authentication": {
                    "kind": "session"
                },
                "actor": {
                    "kind": "user",
                    "id": "usr_01"
                },
                "organization": {
                    "id": "org_01"
                },
                "permissions": [
                    "organization:read"
                ]
            }"#,
        )
        .expect_err("session current actor response should fail");

        assert!(error.to_string().contains("unknown variant `session`"));
    }

    fn client_with_base_url(base_url: &str) -> MistleClient {
        MistleClient::new(MistleClientConfig {
            base_url: base_url.to_owned(),
            api_key: "mstl_test_key".to_owned(),
        })
        .expect("client config should be valid")
    }
}
