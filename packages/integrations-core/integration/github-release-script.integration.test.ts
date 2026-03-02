import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { compileRuntimePlan } from "../src/compiler/index.js";
import { IntegrationRegistry } from "../src/registry/index.js";
import type { IntegrationDefinition } from "../src/types/index.js";

const EmptyTargetConfigSchema = z.object({});
const EmptyBindingConfigSchema = z.object({});

const TestContainerImage = "alpine:3.22";
const InstallPath = "/tmp/jq";

function createGithubBinaryInstallDefinition(): IntegrationDefinition<
  typeof EmptyTargetConfigSchema,
  typeof EmptyBindingConfigSchema
> {
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
                installPath: InstallPath,
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

async function prepareContainer(container: StartedTestContainer): Promise<void> {
  const installDependenciesResult = await container.exec([
    "sh",
    "-euc",
    "apk add --no-cache curl ca-certificates coreutils tar",
  ]);

  if (installDependenciesResult.exitCode !== 0) {
    throw new Error(
      `Failed to install container dependencies. Output: ${installDependenciesResult.output}`,
    );
  }
}

describe("renderInstallLatestGithubReleaseBinaryScript integration", () => {
  it("downloads and installs a release binary that can be executed in linux", async () => {
    const registry = new IntegrationRegistry();
    registry.register(createGithubBinaryInstallDefinition());

    const runtimePlan = compileRuntimePlan({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      runtimeContext: {
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

    let container: StartedTestContainer | undefined;

    try {
      container = await new GenericContainer(TestContainerImage)
        .withCommand(["sh", "-euc", "sleep infinity"])
        .start();

      await prepareContainer(container);

      const installResult = await container.exec(["sh", "-euc", script]);
      if (installResult.exitCode !== 0) {
        throw new Error(`Install script failed. Output: ${installResult.output}`);
      }

      const versionResult = await container.exec([InstallPath, "--version"]);
      expect(versionResult.exitCode).toBe(0);
      expect(versionResult.stdout.trim().startsWith("jq-")).toBe(true);
    } finally {
      if (container !== undefined) {
        await container.stop();
      }
    }
  }, 240_000);
});
