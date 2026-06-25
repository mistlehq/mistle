import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { GoogleWorkspaceConnectionMethodIds } from "./auth.js";
import { GoogleWorkspaceMcpServerCatalog } from "./mcp-catalog.js";

type GoogleWorkspaceBindingFormContext = IntegrationFormContext;

const GoogleWorkspaceDefaultMcpServers = GoogleWorkspaceMcpServerCatalog.map((entry) => entry.id);

export function resolveGoogleWorkspaceBindingConfigForm(
  input: GoogleWorkspaceBindingFormContext,
): ResolvedIntegrationForm {
  if (input.connection === undefined) {
    throw new Error("Google Workspace binding config form requires connection context.");
  }

  const baseSchemaProperties = {
    mcpServers: {
      title: "Google Workspace tools",
      default: GoogleWorkspaceDefaultMcpServers,
      items: {
        type: "string",
        enum: GoogleWorkspaceMcpServerCatalog.map((entry) => entry.id),
      },
      type: "array",
      uniqueItems: true,
    },
  };
  const baseUiSchema = {
    mcpServers: {
      "ui:enumNames": GoogleWorkspaceMcpServerCatalog.map((entry) => entry.displayName),
      "ui:widget": "checkboxes",
      "ui:options": {
        inline: false,
      },
    },
  };

  if (
    input.connection.config["connection_method"] !==
    GoogleWorkspaceConnectionMethodIds.SERVICE_ACCOUNT
  ) {
    return {
      schema: {
        properties: baseSchemaProperties,
      },
      uiSchema: {
        ...baseUiSchema,
        workspaceUserEmail: {
          "ui:widget": "hidden",
        },
      },
    };
  }

  return {
    schema: {
      properties: {
        ...baseSchemaProperties,
        workspaceUserEmail: {
          type: "string",
          title: "Workspace user email",
          description:
            "Optional delegated Workspace user subject for domain-wide delegation. Leave blank to mint tokens as the service account itself.",
        },
      },
    },
    uiSchema: {
      ...baseUiSchema,
      workspaceUserEmail: {
        "ui:title": "Workspace user email",
        "ui:placeholder": "user@example.com",
        "ui:widget": "email",
      },
    },
  };
}
