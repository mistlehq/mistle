import { describe, expect, it } from "vitest";

import {
  createControlPlaneIntegrationTargetsSyncCommandInput,
  resolveHostPathFromContainerPath,
} from "./full-system-environment.js";
import { DockerIntegrationConfigPathInContainer } from "./integration-config-paths.js";

describe("resolveHostPathFromContainerPath", () => {
  it("maps a container path under /app to the host build context", () => {
    expect(
      resolveHostPathFromContainerPath({
        buildContextHostPath: "/workspace/repo",
        containerPath: DockerIntegrationConfigPathInContainer,
      }),
    ).toBe("/workspace/repo/config/config.integration.docker.toml");
  });

  it("rejects container paths outside the mounted /app workspace", () => {
    expect(() =>
      resolveHostPathFromContainerPath({
        buildContextHostPath: "/workspace/repo",
        containerPath: "/tmp/config.toml",
      }),
    ).toThrow("containerPath must stay within the mounted /app workspace.");
  });
});

describe("createControlPlaneIntegrationTargetsSyncCommandInput", () => {
  it("creates a command that provisions integration targets against the host database", () => {
    expect(
      createControlPlaneIntegrationTargetsSyncCommandInput({
        buildContextHostPath: "/workspace/repo",
        configPathInContainer: DockerIntegrationConfigPathInContainer,
        hostDatabaseUrl: "postgresql://mistle:mistle@127.0.0.1:5433/mistle_system",
      }),
    ).toEqual({
      command: "pnpm",
      args: ["--filter", "@mistle/control-plane-api", "integration-targets:sync"],
      cwd: "/workspace/repo",
      env: {
        MISTLE_CONFIG_PATH: "/workspace/repo/config/config.integration.docker.toml",
        MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL:
          "postgresql://mistle:mistle@127.0.0.1:5433/mistle_system",
      },
    });
  });
});
