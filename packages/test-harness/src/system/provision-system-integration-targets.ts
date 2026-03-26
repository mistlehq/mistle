import { isAbsolute, relative, resolve, sep } from "node:path";

const WorkspaceDirInContainer = "/app";

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
}): {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
} {
  return {
    command: "pnpm",
    args: ["--filter", "@mistle/control-plane-api", "integration-targets:sync"],
    cwd: input.buildContextHostPath,
    env: {
      MISTLE_CONFIG_PATH: resolveHostPathFromContainerPath({
        buildContextHostPath: input.buildContextHostPath,
        containerPath: input.configPathInContainer,
      }),
      MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL: input.hostDatabaseUrl,
    },
  };
}
