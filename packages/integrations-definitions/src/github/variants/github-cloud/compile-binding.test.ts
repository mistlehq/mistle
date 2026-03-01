import { describe, expect, it } from "vitest";

import { compileGitHubCloudBinding } from "./compile-binding.js";

describe("compileGitHubCloudBinding", () => {
  it("builds expected repo-scoped egress route", () => {
    const compiled = compileGitHubCloudBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "github_cloud",
      target: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          apiBaseUrl: "https://api.github.com",
          webBaseUrl: "https://github.com",
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
        sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["api.github.com"],
          pathPrefixes: ["/repos/acme/repo-a", "/repos/acme/repo-b"],
          methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        },
        upstream: {
          baseUrl: "https://api.github.com",
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

  it("preserves custom API base path for enterprise-style proxies", () => {
    const compiled = compileGitHubCloudBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "github_cloud_proxy",
      target: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          apiBaseUrl: "https://proxy.example.com/github/api/v3",
          webBaseUrl: "https://proxy.example.com/github",
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
        sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
      },
    });

    expect(compiled.egressRoutes[0]?.match.hosts).toEqual(["proxy.example.com"]);
    expect(compiled.egressRoutes[0]?.match.pathPrefixes).toEqual([
      "/github/api/v3/repos/acme/repo",
    ]);
  });
});
