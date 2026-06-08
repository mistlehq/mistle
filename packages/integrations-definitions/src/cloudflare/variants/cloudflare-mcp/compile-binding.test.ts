import { describe, expect, it } from "vitest";

import { CloudflareCredentialSlotKeys } from "./auth.js";
import { compileCloudflareBinding } from "./compile-binding.js";
import { CloudflareMcpServerIds } from "./mcp-catalog.js";

const SandboxPaths = {
  userHomeDir: "/root",
  workspaceDir: "/root",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
};

function artifactBinPath(name: string): string {
  return `/usr/local/bin/${name}`;
}

function createCompileInput(
  input: {
    mcpServers?: Array<(typeof CloudflareMcpServerIds)[keyof typeof CloudflareMcpServerIds]>;
  } = {},
): Parameters<typeof compileCloudflareBinding>[0] {
  return {
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
        mcpServers: input.mcpServers ?? [CloudflareMcpServerIds.CLOUDFLARE_API],
      },
    },
    refs: {
      sandboxPaths: SandboxPaths,
      artifactBinPath,
    },
  };
}

describe("compileCloudflareBinding", () => {
  it("builds the Cloudflare API MCP Code Mode route with bearer API token auth", () => {
    const compiled = compileCloudflareBinding(createCompileInput());

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["mcp.cloudflare.com"],
          pathPrefixes: ["/mcp"],
        },
        upstream: {
          baseUrl: "https://mcp.cloudflare.com/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_cloudflare",
          secretType: "api_key",
          slotKey: CloudflareCredentialSlotKeys.API_KEY,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("does not emit egress routes when no Cloudflare MCP servers are selected", () => {
    const compiled = compileCloudflareBinding(
      createCompileInput({
        mcpServers: [],
      }),
    );

    expect(compiled.egressRoutes).toEqual([]);
  });
});
