import { describe, expect, it } from "vitest";

import { GoogleWorkspaceMcpBaseDefinition } from "./base-definition.js";
import { GoogleWorkspaceDefinition } from "./definition.js";
import { GoogleWorkspaceMcpServerIds } from "./mcp-catalog.js";

describe("GoogleWorkspaceDefinition", () => {
  it("defines BYO Google OAuth and local Workspace MCP tools", () => {
    expect(GoogleWorkspaceDefinition).toMatchObject({
      familyId: "google-workspace",
      variantId: "google-workspace-mcp",
      kind: "connector",
      displayName: "Google Workspace",
      logoKey: "google",
      connectionMethods: [
        {
          id: "oauth2-authorization-code",
          label: "Google OAuth",
          kind: "redirect",
        },
        {
          id: "google-workspace-service-account",
          label: "Service account",
          kind: "form",
        },
      ],
    });
    expect(GoogleWorkspaceDefinition.oauth2AuthorizationCode).toBeDefined();
    expect(GoogleWorkspaceDefinition.credentialResolvers?.default).toBeDefined();
  });

  it("keeps the browser-safe base definition free of server-only OAuth handlers", () => {
    expect(GoogleWorkspaceMcpBaseDefinition.oauth2AuthorizationCode).toBeUndefined();
  });

  it("resolves selected Google Workspace tools to one local MCP server", () => {
    if (typeof GoogleWorkspaceDefinition.mcp !== "function") {
      throw new Error("Expected Google Workspace definition to provide dynamic MCP servers.");
    }

    expect(
      GoogleWorkspaceDefinition.mcp({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "google-workspace-mcp",
        target: {
          familyId: "google-workspace",
          variantId: "google-workspace-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "icn_google_workspace",
          status: "active",
          config: {
            connection_method: "oauth2-authorization-code",
            client_id: "google_client_123.apps.googleusercontent.com",
          },
        },
        binding: {
          id: "ibd_123",
          kind: "connector",
          config: {
            mcpServers: [
              GoogleWorkspaceMcpServerIds.GMAIL,
              GoogleWorkspaceMcpServerIds.DRIVE,
              GoogleWorkspaceMcpServerIds.SHEETS,
              GoogleWorkspaceMcpServerIds.PEOPLE,
            ],
            workspaceUserEmail: "",
          },
        },
        refs: {
          sandboxPaths: {
            userHomeDir: "/root",
            workspaceDir: "/root",
            runtimeDataDir: "/var/lib/mistle",
            runtimeArtifactDir: "/var/lib/mistle/artifacts",
            runtimeArtifactBinDir: "/usr/local/bin",
          },
          artifactBinPath(name) {
            return `/usr/local/bin/${name}`;
          },
        },
      }),
    ).toEqual([
      {
        serverId: "google-workspace-gws-mcp",
        serverName: "google_workspace",
        transport: "streamable-http",
        url: "http://127.0.0.1:7353/mcp",
        description:
          "Google Workspace Gmail, Drive, Sheets, Docs, Slides, Calendar, Chat, and People MCP",
      },
    ]);
  });
});
