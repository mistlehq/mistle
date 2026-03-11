import type { StartedNetwork } from "testcontainers";

import { startDockerTargetApp, type StartedWorkspaceApp } from "./shared.js";

const DockerSocketPath = "/var/run/docker.sock";

const DEFAULT_DOCKER_TEST_OTLP_TRACES_ENDPOINT =
  "http://host.testcontainers.internal:4318/v1/traces";
const DEFAULT_DOCKER_TEST_OTLP_LOGS_ENDPOINT = "http://host.testcontainers.internal:4318/v1/logs";
const DEFAULT_DOCKER_TEST_OTLP_METRICS_ENDPOINT =
  "http://host.testcontainers.internal:4318/v1/metrics";
const DEFAULT_DOCKER_TEST_RESOURCE_ATTRIBUTES = "deployment.environment=test";

function createDefaultTelemetryEnvironment(): Record<string, string> {
  return {
    MISTLE_GLOBAL_TELEMETRY_ENABLED: process.env.MISTLE_GLOBAL_TELEMETRY_ENABLED ?? "true",
    MISTLE_GLOBAL_TELEMETRY_DEBUG: process.env.MISTLE_GLOBAL_TELEMETRY_DEBUG ?? "false",
    MISTLE_GLOBAL_TELEMETRY_TRACES_ENDPOINT:
      process.env.MISTLE_GLOBAL_TELEMETRY_TRACES_ENDPOINT ??
      DEFAULT_DOCKER_TEST_OTLP_TRACES_ENDPOINT,
    MISTLE_GLOBAL_TELEMETRY_LOGS_ENDPOINT:
      process.env.MISTLE_GLOBAL_TELEMETRY_LOGS_ENDPOINT ?? DEFAULT_DOCKER_TEST_OTLP_LOGS_ENDPOINT,
    MISTLE_GLOBAL_TELEMETRY_METRICS_ENDPOINT:
      process.env.MISTLE_GLOBAL_TELEMETRY_METRICS_ENDPOINT ??
      DEFAULT_DOCKER_TEST_OTLP_METRICS_ENDPOINT,
    MISTLE_GLOBAL_TELEMETRY_RESOURCE_ATTRIBUTES:
      process.env.MISTLE_GLOBAL_TELEMETRY_RESOURCE_ATTRIBUTES ??
      DEFAULT_DOCKER_TEST_RESOURCE_ATTRIBUTES,
  };
}

export type StartDataPlaneWorkerInput = {
  buildContextHostPath: string;
  configPathInContainer: string;
  startupTimeoutMs: number;
  cacheBustKey?: string;
  environment: Record<string, string>;
  network?: StartedNetwork;
};
export type DataPlaneWorkerService = StartedWorkspaceApp;

export async function startDataPlaneWorker(
  input: StartDataPlaneWorkerInput,
): Promise<DataPlaneWorkerService> {
  return startDockerTargetApp({
    buildContextHostPath: input.buildContextHostPath,
    dockerfileRelativePath: "Dockerfile.test",
    dockerTarget: "data-plane-worker-test-runtime",
    startupTimeoutMs: input.startupTimeoutMs,
    containerPort: 5201,
    networkAlias: "data-plane-worker",
    readiness: {
      kind: "log",
      pattern: /Worker started\./,
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
    ],
  });
}
