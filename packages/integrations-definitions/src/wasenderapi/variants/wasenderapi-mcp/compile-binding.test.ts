import { describe, expect, it } from "vitest";

import { WasenderApiCredentialSlotKeys } from "./auth.js";
import { compileWasenderApiBinding } from "./compile-binding.js";

const SandboxPaths = {
  userHomeDir: "/root",
  workspaceDir: "/root",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
} as const;

function artifactBinPath(name: string): string {
  return `/usr/local/bin/${name}`;
}

describe("compileWasenderApiBinding", () => {
  it("builds the expected hosted MCP route", () => {
    const compiled = compileWasenderApiBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "wasenderapi-mcp",
      target: {
        familyId: "wasenderapi",
        variantId: "wasenderapi-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_wasenderapi",
        status: "active",
        config: {
          connection_method: "api-key",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: ["wasenderapi-mcp"],
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
          hosts: ["wasenderapi.com"],
          pathPrefixes: ["/mcp"],
        },
        upstream: {
          baseUrl: "https://wasenderapi.com/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_wasenderapi",
          secretType: "api_key",
          slotKey: WasenderApiCredentialSlotKeys.PERSONAL_ACCESS_TOKEN,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("omits routes when the MCP tool is not selected", () => {
    const compiled = compileWasenderApiBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "wasenderapi-mcp",
      target: {
        familyId: "wasenderapi",
        variantId: "wasenderapi-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_wasenderapi",
        status: "active",
        config: {
          connection_method: "api-key",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: [],
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
