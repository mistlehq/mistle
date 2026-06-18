import type {
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { compileOpenComputerBinding } from "./compile-binding.js";
import { OpenComputerSandboxRuntimeCredentialSlotKeys } from "./constants.js";
import type { OpenComputerSandboxRuntimeBindingConfig } from "./schemas.js";

function artifactBinPath(name: string): string {
  return `/usr/local/bin/${name}`;
}

const SandboxPaths = {
  userHomeDir: "/root",
  workspaceDir: "/root",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
} satisfies RuntimeArtifactRefsSandboxPaths;

type RuntimeArtifactRefsSandboxPaths = {
  userHomeDir: string;
  workspaceDir: string;
  runtimeDataDir: string;
  runtimeArtifactDir: string;
  runtimeArtifactBinDir: string;
};

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
          op: "mise_install",
          tools: input.tools,
          ...(input.force === undefined ? {} : { force: input.force }),
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        };
      },
    },
    githubReleases: {
      install(input: RuntimeArtifactGitHubReleaseInstallHelperInput): RuntimeArtifactInstallStep {
        return {
          op: "github_release_install",
          ...input,
        };
      },
    },
    compileContext: {
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "opencomputer",
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

function compileOpenComputerForTools(
  tools: OpenComputerSandboxRuntimeBindingConfig["tools"],
  targetConfig: { apiBaseUrl?: string } = {},
) {
  return compileOpenComputerBinding({
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    targetKey: "opencomputer",
    target: {
      familyId: "opencomputer",
      variantId: "opencomputer-default",
      enabled: true,
      secrets: {},
      config: targetConfig,
    },
    connection: {
      id: "icn_123",
      status: "active",
      config: {},
    },
    binding: {
      id: "ibd_123",
      kind: "sandbox",
      config: {
        tools,
      },
    },
    refs: {
      sandboxPaths: SandboxPaths,
      artifactBinPath,
    },
  });
}

describe("compileOpenComputerBinding", () => {
  it("omits routes and artifacts when the OpenComputer CLI is not selected", () => {
    const compiled = compileOpenComputerForTools([]);

    expect(compiled.egressRoutes).toEqual([]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("builds managed egress routes for OpenComputer app and sessions hosts when the CLI is selected", () => {
    const compiled = compileOpenComputerForTools(["opencomputer-cli"]);

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["app.opencomputer.dev"],
          pathPrefixes: ["/"],
        },
        upstream: {
          baseUrl: "https://app.opencomputer.dev",
        },
        authInjection: {
          type: "header",
          target: "X-API-Key",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: OpenComputerSandboxRuntimeCredentialSlotKeys.API_KEY,
        },
      },
      {
        match: {
          hosts: ["api.opencomputer.dev"],
          pathPrefixes: ["/"],
        },
        upstream: {
          baseUrl: "https://api.opencomputer.dev",
        },
        authInjection: {
          type: "header",
          target: "X-API-Key",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: OpenComputerSandboxRuntimeCredentialSlotKeys.API_KEY,
        },
      },
    ]);
    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("installs OpenComputer CLI from a pinned GitHub release with managed egress env", () => {
    const compiled = compileOpenComputerForTools(["opencomputer-cli"]);

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    if (artifact === undefined) {
      throw new Error("Expected OpenComputer CLI artifact.");
    }

    expect(artifact).toMatchObject({
      artifactKey: "opencomputer-cli",
      name: "OpenComputer CLI",
      env: {
        OPENCOMPUTER_API_KEY: "mistle-placeholder-opencomputer-api-key",
        OPENCOMPUTER_API_URL: "https://app.opencomputer.dev",
        SESSIONS_API_URL: "https://api.opencomputer.dev",
      },
    });

    const lifecycle = resolveArtifactLifecycleCommands(artifact);
    expect(lifecycle.install).toEqual([
      {
        op: "github_release_install",
        repository: "diggerhq/opencomputer",
        release: {
          kind: "tag",
          match: "exact",
          tag: "v0.5.0.139",
        },
        asset: {
          kind: "by_arch",
          x86_64: {
            fileName: "oc-linux-amd64",
            format: "binary",
            sha256: "aae9b4787bf975e41b38c7d671ab242570de85a8f87873c2300bb9c11b148ce1",
          },
          aarch64: {
            fileName: "oc-linux-arm64",
            format: "binary",
            sha256: "53ee578a1804e48b043bcae6a28ee7382cd06c097f5af4d4d3f15c18d4012eb4",
          },
        },
        installPath: "/usr/local/bin/oc",
        timeoutMs: 180_000,
      },
    ]);
  });

  it("uses a custom OpenComputer API base URL for CLI env and managed egress", () => {
    const compiled = compileOpenComputerForTools(["opencomputer-cli"], {
      apiBaseUrl: "https://opencomputer.example.com/api",
    });

    expect(compiled.egressRoutes).toMatchObject([
      {
        match: {
          hosts: ["opencomputer.example.com"],
          pathPrefixes: ["/api"],
        },
        upstream: {
          baseUrl: "https://opencomputer.example.com/api",
        },
      },
      {
        match: {
          hosts: ["api.opencomputer.dev"],
          pathPrefixes: ["/"],
        },
        upstream: {
          baseUrl: "https://api.opencomputer.dev",
        },
      },
    ]);
    expect(compiled.artifacts[0]?.env).toEqual({
      OPENCOMPUTER_API_KEY: "mistle-placeholder-opencomputer-api-key",
      OPENCOMPUTER_API_URL: "https://opencomputer.example.com/api",
      SESSIONS_API_URL: "https://api.opencomputer.dev",
    });
  });
});
