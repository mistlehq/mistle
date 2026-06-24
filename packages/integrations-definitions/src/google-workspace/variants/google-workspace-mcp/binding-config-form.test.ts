import { IntegrationKinds } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { GoogleWorkspaceConnectionMethodIds } from "./auth.js";
import { resolveGoogleWorkspaceBindingConfigForm } from "./binding-config-form.js";

function createFormContext(input: { connectionMethod: string }) {
  return {
    familyId: "google-workspace",
    variantId: "google-workspace-mcp",
    kind: IntegrationKinds.CONNECTOR,
    target: {
      rawConfig: {},
      config: {},
    },
    connection: {
      id: "icn_google_workspace",
      rawConfig: {
        connection_method: input.connectionMethod,
      },
      config: {
        connection_method: input.connectionMethod,
      },
    },
    currentValue: {},
  };
}

describe("resolveGoogleWorkspaceBindingConfigForm", () => {
  it("only asks for MCP server selection when the connection uses Google OAuth", () => {
    const form = resolveGoogleWorkspaceBindingConfigForm(
      createFormContext({
        connectionMethod: GoogleWorkspaceConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      }),
    );

    expect(form.schema?.properties).toHaveProperty("mcpServers");
    expect(form.schema?.properties).not.toHaveProperty("workspaceUserEmail");
  });

  it("asks for an optional Workspace user email when the connection uses a service account", () => {
    const form = resolveGoogleWorkspaceBindingConfigForm(
      createFormContext({
        connectionMethod: GoogleWorkspaceConnectionMethodIds.SERVICE_ACCOUNT,
      }),
    );

    expect(form.schema).toMatchObject({
      properties: {
        workspaceUserEmail: {
          type: "string",
          title: "Workspace user email",
          description:
            "Optional delegated Workspace user subject for domain-wide delegation. Leave blank to mint tokens as the service account itself.",
        },
      },
    });
    expect(form.schema).not.toHaveProperty("required");
    expect(form.uiSchema).toMatchObject({
      workspaceUserEmail: {
        "ui:placeholder": "user@example.com",
        "ui:widget": "email",
      },
    });
  });
});
