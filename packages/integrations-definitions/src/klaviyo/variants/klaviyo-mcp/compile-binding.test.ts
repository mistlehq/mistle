import { describe, expect, it } from "vitest";

import { KlaviyoCredentialSlotKeys } from "./auth.js";
import type { KlaviyoBindingConfig } from "./binding-config-schema.js";
import { compileKlaviyoBinding } from "./compile-binding.js";
import { KlaviyoToolIds } from "./tool-ids.js";

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

function compileKlaviyoBindingForTools(tools: KlaviyoBindingConfig["tools"]) {
  return compileKlaviyoBinding({
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    targetKey: "klaviyo-mcp",
    target: {
      familyId: "klaviyo",
      variantId: "klaviyo-mcp",
      enabled: true,
      config: {},
      secrets: {},
    },
    connection: {
      id: "icn_klaviyo",
      status: "active",
      config: {
        connection_method: "oauth2-authorization-code",
        client_id: "klaviyo_client_123",
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

describe("compileKlaviyoBinding", () => {
  it("builds the hosted MCP route with integration connection token injection", () => {
    const compiled = compileKlaviyoBindingForTools([KlaviyoToolIds.KLAVIYO_MCP]);

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["mcp.klaviyo.com"],
          pathPrefixes: ["/mcp"],
        },
        upstream: {
          baseUrl: "https://mcp.klaviyo.com/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_klaviyo",
          secretType: "oauth2_access_token",
          slotKey: KlaviyoCredentialSlotKeys.accessToken,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("omits routes when the MCP tool is not selected", () => {
    const compiled = compileKlaviyoBindingForTools([]);

    expect(compiled.egressRoutes).toEqual([]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });
});
