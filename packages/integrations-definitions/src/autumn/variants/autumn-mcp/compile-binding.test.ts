import { describe, expect, it } from "vitest";

import { AutumnCredentialSlotKeys } from "./auth.js";
import { compileAutumnBinding } from "./compile-binding.js";
import { AutumnMcpServerIds } from "./mcp-catalog.js";

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
    mcpServers?: Array<(typeof AutumnMcpServerIds)[keyof typeof AutumnMcpServerIds]>;
  } = {},
): Parameters<typeof compileAutumnBinding>[0] {
  return {
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
        mcpServers: input.mcpServers ?? [AutumnMcpServerIds.AUTUMN],
      },
    },
    refs: {
      sandboxPaths: SandboxPaths,
      artifactBinPath,
    },
  };
}

describe("compileAutumnBinding", () => {
  it("builds the Autumn MCP route with bearer secret-key auth", () => {
    const compiled = compileAutumnBinding(createCompileInput());

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["mcp.useautumn.com"],
          pathPrefixes: ["/mcp"],
        },
        upstream: {
          baseUrl: "https://mcp.useautumn.com/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_autumn",
          secretType: "api_key",
          slotKey: AutumnCredentialSlotKeys.API_KEY,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("does not emit egress routes when no Autumn MCP servers are selected", () => {
    const compiled = compileAutumnBinding(
      createCompileInput({
        mcpServers: [],
      }),
    );

    expect(compiled.egressRoutes).toEqual([]);
  });
});
