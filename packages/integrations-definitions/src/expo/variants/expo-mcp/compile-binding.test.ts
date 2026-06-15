import { describe, expect, it } from "vitest";

import { ExpoCredentialSlotKeys } from "./auth.js";
import { compileExpoBinding } from "./compile-binding.js";
import { ExpoMcpServerIds } from "./mcp-catalog.js";

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

describe("compileExpoBinding", () => {
  it("builds the hosted MCP route with integration connection token injection", () => {
    const compiled = compileExpoBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "expo-mcp",
      target: {
        familyId: "expo",
        variantId: "expo-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_expo",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "expo_client_123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          mcpServers: [ExpoMcpServerIds.EXPO],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["mcp.expo.dev"],
          pathPrefixes: ["/mcp"],
        },
        upstream: {
          baseUrl: "https://mcp.expo.dev/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_expo",
          secretType: "oauth2_access_token",
          slotKey: ExpoCredentialSlotKeys.accessToken,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("omits routes when the MCP server is not selected", () => {
    const compiled = compileExpoBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "expo-mcp",
      target: {
        familyId: "expo",
        variantId: "expo-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_expo",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "expo_client_123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          mcpServers: [],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.egressRoutes).toEqual([]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });
});
