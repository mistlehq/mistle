import { CONTROL_PLANE_SCHEMA_NAME } from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import { SMTPEmailSender } from "@mistle/emails";
import { createMailpitInbox, runCleanupTasks, type MailpitService } from "@mistle/test-harness";
import type { Worker } from "openworkflow";
import type { BackendPostgres } from "openworkflow/postgres";
import postgres from "postgres";

import {
  ControlPlaneWorkerWorkflowIds,
  createControlPlaneBackend,
  createControlPlaneOpenWorkflow,
  createControlPlaneWorker,
} from "../../src/control-plane/index.js";
import { it as baseIt } from "../test-context.js";

export type ControlPlaneWorkflowFixture = {
  mailpitService: MailpitService;
  sql: ReturnType<typeof postgres>;
  openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required integration environment variable: ${name}`);
  }

  return value;
}

function parsePort(input: { value: string; variableName: string }): number {
  const parsedPort = Number.parseInt(input.value, 10);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(`Environment variable ${input.variableName} must be a valid TCP port.`);
  }

  return parsedPort;
}

export const it = baseIt.extend<{ fixture: ControlPlaneWorkflowFixture }>({
  fixture: [
    async ({ databaseStack }, use) => {
      const cleanupTasks: Array<() => Promise<void>> = [];
      const mailpitSmtpHost = requireEnv("MISTLE_WF_IT_MAILPIT_SMTP_HOST");
      const mailpitSmtpPort = parsePort({
        value: requireEnv("MISTLE_WF_IT_MAILPIT_SMTP_PORT"),
        variableName: "MISTLE_WF_IT_MAILPIT_SMTP_PORT",
      });
      const mailpitHttpBaseUrl = requireEnv("MISTLE_WF_IT_MAILPIT_HTTP_BASE_URL");

      try {
        await runControlPlaneMigrations({
          connectionString: databaseStack.directUrl,
          schemaName: CONTROL_PLANE_SCHEMA_NAME,
          migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
          migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
          migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
        });

        const backend: BackendPostgres = await createControlPlaneBackend({
          url: databaseStack.directUrl,
          namespaceId: "control-plane-tests",
          runMigrations: true,
        });
        cleanupTasks.unshift(async () => {
          await backend.stop();
        });

        const sql = postgres(databaseStack.directUrl, {
          max: 1,
        });
        cleanupTasks.unshift(async () => {
          await sql.end({ timeout: 5 });
        });

        const openWorkflow = createControlPlaneOpenWorkflow({ backend });
        const emailSender = SMTPEmailSender.fromTransportOptions({
          host: mailpitSmtpHost,
          port: mailpitSmtpPort,
          secure: false,
        });

        const worker: Worker = createControlPlaneWorker({
          openWorkflow,
          maxConcurrentWorkflows: 1,
          enabledWorkflows: [
            ControlPlaneWorkerWorkflowIds.HANDLE_AUTOMATION_RUN,
            ControlPlaneWorkerWorkflowIds.HANDLE_CONVERSATION_DELIVERY,
            ControlPlaneWorkerWorkflowIds.HANDLE_INTEGRATION_WEBHOOK_EVENT,
            ControlPlaneWorkerWorkflowIds.SEND_ORGANIZATION_INVITATION,
            ControlPlaneWorkerWorkflowIds.SEND_VERIFICATION_OTP,
            ControlPlaneWorkerWorkflowIds.REQUEST_DELETE_SANDBOX_PROFILE,
            ControlPlaneWorkerWorkflowIds.START_SANDBOX_PROFILE_INSTANCE,
          ],
          services: {
            automationRuns: {
              transitionAutomationRunToRunning: async () => ({
                shouldProcess: true,
              }),
              prepareAutomationRun: async (input) => ({
                automationRunId: input.automationRunId,
                automationRunCreatedAt: "2026-01-01T00:00:00.000Z",
                automationId: "atm_test",
                automationTargetId: "atg_test",
                organizationId: "org_test",
                sandboxProfileId: "sbp_test",
                sandboxProfileVersion: 1,
                webhookEventId: "iwe_test",
                webhookEventType: "github.issue_comment.created",
                webhookProviderEventType: "issue_comment",
                webhookExternalEventId: "evt_test",
                webhookExternalDeliveryId: "delivery_test",
                webhookPayload: {},
                sourceOccurredAt: "2026-01-01T00:00:00.000Z",
                sourceOrderKey: "2026-01-01T00:00:00.000Z#00000000000000000001",
                providerFamily: "codex",
                providerModel: "gpt-5.3-codex",
                renderedInput: "hello",
                renderedConversationKey: "conversation-key",
                renderedIdempotencyKey: null,
              }),
              enqueuePreparedAutomationRun: async () => {},
              markAutomationRunFailed: async () => {},
              resolveAutomationRunFailure: ({ error }) => {
                if (error instanceof Error) {
                  return {
                    code: "automation_run_execution_failed",
                    message: error.message,
                  };
                }

                return {
                  code: "automation_run_execution_failed",
                  message: "Automation run execution failed with a non-error exception.",
                };
              },
            },
            conversationDeliveries: {
              handleConversationDelivery: async (input) => ({
                conversationId: input.conversationId,
                generation: input.generation,
              }),
            },
            integrationWebhooks: {
              handleWebhookEvent: async (input) => ({
                webhookEventId: input.webhookEventId,
              }),
            },
            emailDelivery: {
              emailSender,
              from: {
                email: "no-reply@mistle.dev",
                name: "Mistle",
              },
            },
            sandboxProfiles: {
              deleteSandboxProfile: async (input) => {
                await sql`
                  delete from control_plane.sandbox_profiles
                  where id = ${input.profileId} and organization_id = ${input.organizationId}
                `;
              },
            },
            sandboxInstances: {
              startSandboxProfileInstance: async () => ({
                workflowRunId: "wf_start_sandbox_test",
                sandboxInstanceId: "sbi_test",
              }),
            },
          },
        });
        await worker.start();
        cleanupTasks.unshift(async () => {
          await worker.stop();
        });

        const inbox = createMailpitInbox({
          httpBaseUrl: mailpitHttpBaseUrl,
        });
        const mailpitService: MailpitService = {
          smtpHost: mailpitSmtpHost,
          smtpPort: mailpitSmtpPort,
          httpBaseUrl: mailpitHttpBaseUrl,
          listMessages: inbox.listMessages,
          getMessageSummary: inbox.getMessageSummary,
          waitForMessage: inbox.waitForMessage,
          runtimeMetadata: {
            containerId: "shared-mailpit-managed-by-global-setup",
          },
          stop: async () => {
            throw new Error("Shared Mailpit service is managed by global setup.");
          },
        };

        await use({
          mailpitService,
          sql,
          openWorkflow,
        });
      } finally {
        await runCleanupTasks({
          tasks: cleanupTasks,
          context: "workflows control-plane fixture cleanup",
        });
      }
    },
    {
      scope: "file",
    },
  ],
});
