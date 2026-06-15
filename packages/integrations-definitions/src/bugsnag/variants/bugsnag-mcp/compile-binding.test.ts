import { describe, expect, it } from "vitest";

import { BugSnagCredentialSlotKeys } from "./auth.js";
import { compileBugSnagBinding } from "./compile-binding.js";

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

describe("compileBugSnagBinding", () => {
  it("builds the hosted MCP route with integration connection token injection", () => {
    const compiled = compileBugSnagBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "bugsnag-mcp",
      target: {
        familyId: "bugsnag",
        variantId: "bugsnag-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_bugsnag",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "bugsnag_client_123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: ["bugsnag-mcp"],
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
          hosts: ["bugsnag.mcp.smartbear.com"],
          pathPrefixes: ["/mcp"],
        },
        upstream: {
          baseUrl: "https://bugsnag.mcp.smartbear.com/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_bugsnag",
          secretType: "oauth2_access_token",
          slotKey: BugSnagCredentialSlotKeys.accessToken,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("omits routes when the MCP tool is not selected", () => {
    const compiled = compileBugSnagBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "bugsnag-mcp",
      target: {
        familyId: "bugsnag",
        variantId: "bugsnag-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_bugsnag",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "bugsnag_client_123",
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
