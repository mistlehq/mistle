import type { RuntimeArtifactCommand, RuntimeArtifactSpec } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { compileGitHubEnterpriseServerBinding } from "./compile-binding.js";

function artifactBinPath(name: string): string {
  return `/var/lib/mistle/bin/${name}`;
}

const SandboxPaths = {
  userHomeDir: "/home/sandbox",
  userProjectsDir: "/home/sandbox/projects",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/var/lib/mistle/bin",
} as const;

function resolveArtifactLifecycleCommands(artifact: RuntimeArtifactSpec): {
  install: ReadonlyArray<RuntimeArtifactCommand>;
  update?: ReadonlyArray<RuntimeArtifactCommand>;
  remove: ReadonlyArray<RuntimeArtifactCommand>;
} {
  const refs = {
    command: {
      exec(input: RuntimeArtifactCommand): RuntimeArtifactCommand {
        return input;
      },
    },
    sandboxPaths: SandboxPaths,
    artifactBinPath,
    mise: {
      install(input: { tools: ReadonlyArray<string>; force?: boolean; timeoutMs?: number }) {
        return {
          args: ["mise", "install", ...input.tools],
        };
      },
    },
    githubReleases: {
      installLatestBinary() {
        return {
          args: ["github-releases.installLatestBinary"],
        };
      },
    },
    compileContext: {
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "github_enterprise_server",
      bindingId: "ibd_123",
    },
  };

  const install =
    typeof artifact.lifecycle.install === "function"
      ? artifact.lifecycle.install({ refs })
      : artifact.lifecycle.install;
  const update =
    artifact.lifecycle.update === undefined
      ? undefined
      : typeof artifact.lifecycle.update === "function"
        ? artifact.lifecycle.update({ refs })
        : artifact.lifecycle.update;
  const remove =
    typeof artifact.lifecycle.remove === "function"
      ? artifact.lifecycle.remove({ refs })
      : artifact.lifecycle.remove;

  return {
    install,
    ...(update === undefined ? {} : { update }),
    remove,
  };
}

describe("compileGitHubEnterpriseServerBinding", () => {
  it("builds expected github routes, gh artifact, and workspace sources for enterprise API paths", () => {
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
        sandboxPaths: SandboxPaths,
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
          pathPrefixes: ["/api/v3", "/api/graphql"],
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

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe("gh-cli");
    expect(artifact?.name).toBe("GitHub CLI");
    expect(artifact?.env).toEqual({
      GH_TOKEN: "dummy-value",
    });
    if (artifact === undefined) {
      throw new Error("Expected compiled gh artifact.");
    }
    expect(resolveArtifactLifecycleCommands(artifact)).toEqual({
      install: [
        {
          args: [
            "sh",
            "-euc",
            expect.stringContaining("https://github.com/cli/cli/releases/latest"),
          ],
          timeoutMs: 120_000,
        },
      ],
      update: [
        {
          args: [
            "sh",
            "-euc",
            expect.stringContaining("https://github.com/cli/cli/releases/latest"),
          ],
          timeoutMs: 120_000,
        },
      ],
      remove: [
        {
          args: ["rm", "-f", "/var/lib/mistle/bin/gh"],
        },
      ],
    });
    expect(compiled.runtimeClients).toEqual([]);
    expect(compiled.workspaceSources).toEqual([
      {
        sourceKind: "git-clone",
        resourceKind: "repository",
        path: "/home/sandbox/projects/acme/repo",
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
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.egressRoutes[0]?.match.pathPrefixes).toEqual([
      "/acme/repo-a.git",
      "/acme/repo-b.git",
    ]);
    expect(compiled.egressRoutes[1]?.match.pathPrefixes).toEqual(["/api/v3", "/api/graphql"]);
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
        sandboxPaths: SandboxPaths,
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
          sandboxPaths: SandboxPaths,
          artifactBinPath,
        },
      }),
    ).toThrowError();
  });
});
