import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SHARED_SYSTEM_INFRA_KEY,
  IntegrationConfigPathInContainer,
  readTestContext,
  removeTestContext,
  startOtlpReceiver,
  startFullSystemEnvironment,
  writeTestContext,
} from "@mistle/test-harness";

import { updateGitHubAppWebhookConfig } from "./helpers/github-app-installation.js";
import {
  SharedGitHubWebhookHarnessContextId,
  SharedGitHubWebhookHarnessContextSchema,
} from "./helpers/github-webhook-trigger.js";

const PROJECT_ROOT_HOST_PATH = fileURLToPath(new URL("../..", import.meta.url));
const APP_STARTUP_TIMEOUT_MS = 120_000;
const AUTH_ORIGIN = "http://localhost:5100";
const INTERNAL_AUTH_SERVICE_TOKEN = "system-internal-service-token";
const SANDBOXD_TEST_FAULTS_ENABLED_ENV = "MISTLE_TEST_SANDBOXD_TEST_FAULTS_ENABLED";
const CloudflareTunnelIdEnvVar = "CLOUDFLARE_TUNNEL_ID";
const CloudflareTunnelCredentialsJsonEnvVar = "CLOUDFLARE_TUNNEL_CREDENTIALS_JSON";
const DataPlaneGatewayTunnelHostnameEnvVar = "DATA_PLANE_API_TUNNEL_HOSTNAME";
const ControlPlaneApiTunnelHostnameEnvVar = "CONTROL_PLANE_API_TUNNEL_HOSTNAME";
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

function readRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required for this system test environment.`);
  }

  return value;
}

function readOptionalEnvVar(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function resolveSandboxPublicGatewayTunnel(input: { provider: SystemSandboxProvider }):
  | {
      tunnelId: string;
      tunnelCredentialsJson: string;
      publicHostname: string;
    }
  | undefined {
  if (input.provider !== SystemSandboxProvider.E2B) {
    return undefined;
  }

  return {
    tunnelId: readRequiredEnvVar(CloudflareTunnelIdEnvVar),
    tunnelCredentialsJson: readRequiredEnvVar(CloudflareTunnelCredentialsJsonEnvVar),
    publicHostname: readRequiredEnvVar(DataPlaneGatewayTunnelHostnameEnvVar),
  };
}

function resolveSharedControlPlaneTunnel():
  | {
      tunnelId: string;
      tunnelCredentialsJson: string;
      publicHostname: string;
    }
  | undefined {
  const tunnelId = readOptionalEnvVar(CloudflareTunnelIdEnvVar);
  const tunnelCredentialsJson = readOptionalEnvVar(CloudflareTunnelCredentialsJsonEnvVar);
  const publicHostname = readOptionalEnvVar(ControlPlaneApiTunnelHostnameEnvVar);

  const configuredValues = [tunnelId, tunnelCredentialsJson, publicHostname].filter(
    (value): value is string => value !== undefined,
  );

  if (configuredValues.length === 0) {
    return undefined;
  }

  if (tunnelId === undefined) {
    throw new Error(
      `${CloudflareTunnelIdEnvVar} is required when enabling the shared control-plane tunnel.`,
    );
  }

  if (tunnelCredentialsJson === undefined) {
    throw new Error(
      `${CloudflareTunnelCredentialsJsonEnvVar} is required when enabling the shared control-plane tunnel.`,
    );
  }

  if (publicHostname === undefined) {
    throw new Error(
      `${ControlPlaneApiTunnelHostnameEnvVar} is required when enabling the shared control-plane tunnel.`,
    );
  }

  return {
    tunnelId,
    tunnelCredentialsJson,
    publicHostname,
  };
}

function createTelemetryEnvironmentOverrides(input: {
  tracesEndpoint: string;
  logsEndpoint: string;
  metricsEndpoint: string;
}): Record<string, string> {
  return {
    MISTLE_INTERNAL_AUTH_SHARED_TOKEN: INTERNAL_AUTH_SERVICE_TOKEN,
    MISTLE_TELEMETRY_ENABLED: "true",
    MISTLE_TELEMETRY_DEBUG: "false",
    MISTLE_TELEMETRY_TRACES_ENDPOINT: input.tracesEndpoint,
    MISTLE_TELEMETRY_LOGS_ENDPOINT: input.logsEndpoint,
    MISTLE_TELEMETRY_METRICS_ENDPOINT: input.metricsEndpoint,
  };
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
      configPathInContainer: IntegrationConfigPathInContainer,
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
      dataPlaneGatewayEnvironment: telemetryEnvironmentOverrides,
      dataPlaneWorkerEnvironment: {
        ...telemetryEnvironmentOverrides,
        [SANDBOXD_TEST_FAULTS_ENABLED_ENV]: "true",
      },
      sharedControlPlaneTunnel: resolveSharedControlPlaneTunnel(),
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
          mailpitHttpBaseUrl: environment.mailpit.httpBaseUrl,
          controlPlaneDatabaseUrl: environment.database.hostDatabaseUrl,
          sandboxProvider,
          internalAuthServiceToken: INTERNAL_AUTH_SERVICE_TOKEN,
          otlpTraceCaptureFilePath,
          sandboxNetworkName: environment.sandboxNetworkName,
          dataPlaneGatewayIdleTimeoutMs: environment.dataPlaneGatewayLifecycle.idleTimeoutMs,
          dataPlaneGatewayBootstrapDisconnectGraceMs:
            environment.dataPlaneGatewayLifecycle.bootstrapDisconnectGraceMs,
        },
      });
    } catch (error) {
      await removeTestContext(SharedGitHubWebhookHarnessContextId).catch(() => undefined);
      await otlpReceiver.close();
      await rm(otlpTraceCaptureFilePath, { force: true });
      await removeTestContext(TestContextId);
      await environment.stop();
      throw error;
    }

    return async () => {
      const sharedGitHubWebhookHarness = await readTestContext({
        id: SharedGitHubWebhookHarnessContextId,
        schema: SharedGitHubWebhookHarnessContextSchema,
      }).catch(() => null);

      if (sharedGitHubWebhookHarness !== null) {
        await updateGitHubAppWebhookConfig({
          url: sharedGitHubWebhookHarness.originalWebhookConfig.url,
          ...(sharedGitHubWebhookHarness.originalWebhookConfig.contentType === undefined
            ? {}
            : { contentType: sharedGitHubWebhookHarness.originalWebhookConfig.contentType }),
          ...(sharedGitHubWebhookHarness.originalWebhookConfig.insecureSsl === undefined
            ? {}
            : { insecureSsl: sharedGitHubWebhookHarness.originalWebhookConfig.insecureSsl }),
        }).catch(() => undefined);
      }

      await removeTestContext(SharedGitHubWebhookHarnessContextId).catch(() => undefined);
      await removeTestContext(TestContextId);
      await environment.stop();
      await otlpReceiver.close();
      await rm(otlpTraceCaptureFilePath, { force: true });
    };
  };
}
