import { closeWorkflowContext, getWorkflowContext } from "../openworkflow/core/context.js";
import { closeOpenWorkflowRuntime, getOpenWorkflowRuntime } from "../openworkflow/core/runtime.js";
import type { ControlPlaneWorkerIntegrationFixture } from "./test-context.js";

function assignEnvironment(overrides: Record<string, string | undefined>): () => void {
  const previousEntries: Array<readonly [string, string | undefined]> = Object.entries(
    overrides,
  ).map(([key]) => [key, process.env[key]]);

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }

  return () => {
    for (const [key, value] of previousEntries) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }

      process.env[key] = value;
    }
  };
}

export function createWorkerEnvironment(
  fixture: ControlPlaneWorkerIntegrationFixture,
): Record<string, string> {
  return {
    NODE_ENV: "development",
    MISTLE_GLOBAL_TELEMETRY_ENABLED: "false",
    MISTLE_GLOBAL_TELEMETRY_DEBUG: "false",
    MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN: fixture.internalAuthServiceToken,
    MISTLE_GLOBAL_SANDBOX_PROVIDER: "docker",
    MISTLE_GLOBAL_SANDBOX_DEFAULT_BASE_IMAGE: "mistle/sandbox-base:test",
    MISTLE_GLOBAL_SANDBOX_GATEWAY_WS_URL: "ws://127.0.0.1:8084/tunnel/sandbox",
    MISTLE_GLOBAL_SANDBOX_INTERNAL_GATEWAY_WS_URL: "ws://127.0.0.1:8084/tunnel/sandbox",
    MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_SECRET: "integration-connect-secret",
    MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_ISSUER: "control-plane-api",
    MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_AUDIENCE: "data-plane-gateway",
    MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_SECRET: "integration-bootstrap-secret",
    MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_ISSUER: "data-plane-worker",
    MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_AUDIENCE: "data-plane-gateway",
    MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_DATABASE_URL: fixture.databaseStack.directUrl,
    MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: fixture.config.workflow.namespaceId,
    MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "false",
    MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY: String(
      fixture.config.workflow.concurrency,
    ),
    MISTLE_APPS_CONTROL_PLANE_WORKER_EMAIL_FROM_ADDRESS: fixture.config.email.fromAddress,
    MISTLE_APPS_CONTROL_PLANE_WORKER_EMAIL_FROM_NAME: fixture.config.email.fromName,
    MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_HOST: fixture.config.email.smtpHost,
    MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PORT: String(fixture.config.email.smtpPort),
    MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_SECURE: String(fixture.config.email.smtpSecure),
    MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_USERNAME: fixture.config.email.smtpUsername,
    MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PASSWORD: fixture.config.email.smtpPassword,
    MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL: fixture.config.dataPlaneApi.baseUrl,
    MISTLE_APPS_CONTROL_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL:
      fixture.config.controlPlaneApi.baseUrl,
  };
}

export async function withOpenWorkflowRuntime<T>(input: {
  fixture: ControlPlaneWorkerIntegrationFixture;
  run: (input: {
    workflowContext: Awaited<ReturnType<typeof getWorkflowContext>>;
    runtime: Awaited<ReturnType<typeof getOpenWorkflowRuntime>>;
  }) => Promise<T>;
}): Promise<T> {
  const restoreEnvironment = assignEnvironment({
    MISTLE_CONFIG_PATH: undefined,
    ...createWorkerEnvironment(input.fixture),
  });

  try {
    const runtime = await getOpenWorkflowRuntime();
    const workflowContext = await getWorkflowContext();

    return await input.run({
      runtime,
      workflowContext,
    });
  } finally {
    await closeWorkflowContext();
    await closeOpenWorkflowRuntime();
    restoreEnvironment();
  }
}
