//! Shared activation protocol types.

use serde::{Deserialize, Deserializer, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivationOperationKind {
    Start,
    Resume,
    SetupCheck,
    Snapshot,
}

impl ActivationOperationKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Resume => "resume",
            Self::SetupCheck => "setup_check",
            Self::Snapshot => "snapshot",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitSigningConfig {
    pub format: String,
    pub program: String,
    pub key_ref: String,
    pub organization_id: String,
    pub provider_family: String,
    pub integration_connection_id: Option<String>,
    pub acting_user_id: String,
    pub grant: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitIdentity {
    pub name: String,
    pub email: String,
    pub signing: Option<GitSigningConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransparentProxyBypassKind {
    SocketMark,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransparentProxyBypass {
    pub kind: TransparentProxyBypassKind,
    pub mark: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransparentProxyExclusionKind {
    Cidr,
    Host,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransparentProxyExclusion {
    pub kind: TransparentProxyExclusionKind,
    pub value: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransparentProxyConfiguration {
    pub passthrough_bypass: TransparentProxyBypass,
    pub exclusions: Vec<TransparentProxyExclusion>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivationOkResponse {
    #[serde(deserialize_with = "deserialize_ok_true")]
    pub ok: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivationErrorResponse {
    #[serde(deserialize_with = "deserialize_ok_false")]
    pub ok: bool,
    #[serde(deserialize_with = "deserialize_non_empty_error")]
    pub error: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ActivationResponse {
    Ok(ActivationOkResponse),
    Error(ActivationErrorResponse),
}

fn deserialize_ok_true<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    let ok = bool::deserialize(deserializer)?;
    if ok {
        Ok(ok)
    } else {
        Err(serde::de::Error::custom(
            "activation success response must contain ok: true",
        ))
    }
}

fn deserialize_ok_false<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    let ok = bool::deserialize(deserializer)?;
    if ok {
        Err(serde::de::Error::custom(
            "activation error response must contain ok: false",
        ))
    } else {
        Ok(ok)
    }
}

fn deserialize_non_empty_error<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let error = String::deserialize(deserializer)?;
    if error.is_empty() {
        return Err(serde::de::Error::custom(
            "activation error response must contain a non-empty error",
        ));
    }
    Ok(error)
}
