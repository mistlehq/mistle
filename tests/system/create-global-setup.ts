import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SHARED_SYSTEM_INFRA_KEY,
  DockerIntegrationConfigPathInContainer,
  E2BIntegrationConfigPathInContainer,
  removeTestContext,
  startOtlpReceiver,
  startFullSystemEnvironment,
  writeTestContext,
} from "@mistle/test-harness";

const PROJECT_ROOT_HOST_PATH = fileURLToPath(new URL("../..", import.meta.url));
const APP_STARTUP_TIMEOUT_MS = 120_000;
const AUTH_ORIGIN = "http://localhost:5100";
const INTERNAL_AUTH_SERVICE_TOKEN = "system-internal-service-token";
const DATA_PLANE_GATEWAY_IDLE_TIMEOUT_MS = 20_000;
const DATA_PLANE_GATEWAY_BOOTSTRAP_DISCONNECT_GRACE_MS = 8_000;
const SANDBOXD_TEST_FAULTS_ENABLED_ENV =
  "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_SANDBOXD_TEST_FAULTS_ENABLED";
const CloudflareTunnelTokenEnvVar = "CLOUDFLARE_TUNNEL_TOKEN";
const DataPlaneGatewayTunnelHostnameEnvVar = "DATA_PLANE_API_TUNNEL_HOSTNAME";
const TestContextId = "system";
const SystemSandboxProvider = {
  DOCKER: "docker",
  E2B: "e2b",
} as const;

type SystemSandboxProvider = (typeof SystemSandboxProvider)[keyof typeof SystemSandboxProvider];

function readSystemSandboxProvider(): SystemSandboxProvider {
  const rawProvider =
    process.env.MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER ?? SystemSandboxProvider.DOCKER;

  if (rawProvider === SystemSandboxProvider.DOCKER || rawProvider === SystemSandboxProvider.E2B) {
    return rawProvider;
  }

  throw new Error(
    `Unsupported MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER '${rawProvider}'. Expected 'docker' or 'e2b'.`,
  );
}

function resolveConfigPathInContainer(provider: SystemSandboxProvider): string {
  if (provider === SystemSandboxProvider.DOCKER) {
    return DockerIntegrationConfigPathInContainer;
  }

  return E2BIntegrationConfigPathInContainer;
}

function readRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required for this system test environment.`);
  }

  return value;
}

function resolveSandboxPublicGatewayTunnel(input: { provider: SystemSandboxProvider }):
  | {
      cloudflareTunnelToken: string;
      publicHostname: string;
    }
  | undefined {
  if (input.provider !== SystemSandboxProvider.E2B) {
    return undefined;
  }

  return {
    cloudflareTunnelToken: readRequiredEnvVar(CloudflareTunnelTokenEnvVar),
    publicHostname: readRequiredEnvVar(DataPlaneGatewayTunnelHostnameEnvVar),
  };
}

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

function readGatewayLifecycleOrThrow(input: {
  environment: Awaited<ReturnType<typeof startFullSystemEnvironment>>;
}): {
  idleTimeoutMs: number;
  bootstrapDisconnectGraceMs: number;
} {
  const lifecycle = input.environment.dataPlaneGatewayLifecycle;
  if (lifecycle === undefined) {
    throw new Error(
      "Expected full system environment to expose data-plane-gateway lifecycle values.",
    );
  }

  return lifecycle;
}

export function createSystemGlobalSetup(): () => Promise<() => Promise<void>> {
  return async function setup(): Promise<() => Promise<void>> {
    const sandboxProvider = readSystemSandboxProvider();
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
      configPathInContainer: resolveConfigPathInContainer(sandboxProvider),
      sandboxProvider,
      sandboxPublicGatewayTunnel: resolveSandboxPublicGatewayTunnel({
        provider: sandboxProvider,
      }),
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
      dataPlaneGatewayEnvironment: {
        ...telemetryEnvironmentOverrides,
        MISTLE_APPS_DATA_PLANE_GATEWAY_LIFECYCLE_IDLE_TIMEOUT_MS: String(
          DATA_PLANE_GATEWAY_IDLE_TIMEOUT_MS,
        ),
        MISTLE_APPS_DATA_PLANE_GATEWAY_LIFECYCLE_BOOTSTRAP_DISCONNECT_GRACE_MS: String(
          DATA_PLANE_GATEWAY_BOOTSTRAP_DISCONNECT_GRACE_MS,
        ),
      },
      dataPlaneWorkerEnvironment: {
        ...telemetryEnvironmentOverrides,
        [SANDBOXD_TEST_FAULTS_ENABLED_ENV]: "true",
      },
      tokenizerProxyEnvironment: telemetryEnvironmentOverrides,
    });

    try {
      const gatewayLifecycle = readGatewayLifecycleOrThrow({
        environment,
      });

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
          sandboxProvider,
          internalAuthServiceToken: INTERNAL_AUTH_SERVICE_TOKEN,
          otlpTraceCaptureFilePath,
          sandboxNetworkName: environment.sandboxNetworkName,
          dataPlaneGatewayIdleTimeoutMs: gatewayLifecycle.idleTimeoutMs,
          dataPlaneGatewayBootstrapDisconnectGraceMs: gatewayLifecycle.bootstrapDisconnectGraceMs,
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
