use mstl_core::client::{MistleClient, MistleClientAuthorizationHeaderConfig};
use rmcp::ErrorData as McpError;
use serde_json::json;

pub(crate) fn mistle_client(
    base_url: String,
    authorization_header: String,
) -> Result<MistleClient, McpError> {
    MistleClient::new_with_authorization_header(MistleClientAuthorizationHeaderConfig {
        base_url,
        authorization_header,
    })
    .map_err(|source| {
        McpError::internal_error(
            "failed to configure Mistle client",
            Some(json!(source.to_string())),
        )
    })
}
