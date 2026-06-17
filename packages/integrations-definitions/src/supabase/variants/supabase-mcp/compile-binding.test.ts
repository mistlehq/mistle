import { describe, expect, it } from "vitest";

import { SupabaseCredentialSlotKeys } from "./auth.js";
import { compileSupabaseBinding } from "./compile-binding.js";

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

describe("compileSupabaseBinding", () => {
  it("builds the hosted MCP route with integration connection token injection", () => {
    const compiled = compileSupabaseBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "supabase-mcp",
      target: {
        familyId: "supabase",
        variantId: "supabase-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_supabase",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "supabase_client_123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: ["supabase-mcp"],
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
          hosts: ["mcp.supabase.com"],
          pathPrefixes: ["/mcp"],
        },
        upstream: {
          baseUrl: "https://mcp.supabase.com/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_supabase",
          secretType: "oauth2_access_token",
          slotKey: SupabaseCredentialSlotKeys.accessToken,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("omits routes when the MCP tool is not selected", () => {
    const compiled = compileSupabaseBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "supabase-mcp",
      target: {
        familyId: "supabase",
        variantId: "supabase-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_supabase",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "supabase_client_123",
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
