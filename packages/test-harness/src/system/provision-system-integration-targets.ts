import { isAbsolute, relative, resolve, sep } from "node:path";

const WorkspaceDirInContainer = "/app";

type SystemCommandInput = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};

export function resolveHostPathFromContainerPath(input: {
  buildContextHostPath: string;
  containerPath: string;
}): string {
  if (!isAbsolute(input.containerPath)) {
    throw new Error("containerPath must be an absolute path.");
  }

  const relativePath = relative(WorkspaceDirInContainer, input.containerPath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new Error("containerPath must stay within the mounted /app workspace.");
  }

  return resolve(input.buildContextHostPath, relativePath);
}

export function createControlPlaneIntegrationTargetsSyncCommandInput(input: {
  buildContextHostPath: string;
  configPathInContainer: string;
  hostDatabaseUrl: string;
}): SystemCommandInput {
  return {
    command: "pnpm",
    args: ["--filter", "@mistle/control-plane-api", "integration-targets:sync"],
    cwd: input.buildContextHostPath,
    env: {
      ...createConfigPathEnv(input),
      MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL: input.hostDatabaseUrl,
    },
  };
}

export function createControlPlaneDatabaseMigrationCommandInput(input: {
  buildContextHostPath: string;
  configPathInContainer: string;
  hostDatabaseUrl: string;
}): SystemCommandInput {
  return {
    command: "pnpm",
    args: ["--filter", "@mistle/control-plane-api", "db:migrate"],
    cwd: input.buildContextHostPath,
    env: {
      ...createConfigPathEnv(input),
      MISTLE_APPS_CONTROL_PLANE_API_DATABASE_MIGRATION_URL: input.hostDatabaseUrl,
    },
  };
}

export function createControlPlaneWorkflowMigrationCommandInput(input: {
  buildContextHostPath: string;
  configPathInContainer: string;
  hostDatabaseUrl: string;
}): SystemCommandInput {
  return {
    command: "pnpm",
    args: [
      "--filter",
      "@mistle/control-plane-api",
      "exec",
      "tsx",
      "scripts/run-control-plane-workflow-migrations.ts",
    ],
    cwd: input.buildContextHostPath,
    env: {
      ...createConfigPathEnv(input),
      MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_DATABASE_URL: input.hostDatabaseUrl,
    },
  };
}

export function createDataPlaneDatabaseMigrationCommandInput(input: {
  buildContextHostPath: string;
  configPathInContainer: string;
  hostDatabaseUrl: string;
}): SystemCommandInput {
  return {
    command: "pnpm",
    args: ["--filter", "@mistle/data-plane-api", "db:migrate"],
    cwd: input.buildContextHostPath,
    env: {
      ...createConfigPathEnv(input),
      MISTLE_APPS_DATA_PLANE_API_DATABASE_MIGRATION_URL: input.hostDatabaseUrl,
    },
  };
}

export function createDataPlaneWorkflowMigrationCommandInput(input: {
  buildContextHostPath: string;
  configPathInContainer: string;
  hostDatabaseUrl: string;
}): SystemCommandInput {
  return {
    command: "pnpm",
    args: [
      "--filter",
      "@mistle/data-plane-api",
      "exec",
      "tsx",
      "src/scripts/run-data-plane-workflow-migrations.ts",
    ],
    cwd: input.buildContextHostPath,
    env: {
      ...createConfigPathEnv(input),
      MISTLE_APPS_DATA_PLANE_API_WORKFLOW_DATABASE_URL: input.hostDatabaseUrl,
    },
  };
}

function createConfigPathEnv(input: {
  buildContextHostPath: string;
  configPathInContainer: string;
}): { MISTLE_CONFIG_PATH: string } {
  return {
    MISTLE_CONFIG_PATH: resolveHostPathFromContainerPath({
      buildContextHostPath: input.buildContextHostPath,
      containerPath: input.configPathInContainer,
    }),
  };
}
