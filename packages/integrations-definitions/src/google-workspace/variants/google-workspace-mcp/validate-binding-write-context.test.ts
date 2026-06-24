import { describe, expect, it } from "vitest";

import { validateGoogleWorkspaceBindingWriteContext } from "./validate-binding-write-context.js";

function createValidationInput(input: {
  connectionConfig: Record<string, unknown>;
  bindingConfig: {
    mcpServers: string[];
    workspaceUserEmail?: string;
  };
}): Parameters<typeof validateGoogleWorkspaceBindingWriteContext>[0] {
  return {
    targetKey: "google-workspace-mcp",
    bindingIdOrDraftIndex: "0",
    target: {
      familyId: "google-workspace",
      variantId: "google-workspace-mcp",
      config: {},
    },
    connection: {
      id: "icn_google_workspace",
      config: input.connectionConfig,
    },
    binding: {
      kind: "connector",
      config: input.bindingConfig,
    },
  };
}

describe("validateGoogleWorkspaceBindingWriteContext", () => {
  it("allows Google OAuth bindings without a Workspace user email", () => {
    expect(
      validateGoogleWorkspaceBindingWriteContext(
        createValidationInput({
          connectionConfig: {
            connection_method: "oauth2-authorization-code",
            client_id: "google_client_123.apps.googleusercontent.com",
          },
          bindingConfig: {
            mcpServers: ["gmail"],
          },
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("allows service account bindings without a Workspace user email", () => {
    expect(
      validateGoogleWorkspaceBindingWriteContext(
        createValidationInput({
          connectionConfig: {
            connection_method: "google-workspace-service-account",
          },
          bindingConfig: {
            mcpServers: ["gmail"],
          },
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("allows service account bindings with a Workspace user email", () => {
    expect(
      validateGoogleWorkspaceBindingWriteContext(
        createValidationInput({
          connectionConfig: {
            connection_method: "google-workspace-service-account",
          },
          bindingConfig: {
            mcpServers: ["gmail"],
            workspaceUserEmail: "workspace-user@example.com",
          },
        }),
      ),
    ).toEqual({ ok: true });
  });
});
