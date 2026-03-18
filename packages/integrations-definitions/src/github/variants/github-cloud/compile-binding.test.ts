import type { RuntimeArtifactCommand, RuntimeArtifactSpec } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { compileGitHubCloudBinding } from "./compile-binding.js";

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
      targetKey: "github_cloud",
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

describe("compileGitHubCloudBinding", () => {
  it("builds expected github egress routes, gh artifact, and workspace sources", () => {
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
          connection_method: "api-key",
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
          pathPrefixes: ["/"],
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
      {
        match: {
          hosts: ["uploads.github.com"],
          pathPrefixes: ["/"],
          methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        },
        upstream: {
          baseUrl: "https://uploads.github.com",
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
        path: "/home/sandbox/projects/acme/repo-a",
        originUrl: "https://github.com/acme/repo-a.git",
      },
      {
        sourceKind: "git-clone",
        resourceKind: "repository",
        path: "/home/sandbox/projects/acme/repo-b",
        originUrl: "https://github.com/acme/repo-b.git",
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
          connection_method: "api-key",
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

    expect(compiled.egressRoutes[0]?.match.hosts).toEqual(["proxy.example.com"]);
    expect(compiled.egressRoutes[0]?.match.pathPrefixes).toEqual(["/github/acme/repo.git"]);
    expect(compiled.egressRoutes[1]?.match.pathPrefixes).toEqual([
      "/github/api/v3",
      "/github/api/graphql",
    ]);
    expect(compiled.egressRoutes).toHaveLength(2);
    expect(compiled.workspaceSources).toEqual([
      {
        sourceKind: "git-clone",
        resourceKind: "repository",
        path: "/home/sandbox/projects/acme/repo",
        originUrl: "https://proxy.example.com/github/acme/repo.git",
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
          connection_method: "api-key",
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

    expect(compiled.egressRoutes[0]?.match.pathPrefixes).toEqual(["/acme/repo.git"]);
    expect(compiled.egressRoutes[1]?.match.pathPrefixes).toEqual(["/"]);
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
          connection_method: "github-app-installation",
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
    expect(compiled.egressRoutes[2]?.credentialResolver.secretType).toBe("oauth_access_token");
    expect(compiled.egressRoutes[2]?.credentialResolver.resolverKey).toBe(
      "github_app_installation_token",
    );
  });

  it("fails fast when connection connection_method is missing", () => {
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
          sandboxPaths: SandboxPaths,
          artifactBinPath,
        },
      }),
    ).toThrowError();
  });
});
