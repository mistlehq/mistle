import { routesOverlap, type EgressCredentialRoute } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { GcpCredentialSlotKeys } from "./auth.js";
import { compileGcpBinding } from "./compile-binding.js";
import { GcpMcpServerIds } from "./mcp-catalog.js";

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

function createCompileInput(input: {
  mcpServers: Array<(typeof GcpMcpServerIds)[keyof typeof GcpMcpServerIds]>;
}): Parameters<typeof compileGcpBinding>[0] {
  return {
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    targetKey: "gcp-mcp",
    target: {
      familyId: "gcp",
      variantId: "gcp-mcp",
      enabled: true,
      config: {},
      secrets: {},
    },
    connection: {
      id: "icn_gcp",
      status: "active",
      config: {
        connection_method: "oauth2-authorization-code",
        client_id: "google_client_123.apps.googleusercontent.com",
      },
    },
    binding: {
      id: "ibd_123",
      kind: "connector",
      config: {
        mcpServers: input.mcpServers,
      },
    },
    refs: {
      sandboxPaths: SandboxPaths,
      artifactBinPath,
    },
  };
}

function requireRoute(
  routes: ReturnType<typeof compileGcpBinding>["egressRoutes"],
  index: number,
): ReturnType<typeof compileGcpBinding>["egressRoutes"][number] {
  const route = routes[index];
  if (route === undefined) {
    throw new Error(`Expected route at index ${String(index)}.`);
  }

  return route;
}

describe("compileGcpBinding", () => {
  it("builds the expected Cloud Storage MCP route", () => {
    const compiled = compileGcpBinding(
      createCompileInput({
        mcpServers: [GcpMcpServerIds.CLOUD_STORAGE],
      }),
    );

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["storage.googleapis.com"],
          pathPrefixes: ["/storage/mcp"],
        },
        upstream: {
          baseUrl: "https://storage.googleapis.com/storage/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_gcp",
          secretType: "oauth2_access_token",
          slotKey: GcpCredentialSlotKeys.accessToken,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("builds the expected Cloud Resource Manager MCP route", () => {
    const compiled = compileGcpBinding(
      createCompileInput({
        mcpServers: [GcpMcpServerIds.CLOUD_RESOURCE_MANAGER],
      }),
    );

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["cloudresourcemanager.googleapis.com"],
          pathPrefixes: ["/mcp"],
        },
        upstream: {
          baseUrl: "https://cloudresourcemanager.googleapis.com/mcp",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_gcp",
          secretType: "oauth2_access_token",
          slotKey: GcpCredentialSlotKeys.accessToken,
        },
      },
    ]);
  });

  it("builds non-overlapping routes for all selected Google Cloud MCP servers", () => {
    const compiled = compileGcpBinding(
      createCompileInput({
        mcpServers: [GcpMcpServerIds.CLOUD_STORAGE, GcpMcpServerIds.CLOUD_RESOURCE_MANAGER],
      }),
    );

    expect(compiled.egressRoutes).toHaveLength(2);
    const storageRoute: EgressCredentialRoute = {
      egressRuleId: "egress_rule_gcp_storage",
      bindingId: "ibd_123",
      familyId: "gcp",
      variantId: "gcp-mcp",
      ...requireRoute(compiled.egressRoutes, 0),
    };
    const resourceManagerRoute: EgressCredentialRoute = {
      egressRuleId: "egress_rule_gcp_resource_manager",
      bindingId: "ibd_123",
      familyId: "gcp",
      variantId: "gcp-mcp",
      ...requireRoute(compiled.egressRoutes, 1),
    };

    expect(
      routesOverlap({
        left: storageRoute,
        right: resourceManagerRoute,
      }),
    ).toBe(false);
  });
});
