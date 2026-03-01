import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { IntegrationRegistry } from "../registry/index.js";
import type { IntegrationDefinition } from "../types/index.js";
import { compileRuntimePlan } from "./index.js";

const execFileAsync = promisify(execFile);

const EmptyTargetConfigSchema = z.object({});
const EmptyBindingConfigSchema = z.object({});

function createGithubBinaryInstallDefinition(
  installPath: string,
): IntegrationDefinition<typeof EmptyTargetConfigSchema, typeof EmptyBindingConfigSchema> {
  return {
    familyId: "test",
    variantId: "github-releases-install-binary",
    kind: "agent",
    displayName: "Test",
    logoKey: "test",
    targetConfigSchema: EmptyTargetConfigSchema,
    bindingConfigSchema: EmptyBindingConfigSchema,
    supportedAuthSchemes: ["api-key"],
    triggerEventTypes: [],
    userConfigSlots: [],
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [
        {
          artifactKey: "jq",
          name: "jq",
          lifecycle: {
            install: ({ refs }) => [
              refs.githubReleases.installLatestBinary({
                repository: "jqlang/jq",
                assets: {
                  x86_64: {
                    fileName: "jq-linux-amd64",
                    binaryPath: "jq-linux-amd64",
                    format: "binary",
                  },
                  aarch64: {
                    fileName: "jq-linux-arm64",
                    binaryPath: "jq-linux-arm64",
                    format: "binary",
                  },
                },
                installPath,
                timeoutMs: 120_000,
              }),
            ],
          },
        },
      ],
      runtimeClientSetups: [],
    }),
  };
}

describe("renderInstallLatestGithubReleaseBinaryScript integration", () => {
  it("downloads and installs a release binary that can be executed", async () => {
    if (process.platform !== "linux") {
      return;
    }

    if (process.arch !== "x64" && process.arch !== "arm64") {
      return;
    }

    const installRoot = await mkdtemp(join(tmpdir(), "integrations-core-github-release-"));
    const installPath = join(installRoot, "jq");

    try {
      const registry = new IntegrationRegistry();
      registry.register(createGithubBinaryInstallDefinition(installPath));

      const runtimePlan = compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "default-base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxProvider: "docker",
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            targetKey: "test_target",
            target: {
              familyId: "test",
              variantId: "github-releases-install-binary",
              enabled: true,
              config: {},
            },
            connection: {
              id: "conn_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_123",
              kind: "agent",
              connectionId: "conn_123",
              config: {},
            },
          },
        ],
      });

      const installCommand = runtimePlan.artifacts[0]?.lifecycle.install[0];
      expect(installCommand?.args[0]).toBe("sh");
      expect(installCommand?.args[1]).toBe("-euc");
      expect(typeof installCommand?.args[2]).toBe("string");

      const script = installCommand?.args[2];
      if (typeof script !== "string") {
        throw new Error("Expected generated github release install script.");
      }

      await execFileAsync("sh", ["-euc", script], {
        timeout: 120_000,
      });

      const installedBinaryStat = await stat(installPath);
      expect(installedBinaryStat.isFile()).toBe(true);

      const versionResult = await execFileAsync(installPath, ["--version"], {
        timeout: 30_000,
      });
      expect(versionResult.stdout.trim().startsWith("jq-")).toBe(true);
    } finally {
      await rm(installRoot, { recursive: true, force: true });
    }
  }, 180_000);
});
