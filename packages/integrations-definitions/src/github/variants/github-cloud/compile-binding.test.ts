import type {
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { GitHubRequestMiddlewareIds } from "../../shared/egress-request-middleware.js";
import { GitHubCredentialSlotKeys } from "../../shared/slot-keys.js";
import { compileGitHubCloudBinding } from "./compile-binding.js";

const GitHubCliTokenPattern = /^ghp_[A-Za-z0-9]{36}$/;

function artifactBinPath(name: string): string {
  return `/usr/local/bin/${name}`;
}

const SandboxPaths = {
  userHomeDir: "/root",
  workspaceDir: "/root",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
} as const;

function resolveArtifactLifecycleCommands(artifact: RuntimeArtifactSpec): {
  install: ReadonlyArray<RuntimeArtifactInstallStep>;
} {
  const refs = {
    command: {
      exec(input: RuntimeExecCommand): RuntimeArtifactInstallStep {
        return {
          op: "exec",
          command: input,
        };
      },
    },
    sandboxPaths: SandboxPaths,
    artifactBinPath,
    mise: {
      install(input: {
        tools: ReadonlyArray<string>;
        force?: boolean;
        timeoutMs?: number;
      }): RuntimeArtifactInstallStep {
        return {
          op: "exec",
          command: {
            args: ["mise", "install", ...input.tools],
          },
        };
      },
    },
    githubReleases: {
      install(): RuntimeArtifactInstallStep {
        return {
          op: "exec",
          command: {
            args: ["github-releases.install"],
          },
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
  return {
    install,
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
          tools: ["github-cli"],
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
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_API_KEY,
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
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_API_KEY,
        },
        requestMiddleware: [GitHubRequestMiddlewareIds.APPEND_SESSION_LINK_TO_MARKDOWN],
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
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_API_KEY,
        },
      },
    ]);

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe("gh-cli");
    expect(artifact?.name).toBe("GitHub CLI");
    expect(artifact?.env).toEqual({
      GH_TOKEN: expect.stringMatching(GitHubCliTokenPattern),
    });
    if (artifact === undefined) {
      throw new Error("Expected compiled gh artifact.");
    }
    expect(resolveArtifactLifecycleCommands(artifact)).toEqual({
      install: [
        {
          op: "exec",
          command: {
            args: ["sh", "-euc", expect.stringContaining("run_with_retry")],
            timeoutMs: 120_000,
          },
        },
      ],
    });
    expect(compiled.runtimeClients).toEqual([]);
    expect(compiled.workspaceSources).toEqual([
      {
        sourceKind: "git-clone",
        resourceKind: "repository",
        path: "/root/acme/repo-a",
        originUrl: "https://github.com/acme/repo-a.git",
      },
      {
        sourceKind: "git-clone",
        resourceKind: "repository",
        path: "/root/acme/repo-b",
        originUrl: "https://github.com/acme/repo-b.git",
      },
    ]);
  });

  it("omits the gh artifact when github-cli is not selected", () => {
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
          repositories: ["acme/repo-a"],
          tools: [],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.artifacts).toEqual([]);
    expect(compiled.workspaceSources).toEqual([
      {
        sourceKind: "git-clone",
        resourceKind: "repository",
        path: "/root/acme/repo-a",
        originUrl: "https://github.com/acme/repo-a.git",
      },
    ]);
  });

  it("keeps api access and gh artifact when no repositories are selected", () => {
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
          repositories: [],
          tools: ["github-cli"],
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
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_API_KEY,
        },
        requestMiddleware: [GitHubRequestMiddlewareIds.APPEND_SESSION_LINK_TO_MARKDOWN],
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
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_API_KEY,
        },
      },
    ]);
    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.workspaceSources).toEqual([]);
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
          tools: ["github-cli"],
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
        path: "/root/acme/repo",
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
          tools: [],
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

  it("uses github app installation token secret type for github app installation connections", () => {
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
          app_id: "123",
          app_slug: "mistle-github-app",
          client_id: "Iv1.client123",
          installation_id: "12345",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "git",
        config: {
          repositories: ["acme/repo"],
          tools: [],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.egressRoutes[0]?.credentialResolver).toMatchObject({
      kind: "integration_connection",
      secretType: "github_app_installation_token",
      resolverKey: "github_app_installation_token",
    });
    expect(compiled.egressRoutes[1]?.credentialResolver).toMatchObject({
      kind: "integration_connection",
      secretType: "github_app_installation_token",
      resolverKey: "github_app_installation_token",
    });
    expect(compiled.egressRoutes[1]?.requestMiddleware).toEqual([
      GitHubRequestMiddlewareIds.APPEND_SESSION_LINK_TO_MARKDOWN,
    ]);
    expect(compiled.egressRoutes[2]?.credentialResolver).toMatchObject({
      kind: "integration_connection",
      secretType: "github_app_installation_token",
      resolverKey: "github_app_installation_token",
    });
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
            tools: [],
          },
        },
        refs: {
          sandboxPaths: SandboxPaths,
          artifactBinPath,
        },
      }),
    ).toThrow(/Invalid input/);
  });
});
