import { describe, expect, it } from "vitest";

import { AutumnDefinition } from "./definition.js";
import { AutumnMcpServerIds } from "./mcp-catalog.js";

describe("AutumnDefinition", () => {
  it("defines secret-key Autumn MCP access", () => {
    expect(AutumnDefinition).toMatchObject({
      familyId: "autumn",
      variantId: "autumn-mcp",
      kind: "connector",
      displayName: "Autumn",
      logoKey: "autumn",
      connectionMethods: [
        {
          id: "api-key",
          label: "Secret key",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "Autumn secret key",
              inputType: "password",
              slotKey: "autumn.autumn-mcp.api-key.api-key",
            },
          ],
        },
      ],
    });
  });

  it("resolves selected Autumn MCP servers from the binding config", () => {
    if (typeof AutumnDefinition.mcp !== "function") {
      throw new Error("Expected Autumn definition to provide dynamic MCP servers.");
    }

    expect(
      AutumnDefinition.mcp({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "autumn-mcp",
        target: {
          familyId: "autumn",
          variantId: "autumn-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "icn_autumn",
          status: "active",
          config: {
            connection_method: "api-key",
          },
        },
        binding: {
          id: "ibd_123",
          kind: "connector",
          config: {
            mcpServers: [AutumnMcpServerIds.AUTUMN],
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
        serverId: AutumnMcpServerIds.AUTUMN,
        serverName: AutumnMcpServerIds.AUTUMN,
        transport: "streamable-http",
        url: "https://mcp.useautumn.com/mcp",
        description: "Autumn billing, customer, plan, balance, and log MCP access",
      },
    ]);
  });
});
