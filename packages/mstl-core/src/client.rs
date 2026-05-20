use std::error::Error;
use std::fmt::{Display, Formatter};

use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Clone)]
pub struct MistleClient {
    authorization_header: String,
    base_url: Url,
}

impl MistleClient {
    pub fn new(config: MistleClientConfig) -> Result<Self, MistleClientError> {
        let base_url = parse_base_url(&config.base_url)?;
        let api_key = validate_required_string("api key is required", config.api_key)?;
        let authorization_header = format!("Bearer {api_key}");

        Ok(Self {
            authorization_header,
            base_url,
        })
    }

    pub fn new_with_authorization_header(
        config: MistleClientAuthorizationHeaderConfig,
    ) -> Result<Self, MistleClientError> {
        let base_url = parse_base_url(&config.base_url)?;
        let authorization_header = validate_required_string(
            "authorization header is required",
            config.authorization_header,
        )?;

        Ok(Self {
            authorization_header,
            base_url,
        })
    }

    pub fn current_actor(&self) -> Result<CurrentActor, MistleClientError> {
        self.get_json(self.current_actor_url().as_str())
    }

    pub fn list_sandbox_profiles(&self) -> Result<ListSandboxProfilesResponse, MistleClientError> {
        let mut page = self.list_sandbox_profiles_page(None)?;
        let total_results = page.total_results;
        let mut items = page.items;
        let mut next_page = page.next_page;

        while let Some(next_page_cursor) = next_page {
            let after = next_page_cursor
                .after
                .ok_or(MistleClientError::InvalidResponse(
                    "profile list next page is missing its `after` cursor",
                ))?;
            page = self.list_sandbox_profiles_page(Some(&after))?;
            items.append(&mut page.items);
            next_page = page.next_page;
        }

        Ok(ListSandboxProfilesResponse {
            total_results,
            items,
            next_page: None,
            previous_page: None,
        })
    }

    pub fn get_sandbox_profile(
        &self,
        profile_id: &str,
    ) -> Result<SandboxProfile, MistleClientError> {
        self.get_json(self.get_sandbox_profile_url(profile_id)?.as_str())
    }

    pub fn list_sandbox_profile_versions(
        &self,
        profile_id: &str,
    ) -> Result<ListSandboxProfileVersionsResponse, MistleClientError> {
        self.get_json(self.list_sandbox_profile_versions_url(profile_id)?.as_str())
    }

    pub fn update_sandbox_profile_version_draft(
        &self,
        profile_id: &str,
        version: u32,
        request: UpdateSandboxProfileVersionDraftRequest<'_>,
    ) -> Result<UpdateSandboxProfileVersionDraftResponse, MistleClientError> {
        self.put_json(
            self.update_sandbox_profile_version_draft_url(profile_id, version)?
                .as_str(),
            &request,
        )
    }

    pub fn start_active_sandbox_profile_instance(
        &self,
        profile_id: &str,
    ) -> Result<StartSandboxProfileInstanceResponse, MistleClientError> {
        self.post_json(
            self.start_active_sandbox_profile_instance_url(profile_id)?
                .as_str(),
            &StartSandboxProfileInstanceBody {},
        )
    }

    pub fn start_sandbox_profile_instance_version(
        &self,
        profile_id: &str,
        version: u32,
    ) -> Result<StartSandboxProfileInstanceResponse, MistleClientError> {
        self.post_json(
            self.start_sandbox_profile_instance_version_url(profile_id, version)?
                .as_str(),
            &StartSandboxProfileInstanceBody {},
        )
    }

    pub fn get_sandbox_instance(
        &self,
        sandbox_id: &str,
    ) -> Result<SandboxInstance, MistleClientError> {
        self.get_json(self.get_sandbox_instance_url(sandbox_id)?.as_str())
    }

    pub fn create_sandbox_instance_connection_token(
        &self,
        sandbox_id: &str,
    ) -> Result<SandboxInstanceConnectionToken, MistleClientError> {
        self.post_json(
            self.create_sandbox_instance_connection_token_url(sandbox_id)?
                .as_str(),
            &CreateSandboxInstanceConnectionTokenBody {},
        )
    }

    pub fn list_sandbox_instances(
        &self,
        request: ListSandboxInstancesRequest,
    ) -> Result<ListSandboxInstancesResponse, MistleClientError> {
        validate_list_sandbox_instances_request(&request)?;
        self.list_sandbox_instances_page(&request)
    }

    fn list_sandbox_profiles_page(
        &self,
        after: Option<&str>,
    ) -> Result<ListSandboxProfilesResponse, MistleClientError> {
        self.get_json(self.list_sandbox_profiles_url(after).as_str())
    }

    fn list_sandbox_instances_page(
        &self,
        request: &ListSandboxInstancesRequest,
    ) -> Result<ListSandboxInstancesResponse, MistleClientError> {
        self.get_json(self.list_sandbox_instances_url(request).as_str())
    }

