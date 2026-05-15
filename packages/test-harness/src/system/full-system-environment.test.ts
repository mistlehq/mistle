import { describe, expect, it } from "vitest";

import { IntegrationConfigPathInContainer } from "./integration-config-paths.js";
import {
  createControlPlaneDatabaseMigrationCommandInput,
  createControlPlaneIntegrationTargetsSyncCommandInput,
  createControlPlaneWorkflowMigrationCommandInput,
  createDataPlaneDatabaseMigrationCommandInput,
  createDataPlaneWorkflowMigrationCommandInput,
  resolveHostPathFromContainerPath,
} from "./provision-system-integration-targets.js";

const BuildContextHostPath = "/workspace/repo";
const HostDatabaseUrl = "postgresql://mistle:mistle@127.0.0.1:5433/mistle_system";
const HostConfigPath = "/workspace/repo/config/config.integration.toml";

describe("resolveHostPathFromContainerPath", () => {
  it("maps a container path under /app to the host build context", () => {
    expect(
      resolveHostPathFromContainerPath({
        buildContextHostPath: "/workspace/repo",
        containerPath: IntegrationConfigPathInContainer,
      }),
    ).toBe(HostConfigPath);
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
        buildContextHostPath: BuildContextHostPath,
        configPathInContainer: IntegrationConfigPathInContainer,
        hostDatabaseUrl: HostDatabaseUrl,
      }),
    ).toEqual({
      command: "pnpm",
      args: ["--filter", "@mistle/control-plane-api", "integration-targets:sync"],
      cwd: BuildContextHostPath,
      env: {
        MISTLE_CONFIG_PATH: HostConfigPath,
        MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL: HostDatabaseUrl,
      },
    });
  });
});

describe("system migration command inputs", () => {
  it("creates a command that runs control-plane database migrations against the host database", () => {
    expect(
      createControlPlaneDatabaseMigrationCommandInput({
        buildContextHostPath: BuildContextHostPath,
        configPathInContainer: IntegrationConfigPathInContainer,
        hostDatabaseUrl: HostDatabaseUrl,
      }),
    ).toEqual({
      command: "pnpm",
      args: ["--filter", "@mistle/control-plane-api", "db:migrate"],
      cwd: BuildContextHostPath,
      env: {
        MISTLE_CONFIG_PATH: HostConfigPath,
        MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL: HostDatabaseUrl,
      },
    });
  });

  it("creates a command that runs control-plane workflow migrations against the host database", () => {
    expect(
      createControlPlaneWorkflowMigrationCommandInput({
        buildContextHostPath: BuildContextHostPath,
        configPathInContainer: IntegrationConfigPathInContainer,
        hostDatabaseUrl: HostDatabaseUrl,
      }),
    ).toEqual({
      command: "pnpm",
      args: [
        "--filter",
        "@mistle/control-plane-api",
        "exec",
        "tsx",
        "scripts/run-control-plane-workflow-migrations.ts",
      ],
      cwd: BuildContextHostPath,
      env: {
        MISTLE_CONFIG_PATH: HostConfigPath,
        MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL: HostDatabaseUrl,
        MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL: HostDatabaseUrl,
      },
    });
  });

  it("creates a command that runs data-plane database migrations against the host database", () => {
    expect(
      createDataPlaneDatabaseMigrationCommandInput({
        buildContextHostPath: BuildContextHostPath,
        configPathInContainer: IntegrationConfigPathInContainer,
        hostDatabaseUrl: HostDatabaseUrl,
      }),
    ).toEqual({
      command: "pnpm",
      args: ["--filter", "@mistle/data-plane-api", "db:migrate"],
      cwd: BuildContextHostPath,
      env: {
        MISTLE_CONFIG_PATH: HostConfigPath,
        MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL: HostDatabaseUrl,
      },
    });
  });

  it("creates a command that runs data-plane workflow migrations against the host database", () => {
    expect(
      createDataPlaneWorkflowMigrationCommandInput({
        buildContextHostPath: BuildContextHostPath,
        configPathInContainer: IntegrationConfigPathInContainer,
        hostDatabaseUrl: HostDatabaseUrl,
      }),
    ).toEqual({
      command: "pnpm",
      args: [
        "--filter",
        "@mistle/data-plane-api",
        "exec",
        "tsx",
        "src/scripts/run-data-plane-workflow-migrations.ts",
      ],
      cwd: BuildContextHostPath,
      env: {
        MISTLE_CONFIG_PATH: HostConfigPath,
        MISTLE_POSTGRES_DATA_PLANE_POOLED_URL: HostDatabaseUrl,
        MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL: HostDatabaseUrl,
      },
    });
  });
});
