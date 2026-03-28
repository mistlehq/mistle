import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { createDefaultTelemetryEnvironment } from "./http-app.js";
import {
  startDockerTargetApp,
  type StartDockerTargetAppInput,
  type StartedWorkspaceApp,
} from "./shared.js";

const ControlPlaneWorkerDefinition = {
  appName: "control-plane-worker",
  dockerfileRelativePath: "Dockerfile.test",
  dockerTarget: "control-plane-worker-test-runtime",
  networkAlias: "control-plane-worker",
  containerPort: 5101,
  openWorkflowConfigRelativePath: "apps/control-plane-worker/dist/openworkflow.config.js",
} as const;

export type StartControlPlaneWorkerInput = {
  buildContextHostPath: string;
  configPathInContainer: string;
  startupTimeoutMs: number;
  cacheBustKey?: string;
  prebuiltImageName?: string;
  environment: Record<string, string>;
  bindMounts?: StartDockerTargetAppInput["bindMounts"];
  network?: StartDockerTargetAppInput["network"];
};
export type ControlPlaneWorkerService = StartedWorkspaceApp;

async function validatePrebuiltWorkerArtifacts(buildContextHostPath: string): Promise<void> {
  const openWorkflowConfigPath = resolve(
    buildContextHostPath,
    ControlPlaneWorkerDefinition.openWorkflowConfigRelativePath,
  );

  let openWorkflowConfigStats;
  try {
    openWorkflowConfigStats = await stat(openWorkflowConfigPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing prebuilt control-plane-worker OpenWorkflow config at ${openWorkflowConfigPath}: ${message}`,
    );
  }

  if (!openWorkflowConfigStats.isFile()) {
    throw new Error(
      `Expected prebuilt control-plane-worker OpenWorkflow config file at ${openWorkflowConfigPath}.`,
    );
  }
}

export async function startControlPlaneWorker(
  input: StartControlPlaneWorkerInput,
): Promise<ControlPlaneWorkerService> {
  await validatePrebuiltWorkerArtifacts(input.buildContextHostPath);

  return startDockerTargetApp({
    buildContextHostPath: input.buildContextHostPath,
    dockerfileRelativePath: ControlPlaneWorkerDefinition.dockerfileRelativePath,
    dockerTarget: ControlPlaneWorkerDefinition.dockerTarget,
    startupTimeoutMs: input.startupTimeoutMs,
    containerPort: ControlPlaneWorkerDefinition.containerPort,
    networkAlias: ControlPlaneWorkerDefinition.networkAlias,
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
    ...(input.bindMounts === undefined
      ? {}
      : {
          bindMounts: input.bindMounts,
        }),
    ...(input.network === undefined
      ? {}
      : {
          network: input.network,
        }),
  });
}
