import { describe, expect, it } from "vitest";

import { RailwayCredentialSlotKeys } from "./auth.js";
import type { RailwayBindingConfig } from "./binding-config-schema.js";
import { compileRailwayBinding } from "./compile-binding.js";
import { RailwayToolIds } from "./tool-ids.js";

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

function compileRailwayBindingForTools(tools: RailwayBindingConfig["tools"]) {
  return compileRailwayBinding({
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    targetKey: "railway-mcp",
    target: {
      familyId: "railway",
      variantId: "railway-mcp",
      enabled: true,
      config: {},
      secrets: {},
    },
    connection: {
      id: "icn_railway",
      status: "active",
      config: {
        connection_method: "oauth2-authorization-code",
        client_id: "railway_client_123",
      },
    },
    binding: {
      id: "ibd_123",
      kind: "connector",
      config: {
        tools,
      },
    },
    refs: {
      sandboxPaths: SandboxPaths,
      artifactBinPath,
    },
  });
}

describe("compileRailwayBinding", () => {
  it("builds the hosted MCP route with integration connection token injection", () => {
    const compiled = compileRailwayBindingForTools([RailwayToolIds.RAILWAY_MCP]);

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["mcp.railway.com"],
          pathPrefixes: ["/"],
        },
        upstream: {
          baseUrl: "https://mcp.railway.com/",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_railway",
          secretType: "oauth2_access_token",
          slotKey: RailwayCredentialSlotKeys.accessToken,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("omits routes when the MCP tool is not selected", () => {
    const compiled = compileRailwayBindingForTools([]);

    expect(compiled.egressRoutes).toEqual([]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });
});
