import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { systemClock, systemSleeper } from "@mistle/time";
import type { StartedNetwork } from "testcontainers";

import { startDockerTargetApp, type StartedWorkspaceApp } from "./shared.js";

const HOST_HEALTHCHECK_POLL_INTERVAL_MS = 100;

export type StartDockerHttpAppInput = {
  buildContextHostPath: string;
  configPathInContainer: string;
  startupTimeoutMs: number;
  cacheBustKey?: string;
  environment: Record<string, string>;
  network?: StartedNetwork;
};

export type DockerHttpAppDefinition = {
  appName: string;
  distEntrypointRelativePath: string;
  dockerfileRelativePath: string;
  dockerTarget: string;
  containerPort: number;
  networkAlias: string;
  healthPath: string;
  hostEnvVar: string;
  portEnvVar: string;
};

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function validatePrebuiltArtifacts(input: {
  buildContextHostPath: string;
  distEntrypointRelativePath: string;
  appName: string;
}): Promise<void> {
  const distEntrypointPath = resolve(input.buildContextHostPath, input.distEntrypointRelativePath);

  let distEntrypointStats;
  try {
    distEntrypointStats = await stat(distEntrypointPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing prebuilt ${input.appName} dist artifacts at ${distEntrypointPath}: ${message}`,
    );
  }

  if (!distEntrypointStats.isFile()) {
    throw new Error(
      `Expected prebuilt ${input.appName} dist entrypoint file at ${distEntrypointPath}.`,
    );
  }
}

async function waitForHostHealthcheck(input: {
  baseUrl: string;
  path: string;
  expectedStatus: number;
  timeoutMs: number;
  appName: string;
}): Promise<void> {
  const deadline = systemClock.nowMs() + input.timeoutMs;
  const url = `${input.baseUrl}${input.path}`;

  while (systemClock.nowMs() < deadline) {
    const response = await fetch(url).catch(() => null);
    if (response?.status === input.expectedStatus) {
      return;
    }

    await systemSleeper.sleep(HOST_HEALTHCHECK_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for ${input.appName} host healthcheck at ${url} within ${input.timeoutMs}ms.`,
  );
}

export async function startDockerHttpApp(
  definition: DockerHttpAppDefinition,
  input: StartDockerHttpAppInput,
): Promise<StartedWorkspaceApp> {
  await validatePrebuiltArtifacts({
    buildContextHostPath: input.buildContextHostPath,
    distEntrypointRelativePath: definition.distEntrypointRelativePath,
    appName: definition.appName,
  });

  const service = await startDockerTargetApp({
    buildContextHostPath: input.buildContextHostPath,
    dockerfileRelativePath: definition.dockerfileRelativePath,
    dockerTarget: definition.dockerTarget,
    startupTimeoutMs: input.startupTimeoutMs,
    containerPort: definition.containerPort,
    networkAlias: definition.networkAlias,
    readiness: {
      kind: "command",
      command: `wget -q -T 2 -O /dev/null http://127.0.0.1:${String(definition.containerPort)}${definition.healthPath}`,
    },
    environment: {
      ...input.environment,
      MISTLE_CONFIG_PATH: input.configPathInContainer,
      [definition.hostEnvVar]: "0.0.0.0",
      [definition.portEnvVar]: String(definition.containerPort),
    },
    ...(input.cacheBustKey === undefined
      ? {}
      : {
          cacheBustKey: input.cacheBustKey,
        }),
    ...(input.network === undefined
      ? {}
      : {
          network: input.network,
        }),
  });

  try {
    await waitForHostHealthcheck({
      baseUrl: service.hostBaseUrl,
      path: definition.healthPath,
      expectedStatus: 200,
      timeoutMs: input.startupTimeoutMs,
      appName: definition.appName,
    });

    return service;
  } catch (hostHealthcheckError) {
    try {
      await service.stop();
    } catch (stopError) {
      throw new AggregateError(
        [normalizeError(hostHealthcheckError), normalizeError(stopError)],
        `${definition.appName} started but failed host healthcheck and failed during shutdown cleanup.`,
      );
    }

    throw hostHealthcheckError;
  }
}
