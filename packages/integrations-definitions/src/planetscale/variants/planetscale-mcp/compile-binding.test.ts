import { routesOverlap, type EgressCredentialRoute } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { PlanetScaleCredentialSlotKeys } from "./auth.js";
import { compilePlanetScaleBinding } from "./compile-binding.js";

const SandboxPaths = {
  userHomeDir: "/root",
  workspaceDir: "/root",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
} as const;

function artifactBinPath(name: string): string {
  return `/usr/local/bin/${name}`;
}

function requireRoute(
  routes: ReturnType<typeof compilePlanetScaleBinding>["egressRoutes"],
  index: number,
): ReturnType<typeof compilePlanetScaleBinding>["egressRoutes"][number] {
  const route = routes[index];
  if (route === undefined) {
    throw new Error(`Expected route at index ${String(index)}.`);
  }

  return route;
}

describe("compilePlanetScaleBinding", () => {
  it("builds the expected full MCP route", () => {
    const compiled = compilePlanetScaleBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "planetscale-mcp",
      target: {
        familyId: "planetscale",
        variantId: "planetscale-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_planetscale",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "pscale_app_123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: ["planetscale-mcp"],
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
          hosts: ["mcp.pscale.dev"],
          pathPrefixes: ["/mcp/planetscale"],
        },
        upstream: {
          baseUrl: "https://mcp.pscale.dev/mcp/planetscale",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_planetscale",
          secretType: "oauth2_access_token",
          slotKey: PlanetScaleCredentialSlotKeys.accessToken,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("builds the expected insights-only MCP route", () => {
    const compiled = compilePlanetScaleBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "planetscale-mcp",
      target: {
        familyId: "planetscale",
        variantId: "planetscale-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_planetscale",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "pscale_app_123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: ["planetscale-insights-mcp"],
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
          hosts: ["mcp.pscale.dev"],
          pathPrefixes: ["/mcp/planetscale-insights-only"],
        },
        upstream: {
          baseUrl: "https://mcp.pscale.dev/mcp/planetscale-insights-only",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_planetscale",
          secretType: "oauth2_access_token",
          slotKey: PlanetScaleCredentialSlotKeys.accessToken,
        },
      },
    ]);
  });

  it("builds both MCP routes when both tools are selected", () => {
    const compiled = compilePlanetScaleBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "planetscale-mcp",
      target: {
        familyId: "planetscale",
        variantId: "planetscale-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_planetscale",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "pscale_app_123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: ["planetscale-mcp", "planetscale-insights-mcp"],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.egressRoutes).toHaveLength(2);
    const fullMcpRoute: EgressCredentialRoute = {
      egressRuleId: "egress_rule_planetscale",
      bindingId: "ibd_123",
      familyId: "planetscale",
      variantId: "planetscale-mcp",
      ...requireRoute(compiled.egressRoutes, 0),
    };
    const insightsMcpRoute: EgressCredentialRoute = {
      egressRuleId: "egress_rule_planetscale_insights",
      bindingId: "ibd_123",
      familyId: "planetscale",
      variantId: "planetscale-mcp",
      ...requireRoute(compiled.egressRoutes, 1),
    };

    expect(
      routesOverlap({
        left: fullMcpRoute,
        right: insightsMcpRoute,
      }),
    ).toBe(false);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });
});
