import { describe, expect, it } from "vitest";

import { DataForSeoCredentialSlotKeys } from "./auth.js";
import type { DataForSeoBindingConfig } from "./binding-config-schema.js";
import { compileDataForSeoBinding } from "./compile-binding.js";
import { DataForSeoToolIds } from "./tool-ids.js";

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

function compileDataForSeoBindingForTools(tools: DataForSeoBindingConfig["tools"]) {
  return compileDataForSeoBinding({
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    targetKey: "dataforseo-mcp",
    target: {
      familyId: "dataforseo",
      variantId: "dataforseo-mcp",
      enabled: true,
      config: {},
      secrets: {},
    },
    connection: {
      id: "icn_dataforseo",
      status: "active",
      config: {
        connection_method: "oauth2-authorization-code",
        client_id: "dataforseo_client_123",
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

describe("compileDataForSeoBinding", () => {
  it("builds the hosted MCP route with integration connection token injection", () => {
    const compiled = compileDataForSeoBindingForTools([DataForSeoToolIds.DATAFORSEO_MCP]);

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["mcp.dataforseo.com"],
          pathPrefixes: ["/mcp"],
        },
        upstream: {
          baseUrl: "https://mcp.dataforseo.com/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_dataforseo",
          secretType: "oauth2_access_token",
          slotKey: DataForSeoCredentialSlotKeys.accessToken,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("omits routes when the MCP tool is not selected", () => {
    const compiled = compileDataForSeoBindingForTools([]);

    expect(compiled.egressRoutes).toEqual([]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });
});
