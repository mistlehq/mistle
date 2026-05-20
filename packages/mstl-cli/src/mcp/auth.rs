use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use rmcp::ErrorData as McpError;
use rmcp::service::{RequestContext, RoleServer};
use serde_json::json;

pub(crate) fn authorization_header_from_context(
    context: &RequestContext<RoleServer>,
) -> Result<String, McpError> {
    let authorization = context
        .extensions
        .get::<Parts>()
        .ok_or_else(|| McpError::invalid_request("missing HTTP request context", None))?
        .headers
        .get(AUTHORIZATION)
        .ok_or_else(|| McpError::invalid_request("missing Authorization header", None))?
        .to_str()
        .map_err(|source| {
            McpError::invalid_request(
                "Authorization header must be valid UTF-8",
                Some(json!(source.to_string())),
            )
        })?;

    Ok(authorization.to_owned())
}
