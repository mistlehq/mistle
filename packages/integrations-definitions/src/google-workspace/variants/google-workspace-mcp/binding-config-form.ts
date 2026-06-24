import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { resolveRemoteMcpServerSelectionForm } from "../../../shared/remote-mcp-server-catalog/index.js";
import { GoogleWorkspaceConnectionMethodIds } from "./auth.js";
import { GoogleWorkspaceMcpServerCatalog } from "./mcp-catalog.js";

type GoogleWorkspaceBindingFormContext = IntegrationFormContext;

function resolveSchemaProperties(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema["properties"];
  if (
    properties === undefined ||
    properties === null ||
    typeof properties !== "object" ||
    Array.isArray(properties)
  ) {
    throw new Error("Google Workspace MCP server selection form is missing schema properties.");
  }

  return Object.fromEntries(Object.entries(properties));
}

export function resolveGoogleWorkspaceBindingConfigForm(
  input: GoogleWorkspaceBindingFormContext,
): ResolvedIntegrationForm {
  if (input.connection === undefined) {
    throw new Error("Google Workspace binding config form requires connection context.");
  }

  const remoteMcpServerForm = resolveRemoteMcpServerSelectionForm({
    catalog: GoogleWorkspaceMcpServerCatalog,
    fieldName: "mcpServers",
    title: "Google Workspace MCP servers",
  });
  if (remoteMcpServerForm.schema === undefined) {
    throw new Error("Google Workspace MCP server selection form is missing a schema.");
  }

  if (
    input.connection.config["connection_method"] !==
    GoogleWorkspaceConnectionMethodIds.SERVICE_ACCOUNT
  ) {
    return remoteMcpServerForm;
  }

  const remoteMcpServerProperties = resolveSchemaProperties(remoteMcpServerForm.schema);

  return {
    schema: {
      properties: {
        ...remoteMcpServerProperties,
        workspaceUserEmail: {
          type: "string",
          title: "Workspace user email",
          description:
            "Optional delegated Workspace user subject for domain-wide delegation. Leave blank to mint tokens as the service account itself.",
        },
      },
    },
    uiSchema: {
      ...remoteMcpServerForm.uiSchema,
      workspaceUserEmail: {
        "ui:placeholder": "user@example.com",
        "ui:widget": "email",
      },
    },
  };
}
