import { describe, expect, it } from "vitest";

import { compileGitHubCloudBinding } from "./compile-binding.js";

function artifactBinPath(name: string): string {
  return `/workspace/.mistle/bin/${name}`;
}

describe("compileGitHubCloudBinding", () => {
  it("builds expected repo-scoped egress routes and workspace sources", () => {
    const compiled = compileGitHubCloudBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "github_cloud",
      target: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        secrets: {},
        config: {
          apiBaseUrl: "https://api.github.com",
          webBaseUrl: "https://github.com",
        },
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {
          auth_scheme: "api-key",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "git",
        config: {
          repositories: ["acme/repo-b", "acme/repo-a", "acme/repo-a"],
        },
      },
      refs: {
        egressUrl: {
          kind: "egress_url",
          routeId: "route_ibd_123",
        },
        artifactBinPath,
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["github.com"],
          pathPrefixes: ["/acme/repo-a.git", "/acme/repo-b.git"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://github.com",
        },
        authInjection: {
          type: "basic",
          target: "authorization",
          username: "x-access-token",
        },
        credentialResolver: {
          connectionId: "icn_123",
          secretType: "api_key",
        },
      },
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
    expect(compiled.runtimeClients).toEqual([]);
    expect(compiled.workspaceSources).toEqual([
      {
        sourceKind: "git-clone",
        resourceKind: "repository",
        path: "/workspace/repos/acme/repo-a",
        originUrl: "https://github.com/acme/repo-a.git",
        routeId: {
          kind: "egress_url",
          routeId: "route_ibd_123",
        },
      },
      {
        sourceKind: "git-clone",
        resourceKind: "repository",
        path: "/workspace/repos/acme/repo-b",
        originUrl: "https://github.com/acme/repo-b.git",
        routeId: {
          kind: "egress_url",
          routeId: "route_ibd_123",
        },
      },
    ]);
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
        secrets: {},
        config: {
          apiBaseUrl: "https://proxy.example.com/github/api/v3",
          webBaseUrl: "https://proxy.example.com/github",
        },
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {
          auth_scheme: "api-key",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "git",
        config: {
          repositories: ["acme/repo"],
        },
      },
      refs: {
        egressUrl: {
          kind: "egress_url",
          routeId: "route_ibd_123",
        },
        artifactBinPath,
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
      },
    });

    expect(compiled.egressRoutes[0]?.match.hosts).toEqual(["proxy.example.com"]);
    expect(compiled.egressRoutes[0]?.match.pathPrefixes).toEqual(["/github/acme/repo.git"]);
    expect(compiled.egressRoutes[1]?.match.pathPrefixes).toEqual([
      "/github/api/v3/repos/acme/repo",
    ]);
    expect(compiled.workspaceSources).toEqual([
      {
        sourceKind: "git-clone",
        resourceKind: "repository",
        path: "/workspace/repos/acme/repo",
        originUrl: "https://proxy.example.com/github/acme/repo.git",
        routeId: {
          kind: "egress_url",
          routeId: "route_ibd_123",
        },
      },
    ]);
  });

  it("keeps repository path prefixes valid when api base url is root with trailing slash", () => {
    const compiled = compileGitHubCloudBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "github_cloud",
      target: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        secrets: {},
        config: {
          apiBaseUrl: "https://api.github.com/",
          webBaseUrl: "https://github.com",
        },
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {
          auth_scheme: "api-key",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "git",
        config: {
          repositories: ["acme/repo"],
        },
      },
      refs: {
        egressUrl: {
          kind: "egress_url",
          routeId: "route_ibd_123",
        },
        artifactBinPath,
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
      },
    });

    expect(compiled.egressRoutes[0]?.match.pathPrefixes).toEqual(["/acme/repo.git"]);
    expect(compiled.egressRoutes[1]?.match.pathPrefixes).toEqual(["/repos/acme/repo"]);
  });

  it("uses oauth access token secret type for github app-style oauth connections", () => {
    const compiled = compileGitHubCloudBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "github_cloud",
      target: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        secrets: {},
        config: {
          apiBaseUrl: "https://api.github.com",
          webBaseUrl: "https://github.com",
        },
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {
          auth_scheme: "oauth",
          installation_id: "12345",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "git",
        config: {
          repositories: ["acme/repo"],
        },
      },
      refs: {
        egressUrl: {
          kind: "egress_url",
          routeId: "route_ibd_123",
        },
        artifactBinPath,
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
      },
    });

    expect(compiled.egressRoutes[0]?.credentialResolver.secretType).toBe("oauth_access_token");
    expect(compiled.egressRoutes[0]?.credentialResolver.resolverKey).toBe(
      "github_app_installation_token",
    );
    expect(compiled.egressRoutes[1]?.credentialResolver.secretType).toBe("oauth_access_token");
    expect(compiled.egressRoutes[1]?.credentialResolver.resolverKey).toBe(
      "github_app_installation_token",
    );
  });

  it("fails fast when connection auth_scheme is missing", () => {
    expect(() =>
      compileGitHubCloudBinding({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "github_cloud",
        target: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          secrets: {},
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
            repositories: ["acme/repo"],
          },
        },
        refs: {
          egressUrl: {
            kind: "egress_url",
            routeId: "route_ibd_123",
          },
          artifactBinPath,
        },
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
        },
      }),
    ).toThrowError();
  });
});
