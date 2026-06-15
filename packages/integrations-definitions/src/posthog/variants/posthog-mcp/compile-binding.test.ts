import { describe, expect, it } from "vitest";

import { PostHogCredentialSlotKeys } from "./auth.js";
import type { PostHogBindingConfig } from "./binding-config-schema.js";
import { compilePostHogBinding } from "./compile-binding.js";
import { PostHogToolIds } from "./tool-ids.js";

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

function compilePostHogBindingForTools(tools: PostHogBindingConfig["tools"]) {
  return compilePostHogBinding({
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    targetKey: "posthog-mcp",
    target: {
      familyId: "posthog",
      variantId: "posthog-mcp",
      enabled: true,
      config: {},
      secrets: {},
    },
    connection: {
      id: "icn_posthog",
      status: "active",
      config: {
        connection_method: "oauth2-authorization-code",
        client_id: "posthog_client_123",
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

describe("compilePostHogBinding", () => {
  it("builds the hosted MCP route with integration connection token injection", () => {
    const compiled = compilePostHogBindingForTools([PostHogToolIds.POSTHOG_MCP]);

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["mcp.posthog.com"],
          pathPrefixes: ["/mcp"],
        },
        upstream: {
          baseUrl: "https://mcp.posthog.com/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_posthog",
          secretType: "oauth2_access_token",
          slotKey: PostHogCredentialSlotKeys.accessToken,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("omits routes when the MCP tool is not selected", () => {
    const compiled = compilePostHogBindingForTools([]);

    expect(compiled.egressRoutes).toEqual([]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });
});
