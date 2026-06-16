import { describe, expect, it } from "vitest";

import { AgentMailCredentialSlotKeys } from "./auth.js";
import { compileAgentMailBinding } from "./compile-binding.js";

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

describe("compileAgentMailBinding", () => {
  it("builds the hosted MCP route with integration connection token injection", () => {
    const compiled = compileAgentMailBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "agentmail-mcp",
      target: {
        familyId: "agentmail",
        variantId: "agentmail-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_agentmail",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "agentmail_client_123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: ["agentmail-mcp"],
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
          hosts: ["mcp.agentmail.to"],
          pathPrefixes: ["/mcp"],
        },
        upstream: {
          baseUrl: "https://mcp.agentmail.to/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_agentmail",
          secretType: "oauth2_access_token",
          slotKey: AgentMailCredentialSlotKeys.accessToken,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("omits routes when the MCP tool is not selected", () => {
    const compiled = compileAgentMailBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "agentmail-mcp",
      target: {
        familyId: "agentmail",
        variantId: "agentmail-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_agentmail",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "agentmail_client_123",
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
