import { describe, expect, it } from "vitest";

import { CloudflareConnectionConfigForm } from "./binding-config-form.js";
import { CloudflareDefinition } from "./definition.js";
import { CloudflareMcpServerIds } from "./mcp-catalog.js";

describe("CloudflareDefinition", () => {
  it("defines API-token Cloudflare API MCP Code Mode access", () => {
    const apiTokenMethod = CloudflareDefinition.connectionMethods.find(
      (method) => method.id === "api-key",
    );

    expect(CloudflareDefinition).toMatchObject({
      familyId: "cloudflare",
      variantId: "cloudflare-mcp",
      kind: "connector",
      displayName: "Cloudflare",
      logoKey: "cloudflare",
      connectionMethods: [
        {
          id: "api-key",
          label: "API token",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "Cloudflare API token",
              inputType: "password",
              slotKey: "cloudflare.cloudflare-mcp.api-key.api-key",
            },
          ],
        },
      ],
    });
    expect(apiTokenMethod?.kind).toBe("form");
    if (apiTokenMethod?.kind !== "form") {
      throw new Error("Expected Cloudflare API token method to be a form method.");
    }
    expect(apiTokenMethod.configForm).toBe(CloudflareConnectionConfigForm);
  });

  it("resolves selected Cloudflare MCP servers from the binding config", () => {
    if (typeof CloudflareDefinition.mcp !== "function") {
      throw new Error("Expected Cloudflare definition to provide dynamic MCP servers.");
    }

    expect(
      CloudflareDefinition.mcp({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "cloudflare-mcp",
        target: {
          familyId: "cloudflare",
          variantId: "cloudflare-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "icn_cloudflare",
          status: "active",
          config: {
            connection_method: "api-key",
          },
        },
        binding: {
          id: "ibd_123",
          kind: "connector",
          config: {
            mcpServers: [CloudflareMcpServerIds.CLOUDFLARE_API],
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
        serverId: CloudflareMcpServerIds.CLOUDFLARE_API,
        serverName: CloudflareMcpServerIds.CLOUDFLARE_API,
        transport: "streamable-http",
        url: "https://mcp.cloudflare.com/mcp",
        description: "Cloudflare API MCP Code Mode",
      },
    ]);
  });
});
