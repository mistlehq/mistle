import type {
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { compileTensorlakeBinding } from "./compile-binding.js";
import { TensorlakeSandboxRuntimeCredentialSlotKeys } from "./constants.js";
import type { TensorlakeSandboxRuntimeBindingConfig } from "./schemas.js";

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
      targetKey: "tensorlake",
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

function compileTensorlakeForTools(tools: TensorlakeSandboxRuntimeBindingConfig["tools"]) {
  return compileTensorlakeBinding({
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    targetKey: "tensorlake",
    target: {
      familyId: "tensorlake",
      variantId: "tensorlake-default",
      enabled: true,
      secrets: {},
      config: {},
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

describe("compileTensorlakeBinding", () => {
  it("omits routes and artifacts when the Tensorlake CLI is not selected", () => {
    const compiled = compileTensorlakeForTools([]);

    expect(compiled.egressRoutes).toEqual([]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("builds managed egress routes for Tensorlake API and sandbox proxy hosts when the CLI is selected", () => {
    const compiled = compileTensorlakeForTools(["tensorlake-cli"]);

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["api.tensorlake.ai"],
          pathPrefixes: ["/"],
        },
        upstream: {
          baseUrl: "https://api.tensorlake.ai",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: TensorlakeSandboxRuntimeCredentialSlotKeys.API_KEY,
        },
      },
      {
        match: {
          hosts: ["sandbox.tensorlake.ai"],
          pathPrefixes: ["/"],
        },
        upstream: {
          baseUrl: "https://sandbox.tensorlake.ai",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: TensorlakeSandboxRuntimeCredentialSlotKeys.API_KEY,
        },
      },
    ]);
    expect(compiled.artifacts).toHaveLength(1);
  });

  it("installs Tensorlake CLI with placeholder API-key environment when selected", () => {
    const compiled = compileTensorlakeForTools(["tensorlake-cli"]);

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    if (artifact === undefined) {
      throw new Error("Expected Tensorlake CLI artifact.");
    }

    expect(artifact).toMatchObject({
      artifactKey: "tensorlake-cli",
      name: "Tensorlake CLI",
      env: {
        TENSORLAKE_API_KEY: "tl_apiKey_mistle_placeholder_for_managed_egress",
        TENSORLAKE_API_URL: "https://api.tensorlake.ai",
        TENSORLAKE_SANDBOX_PROXY_URL: "https://sandbox.tensorlake.ai",
      },
    });

    const lifecycle = resolveArtifactLifecycleCommands(artifact);
    expect(lifecycle.install).toHaveLength(2);
    expect(lifecycle.install[0]).toMatchObject({
      op: "mise_install",
      tools: ["node@24.11.1"],
      timeoutMs: 180_000,
    });
    expect(lifecycle.install[1]).toMatchObject({
      op: "exec",
      command: {
        args: [
          "mise",
          "exec",
          "node@24.11.1",
          "--",
          "sh",
          "-euc",
          expect.stringContaining("npm install --prefix"),
        ],
        timeoutMs: 180_000,
      },
    });
    expect(lifecycle.install[1]).toMatchObject({
      command: {
        args: [
          expect.any(String),
          expect.any(String),
          expect.any(String),
          expect.any(String),
          expect.any(String),
          expect.any(String),
          expect.stringContaining("tensorlake@0.5.31"),
        ],
      },
    });
    expect(lifecycle.install[1]).toMatchObject({
      command: {
        args: [
          expect.any(String),
          expect.any(String),
          expect.any(String),
          expect.any(String),
          expect.any(String),
          expect.any(String),
          expect.stringContaining("/var/lib/mistle/artifacts/tensorlake-cli"),
        ],
      },
    });
  });
});
