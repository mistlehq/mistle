import type {
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { GitHubCredentialSlotKeys } from "../../shared/slot-keys.js";
import { compileGitHubEnterpriseServerBinding } from "./compile-binding.js";

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
      targetKey: "github_enterprise_server",
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
          slotKey: GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_API_KEY,
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
          slotKey: GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_API_KEY,
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
        path: "/root/acme/repo",
        originUrl: "https://ghe.example.com/acme/repo.git",
      },
    ]);
  });

  it("omits the gh artifact when github-cli is not selected", () => {
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

    expect(compiled.artifacts).toEqual([]);
    expect(compiled.workspaceSources).toEqual([
      {
        sourceKind: "git-clone",
        resourceKind: "repository",
        path: "/root/acme/repo",
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

    expect(compiled.egressRoutes[0]?.match.pathPrefixes).toEqual([
      "/acme/repo-a.git",
      "/acme/repo-b.git",
    ]);
    expect(compiled.egressRoutes[1]?.match.pathPrefixes).toEqual(["/api/v3", "/api/graphql"]);
  });

  it("uses github app installation token secret type for github app installation connections", () => {
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
          connection_method: "github-app-installation",
          app_id: "123",
          app_slug: "mistle-github-app",
          installation_id: "12345",
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

    expect(compiled.egressRoutes[0]?.credentialResolver.secretType).toBe(
      "github_app_installation_token",
    );
    expect(compiled.egressRoutes[0]?.credentialResolver.resolverKey).toBe(
      "github_app_installation_token",
    );
    expect(compiled.egressRoutes[1]?.credentialResolver.secretType).toBe(
      "github_app_installation_token",
    );
    expect(compiled.egressRoutes[1]?.credentialResolver.resolverKey).toBe(
      "github_app_installation_token",
    );
  });

  it("fails fast when github app installation config omits installation_id", () => {
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
            connection_method: "github-app-installation",
            app_id: "123",
            app_slug: "mistle-github-app",
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
      }),
    ).toThrow(/Invalid input/);
  });
});
