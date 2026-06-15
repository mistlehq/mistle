import { describe, expect, it } from "vitest";

import { StripeCredentialSlotKeys } from "./auth.js";
import { compileStripeBinding } from "./compile-binding.js";

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

describe("compileStripeBinding", () => {
  it("builds the hosted MCP route with integration connection token injection", () => {
    const compiled = compileStripeBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "stripe-mcp",
      target: {
        familyId: "stripe",
        variantId: "stripe-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_stripe",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "stripe_client_123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: ["stripe-mcp"],
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
          hosts: ["mcp.stripe.com"],
          pathPrefixes: ["/"],
        },
        upstream: {
          baseUrl: "https://mcp.stripe.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_stripe",
          secretType: "oauth2_access_token",
          slotKey: StripeCredentialSlotKeys.accessToken,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("omits routes when the MCP tool is not selected", () => {
    const compiled = compileStripeBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "stripe-mcp",
      target: {
        familyId: "stripe",
        variantId: "stripe-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_stripe",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "stripe_client_123",
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
