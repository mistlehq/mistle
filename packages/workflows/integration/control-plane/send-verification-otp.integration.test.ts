import type { Worker } from "openworkflow";
import type { BackendPostgres } from "openworkflow/postgres";

import { SMTPEmailSender } from "@mistle/emails";
import {
  startMailpit,
  startPostgresWithPgBouncer,
  type MailpitService,
  type PostgresWithPgBouncerService,
} from "@mistle/test-harness";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import {
  SendVerificationOTPWorkflowSpec,
  createControlPlaneBackend,
  createControlPlaneOpenWorkflow,
  createControlPlaneWorker,
} from "../../src/control-plane/index.js";

describe("send verification otp workflow integration", () => {
  it("runs the workflow and sends an OTP email via SMTP", async () => {
    let databaseStack: PostgresWithPgBouncerService | undefined;
    let mailpitService: MailpitService | undefined;
    let backend: BackendPostgres | undefined;
    let worker: Worker | undefined;
    let sql: ReturnType<typeof postgres> | undefined;

    try {
      databaseStack = await startPostgresWithPgBouncer({
        databaseName: "mistle_workflows_test",
      });
      mailpitService = await startMailpit();

      backend = await createControlPlaneBackend({
        url: databaseStack.directUrl,
        namespaceId: "control-plane-tests",
        runMigrations: true,
      });
      const sqlClient = postgres(databaseStack.directUrl, {
        max: 1,
      });
      sql = sqlClient;

      const openWorkflow = createControlPlaneOpenWorkflow({ backend });
      const emailSender = SMTPEmailSender.fromTransportOptions({
        host: mailpitService.smtpHost,
        port: mailpitService.smtpPort,
        secure: false,
      });

      worker = createControlPlaneWorker({
        openWorkflow,
        concurrency: 1,
        workflowInputs: {
          sendVerificationOTP: {
            emailSender,
            from: {
              email: "no-reply@mistle.dev",
              name: "Mistle",
            },
          },
          requestDeleteSandboxProfile: {
            deleteSandboxProfile: async (input) => {
              await sqlClient`
                delete from control_plane.sandbox_profiles
                where id = ${input.profileId} and organization_id = ${input.organizationId}
              `;
            },
          },
        },
      });
      await worker.start();

      const recipient = "workflow-otp@mistle.dev";
      const handle = await openWorkflow.runWorkflow(SendVerificationOTPWorkflowSpec, {
        email: recipient,
        otp: "123456",
        type: "sign-in",
        expiresInSeconds: 300,
      });
      const result = await handle.result({ timeoutMs: 10_000 });

      expect(result.messageId).not.toBe("");

      const message = await mailpitService.waitForMessage({
        timeoutMs: 10_000,
        description: `workflow OTP email for ${recipient}`,
        matcher: ({ message: listMessage }) =>
          listMessage.Subject === "Your sign-in code" &&
          listMessage.To.some((address) => address.Address === recipient),
      });

      expect(message.Subject).toBe("Your sign-in code");
      expect(message.To.map((address) => address.Address)).toContain(recipient);
    } finally {
      const stopPromises: Promise<void>[] = [];
      if (worker !== undefined) {
        stopPromises.push(worker.stop());
      }
      if (backend !== undefined) {
        stopPromises.push(backend.stop());
      }
      if (sql !== undefined) {
        stopPromises.push(sql.end({ timeout: 5 }));
      }
      if (mailpitService !== undefined) {
        stopPromises.push(mailpitService.stop());
      }
      if (databaseStack !== undefined) {
        stopPromises.push(databaseStack.stop());
      }

      await Promise.all(stopPromises);
    }
  }, 90_000);
});