    fn get_json<TResponse>(&self, url: &str) -> Result<TResponse, MistleClientError>
    where
        TResponse: for<'de> Deserialize<'de>,
    {
        let mut response = ureq::get(url)
            .header("authorization", self.authorization_header.clone())
            .call()
            .map_err(MistleClientError::Request)?;

        let response_body = response
            .body_mut()
            .read_to_string()
            .map_err(MistleClientError::ReadResponse)?;

        serde_json::from_str(&response_body).map_err(MistleClientError::DecodeResponse)
    }

    fn put_json<TRequest, TResponse>(
        &self,
        url: &str,
        body: &TRequest,
    ) -> Result<TResponse, MistleClientError>
    where
        TRequest: Serialize,
        TResponse: for<'de> Deserialize<'de>,
    {
        let request_body = serde_json::to_string(body).map_err(MistleClientError::EncodeRequest)?;
        let mut response = ureq::put(url)
            .header("authorization", self.authorization_header.clone())
            .content_type("application/json")
            .send(request_body)
            .map_err(MistleClientError::Request)?;

        let response_body = response
            .body_mut()
            .read_to_string()
            .map_err(MistleClientError::ReadResponse)?;

        serde_json::from_str(&response_body).map_err(MistleClientError::DecodeResponse)
    }

