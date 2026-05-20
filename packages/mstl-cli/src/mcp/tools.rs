use mstl_core::client::{ListSandboxProfilesResponse, SandboxProfile, SandboxProfileStatus};
use rmcp::ErrorData as McpError;
use rmcp::model::{
    CallToolRequestParams, CallToolResult, ErrorCode, JsonObject, Tool, ToolAnnotations,
};
use rmcp::service::{RequestContext, RoleServer};
use serde_json::{Map, Value, json};

use crate::command_metadata::{MCP_PROFILE_GET_TOOL, MCP_PROFILE_LIST_TOOL};
use crate::mcp::auth::authorization_header_from_context;
use crate::mcp::client::mistle_client;

pub(crate) fn tool_definitions() -> Vec<Tool> {
    vec![profile_list_tool(), profile_get_tool()]
}

pub(crate) async fn call_tool(
    request: CallToolRequestParams,
    context: RequestContext<RoleServer>,
    base_url: &str,
) -> Result<CallToolResult, McpError> {
    match request.name.as_ref() {
        name if name == MCP_PROFILE_LIST_TOOL.name => profile_list(context, base_url).await,
        name if name == MCP_PROFILE_GET_TOOL.name => {
            profile_get(request.arguments, context, base_url).await
        }
        name => Err(McpError::new(
            ErrorCode::METHOD_NOT_FOUND,
            format!("unknown tool `{name}`"),
            None,
        )),
    }
}

async fn profile_list(
    context: RequestContext<RoleServer>,
    base_url: &str,
) -> Result<CallToolResult, McpError> {
    let authorization_header = authorization_header_from_context(&context)?;
    let base_url = base_url.to_owned();
    let response = tokio::task::spawn_blocking(move || {
        mistle_client(base_url, authorization_header)?
            .list_sandbox_profiles()
            .map_err(|source| {
                McpError::internal_error(
                    "failed to list sandbox profiles",
                    Some(json!(source.to_string())),
                )
            })
    })
    .await
    .map_err(|source| {
        McpError::internal_error(
            "failed to join profile_list task",
            Some(json!(source.to_string())),
        )
    })??;

    Ok(structured_result(list_profiles_value(&response)))
}

async fn profile_get(
    arguments: Option<JsonObject>,
    context: RequestContext<RoleServer>,
    base_url: &str,
) -> Result<CallToolResult, McpError> {
    let profile_id = required_string_argument(arguments.as_ref(), "profile_id")?.to_owned();
    let authorization_header = authorization_header_from_context(&context)?;
    let base_url = base_url.to_owned();
    let profile = tokio::task::spawn_blocking(move || {
        mistle_client(base_url, authorization_header)?
            .get_sandbox_profile(&profile_id)
            .map_err(|source| {
                McpError::internal_error(
                    "failed to get sandbox profile",
                    Some(json!(source.to_string())),
                )
            })
    })
    .await
    .map_err(|source| {
        McpError::internal_error(
            "failed to join profile_get task",
            Some(json!(source.to_string())),
        )
    })??;

    Ok(structured_result(profile_value(&profile)))
}

fn required_string_argument<'a>(
    arguments: Option<&'a JsonObject>,
    name: &'static str,
) -> Result<&'a str, McpError> {
    let value = arguments
        .and_then(|arguments| arguments.get(name))
        .ok_or_else(|| McpError::invalid_params(format!("missing `{name}` argument"), None))?;
    let value = value
        .as_str()
        .ok_or_else(|| McpError::invalid_params(format!("`{name}` must be a string"), None))?;
    let value = value.trim();

    if value.is_empty() {
        return Err(McpError::invalid_params(
            format!("`{name}` cannot be blank"),
            None,
        ));
    }

    Ok(value)
}

fn structured_result(value: Value) -> CallToolResult {
    CallToolResult::structured(value)
}

fn profile_list_tool() -> Tool {
    Tool::new(
        MCP_PROFILE_LIST_TOOL.name,
        MCP_PROFILE_LIST_TOOL.description,
        empty_object_schema(),
    )
    .with_title(MCP_PROFILE_LIST_TOOL.title)
    .with_annotations(read_only_annotations(MCP_PROFILE_LIST_TOOL.title))
}

fn profile_get_tool() -> Tool {
    Tool::new(
        MCP_PROFILE_GET_TOOL.name,
        MCP_PROFILE_GET_TOOL.description,
        profile_get_input_schema(),
    )
    .with_title(MCP_PROFILE_GET_TOOL.title)
    .with_annotations(read_only_annotations(MCP_PROFILE_GET_TOOL.title))
}

fn read_only_annotations(title: &str) -> ToolAnnotations {
    ToolAnnotations::with_title(title)
        .read_only(true)
        .destructive(false)
        .idempotent(true)
        .open_world(false)
}

fn empty_object_schema() -> JsonObject {
    let mut schema = Map::new();
    schema.insert("type".to_owned(), json!("object"));
    schema.insert("additionalProperties".to_owned(), json!(false));
    schema
}

fn profile_get_input_schema() -> JsonObject {
    let mut properties = Map::new();
    properties.insert(
        "profile_id".to_owned(),
        json!({
            "type": "string",
            "description": "Sandbox profile id"
        }),
    );

    let mut schema = Map::new();
    schema.insert("type".to_owned(), json!("object"));
    schema.insert("properties".to_owned(), Value::Object(properties));
    schema.insert("required".to_owned(), json!(["profile_id"]));
    schema.insert("additionalProperties".to_owned(), json!(false));
    schema
}

fn list_profiles_value(response: &ListSandboxProfilesResponse) -> Value {
    json!({
        "totalResults": response.total_results,
        "items": response.items.iter().map(profile_value).collect::<Vec<_>>(),
    })
}

fn profile_value(profile: &SandboxProfile) -> Value {
    json!({
        "id": profile.id,
        "displayName": profile.display_name,
        "activeVersion": profile.active_version,
        "status": profile_status_value(&profile.status),
        "createdAt": profile.created_at,
        "updatedAt": profile.updated_at,
    })
}

fn profile_status_value(status: &SandboxProfileStatus) -> &'static str {
    match status {
        SandboxProfileStatus::Active => "active",
        SandboxProfileStatus::Inactive => "inactive",
    }
}

#[cfg(test)]
mod tests {
    use crate::mcp::tools::{
        profile_get_input_schema, profile_status_value, required_string_argument, tool_definitions,
    };
    use mstl_core::client::SandboxProfileStatus;
    use serde_json::{Map, json};

    #[test]
    fn exposes_profile_tools() {
        let tools = tool_definitions();

        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "profile_list");
        assert_eq!(tools[1].name, "profile_get");
    }

    #[test]
    fn profile_get_requires_profile_id() {
        let schema = profile_get_input_schema();

        assert_eq!(schema.get("required"), Some(&json!(["profile_id"])));
        assert_eq!(schema.get("additionalProperties"), Some(&json!(false)));
    }

    #[test]
    fn parses_required_string_arguments() {
        let mut arguments = Map::new();
        arguments.insert("profile_id".to_owned(), json!(" sbp_python "));

        assert_eq!(
            required_string_argument(Some(&arguments), "profile_id")
                .expect("argument should parse"),
            "sbp_python"
        );
    }

    #[test]
    fn renders_profile_status_values() {
        assert_eq!(
            profile_status_value(&SandboxProfileStatus::Active),
            "active"
        );
        assert_eq!(
            profile_status_value(&SandboxProfileStatus::Inactive),
            "inactive"
        );
    }
}
