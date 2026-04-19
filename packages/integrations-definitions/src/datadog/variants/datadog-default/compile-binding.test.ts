import { describe, expect, it } from "vitest";

import { DatadogCredentialSlotKeys } from "./auth.js";
import { compileDatadogBinding } from "./compile-binding.js";

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

describe("compileDatadogBinding", () => {
  it("builds the expected hosted MCP route", () => {
    const compiled = compileDatadogBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "datadog-default",
      target: {
        familyId: "datadog",
        variantId: "datadog-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_datadog",
        status: "active",
        config: {
          connection_method: "api-key",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: ["datadog-mcp"],
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
          hosts: ["mcp.datadoghq.com"],
          pathPrefixes: ["/api/unstable/mcp-server/mcp"],
        },
        upstream: {
          baseUrl: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
        },
        authInjection: {
          type: "header",
          target: "dd_api_key",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_datadog",
          secretType: "api_key",
          slotKey: DatadogCredentialSlotKeys.API_KEY,
        },
        additionalCredentialHeaders: [
          {
            header: "dd_application_key",
            credentialResolver: {
              kind: "integration_connection",
              connectionId: "icn_datadog",
              secretType: "api_key",
              slotKey: DatadogCredentialSlotKeys.APPLICATION_KEY,
            },
          },
        ],
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("omits routes when the MCP tool is not selected", () => {
    const compiled = compileDatadogBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "datadog-default",
      target: {
        familyId: "datadog",
        variantId: "datadog-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_datadog",
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