    fn post_json<TRequest, TResponse>(
        &self,
        url: &str,
        body: &TRequest,
    ) -> Result<TResponse, MistleClientError>
    where
        TRequest: Serialize,
        TResponse: for<'de> Deserialize<'de>,
    {
        let request_body = serde_json::to_string(body).map_err(MistleClientError::EncodeRequest)?;
        let mut response = ureq::post(url)
            .header("authorization", self.authorization_header.clone())
            .content_type("application/json")
            .send(request_body)
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

    fn list_sandbox_profiles_url(&self, after: Option<&str>) -> Url {
        let mut url = endpoint_url(&self.base_url, "/v1/sandbox/profiles");

        if let Some(after) = after {
            url.query_pairs_mut().append_pair("after", after);
        }

        url
    }

    fn get_sandbox_profile_url(&self, profile_id: &str) -> Result<Url, MistleClientError> {
        let validated_profile_id = validate_sandbox_profile_id(profile_id)?;

        Ok(endpoint_url(
            &self.base_url,
            &format!("/v1/sandbox/profiles/{validated_profile_id}"),
        ))
    }

    fn list_sandbox_profile_versions_url(
        &self,
        profile_id: &str,
    ) -> Result<Url, MistleClientError> {
        let validated_profile_id = validate_sandbox_profile_id(profile_id)?;

        Ok(endpoint_url(
            &self.base_url,
            &format!("/v1/sandbox/profiles/{validated_profile_id}/versions"),
        ))
    }

    fn update_sandbox_profile_version_draft_url(
        &self,
        profile_id: &str,
        version: u32,
    ) -> Result<Url, MistleClientError> {
        let validated_profile_id = validate_sandbox_profile_id(profile_id)?;
        validate_sandbox_profile_version(version)?;

        Ok(endpoint_url(
            &self.base_url,
            &format!("/v1/sandbox/profiles/{validated_profile_id}/versions/{version}/draft"),
        ))
    }

    fn start_active_sandbox_profile_instance_url(
        &self,
        profile_id: &str,
    ) -> Result<Url, MistleClientError> {
        let validated_profile_id = validate_sandbox_profile_id(profile_id)?;

        Ok(endpoint_url(
            &self.base_url,
            &format!("/v1/sandbox/profiles/{validated_profile_id}/instances"),
        ))
    }

    fn start_sandbox_profile_instance_version_url(
        &self,
        profile_id: &str,
        version: u32,
    ) -> Result<Url, MistleClientError> {
        let validated_profile_id = validate_sandbox_profile_id(profile_id)?;
        validate_sandbox_profile_version(version)?;

        Ok(endpoint_url(
            &self.base_url,
            &format!("/v1/sandbox/profiles/{validated_profile_id}/versions/{version}/instances"),
        ))
    }

    fn get_sandbox_instance_url(&self, sandbox_id: &str) -> Result<Url, MistleClientError> {
        let validated_sandbox_id = validate_sandbox_instance_id(sandbox_id)?;

        Ok(endpoint_url(
            &self.base_url,
            &format!("/v1/sandbox/instances/{validated_sandbox_id}"),
        ))
    }

    fn create_sandbox_instance_connection_token_url(
        &self,
        sandbox_id: &str,
    ) -> Result<Url, MistleClientError> {
        let validated_sandbox_id = validate_sandbox_instance_id(sandbox_id)?;

        Ok(endpoint_url(
            &self.base_url,
            &format!("/v1/sandbox/instances/{validated_sandbox_id}/connection-tokens"),
        ))
    }

    fn list_sandbox_instances_url(&self, request: &ListSandboxInstancesRequest) -> Url {
        let mut url = endpoint_url(&self.base_url, "/v1/sandbox/instances");

        if request.limit.is_some() || request.after.is_some() {
            let mut query_pairs = url.query_pairs_mut();

            if let Some(limit) = request.limit {
                query_pairs.append_pair("limit", &limit.to_string());
            }

            if let Some(after) = &request.after {
                query_pairs.append_pair("after", after);
            }
        }

        url
    }
}

#[derive(Debug, Clone)]
pub struct MistleClientConfig {
    pub base_url: String,
    pub api_key: String,
}

#[derive(Debug, Clone)]
pub struct MistleClientAuthorizationHeaderConfig {
    pub base_url: String,
    pub authorization_header: String,
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

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListSandboxProfilesResponse {
    pub total_results: u32,
    pub items: Vec<SandboxProfile>,
    pub next_page: Option<KeysetPage>,
    pub previous_page: Option<KeysetPage>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxProfile {
    pub id: String,
    pub display_name: String,
    pub active_version: Option<u32>,
    pub status: SandboxProfileStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SandboxProfileStatus {
    Active,
    Inactive,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListSandboxProfileVersionsResponse {
    pub versions: Vec<SandboxProfileVersion>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxProfileVersion {
    pub sandbox_profile_id: String,
    pub version: u32,
    pub state: SandboxProfileVersionState,
    pub is_active: bool,
    pub usable: bool,
    pub agent_runtime_id: SandboxProfileVersionAgentRuntimeId,
    pub default_persistence_mode: SandboxProfileVersionDefaultPersistenceMode,
    pub sandbox_provider: Option<String>,
    pub sandbox_connection_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SandboxProfileVersionState {
    Draft,
    Published,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SandboxProfileVersionAgentRuntimeId {
    Codex,
    Opencode,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SandboxProfileVersionDefaultPersistenceMode {
    Ephemeral,
    Persistent,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSandboxProfileVersionDraftRequest<'a> {
    #[serde(rename = "setupScript", skip_serializing_if = "Option::is_none")]
    pub setup_script: Option<Option<&'a str>>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSandboxProfileVersionDraftResponse {
    pub sandbox_profile_id: String,
    pub version: u32,
    pub setup_script: Option<String>,
    pub default_persistence_mode: SandboxProfileVersionDefaultPersistenceMode,
    pub agent_runtime_id: SandboxProfileVersionAgentRuntimeId,
    pub sandbox_provider: Option<String>,
    pub sandbox_connection_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartSandboxProfileInstanceBody {}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateSandboxInstanceConnectionTokenBody {}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartSandboxProfileInstanceResponse {
    pub status: StartSandboxProfileInstanceStatus,
    pub workflow_run_id: String,
    pub sandbox_instance_id: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StartSandboxProfileInstanceStatus {
    Accepted,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxInstance {
    pub id: String,
    pub title: Option<String>,
    pub status: SandboxInstanceStatus,
    pub connectable: bool,
    pub failure_code: Option<String>,
    pub failure_message: Option<String>,
    pub runtime_context: Option<SandboxInstanceRuntimeContext>,
    pub trigger_conversation: Option<SandboxInstanceTriggerConversation>,
    pub startup_operation: Option<SandboxInstanceStartupOperation>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxInstanceConnectionToken {
    pub instance_id: String,
    pub url: String,
    pub token: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListSandboxInstancesResponse {
    pub total_results: u32,
    pub items: Vec<SandboxInstanceListItem>,
    pub next_page: Option<KeysetPage>,
    pub previous_page: Option<KeysetPage>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ListSandboxInstancesRequest {
    pub limit: Option<u32>,
    pub after: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxInstanceListItem {
    pub id: String,
    pub sandbox_profile_id: String,
    pub title: Option<String>,
    pub sandbox_profile_display_name: Option<String>,
    pub sandbox_profile_version: u32,
    pub status: SandboxInstanceStatus,
    pub started_by: SandboxInstanceStartedBy,
    pub source: SandboxInstanceSource,
    pub created_at: String,
    pub updated_at: String,
    pub failure_code: Option<String>,
    pub failure_message: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SandboxInstanceStartedBy {
    User { id: String, name: Option<String> },
    ApiKey { id: String, name: Option<String> },
    System { id: String, name: Option<String> },
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SandboxInstanceSource {
    Dashboard,
    Webhook,
    Schedule,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SandboxInstanceStatus {
    Pending,
    Starting,
    Running,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxInstanceRuntimeContext {
    pub agent_runtime_id: Option<SandboxInstanceAgentRuntimeId>,
    pub launch_cwd: Option<String>,
    pub primary_repository_root: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SandboxInstanceAgentRuntimeId {
    Codex,
    Opencode,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxInstanceTriggerConversation {
    pub conversation_id: String,
    pub route_id: Option<String>,
    pub provider_conversation_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxInstanceStartupOperation {
    pub operation_id: String,
    pub operation_kind: SandboxInstanceStartupOperationKind,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SandboxInstanceStartupOperationKind {
    Start,
    Resume,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct KeysetPage {
    pub limit: u32,
    pub after: Option<String>,
    pub before: Option<String>,
}

#[derive(Debug)]
pub enum MistleClientError {
    InvalidConfig(&'static str),
    InvalidBaseUrl(url::ParseError),
    UnsupportedBaseUrlScheme(String),
    BaseUrlCannotIncludeQuery,
    BaseUrlCannotIncludeFragment,
    InvalidResponse(&'static str),
    Request(ureq::Error),
    ReadResponse(ureq::Error),
    EncodeRequest(serde_json::Error),
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
            Self::InvalidResponse(message) => write!(formatter, "invalid response: {message}"),
            Self::Request(error) => write!(formatter, "request failed: {error}"),
            Self::ReadResponse(error) => write!(formatter, "failed to read response: {error}"),
            Self::EncodeRequest(error) => write!(formatter, "failed to encode request: {error}"),
            Self::DecodeResponse(error) => write!(formatter, "failed to decode response: {error}"),
        }
    }
}

impl Error for MistleClientError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::InvalidBaseUrl(error) => Some(error),
            Self::Request(error) | Self::ReadResponse(error) => Some(error),
            Self::EncodeRequest(error) | Self::DecodeResponse(error) => Some(error),
            Self::InvalidConfig(_)
            | Self::UnsupportedBaseUrlScheme(_)
            | Self::BaseUrlCannotIncludeQuery
            | Self::BaseUrlCannotIncludeFragment
            | Self::InvalidResponse(_) => None,
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

fn validate_sandbox_profile_id(profile_id: &str) -> Result<&str, MistleClientError> {
    let trimmed_profile_id = profile_id.trim();

    if trimmed_profile_id.is_empty() {
        return Err(MistleClientError::InvalidConfig("profile id is required"));
    }

    if !trimmed_profile_id.starts_with("sbp_") {
        return Err(MistleClientError::InvalidConfig(
            "profile id must start with `sbp_`",
        ));
    }

    if !trimmed_profile_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
    {
        return Err(MistleClientError::InvalidConfig(
            "profile id can only contain ASCII letters, numbers, underscores, and hyphens",
        ));
    }

    Ok(trimmed_profile_id)
}

fn validate_sandbox_profile_version(version: u32) -> Result<(), MistleClientError> {
    if version == 0 {
        return Err(MistleClientError::InvalidConfig(
            "profile version must be greater than zero",
        ));
    }

    Ok(())
}

fn validate_sandbox_instance_id(sandbox_id: &str) -> Result<&str, MistleClientError> {
    let trimmed_sandbox_id = sandbox_id.trim();

    if trimmed_sandbox_id.is_empty() {
        return Err(MistleClientError::InvalidConfig("sandbox id is required"));
    }

    if !trimmed_sandbox_id.starts_with("sbi_") {
        return Err(MistleClientError::InvalidConfig(
            "sandbox id must start with `sbi_`",
        ));
    }

    if !trimmed_sandbox_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
    {
        return Err(MistleClientError::InvalidConfig(
            "sandbox id can only contain ASCII letters, numbers, underscores, and hyphens",
        ));
    }

    Ok(trimmed_sandbox_id)
}

fn validate_list_sandbox_instances_request(
    request: &ListSandboxInstancesRequest,
) -> Result<(), MistleClientError> {
    if let Some(limit) = request.limit
        && !(1..=100).contains(&limit)
    {
        return Err(MistleClientError::InvalidConfig(
            "sandbox list limit must be between 1 and 100",
        ));
    }

    if let Some(after) = &request.after
        && after.trim().is_empty()
    {
        return Err(MistleClientError::InvalidConfig(
            "sandbox list after cursor cannot be blank",
        ));
    }

    Ok(())
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
        CurrentActorOrganization, ListSandboxInstancesRequest, ListSandboxInstancesResponse,
        ListSandboxProfileVersionsResponse, MistleClient, MistleClientAuthorizationHeaderConfig,
        MistleClientConfig, SandboxInstance, SandboxInstanceAgentRuntimeId,
        SandboxInstanceConnectionToken, SandboxInstanceListItem, SandboxInstanceRuntimeContext,
        SandboxInstanceSource, SandboxInstanceStartedBy, SandboxInstanceStartupOperation,
        SandboxInstanceStartupOperationKind, SandboxInstanceStatus,
        SandboxInstanceTriggerConversation, SandboxProfileVersion,
        SandboxProfileVersionAgentRuntimeId, SandboxProfileVersionDefaultPersistenceMode,
        SandboxProfileVersionState, StartSandboxProfileInstanceResponse,
        StartSandboxProfileInstanceStatus, UpdateSandboxProfileVersionDraftRequest,
        UpdateSandboxProfileVersionDraftResponse,
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
    fn builds_list_sandbox_profiles_url_from_root_base_url() {
        let client = client_with_base_url("https://api.example.test");

        assert_eq!(
            client.list_sandbox_profiles_url(None).as_str(),
            "https://api.example.test/v1/sandbox/profiles"
        );
    }

    #[test]
    fn builds_list_sandbox_profiles_url_with_after_cursor() {
        let client = client_with_base_url("https://api.example.test");

        assert_eq!(
            client
                .list_sandbox_profiles_url(Some("cursor/with space"))
                .as_str(),
            "https://api.example.test/v1/sandbox/profiles?after=cursor%2Fwith+space"
        );
    }

    #[test]
    fn builds_list_sandbox_instances_url_from_root_base_url() {
        let client = client_with_base_url("https://api.example.test");

        assert_eq!(
            client
                .list_sandbox_instances_url(&ListSandboxInstancesRequest::default())
                .as_str(),
            "https://api.example.test/v1/sandbox/instances"
        );
    }

    #[test]
    fn builds_list_sandbox_instances_url_with_limit_and_after_cursor() {
        let client = client_with_base_url("https://api.example.test");

        assert_eq!(
            client
                .list_sandbox_instances_url(&ListSandboxInstancesRequest {
                    limit: Some(50),
                    after: Some("cursor/with space".to_owned()),
                })
                .as_str(),
            "https://api.example.test/v1/sandbox/instances?limit=50&after=cursor%2Fwith+space"
        );
    }

    #[test]
    fn rejects_zero_sandbox_instance_list_limit() {
        let client = client_with_base_url("https://api.example.test");

        let error = client
            .list_sandbox_instances(ListSandboxInstancesRequest {
                limit: Some(0),
                after: None,
            })
            .expect_err("zero limit should fail");

        assert_eq!(
            error.to_string(),
            "sandbox list limit must be between 1 and 100"
        );
    }

    #[test]
    fn rejects_too_large_sandbox_instance_list_limit() {
        let client = client_with_base_url("https://api.example.test");

        let error = client
            .list_sandbox_instances(ListSandboxInstancesRequest {
                limit: Some(101),
                after: None,
            })
            .expect_err("limit above backend max should fail");

        assert_eq!(
            error.to_string(),
            "sandbox list limit must be between 1 and 100"
        );
    }

    #[test]
    fn rejects_blank_sandbox_instance_list_after_cursor() {
        let client = client_with_base_url("https://api.example.test");

        let error = client
            .list_sandbox_instances(ListSandboxInstancesRequest {
                limit: None,
                after: Some(" ".to_owned()),
            })
            .expect_err("blank after cursor should fail");

        assert_eq!(
            error.to_string(),
            "sandbox list after cursor cannot be blank"
        );
    }

    #[test]
    fn builds_get_sandbox_profile_url() {
        let client = client_with_base_url("https://api.example.test");

        assert_eq!(
            client
                .get_sandbox_profile_url("sbp_python-dev")
                .expect("profile id should be valid")
                .as_str(),
            "https://api.example.test/v1/sandbox/profiles/sbp_python-dev"
        );
    }

    #[test]
    fn rejects_invalid_sandbox_profile_id_for_get_url() {
        let client = client_with_base_url("https://api.example.test");

        let error = client
            .get_sandbox_profile_url("sandbox/profile")
            .expect_err("invalid profile id should fail");

        assert_eq!(error.to_string(), "profile id must start with `sbp_`");
    }

    #[test]
    fn builds_list_sandbox_profile_versions_url() {
        let client = client_with_base_url("https://api.example.test");

        assert_eq!(
            client
                .list_sandbox_profile_versions_url("sbp_python-dev")
                .expect("profile id should be valid")
                .as_str(),
            "https://api.example.test/v1/sandbox/profiles/sbp_python-dev/versions"
        );
    }

    #[test]
    fn rejects_invalid_sandbox_profile_id_for_version_list_url() {
        let client = client_with_base_url("https://api.example.test");

        let error = client
            .list_sandbox_profile_versions_url("sandbox/profile")
            .expect_err("invalid profile id should fail");

        assert_eq!(error.to_string(), "profile id must start with `sbp_`");
    }

    #[test]
    fn builds_update_sandbox_profile_version_draft_url() {
        let client = client_with_base_url("https://api.example.test");

        assert_eq!(
            client
                .update_sandbox_profile_version_draft_url("sbp_python-dev", 4)
                .expect("profile id and version should be valid")
                .as_str(),
            "https://api.example.test/v1/sandbox/profiles/sbp_python-dev/versions/4/draft"
        );
    }

    #[test]
    fn rejects_invalid_sandbox_profile_id_for_draft_update_url() {
        let client = client_with_base_url("https://api.example.test");

        let error = client
            .update_sandbox_profile_version_draft_url("sandbox/profile", 4)
            .expect_err("invalid profile id should fail");

        assert_eq!(error.to_string(), "profile id must start with `sbp_`");
    }

    #[test]
    fn rejects_zero_sandbox_profile_version_for_draft_update_url() {
        let client = client_with_base_url("https://api.example.test");

        let error = client
            .update_sandbox_profile_version_draft_url("sbp_python-dev", 0)
            .expect_err("zero profile version should fail");

        assert_eq!(
            error.to_string(),
            "profile version must be greater than zero"
        );
    }

    #[test]
    fn builds_start_active_sandbox_profile_instance_url() {
        let client = client_with_base_url("https://api.example.test");

        assert_eq!(
            client
                .start_active_sandbox_profile_instance_url("sbp_python-dev")
                .expect("profile id should be valid")
                .as_str(),
            "https://api.example.test/v1/sandbox/profiles/sbp_python-dev/instances"
        );
    }

    #[test]
    fn builds_start_sandbox_profile_instance_version_url() {
        let client = client_with_base_url("https://api.example.test");

        assert_eq!(
            client
                .start_sandbox_profile_instance_version_url("sbp_python-dev", 7)
                .expect("profile id should be valid")
                .as_str(),
            "https://api.example.test/v1/sandbox/profiles/sbp_python-dev/versions/7/instances"
        );
    }

    #[test]
    fn rejects_zero_sandbox_profile_instance_version_url() {
        let client = client_with_base_url("https://api.example.test");

        let error = client
            .start_sandbox_profile_instance_version_url("sbp_python-dev", 0)
            .expect_err("zero profile version should fail");

        assert_eq!(
            error.to_string(),
            "profile version must be greater than zero"
        );
    }

    #[test]
    fn builds_get_sandbox_instance_url() {
        let client = client_with_base_url("https://api.example.test");

        assert_eq!(
            client
                .get_sandbox_instance_url("sbi_local-dev")
                .expect("sandbox id should be valid")
                .as_str(),
            "https://api.example.test/v1/sandbox/instances/sbi_local-dev"
        );
    }

    #[test]
    fn rejects_invalid_sandbox_instance_id_for_get_url() {
        let client = client_with_base_url("https://api.example.test");

        let error = client
            .get_sandbox_instance_url("sandbox/instance")
            .expect_err("invalid sandbox id should fail");

        assert_eq!(error.to_string(), "sandbox id must start with `sbi_`");
    }

    #[test]
    fn builds_create_sandbox_instance_connection_token_url() {
        let client = client_with_base_url("https://api.example.test");

        assert_eq!(
            client
                .create_sandbox_instance_connection_token_url("sbi_local-dev")
                .expect("sandbox id should be valid")
                .as_str(),
            "https://api.example.test/v1/sandbox/instances/sbi_local-dev/connection-tokens"
        );
    }

    #[test]
    fn rejects_invalid_sandbox_instance_id_for_connection_token_url() {
        let client = client_with_base_url("https://api.example.test");

        let error = client
            .create_sandbox_instance_connection_token_url("sandbox/instance")
            .expect_err("invalid sandbox id should fail");

        assert_eq!(error.to_string(), "sandbox id must start with `sbi_`");
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
        assert_eq!(client.authorization_header, "Bearer mstl_test_key");
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
    fn accepts_explicit_authorization_header_config() {
        let client =
            MistleClient::new_with_authorization_header(MistleClientAuthorizationHeaderConfig {
                base_url: "https://api.example.test".to_owned(),
                authorization_header: "Basic token".to_owned(),
            })
            .expect("authorization header config should be valid");

        assert_eq!(client.authorization_header, "Basic token");
    }

    #[test]
    fn rejects_blank_authorization_header() {
        let error =
            MistleClient::new_with_authorization_header(MistleClientAuthorizationHeaderConfig {
                base_url: "https://api.example.test".to_owned(),
                authorization_header: " ".to_owned(),
            })
            .expect_err("blank authorization header should fail");

        assert_eq!(error.to_string(), "authorization header is required");
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

    #[test]
    fn decodes_start_sandbox_profile_instance_response() {
        let response = serde_json::from_str::<StartSandboxProfileInstanceResponse>(
            r#"{
                "status": "accepted",
                "workflowRunId": "wfr_01",
                "sandboxInstanceId": "sbi_01"
            }"#,
        )
        .expect("start sandbox response should decode");

        assert_eq!(
            response,
            StartSandboxProfileInstanceResponse {
                status: StartSandboxProfileInstanceStatus::Accepted,
                workflow_run_id: "wfr_01".to_owned(),
                sandbox_instance_id: "sbi_01".to_owned(),
            }
        );
    }

    #[test]
    fn decodes_sandbox_profile_versions_response() {
        let response = serde_json::from_str::<ListSandboxProfileVersionsResponse>(
            r#"{
                "versions": [
                    {
                        "sandboxProfileId": "sbp_python",
                        "version": 3,
                        "state": "draft",
                        "isActive": false,
                        "usable": false,
                        "agentRuntimeId": "codex",
                        "defaultPersistenceMode": "persistent",
                        "sandboxProvider": "daytona",
                        "sandboxConnectionId": "icn_daytona",
                        "maintenanceScript": null,
                        "sandboxResources": null,
                        "refreshSchedule": null,
                        "latestSnapshotJob": null
                    },
                    {
                        "sandboxProfileId": "sbp_python",
                        "version": 2,
                        "state": "published",
                        "isActive": true,
                        "usable": true,
                        "agentRuntimeId": "opencode",
                        "defaultPersistenceMode": "ephemeral",
                        "sandboxProvider": null,
                        "sandboxConnectionId": null,
                        "maintenanceScript": null,
                        "sandboxResources": {
                            "vcpuCount": 2,
                            "memoryMb": 4096
                        },
                        "refreshSchedule": null,
                        "latestSnapshotJob": null
                    }
                ]
            }"#,
        )
        .expect("profile versions response should decode");

        assert_eq!(
            response,
            ListSandboxProfileVersionsResponse {
                versions: vec![
                    SandboxProfileVersion {
                        sandbox_profile_id: "sbp_python".to_owned(),
                        version: 3,
                        state: SandboxProfileVersionState::Draft,
                        is_active: false,
                        usable: false,
                        agent_runtime_id: SandboxProfileVersionAgentRuntimeId::Codex,
                        default_persistence_mode:
                            SandboxProfileVersionDefaultPersistenceMode::Persistent,
                        sandbox_provider: Some("daytona".to_owned()),
                        sandbox_connection_id: Some("icn_daytona".to_owned()),
                    },
                    SandboxProfileVersion {
                        sandbox_profile_id: "sbp_python".to_owned(),
                        version: 2,
                        state: SandboxProfileVersionState::Published,
                        is_active: true,
                        usable: true,
                        agent_runtime_id: SandboxProfileVersionAgentRuntimeId::Opencode,
                        default_persistence_mode:
                            SandboxProfileVersionDefaultPersistenceMode::Ephemeral,
                        sandbox_provider: None,
                        sandbox_connection_id: None,
                    },
                ],
            }
        );
    }

    #[test]
    fn encodes_update_sandbox_profile_version_draft_setup_script_request() {
        let request = UpdateSandboxProfileVersionDraftRequest {
            setup_script: Some(Some("#!/usr/bin/env bash\npnpm install")),
        };

        let request_body =
            serde_json::to_string(&request).expect("setup script request should encode");

        assert_eq!(
            request_body,
            r##"{"setupScript":"#!/usr/bin/env bash\npnpm install"}"##
        );
    }

    #[test]
    fn encodes_clear_sandbox_profile_version_draft_setup_script_request() {
        let request = UpdateSandboxProfileVersionDraftRequest {
            setup_script: Some(None),
        };

        let request_body =
            serde_json::to_string(&request).expect("setup script request should encode");

        assert_eq!(request_body, r#"{"setupScript":null}"#);
    }

    #[test]
    fn omits_unset_sandbox_profile_version_draft_request_fields() {
        let request = UpdateSandboxProfileVersionDraftRequest { setup_script: None };

        let request_body =
            serde_json::to_string(&request).expect("draft update request should encode");

        assert_eq!(request_body, r#"{}"#);
    }

    #[test]
    fn decodes_update_sandbox_profile_version_draft_response() {
        let response = serde_json::from_str::<UpdateSandboxProfileVersionDraftResponse>(
            r##"{
                "sandboxProfileId": "sbp_python",
                "version": 3,
                "setupScript": "#!/usr/bin/env bash\npnpm install",
                "defaultPersistenceMode": "persistent",
                "agentRuntimeId": "codex",
                "sandboxProvider": "daytona",
                "sandboxConnectionId": "icn_daytona",
                "sandboxResources": null,
                "integrationBindings": {
                    "bindings": []
                }
            }"##,
        )
        .expect("setup script update response should decode");

        assert_eq!(
            response,
            UpdateSandboxProfileVersionDraftResponse {
                sandbox_profile_id: "sbp_python".to_owned(),
                version: 3,
                setup_script: Some("#!/usr/bin/env bash\npnpm install".to_owned()),
                default_persistence_mode: SandboxProfileVersionDefaultPersistenceMode::Persistent,
                agent_runtime_id: SandboxProfileVersionAgentRuntimeId::Codex,
                sandbox_provider: Some("daytona".to_owned()),
                sandbox_connection_id: Some("icn_daytona".to_owned()),
            }
        );
    }

    #[test]
    fn decodes_clear_sandbox_profile_version_draft_setup_script_response() {
        let response = serde_json::from_str::<UpdateSandboxProfileVersionDraftResponse>(
            r#"{
                "sandboxProfileId": "sbp_python",
                "version": 3,
                "setupScript": null,
                "defaultPersistenceMode": "ephemeral",
                "agentRuntimeId": "opencode",
                "sandboxProvider": null,
                "sandboxConnectionId": null,
                "sandboxResources": null,
                "integrationBindings": {
                    "bindings": []
                }
            }"#,
        )
        .expect("setup script clear response should decode");

        assert_eq!(
            response,
            UpdateSandboxProfileVersionDraftResponse {
                sandbox_profile_id: "sbp_python".to_owned(),
                version: 3,
                setup_script: None,
                default_persistence_mode: SandboxProfileVersionDefaultPersistenceMode::Ephemeral,
                agent_runtime_id: SandboxProfileVersionAgentRuntimeId::Opencode,
                sandbox_provider: None,
                sandbox_connection_id: None,
            }
        );
    }

    #[test]
    fn decodes_sandbox_instance_response() {
        let instance = serde_json::from_str::<SandboxInstance>(
            r#"{
                "id": "sbi_01",
                "title": "Python dev",
                "status": "running",
                "connectable": true,
                "failureCode": null,
                "failureMessage": null,
                "runtimeContext": {
                    "agentRuntimeId": "codex",
                    "launchCwd": "/workspace",
                    "primaryRepositoryRoot": "/workspace/mistle"
                },
                "triggerConversation": {
                    "conversationId": "cnv_01",
                    "routeId": null,
                    "providerConversationId": "provider_01"
                },
                "startupOperation": {
                    "operationId": "op_01",
                    "operationKind": "start"
                }
            }"#,
        )
        .expect("sandbox instance response should decode");

        assert_eq!(
            instance,
            SandboxInstance {
                id: "sbi_01".to_owned(),
                title: Some("Python dev".to_owned()),
                status: SandboxInstanceStatus::Running,
                connectable: true,
                failure_code: None,
                failure_message: None,
                runtime_context: Some(SandboxInstanceRuntimeContext {
                    agent_runtime_id: Some(SandboxInstanceAgentRuntimeId::Codex),
                    launch_cwd: Some("/workspace".to_owned()),
                    primary_repository_root: Some("/workspace/mistle".to_owned()),
                }),
                trigger_conversation: Some(SandboxInstanceTriggerConversation {
                    conversation_id: "cnv_01".to_owned(),
                    route_id: None,
                    provider_conversation_id: Some("provider_01".to_owned()),
                }),
                startup_operation: Some(SandboxInstanceStartupOperation {
                    operation_id: "op_01".to_owned(),
                    operation_kind: SandboxInstanceStartupOperationKind::Start,
                }),
            }
        );
    }

    #[test]
    fn decodes_sandbox_instance_connection_token_response() {
        let response = serde_json::from_str::<SandboxInstanceConnectionToken>(
            r#"{
                "instanceId": "sbi_01",
                "url": "wss://gateway.example.test/tunnel/sandbox/sbi_01?connect_token=token_01",
                "token": "token_01",
                "expiresAt": "2026-05-18T01:02:03.000Z"
            }"#,
        )
        .expect("sandbox connection token response should decode");

        assert_eq!(
            response,
            SandboxInstanceConnectionToken {
                instance_id: "sbi_01".to_owned(),
                url: "wss://gateway.example.test/tunnel/sandbox/sbi_01?connect_token=token_01"
                    .to_owned(),
                token: "token_01".to_owned(),
                expires_at: "2026-05-18T01:02:03.000Z".to_owned(),
            }
        );
    }

    #[test]
    fn decodes_list_sandbox_instances_response() {
        let response = serde_json::from_str::<ListSandboxInstancesResponse>(
            r#"{
                "totalResults": 1,
                "items": [
                    {
                        "id": "sbi_01",
                        "sandboxProfileId": "sbp_01",
                        "title": "Python dev",
                        "sandboxProfileDisplayName": "Python Dev",
                        "sandboxProfileVersion": 3,
                        "status": "running",
                        "startedBy": {
                            "kind": "api_key",
                            "id": "apk_01",
                            "name": "local"
                        },
                        "source": "dashboard",
                        "createdAt": "2026-05-18T01:02:03.000Z",
                        "updatedAt": "2026-05-18T01:03:03.000Z",
                        "failureCode": null,
                        "failureMessage": null
                    }
                ],
                "nextPage": null,
                "previousPage": null
            }"#,
        )
        .expect("sandbox instance list response should decode");

        assert_eq!(
            response,
            ListSandboxInstancesResponse {
                total_results: 1,
                items: vec![SandboxInstanceListItem {
                    id: "sbi_01".to_owned(),
                    sandbox_profile_id: "sbp_01".to_owned(),
                    title: Some("Python dev".to_owned()),
                    sandbox_profile_display_name: Some("Python Dev".to_owned()),
                    sandbox_profile_version: 3,
                    status: SandboxInstanceStatus::Running,
                    started_by: SandboxInstanceStartedBy::ApiKey {
                        id: "apk_01".to_owned(),
                        name: Some("local".to_owned()),
                    },
                    source: SandboxInstanceSource::Dashboard,
                    created_at: "2026-05-18T01:02:03.000Z".to_owned(),
                    updated_at: "2026-05-18T01:03:03.000Z".to_owned(),
                    failure_code: None,
                    failure_message: None,
                }],
                next_page: None,
                previous_page: None,
            }
        );
    }

    fn client_with_base_url(base_url: &str) -> MistleClient {
        MistleClient::new(MistleClientConfig {
            base_url: base_url.to_owned(),
            api_key: "mstl_test_key".to_owned(),
        })
        .expect("client config should be valid")
    }
}
