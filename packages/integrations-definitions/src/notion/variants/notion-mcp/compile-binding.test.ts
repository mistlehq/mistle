import { describe, expect, it } from "vitest";

import { NotionCredentialSlotKeys } from "./auth.js";
import { compileNotionBinding } from "./compile-binding.js";

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

describe("compileNotionBinding", () => {
  it("builds the hosted MCP route with integration connection token injection", () => {
    const compiled = compileNotionBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "notion-mcp",
      target: {
        familyId: "notion",
        variantId: "notion-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_notion",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "notion_client_123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: ["notion-mcp"],
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
          hosts: ["mcp.notion.com"],
          pathPrefixes: ["/mcp"],
        },
        upstream: {
          baseUrl: "https://mcp.notion.com/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_notion",
          secretType: "oauth2_access_token",
          slotKey: NotionCredentialSlotKeys.accessToken,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("omits routes when the MCP tool is not selected", () => {
    const compiled = compileNotionBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "notion-mcp",
      target: {
        familyId: "notion",
        variantId: "notion-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_notion",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "notion_client_123",
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
