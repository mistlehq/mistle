import { describe, expect, it } from "vitest";

import { SignozCredentialSlotKeys } from "./auth.js";
import { compileSignozBinding } from "./compile-binding.js";

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

describe("compileSignozBinding", () => {
  it("builds the expected hosted MCP route", () => {
    const compiled = compileSignozBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "signoz-mcp",
      target: {
        familyId: "signoz",
        variantId: "signoz-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_signoz",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          region: "us",
          client_id: "signoz_client_123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: ["signoz-mcp"],
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
          hosts: ["mcp.us.signoz.cloud"],
          pathPrefixes: ["/mcp"],
        },
        upstream: {
          baseUrl: "https://mcp.us.signoz.cloud/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_signoz",
          secretType: "oauth2_access_token",
          slotKey: SignozCredentialSlotKeys.accessToken,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("builds the MCP route from an explicit issuer base URL", () => {
    const compiled = compileSignozBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "signoz-mcp",
      target: {
        familyId: "signoz",
        variantId: "signoz-mcp",
        enabled: true,
        config: {
          issuer_base_url: "https://observability.example.com",
        },
        secrets: {},
      },
      connection: {
        id: "icn_signoz",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          region: "us",
          client_id: "signoz_client_123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: ["signoz-mcp"],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.egressRoutes).toEqual([
      expect.objectContaining({
        match: {
          hosts: ["observability.example.com"],
          pathPrefixes: ["/mcp"],
        },
        upstream: {
          baseUrl: "https://observability.example.com/mcp",
        },
      }),
    ]);
  });

  it("omits routes when the MCP tool is not selected", () => {
    const compiled = compileSignozBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "signoz-mcp",
      target: {
        familyId: "signoz",
        variantId: "signoz-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_signoz",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          region: "us",
          client_id: "signoz_client_123",
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
