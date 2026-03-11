import { describe, expect, it } from "vitest";

import { compileGitHubEnterpriseServerBinding } from "./compile-binding.js";

function artifactBinPath(name: string): string {
  return `/workspace/.mistle/bin/${name}`;
}

describe("compileGitHubEnterpriseServerBinding", () => {
  it("builds expected repo-scoped egress routes and workspace sources for enterprise API paths", () => {
    const compiled = compileGitHubEnterpriseServerBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "github_enterprise_server",
      target: {
        familyId: "github",
        variantId: "github-enterprise-server",
        enabled: true,
        secrets: {},
        config: {
          apiBaseUrl: "https://ghe.example.com/api/v3",
          webBaseUrl: "https://ghe.example.com",
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
        artifactBinPath,
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["ghe.example.com"],
          pathPrefixes: ["/acme/repo.git"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://ghe.example.com",
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
    expect(compiled.runtimeClients).toEqual([]);
    expect(compiled.workspaceSources).toEqual([
      {
        sourceKind: "git-clone",
        resourceKind: "repository",
        path: "/workspace/repos/acme/repo",
        originUrl: "https://ghe.example.com/acme/repo.git",
      },
    ]);
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
        secrets: {},
        config: {
          apiBaseUrl: "https://ghe.example.com/api/v3",
          webBaseUrl: "https://ghe.example.com",
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
        artifactBinPath,
      },
    });

    expect(compiled.egressRoutes[0]?.match.pathPrefixes).toEqual([
      "/acme/repo-a.git",
      "/acme/repo-b.git",
    ]);
    expect(compiled.egressRoutes[1]?.match.pathPrefixes).toEqual([
      "/api/v3/repos/acme/repo-a",
      "/api/v3/repos/acme/repo-b",
    ]);
  });

  it("uses oauth access token secret type for github app-style oauth connections", () => {
    const compiled = compileGitHubEnterpriseServerBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "github_enterprise_server",
      target: {
        familyId: "github",
        variantId: "github-enterprise-server",
        enabled: true,
        secrets: {},
        config: {
          apiBaseUrl: "https://ghe.example.com/api/v3",
          webBaseUrl: "https://ghe.example.com",
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
        artifactBinPath,
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

  it("fails fast when oauth config omits installation_id", () => {
    expect(() =>
      compileGitHubEnterpriseServerBinding({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "github_enterprise_server",
        target: {
          familyId: "github",
          variantId: "github-enterprise-server",
          enabled: true,
          secrets: {},
          config: {
            apiBaseUrl: "https://ghe.example.com/api/v3",
            webBaseUrl: "https://ghe.example.com",
          },
        },
        connection: {
          id: "icn_123",
          status: "active",
          config: {
            auth_scheme: "oauth",
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
          artifactBinPath,
        },
      }),
    ).toThrowError();
  });
});
