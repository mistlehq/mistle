import type {
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { compileE2BBinding } from "./compile-binding.js";
import { E2BSandboxRuntimeCredentialSlotKeys } from "./constants.js";
import type { E2BSandboxRuntimeBindingConfig } from "./schemas.js";

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
      targetKey: "e2b",
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

function compileE2BForTools(tools: E2BSandboxRuntimeBindingConfig["tools"]) {
  return compileE2BBinding({
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    targetKey: "e2b",
    target: {
      familyId: "e2b",
      variantId: "e2b-default",
      enabled: true,
      secrets: {},
      config: {
        domain: "e2b.app",
      },
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

describe("compileE2BBinding", () => {
  it("omits routes, artifacts, and runtime clients when the E2B CLI is not selected", () => {
    const compiled = compileE2BForTools([]);

    expect(compiled.egressRoutes).toEqual([]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("builds managed egress routes for E2B API and sandbox hosts when the CLI is selected", () => {
    const compiled = compileE2BForTools(["e2b-cli"]);

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["api.e2b.app"],
          pathPrefixes: ["/"],
        },
        upstream: {
          baseUrl: "https://api.e2b.app",
        },
        authInjection: {
          type: "header",
          target: "X-API-KEY",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: E2BSandboxRuntimeCredentialSlotKeys.API_KEY,
        },
      },
      {
        match: {
          hosts: ["sandbox.e2b.app"],
          pathPrefixes: ["/"],
        },
        upstream: {
          baseUrl: "https://sandbox.e2b.app",
        },
        authInjection: {
          type: "header",
          target: "X-API-KEY",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: E2BSandboxRuntimeCredentialSlotKeys.API_KEY,
        },
      },
    ]);
    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.runtimeClients).toHaveLength(1);
  });

  it("installs E2B CLI from npm through Node and writes a managed credential wrapper", () => {
    const compiled = compileE2BForTools(["e2b-cli"]);

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    if (artifact === undefined) {
      throw new Error("Expected E2B CLI artifact.");
    }

    expect(artifact).toMatchObject({
      artifactKey: "e2b-cli",
      name: "E2B CLI",
    });

    const lifecycle = resolveArtifactLifecycleCommands(artifact);
    expect(lifecycle.install).toHaveLength(2);
    expect(lifecycle.install[0]).toEqual({
      op: "mise_install",
      tools: ["node@24.11.1"],
      timeoutMs: 180_000,
    });

    const installCommand = lifecycle.install[1];
    if (installCommand?.op !== "exec") {
      throw new Error("Expected E2B CLI package install step to be an exec step.");
    }
    expect(installCommand.command.args).toEqual([
      "sh",
      "-euc",
      expect.stringContaining('package_spec="@e2b/cli@2.12.0"'),
    ]);
    expect(installCommand.command.args[2]).toContain(
      "mise exec node@24.11.1 -- npm install --omit=dev --ignore-scripts --no-audit --no-fund",
    );
    expect(installCommand.command.args[2]).toContain(
      "/var/lib/mistle/artifacts/e2b-cli/node_modules/.bin/e2b",
    );

    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "e2b-cli-runtime",
        setup: {
          env: {},
          files: [
            {
              fileId: "e2b_cli_wrapper",
              path: "/usr/local/bin/e2b",
              mode: 0o755,
              content: [
                "#!/bin/sh",
                "set -eu",
                "",
                'export E2B_API_KEY="e2b_0000000000000000000000000000000000000000"',
                'export E2B_DOMAIN="e2b.app"',
                'export E2B_API_URL="https://api.e2b.app"',
                'export E2B_SANDBOX_URL="https://sandbox.e2b.app"',
                "",
                'exec "/var/lib/mistle/artifacts/e2b-cli/node_modules/.bin/e2b" "$@"',
              ].join("\n"),
            },
          ],
        },
        processes: [],
        endpoints: [],
      },
    ]);
  });
});
