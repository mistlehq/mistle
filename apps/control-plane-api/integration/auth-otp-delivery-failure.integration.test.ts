import { randomUUID } from "node:crypto";

import { reserveAvailablePort } from "@mistle/test-harness";
import { systemSleeper } from "@mistle/time";
import { SendVerificationOTPWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { describe, expect } from "vitest";

import {
  closeWorkflowContext,
  getWorkflowContext,
} from "../../control-plane-worker/openworkflow/core/context.js";
import {
  closeOpenWorkflowRuntime,
  getOpenWorkflowRuntime,
} from "../../control-plane-worker/openworkflow/core/runtime.js";
import { SendVerificationOTPWorkflow } from "../../control-plane-worker/openworkflow/send-verification-otp.js";
import { createControlPlaneApiRuntime } from "../src/main.js";
import type { ControlPlaneApiConfig } from "../src/types.js";
import { IntegrationPortAccessConfig } from "./helpers/port-access-config.js";
import { countControlPlaneWorkflowRuns } from "./helpers/workflow-runs.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";
import { it } from "./test-context.js";

const IntegrationConnectionTokenConfig = {
  secret: "integration-connection-secret",
  issuer: "integration-issuer",
  audience: "integration-audience",
} as const;

const IntegrationSandboxRuntimeConfig = {
  defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
  gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
} as const;

function createRuntimeConfigWithWorkflowNamespace(input: {
  config: ControlPlaneApiConfig;
  namespaceId: string;
}): ControlPlaneApiConfig {
  return {
    ...input.config,
    workflow: {
      ...input.config.workflow,
      namespaceId: input.namespaceId,
    },
  };
}

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

function createBrokenSmtpWorkerEnvironment(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  namespaceId: string;
  smtpPort: number;
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
    MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_HOST: "127.0.0.1",
    MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PORT: String(input.smtpPort),
    MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_SECURE: "false",
    MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_USERNAME: "mailpit",
    MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PASSWORD: "mailpit",
    MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL:
      input.fixture.config.dataPlaneApi.baseUrl,
    MISTLE_APPS_CONTROL_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL: input.fixture.config.auth.baseUrl,
  };
}

async function sendOTPRequest(input: {
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
  recipient: string;
}): Promise<Response> {
  return input.request("/v1/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: input.recipient,
      type: "sign-in",
    }),
  });
}

describe("auth otp delivery failure integration", () => {
  it("still enqueues OTP delivery when the email cannot be sent", async ({ fixture }) => {
    const namespaceId = `auth_otp_delivery_failure_${randomUUID().replaceAll("-", "_")}`;
    const smtpPort = await reserveAvailablePort({ host: "127.0.0.1" });
    const recipient = `integration-auth-otp-delivery-failure-${randomUUID()}@example.com`;
    const workflowRunCountBefore = await countControlPlaneWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      namespaceId,
      workflowName: SendVerificationOTPWorkflowSpec.name,
      inputEquals: {
        email: recipient,
        type: "sign-in",
      },
    });
    const runtime = await createControlPlaneApiRuntime({
      app: createRuntimeConfigWithWorkflowNamespace({
        config: fixture.config,
        namespaceId,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: IntegrationConnectionTokenConfig,
      portAccess: IntegrationPortAccessConfig,
      sandbox: IntegrationSandboxRuntimeConfig,
    });
    const restoreEnvironment = assignEnvironment({
      MISTLE_CONFIG_PATH: undefined,
      ...createBrokenSmtpWorkerEnvironment({
        fixture,
        namespaceId,
        smtpPort,
      }),
    });
    try {
      await getOpenWorkflowRuntime();
      const workflowContext = await getWorkflowContext();
      workflowContext.openWorkflow.implementWorkflow(
        SendVerificationOTPWorkflow.spec,
        SendVerificationOTPWorkflow.fn,
      );
      const worker = workflowContext.openWorkflow.newWorker({
        concurrency: 1,
      });
      let stopTicking = false;

      try {
        const tickUntilStopped = (async () => {
          while (!stopTicking) {
            const processedRunCount = await worker.tick();
            if (processedRunCount === 0) {
              await systemSleeper.sleep(10);
            }
          }
        })();

        const response = await sendOTPRequest({
          request: runtime.request,
          recipient,
        });

        await systemSleeper.sleep(250);

        stopTicking = true;
        await tickUntilStopped;

        expect(response.status).toBe(200);

        const workflowRunCountAfter = await countControlPlaneWorkflowRuns({
          databaseUrl: fixture.databaseStack.directUrl,
          namespaceId,
          workflowName: SendVerificationOTPWorkflowSpec.name,
          inputEquals: {
            email: recipient,
            type: "sign-in",
          },
        });
        expect(workflowRunCountAfter).toBe(workflowRunCountBefore + 1);
      } finally {
        stopTicking = true;
        await worker.stop();
      }
    } finally {
      await closeWorkflowContext();
      await closeOpenWorkflowRuntime();
      restoreEnvironment();
      await runtime.stop();
    }
  });
});
