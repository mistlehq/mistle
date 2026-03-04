import { CONTROL_PLANE_SCHEMA_NAME } from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import { SMTPEmailSender } from "@mistle/emails";
import {
  runCleanupTasks,
  startMailpit,
  startPostgresWithPgBouncer,
  type MailpitService,
} from "@mistle/test-harness";
import type { Worker } from "openworkflow";
import type { BackendPostgres } from "openworkflow/postgres";
import postgres from "postgres";
import { it as vitestIt } from "vitest";

import {
  ControlPlaneWorkerWorkflowIds,
  createControlPlaneBackend,
  createControlPlaneOpenWorkflow,
  createControlPlaneWorker,
} from "../../src/control-plane/index.js";

export type ControlPlaneWorkflowFixture = {
  mailpitService: MailpitService;
  sql: ReturnType<typeof postgres>;
  openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
};

export const it = vitestIt.extend<{ fixture: ControlPlaneWorkflowFixture }>({
  fixture: [
    async ({}, use) => {
      const cleanupTasks: Array<() => Promise<void>> = [];

      try {
        const databaseStack = await startPostgresWithPgBouncer({
          databaseName: "mistle_workflows_test",
        });
        cleanupTasks.unshift(async () => {
          await databaseStack.stop();
        });

        const mailpitService = await startMailpit();
        cleanupTasks.unshift(async () => {
          await mailpitService.stop();
        });

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
          host: mailpitService.smtpHost,
          port: mailpitService.smtpPort,
          secure: false,
        });

        const worker: Worker = createControlPlaneWorker({
          openWorkflow,
          maxConcurrentWorkflows: 1,
          enabledWorkflows: [
            ControlPlaneWorkerWorkflowIds.HANDLE_AUTOMATION_RUN,
            ControlPlaneWorkerWorkflowIds.HANDLE_INTEGRATION_WEBHOOK_EVENT,
            ControlPlaneWorkerWorkflowIds.SEND_ORGANIZATION_INVITATION,
            ControlPlaneWorkerWorkflowIds.SEND_VERIFICATION_OTP,
            ControlPlaneWorkerWorkflowIds.REQUEST_DELETE_SANDBOX_PROFILE,
          ],
          services: {
            automationRuns: {
              handleAutomationRun: async (input) => ({
                automationRunId: input.automationRunId,
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
          },
        });
        await worker.start();
        cleanupTasks.unshift(async () => {
          await worker.stop();
        });

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
