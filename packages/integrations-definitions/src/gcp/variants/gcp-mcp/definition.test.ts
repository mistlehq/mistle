import { describe, expect, it } from "vitest";

import { GcpMcpBaseDefinition } from "./base-definition.js";
import { GcpDefinition } from "./definition.js";
import { GcpMcpServerIds } from "./mcp-catalog.js";

describe("GcpDefinition", () => {
  it("defines BYO Google OAuth and Google-hosted MCP servers", () => {
    expect(GcpDefinition).toMatchObject({
      familyId: "gcp",
      variantId: "gcp-mcp",
      kind: "connector",
      displayName: "Google Cloud",
      logoKey: "gcp",
      connectionMethods: [
        {
          id: "oauth2-authorization-code",
          label: "Google OAuth",
          kind: "redirect",
        },
      ],
    });
    expect(GcpDefinition.oauth2AuthorizationCode).toBeDefined();
  });

  it("keeps the browser-safe base definition free of server-only OAuth handlers", () => {
    expect(GcpMcpBaseDefinition.oauth2AuthorizationCode).toBeUndefined();
  });

  it("resolves selected Google Cloud MCP servers from the binding config", () => {
    if (typeof GcpDefinition.mcp !== "function") {
      throw new Error("Expected GCP definition to provide dynamic MCP servers.");
    }

    expect(
      GcpDefinition.mcp({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "gcp-mcp",
        target: {
          familyId: "gcp",
          variantId: "gcp-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "icn_gcp",
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
            mcpServers: [GcpMcpServerIds.CLOUD_STORAGE],
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
        serverId: GcpMcpServerIds.CLOUD_STORAGE,
        serverName: GcpMcpServerIds.CLOUD_STORAGE,
        transport: "streamable-http",
        url: "https://storage.googleapis.com/storage/mcp",
        description: "Google Cloud Storage MCP",
      },
    ]);
  });
});
