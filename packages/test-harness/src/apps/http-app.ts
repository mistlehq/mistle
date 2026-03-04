import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { systemClock, systemScheduler, systemSleeper } from "@mistle/time";
import type { StartedNetwork } from "testcontainers";

import {
  startDockerTargetApp,
  type StartDockerTargetAppInput,
  type StartedWorkspaceApp,
} from "./shared.js";

const HOST_HEALTHCHECK_POLL_INTERVAL_MS = 100;
const HOST_HEALTHCHECK_REQUEST_TIMEOUT_MS = 2_000;
const TRACE_HTTP_APP_STARTUP = process.env.MISTLE_TEST_HARNESS_TRACE === "1";

export type StartDockerHttpAppInput = {
  buildContextHostPath: string;
  configPathInContainer: string;
  startupTimeoutMs: number;
  cacheBustKey?: string;
  environment: Record<string, string>;
  bindMounts?: StartDockerTargetAppInput["bindMounts"];
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

function traceHttpAppStartup(message: string): void {
  if (!TRACE_HTTP_APP_STARTUP) {
    return;
  }

  console.info(`[test-harness:http-app] ${message}`);
}

async function fetchHealthcheckStatus(url: string): Promise<number | undefined> {
  const controller = new AbortController();
  const timeout = systemScheduler.schedule(() => {
    controller.abort();
  }, HOST_HEALTHCHECK_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });
    return response.status;
  } catch {
    return undefined;
  } finally {
    systemScheduler.cancel(timeout);
  }
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
  let attempts = 0;

  while (systemClock.nowMs() < deadline) {
    attempts += 1;
    const attemptStartedAt = systemClock.nowMs();
    const status = await fetchHealthcheckStatus(url);

    traceHttpAppStartup(
      `${input.appName} host healthcheck attempt ${String(attempts)} status=${String(status ?? "unreachable")} durationMs=${String(systemClock.nowMs() - attemptStartedAt)}`,
    );

    if (status === input.expectedStatus) {
      traceHttpAppStartup(
        `${input.appName} host healthcheck became ready after ${String(attempts)} attempts`,
      );
      return;
    }

    await systemSleeper.sleep(HOST_HEALTHCHECK_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for ${input.appName} host healthcheck at ${url} within ${input.timeoutMs}ms after ${String(attempts)} attempts.`,
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
    ...(input.bindMounts === undefined
      ? {}
      : {
          bindMounts: input.bindMounts,
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
