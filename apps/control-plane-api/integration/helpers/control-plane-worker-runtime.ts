import {
  closeWorkflowContext,
  getWorkflowContext,
} from "../../../control-plane-worker/openworkflow/core/context.js";
import {
  closeOpenWorkflowRuntime,
  getOpenWorkflowRuntime,
} from "../../../control-plane-worker/openworkflow/core/runtime.js";
import type { ControlPlaneApiIntegrationFixture } from "../test-context.js";

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

export function createControlPlaneWorkerEnvironment(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  namespaceId: string;
  overrides?: Record<string, string>;
}): Record<string, string> {
  return {
    NODE_ENV: "development",
    MISTLE_GLOBAL_TELEMETRY_ENABLED: "false",
    MISTLE_GLOBAL_TELEMETRY_DEBUG: "false",
    MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN: input.fixture.internalAuthServiceToken,
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
    MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_SECRET: "integration-egress-token-secret",
    MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_ISSUER: "integration-data-plane-worker",
    MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_AUDIENCE: "integration-tokenizer-proxy",
    MISTLE_GLOBAL_SANDBOX_PUBLISH_BASE_DOMAIN: "mistle.example.test",
    MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET: "integration-publish-token-secret",
    MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER: "control-plane-api",
    MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE: "data-plane-gateway",
    MISTLE_GLOBAL_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET:
      "integration-publish-cookie-secret",
    MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_DATABASE_URL: input.fixture.databaseStack.directUrl,
    MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: input.namespaceId,
    MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "false",
    MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY: "1",
    MISTLE_APPS_CONTROL_PLANE_WORKER_EMAIL_FROM_ADDRESS: "no-reply@mistle.dev",
    MISTLE_APPS_CONTROL_PLANE_WORKER_EMAIL_FROM_NAME: "Mistle",
    MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL:
      input.fixture.config.dataPlaneApi.baseUrl,
    MISTLE_APPS_CONTROL_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL: input.fixture.config.auth.baseUrl,
    ...input.overrides,
  };
}

export async function withControlPlaneWorkerRuntime<T>(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  namespaceId: string;
  environmentOverrides?: Record<string, string>;
  run: (input: {
    runtime: Awaited<ReturnType<typeof getOpenWorkflowRuntime>>;
    workflowContext: Awaited<ReturnType<typeof getWorkflowContext>>;
  }) => Promise<T>;
}): Promise<T> {
  const restoreEnvironment = assignEnvironment({
    MISTLE_CONFIG_PATH: undefined,
    ...createControlPlaneWorkerEnvironment({
      fixture: input.fixture,
      namespaceId: input.namespaceId,
      ...(input.environmentOverrides === undefined
        ? {}
        : { overrides: input.environmentOverrides }),
    }),
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
