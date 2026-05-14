import { describe, expect, it } from "vitest";

import { SentryCredentialSlotKeys } from "./auth.js";
import { compileSentryBinding } from "./compile-binding.js";

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

describe("compileSentryBinding", () => {
  it("builds the hosted MCP route with integration connection token injection", () => {
    const compiled = compileSentryBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "sentry-mcp",
      target: {
        familyId: "sentry",
        variantId: "sentry-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_sentry",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "sentry_client_123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: ["sentry-mcp"],
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
          hosts: ["mcp.sentry.dev"],
          pathPrefixes: ["/mcp"],
        },
        upstream: {
          baseUrl: "https://mcp.sentry.dev/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_sentry",
          secretType: "oauth2_access_token",
          slotKey: SentryCredentialSlotKeys.accessToken,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("omits routes when the MCP tool is not selected", () => {
    const compiled = compileSentryBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "sentry-mcp",
      target: {
        familyId: "sentry",
        variantId: "sentry-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_sentry",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "sentry_client_123",
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
