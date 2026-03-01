import { describe, expect, it } from "vitest";

import { compileGitHubEnterpriseServerBinding } from "./compile-binding.js";

describe("compileGitHubEnterpriseServerBinding", () => {
  it("builds expected repo-scoped egress route for enterprise API paths", () => {
    const compiled = compileGitHubEnterpriseServerBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "github_enterprise_server",
      target: {
        familyId: "github",
        variantId: "github-enterprise-server",
        enabled: true,
        config: {
          apiBaseUrl: "https://ghe.example.com/api/v3",
          webBaseUrl: "https://ghe.example.com",
        },
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {},
      },
      binding: {
        id: "ibd_123",
        kind: "git",
        config: {
          repositories: ["acme/repo"],
          includeGhCli: true,
        },
      },
      refs: {
        egressUrl: {
          kind: "egress_url",
          routeId: "route_ibd_123",
        },
      },
      runtimeContext: {
        sandboxProvider: "docker",
        sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["ghe.example.com"],
          pathPrefixes: ["/api/v3/repos/acme/repo"],
          methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        },
        upstream: {
          baseUrl: "https://ghe.example.com/api/v3",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: "icn_123",
          secretType: "api_key",
        },
      },
    ]);

    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClientSetups).toEqual([]);
  });

  it("deduplicates and sorts repositories for deterministic route matching", () => {
    const compiled = compileGitHubEnterpriseServerBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "github_enterprise_server",
      target: {
        familyId: "github",
        variantId: "github-enterprise-server",
        enabled: true,
        config: {
          apiBaseUrl: "https://ghe.example.com/api/v3",
          webBaseUrl: "https://ghe.example.com",
        },
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {},
      },
      binding: {
        id: "ibd_123",
        kind: "git",
        config: {
          repositories: ["acme/repo-b", "acme/repo-a", "acme/repo-a"],
          includeGhCli: false,
        },
      },
      refs: {
        egressUrl: {
          kind: "egress_url",
          routeId: "route_ibd_123",
        },
      },
      runtimeContext: {
        sandboxProvider: "docker",
        sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
      },
    });

    expect(compiled.egressRoutes[0]?.match.pathPrefixes).toEqual([
      "/api/v3/repos/acme/repo-a",
      "/api/v3/repos/acme/repo-b",
    ]);
  });
});
