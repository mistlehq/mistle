import {
  CONTROL_PLANE_SCHEMA_NAME,
  createControlPlaneDatabase,
  sandboxProfiles,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
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
  type PostgresWithPgBouncerService,
} from "@mistle/test-harness";
import {
  createControlPlaneBackend,
  createControlPlaneOpenWorkflow,
  createControlPlaneWorker,
} from "@mistle/workflows/control-plane";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { it as vitestIt } from "vitest";

import type { ControlPlaneApiConfig } from "../src/types.js";
import type { AuthenticatedSession } from "./helpers/auth-session.js";

import { createControlPlaneApiRuntime } from "../src/runtime/index.js";
import { createAuthenticatedSession } from "./helpers/auth-session.js";

export type ControlPlaneApiIntegrationFixture = {
  config: ControlPlaneApiConfig;
  db: ControlPlaneDatabase;
  mailpitService: MailpitService;
  databaseStack: PostgresWithPgBouncerService;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authSession: (input?: { email?: string }) => Promise<AuthenticatedSession>;
};

export const it = vitestIt.extend<{ fixture: ControlPlaneApiIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const cleanupTasks: Array<() => Promise<void>> = [];

      try {
        const databaseStack = await startPostgresWithPgBouncer({
          databaseName: "mistle_control_plane_api_integration",
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

        const workflowNamespaceId = "integration";
        const workflowBackend = await createControlPlaneBackend({
          url: databaseStack.directUrl,
          namespaceId: workflowNamespaceId,
          runMigrations: true,
        });
        cleanupTasks.unshift(async () => {
          await workflowBackend.stop();
        });
        const openWorkflow = createControlPlaneOpenWorkflow({ backend: workflowBackend });
        const workflowDbPool = new Pool({
          connectionString: databaseStack.pooledUrl,
        });
        cleanupTasks.unshift(async () => {
          await workflowDbPool.end();
        });
        const workflowDb = createControlPlaneDatabase(workflowDbPool);
        const emailSender = SMTPEmailSender.fromTransportOptions({
          host: mailpitService.smtpHost,
          port: mailpitService.smtpPort,
          secure: false,
        });

        const workflowWorker = createControlPlaneWorker({
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
                await workflowDb
                  .delete(sandboxProfiles)
                  .where(
                    and(
                      eq(sandboxProfiles.id, input.profileId),
                      eq(sandboxProfiles.organizationId, input.organizationId),
                    ),
                  );
              },
            },
          },
        });
        await workflowWorker.start();
        cleanupTasks.unshift(async () => {
          await workflowWorker.stop();
        });

        const config: ControlPlaneApiConfig = {
          server: {
            host: "127.0.0.1",
            port: 3000,
          },
          database: {
            url: databaseStack.pooledUrl,
          },
          workflow: {
            databaseUrl: databaseStack.pooledUrl,
            namespaceId: workflowNamespaceId,
          },
          auth: {
            baseUrl: "http://localhost:3000",
            invitationAcceptBaseUrl: "http://localhost:5173/invitations/accept",
            secret: "integration-auth-secret",
            trustedOrigins: ["http://localhost:3000"],
            otpLength: 6,
            otpExpiresInSeconds: 300,
            otpAllowedAttempts: 3,
          },
        };

        const runtime = await createControlPlaneApiRuntime(config);
        cleanupTasks.unshift(async () => {
          await runtime.stop();
        });

        await use({
          config,
          db: runtime.db,
          mailpitService,
          databaseStack,
          request: runtime.request,
          authSession: async (input) =>
            createAuthenticatedSession({
              request: runtime.request,
              db: runtime.db,
              mailpitService,
              otpLength: config.auth.otpLength,
              ...(input?.email === undefined ? {} : { email: input.email }),
            }),
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
