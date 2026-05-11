import { describe, expect, it } from "vitest";

import { SandboxConfigurationError } from "../../errors.js";
import { SandboxBaseImagePublishModes, SandboxBaseImageSourceKinds } from "../../types.js";
import {
  createDockerBaseImageBuilderEnv,
  createDockerBuildBaseImageCommand,
} from "./base-image-builder.js";

describe("createDockerBuildBaseImageCommand", () => {
  it("creates a Docker buildx push command for a Dockerfile source", () => {
    expect(
      createDockerBuildBaseImageCommand({
        platform: "linux/amd64",
        source: {
          kind: SandboxBaseImageSourceKinds.DOCKERFILE,
          contextPath: "/repo",
          dockerfilePath: "packages/sandboxd/Dockerfile",
          imageId: "ghcr.io/mistlehq/sandbox-base:dev-test",
          additionalImageIds: ["ghcr.io/mistlehq/sandbox-base:latest"],
          labels: {
            "org.opencontainers.image.source": "https://github.com/mistle-ai/mistle",
          },
          publishMode: SandboxBaseImagePublishModes.PUSH,
          target: "sandbox-base",
        },
      }),
    ).toEqual({
      command: "docker",
      cwd: "/repo",
      args: [
        "buildx",
        "build",
        "--file",
        "packages/sandboxd/Dockerfile",
        "--tag",
        "ghcr.io/mistlehq/sandbox-base:dev-test",
        "--tag",
        "ghcr.io/mistlehq/sandbox-base:latest",
        "--label",
        "org.opencontainers.image.source=https://github.com/mistle-ai/mistle",
        "--platform",
        "linux/amd64",
        "--target",
        "sandbox-base",
        "--push",
        ".",
      ],
    });
  });

  it("creates a Docker buildx load command when the caller requests a local image", () => {
    expect(
      createDockerBuildBaseImageCommand({
        source: {
          kind: SandboxBaseImageSourceKinds.DOCKERFILE,
          contextPath: "/repo",
          dockerfilePath: "packages/sandboxd/Dockerfile",
          imageId: "mistle/sandbox-base:dev",
          publishMode: SandboxBaseImagePublishModes.LOAD,
        },
      }).args,
    ).toContain("--load");
  });

  it("rejects image sources because Docker builds from a Dockerfile source", () => {
    expect(() =>
      createDockerBuildBaseImageCommand({
        source: {
          kind: SandboxBaseImageSourceKinds.IMAGE,
          imageId: "ghcr.io/mistlehq/sandbox-base:dev-test",
        },
      }),
    ).toThrow(SandboxConfigurationError);
  });
});

describe("createDockerBaseImageBuilderEnv", () => {
  it("preserves process environment entries required to resolve the Docker executable", () => {
    const baseEnv: NodeJS.ProcessEnv = {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: "/Users/dev",
    };
    const overrideEnv: NodeJS.ProcessEnv = {
      MISTLE_CONFIG_PATH: "/repo/config/config.development.toml",
    };

    expect(createDockerBaseImageBuilderEnv({ baseEnv, overrideEnv })).toEqual({
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: "/Users/dev",
      MISTLE_CONFIG_PATH: "/repo/config/config.development.toml",
    });
  });

  it("lets explicit override values win over the base process environment", () => {
    const baseEnv: NodeJS.ProcessEnv = {
      MISTLE_CONFIG_PATH: "/old/config.toml",
    };
    const overrideEnv: NodeJS.ProcessEnv = {
      MISTLE_CONFIG_PATH: "/repo/config/config.development.toml",
    };

    expect(createDockerBaseImageBuilderEnv({ baseEnv, overrideEnv })).toEqual({
      MISTLE_CONFIG_PATH: "/repo/config/config.development.toml",
    });
  });
});
