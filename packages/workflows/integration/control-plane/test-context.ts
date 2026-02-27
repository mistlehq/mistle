import type { Worker } from "openworkflow";
import type { BackendPostgres } from "openworkflow/postgres";

import { CONTROL_PLANE_SCHEMA_NAME } from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import { SMTPEmailSender } from "@mistle/emails";
import {
  startMailpit,
  startPostgresWithPgBouncer,
  type MailpitService,
} from "@mistle/test-harness";
import postgres from "postgres";
import { it as vitestIt } from "vitest";

import {
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
          concurrency: 1,
          workflowInputs: {
            sendOrganizationInvitation: {
              emailSender,
              from: {
                email: "no-reply@mistle.dev",
                name: "Mistle",
              },
            },
            sendVerificationOTP: {
              emailSender,
              from: {
                email: "no-reply@mistle.dev",
                name: "Mistle",
              },
            },
            requestDeleteSandboxProfile: {
              deleteSandboxProfile: async (input) => {
                await sql`
                  delete from control_plane.sandbox_profiles
                  where id = ${input.profileId} and organization_id = ${input.organizationId}
                `;
              },
            },
            startSandboxProfileInstance: {
              resolveSandboxProfileVersion: async () => {
                throw new Error(
                  "startSandboxProfileInstance.resolveSandboxProfileVersion is not configured in this fixture.",
                );
              },
              startSandboxInstance: async () => {
                throw new Error(
                  "startSandboxProfileInstance.startSandboxInstance is not configured in this fixture.",
                );
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
        for (const cleanupTask of cleanupTasks) {
          await cleanupTask();
        }
      }
    },
    {
      scope: "file",
    },
  ],
});
