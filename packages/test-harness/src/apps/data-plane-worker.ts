import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { createDefaultTelemetryEnvironment } from "./http-app.js";
import {
  startDockerTargetApp,
  type StartDockerTargetAppInput,
  type StartedWorkspaceApp,
} from "./shared.js";

const DataPlaneWorkerDefinition = {
  appName: "data-plane-worker",
  dockerfileRelativePath: "Dockerfile.test",
  dockerTarget: "data-plane-worker-test-runtime",
  networkAlias: "data-plane-worker",
  containerPort: 5201,
  openWorkflowConfigRelativePath: "apps/data-plane-worker/dist/openworkflow.config.js",
} as const;
const DockerSocketPath = "/var/run/docker.sock";

export type StartDataPlaneWorkerInput = {
  buildContextHostPath: string;
  configPathInContainer: string;
  startupTimeoutMs: number;
  cacheBustKey?: string;
  prebuiltImageName?: string;
  environment: Record<string, string>;
  bindMounts?: StartDockerTargetAppInput["bindMounts"];
  network?: StartDockerTargetAppInput["network"];
};
export type DataPlaneWorkerService = StartedWorkspaceApp;

async function validatePrebuiltWorkerArtifacts(buildContextHostPath: string): Promise<void> {
  const openWorkflowConfigPath = resolve(
    buildContextHostPath,
    DataPlaneWorkerDefinition.openWorkflowConfigRelativePath,
  );

  let openWorkflowConfigStats;
  try {
    openWorkflowConfigStats = await stat(openWorkflowConfigPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing prebuilt data-plane-worker OpenWorkflow config at ${openWorkflowConfigPath}: ${message}`,
    );
  }

  if (!openWorkflowConfigStats.isFile()) {
    throw new Error(
      `Expected prebuilt data-plane-worker OpenWorkflow config file at ${openWorkflowConfigPath}.`,
    );
  }
}

export async function startDataPlaneWorker(
  input: StartDataPlaneWorkerInput,
): Promise<DataPlaneWorkerService> {
  await validatePrebuiltWorkerArtifacts(input.buildContextHostPath);

  return startDockerTargetApp({
    buildContextHostPath: input.buildContextHostPath,
    dockerfileRelativePath: DataPlaneWorkerDefinition.dockerfileRelativePath,
    dockerTarget: DataPlaneWorkerDefinition.dockerTarget,
    startupTimeoutMs: input.startupTimeoutMs,
    containerPort: DataPlaneWorkerDefinition.containerPort,
    networkAlias: DataPlaneWorkerDefinition.networkAlias,
    readiness: {
      kind: "log",
      pattern: /Worker started\./u,
      times: 1,
    },
    environment: {
      ...createDefaultTelemetryEnvironment(),
      ...input.environment,
      MISTLE_CONFIG_PATH: input.configPathInContainer,
    },
    ...(input.cacheBustKey === undefined
      ? {}
      : {
          cacheBustKey: input.cacheBustKey,
        }),
    ...(input.prebuiltImageName === undefined
      ? {}
      : {
          prebuiltImageName: input.prebuiltImageName,
        }),
    ...(input.network === undefined
      ? {}
      : {
          network: input.network,
        }),
    bindMounts: [
      {
        source: DockerSocketPath,
        target: DockerSocketPath,
        mode: "rw",
      },
      ...(input.bindMounts ?? []),
    ],
  });
}
