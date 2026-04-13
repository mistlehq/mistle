import { randomUUID } from "node:crypto";

import { reserveAvailablePort } from "@mistle/test-harness";
import { systemSleeper } from "@mistle/time";
import { SendVerificationOTPWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { describe, expect } from "vitest";

import { SendVerificationOTPWorkflow } from "../openworkflow/send-verification-otp.js";
import { withOpenWorkflowRuntime } from "./openworkflow-test-support.js";
import { it } from "./test-context.js";

const TestTimeoutMs = 60_000;

async function waitForWorkflowRunToFail(input: {
  listWorkflowRuns: () => Promise<{
    data: Array<{
      error: {
        message: string;
      } | null;
      id: string;
      idempotencyKey: string | null;
      status: string;
      workflowName: string;
    }>;
  }>;
  workflowName: string;
  idempotencyKey: string;
  timeoutMs: number;
}): Promise<{
  error: { message: string } | null;
  id: string;
  idempotencyKey: string | null;
  status: string;
  workflowName: string;
}> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < input.timeoutMs) {
    const workflowRuns = await input.listWorkflowRuns();
    const workflowRun = workflowRuns.data.find(
      (candidate) =>
        candidate.workflowName === input.workflowName &&
        candidate.idempotencyKey === input.idempotencyKey,
    );

    if (workflowRun?.status === "failed") {
      return workflowRun;
    }

    await systemSleeper.sleep(50);
  }

  throw new Error(
    `Timed out waiting for workflow '${input.workflowName}' with idempotency key '${input.idempotencyKey}' to fail.`,
  );
}

describe("send verification otp integration", () => {
  it(
    "fails the workflow when the email provider is unavailable",
    async ({ fixture }) => {
      const unavailableSmtpPort = await reserveAvailablePort({ host: "127.0.0.1" });
      const workflowFixture = {
        ...fixture,
        config: {
          ...fixture.config,
          email: {
            ...fixture.config.email,
            smtpHost: "127.0.0.1",
            smtpPort: unavailableSmtpPort,
          },
        },
      };
      const workflowIdempotencyKey = `send-verification-otp:${randomUUID()}`;

      await withOpenWorkflowRuntime({
        fixture: workflowFixture,
        run: async ({ runtime, workflowContext }) => {
          const workflowDeadlineAt = new Date(Date.now() + 1_500);
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
              deadlineAt: workflowDeadlineAt,
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

            const otpWorkflowRun = await waitForWorkflowRunToFail({
              listWorkflowRuns: () =>
                runtime.backend.listWorkflowRuns({
                  limit: 20,
                }),
              workflowName: SendVerificationOTPWorkflowSpec.name,
              idempotencyKey: workflowIdempotencyKey,
              timeoutMs: TestTimeoutMs,
            });

            expect(otpWorkflowRun.status).toBe("failed");
            expect(otpWorkflowRun.error?.message).toContain("ECONNREFUSED");
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
