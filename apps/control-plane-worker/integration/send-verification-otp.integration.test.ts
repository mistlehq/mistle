import { randomUUID } from "node:crypto";

import { reserveAvailablePort } from "@mistle/test-harness";
import { systemSleeper } from "@mistle/time";
import { SendVerificationOTPWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { describe, expect } from "vitest";

import { SendVerificationOTPWorkflow } from "../openworkflow/send-verification-otp.js";
import { withOpenWorkflowRuntime } from "./openworkflow-test-support.js";
import { it } from "./test-context.js";

const TestTimeoutMs = 60_000;

async function waitForWorkflowRun(input: {
  listWorkflowRuns: () => Promise<{
    data: Array<{
      id: string;
      idempotencyKey: string | null;
      status: string;
      workflowName: string;
    }>;
  }>;
  workflowName: string;
  idempotencyKey: string;
  timeoutMs: number;
}): Promise<{ id: string; idempotencyKey: string | null; status: string; workflowName: string }> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < input.timeoutMs) {
    const workflowRuns = await input.listWorkflowRuns();
    const workflowRun = workflowRuns.data.find(
      (candidate) =>
        candidate.workflowName === input.workflowName &&
        candidate.idempotencyKey === input.idempotencyKey,
    );

    if (workflowRun !== undefined) {
      return workflowRun;
    }

    await systemSleeper.sleep(50);
  }

  throw new Error(
    `Timed out waiting for workflow '${input.workflowName}' with idempotency key '${input.idempotencyKey}'.`,
  );
}

async function waitForFailedStepAttempt(input: {
  listStepAttempts: () => Promise<{
    data: Array<{
      error: unknown;
      status: string;
      stepName: string;
    }>;
  }>;
  stepName: string;
  timeoutMs: number;
}): Promise<{ error: unknown; status: string; stepName: string }> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < input.timeoutMs) {
    const stepAttempts = await input.listStepAttempts();
    const stepAttempt = stepAttempts.data.find(
      (candidate) => candidate.stepName === input.stepName && candidate.status === "failed",
    );

    if (stepAttempt !== undefined) {
      return stepAttempt;
    }

    await systemSleeper.sleep(50);
  }

  throw new Error(`Timed out waiting for failed step attempt '${input.stepName}'.`);
}

describe("send verification otp integration", () => {
  it(
    "fails the workflow when smtp delivery fails",
    async ({ fixture }) => {
      const brokenSmtpPort = await reserveAvailablePort({ host: "127.0.0.1" });
      const workflowFixture = {
        ...fixture,
        config: {
          ...fixture.config,
          email: {
            ...fixture.config.email,
            smtpHost: "127.0.0.1",
            smtpPort: brokenSmtpPort,
          },
        },
      };
      const workflowIdempotencyKey = `send-verification-otp:${randomUUID()}`;

      await withOpenWorkflowRuntime({
        fixture: workflowFixture,
        run: async ({ runtime, workflowContext }) => {
          workflowContext.openWorkflow.implementWorkflow(
            SendVerificationOTPWorkflow.spec,
            SendVerificationOTPWorkflow.fn,
          );
          const worker = workflowContext.openWorkflow.newWorker({
            concurrency: 1,
          });
          let stopTicking = false;
          await workflowContext.openWorkflow.runWorkflow(
            SendVerificationOTPWorkflowSpec,
            {
              email: `integration-send-verification-otp-${randomUUID()}@example.com`,
              expiresInSeconds: 300,
              otp: "123456",
              type: "sign-in",
            },
            {
              idempotencyKey: workflowIdempotencyKey,
            },
          );

          try {
            const tickUntilStopped = (async () => {
              while (!stopTicking) {
                const processedRunCount = await worker.tick();
                if (processedRunCount === 0) {
                  await systemSleeper.sleep(10);
                }
              }
            })();

            const otpWorkflowRun = await waitForWorkflowRun({
              listWorkflowRuns: () =>
                runtime.backend.listWorkflowRuns({
                  limit: 20,
                }),
              workflowName: SendVerificationOTPWorkflowSpec.name,
              idempotencyKey: workflowIdempotencyKey,
              timeoutMs: TestTimeoutMs,
            });

            const failedStepAttempt = await waitForFailedStepAttempt({
              listStepAttempts: () =>
                runtime.backend.listStepAttempts({
                  workflowRunId: otpWorkflowRun.id,
                  limit: 20,
                }),
              stepName: "send-verification-otp-email",
              timeoutMs: TestTimeoutMs,
            });

            expect(failedStepAttempt.status).toBe("failed");
            expect(failedStepAttempt.error).not.toBeNull();
            stopTicking = true;
            await tickUntilStopped;
          } finally {
            stopTicking = true;
            await worker.stop();
          }
        },
      });
    },
    TestTimeoutMs,
  );
});
