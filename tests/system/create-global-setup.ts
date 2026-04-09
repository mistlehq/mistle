import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SHARED_SYSTEM_INFRA_KEY,
  DockerIntegrationConfigPathInContainer,
  removeTestContext,
  startOtlpReceiver,
  startFullSystemEnvironment,
  writeTestContext,
} from "@mistle/test-harness";

const PROJECT_ROOT_HOST_PATH = fileURLToPath(new URL("../..", import.meta.url));
const CONFIG_PATH_IN_CONTAINER = DockerIntegrationConfigPathInContainer;
const APP_STARTUP_TIMEOUT_MS = 120_000;
const AUTH_ORIGIN = "http://localhost:5100";
const INTERNAL_AUTH_SERVICE_TOKEN = "system-internal-service-token";
const TestContextId = "system";

function createTelemetryEnvironmentOverrides(input: {
  tracesEndpoint: string;
  logsEndpoint: string;
  metricsEndpoint: string;
}): Record<string, string> {
  return {
    MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN: INTERNAL_AUTH_SERVICE_TOKEN,
    MISTLE_GLOBAL_TELEMETRY_ENABLED: "true",
    MISTLE_GLOBAL_TELEMETRY_DEBUG: "false",
    MISTLE_GLOBAL_TELEMETRY_TRACES_ENDPOINT: input.tracesEndpoint,
    MISTLE_GLOBAL_TELEMETRY_LOGS_ENDPOINT: input.logsEndpoint,
    MISTLE_GLOBAL_TELEMETRY_METRICS_ENDPOINT: input.metricsEndpoint,
  };
}

export function createSystemGlobalSetup(): () => Promise<() => Promise<void>> {
  return async function setup(): Promise<() => Promise<void>> {
    const otlpTraceCaptureFilePath = join(
      tmpdir(),
      `mistle-system-otlp-${randomUUID().replaceAll("-", "")}.jsonl`,
    );
    const otlpReceiver = await startOtlpReceiver({
      captureFilePath: otlpTraceCaptureFilePath,
      host: "0.0.0.0",
    });
    const telemetryEnvironmentOverrides = createTelemetryEnvironmentOverrides({
      tracesEndpoint: `http://host.testcontainers.internal:${String(otlpReceiver.port)}/v1/traces`,
      logsEndpoint: `http://host.testcontainers.internal:${String(otlpReceiver.port)}/v1/logs`,
      metricsEndpoint: `http://host.testcontainers.internal:${String(otlpReceiver.port)}/v1/metrics`,
    });
    const environment = await startFullSystemEnvironment({
      buildContextHostPath: PROJECT_ROOT_HOST_PATH,
      configPathInContainer: CONFIG_PATH_IN_CONTAINER,
      startupTimeoutMs: APP_STARTUP_TIMEOUT_MS,
      sharedInfraKey: DEFAULT_SHARED_SYSTEM_INFRA_KEY,
      postgres: {},
      controlPlaneWorkflowNamespaceId: `system_cp_${randomUUID().replaceAll("-", "_")}`,
      dataPlaneWorkflowNamespaceId: `system_dp_${randomUUID().replaceAll("-", "_")}`,
      authBaseUrl: AUTH_ORIGIN,
      dashboardBaseUrl: "http://localhost:5173",
      authTrustedOrigins:
        "http://localhost:5100,http://127.0.0.1:5100,http://localhost:5173,http://127.0.0.1:5173",
      controlPlaneApiEnvironment: telemetryEnvironmentOverrides,
      controlPlaneWorkerEnvironment: telemetryEnvironmentOverrides,
      dataPlaneApiEnvironment: telemetryEnvironmentOverrides,
      dataPlaneWorkerEnvironment: telemetryEnvironmentOverrides,
      dataPlaneGatewayEnvironment: telemetryEnvironmentOverrides,
      tokenizerProxyEnvironment: telemetryEnvironmentOverrides,
    });

    try {
      await writeTestContext({
        id: TestContextId,
        value: {
          controlPlaneApiBaseUrl: environment.controlPlaneApi.hostBaseUrl,
          controlPlaneApiContainerId: environment.controlPlaneApi.containerId,
          controlPlaneWorkerBaseUrl: environment.controlPlaneWorker.hostBaseUrl,
          controlPlaneWorkerContainerId: environment.controlPlaneWorker.containerId,
          dataPlaneApiBaseUrl: environment.dataPlaneApi.hostBaseUrl,
          dataPlaneApiContainerId: environment.dataPlaneApi.containerId,
          dataPlaneWorkerBaseUrl: environment.dataPlaneWorker.hostBaseUrl,
          dataPlaneWorkerContainerId: environment.dataPlaneWorker.containerId,
          dataPlaneGatewayBaseUrl: environment.dataPlaneGateway.hostBaseUrl,
          dataPlaneGatewayContainerId: environment.dataPlaneGateway.containerId,
          tokenizerProxyBaseUrl: environment.tokenizerProxy.hostBaseUrl,
          tokenizerProxyContainerId: environment.tokenizerProxy.containerId,
          mailpitHttpBaseUrl: environment.mailpit.httpBaseUrl,
          controlPlaneDatabaseUrl: environment.database.hostDatabaseUrl,
          internalAuthServiceToken: INTERNAL_AUTH_SERVICE_TOKEN,
          otlpTraceCaptureFilePath,
          sandboxNetworkName: environment.sandboxNetworkName,
        },
      });
    } catch (error) {
      await otlpReceiver.close();
      await rm(otlpTraceCaptureFilePath, { force: true });
      await removeTestContext(TestContextId);
      await environment.stop();
      throw error;
    }

    return async () => {
      await removeTestContext(TestContextId);
      await environment.stop();
      await otlpReceiver.close();
      await rm(otlpTraceCaptureFilePath, { force: true });
    };
  };
}
