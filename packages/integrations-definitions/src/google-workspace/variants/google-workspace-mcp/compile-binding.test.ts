import { routesOverlap, type EgressCredentialRoute } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { GoogleWorkspaceCredentialSlotKeys } from "./auth.js";
import { compileGoogleWorkspaceBinding } from "./compile-binding.js";
import { GoogleWorkspaceMcpServerIds } from "./mcp-catalog.js";

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
  mcpServers: Array<(typeof GoogleWorkspaceMcpServerIds)[keyof typeof GoogleWorkspaceMcpServerIds]>;
}): Parameters<typeof compileGoogleWorkspaceBinding>[0] {
  return {
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    targetKey: "google-workspace-mcp",
    target: {
      familyId: "google-workspace",
      variantId: "google-workspace-mcp",
      enabled: true,
      config: {},
      secrets: {},
    },
    connection: {
      id: "icn_google_workspace",
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

describe("compileGoogleWorkspaceBinding", () => {
  it("builds the expected Gmail MCP route", () => {
    const compiled = compileGoogleWorkspaceBinding(
      createCompileInput({
        mcpServers: [GoogleWorkspaceMcpServerIds.GMAIL],
      }),
    );

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["gmailmcp.googleapis.com"],
          pathPrefixes: ["/mcp/v1"],
        },
        upstream: {
          baseUrl: "https://gmailmcp.googleapis.com/mcp/v1",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_google_workspace",
          secretType: "oauth2_access_token",
          slotKey: GoogleWorkspaceCredentialSlotKeys.accessToken,
        },
      },
    ]);
  });

  it("builds the expected Google Workspace MCP routes", () => {
    const compiled = compileGoogleWorkspaceBinding(
      createCompileInput({
        mcpServers: [
          GoogleWorkspaceMcpServerIds.DRIVE,
          GoogleWorkspaceMcpServerIds.CALENDAR,
          GoogleWorkspaceMcpServerIds.CHAT,
          GoogleWorkspaceMcpServerIds.PEOPLE,
        ],
      }),
    );

    expect(compiled.egressRoutes.map((route) => route.upstream.baseUrl)).toEqual([
      "https://drivemcp.googleapis.com/mcp/v1",
      "https://calendarmcp.googleapis.com/mcp/v1",
      "https://chatmcp.googleapis.com/mcp/v1",
      "https://people.googleapis.com/mcp/v1",
    ]);
    expect(compiled.egressRoutes.map((route) => route.match)).toEqual([
      {
        hosts: ["drivemcp.googleapis.com"],
        pathPrefixes: ["/mcp/v1"],
      },
      {
        hosts: ["calendarmcp.googleapis.com"],
        pathPrefixes: ["/mcp/v1"],
      },
      {
        hosts: ["chatmcp.googleapis.com"],
        pathPrefixes: ["/mcp/v1"],
      },
      {
        hosts: ["people.googleapis.com"],
        pathPrefixes: ["/mcp/v1"],
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("builds non-overlapping routes for all selected Google Workspace MCP servers", () => {
    const compiled = compileGoogleWorkspaceBinding(
      createCompileInput({
        mcpServers: [
          GoogleWorkspaceMcpServerIds.GMAIL,
          GoogleWorkspaceMcpServerIds.DRIVE,
          GoogleWorkspaceMcpServerIds.CALENDAR,
          GoogleWorkspaceMcpServerIds.CHAT,
          GoogleWorkspaceMcpServerIds.PEOPLE,
        ],
      }),
    );

    expect(compiled.egressRoutes).toHaveLength(5);
    const routes = compiled.egressRoutes.map(
      (route, index): EgressCredentialRoute => ({
        egressRuleId: `egress_rule_google_workspace_${String(index)}`,
        bindingId: "ibd_123",
        familyId: "google-workspace",
        variantId: "google-workspace-mcp",
        ...route,
      }),
    );

    for (const [leftIndex, left] of routes.entries()) {
      for (const [rightIndex, right] of routes.entries()) {
        if (leftIndex >= rightIndex) {
          continue;
        }

        expect(
          routesOverlap({
            left,
            right,
          }),
        ).toBe(false);
      }
    }
  });
});
