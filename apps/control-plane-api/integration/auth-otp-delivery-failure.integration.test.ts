import { randomUUID } from "node:crypto";

import { reserveAvailablePort } from "@mistle/test-harness";
import { systemSleeper } from "@mistle/time";
import { SendVerificationOTPWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { describe, expect } from "vitest";

import { SendVerificationOTPWorkflow } from "../../control-plane-worker/openworkflow/send-verification-otp.js";
import { createControlPlaneApiRuntime } from "../src/main.js";
import type { ControlPlaneApiConfig } from "../src/types.js";
import { withControlPlaneWorkerRuntime } from "./helpers/control-plane-worker-runtime.js";
import { IntegrationPortAccessConfig } from "./helpers/port-access-config.js";
import { countControlPlaneWorkflowRuns } from "./helpers/workflow-runs.js";
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

function createBrokenSmtpWorkerEnvironment(input: { smtpPort: number }): Record<string, string> {
  return {
    MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_HOST: "127.0.0.1",
    MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PORT: String(input.smtpPort),
    MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_SECURE: "false",
    MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_USERNAME: "mailpit",
    MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PASSWORD: "mailpit",
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
    try {
      await withControlPlaneWorkerRuntime({
        fixture,
        namespaceId,
        environmentOverrides: createBrokenSmtpWorkerEnvironment({
          smtpPort,
        }),
        run: async ({ workflowContext }) => {
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
        },
      });
    } finally {
      await runtime.stop();
    }
  });
});
