import { randomUUID } from "node:crypto";

import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import {
  CONTROL_PLANE_SCHEMA_NAME,
  createControlPlaneDatabase,
  sandboxProfiles,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import {
  SandboxInstanceStatuses,
  createDataPlaneDatabase,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import { SMTPEmailSender } from "@mistle/emails";
import { reserveAvailablePort, startMailpit, startPostgresWithPgBouncer } from "@mistle/test-core";
import {
  createControlPlaneBackend,
  createControlPlaneOpenWorkflow,
  createControlPlaneWorker,
} from "@mistle/workflows/control-plane";
import {
  createDataPlaneBackend,
  createDataPlaneOpenWorkflow,
  createDataPlaneWorker,
} from "@mistle/workflows/data-plane";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { it as vitestIt } from "vitest";

import { createDataPlaneApiRuntime } from "../../../data-plane-api/src/runtime/index.js";
import type { DataPlaneApiConfig } from "../../../data-plane-api/src/types.js";
import { createControlPlaneApiRuntime } from "../../src/runtime/index.js";
import type { ControlPlaneApiConfig } from "../../src/types.js";
import type { AuthenticatedSession } from "../helpers/auth-session.js";
import { createAuthenticatedSession } from "../helpers/auth-session.js";

export type StartSandboxIntegrationFixture = {
  controlPlaneDb: ControlPlaneDatabase;
  dataPlaneDb: DataPlaneDatabase;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authSession: (input?: { email?: string }) => Promise<AuthenticatedSession>;
};

type ResolveSandboxProfileVersionInput = {
  db: ControlPlaneDatabase;
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
};

async function verifySandboxProfileVersionExists(
  input: ResolveSandboxProfileVersionInput,
): Promise<void> {
  const sandboxProfile = await input.db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.sandboxProfileId), eq(table.organizationId, input.organizationId)),
  });

  if (sandboxProfile === undefined) {
    throw new Error("Sandbox profile was not found.");
  }

  const sandboxProfileVersion = await input.db.query.sandboxProfileVersions.findFirst({
    columns: {
      sandboxProfileId: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, input.sandboxProfileId),
        eq(table.version, input.sandboxProfileVersion),
      ),
  });

  if (sandboxProfileVersion === undefined) {
    throw new Error("Sandbox profile version was not found.");
  }
}

export const it = vitestIt.extend<{ fixture: StartSandboxIntegrationFixture }>({
  fixture: [
    async ({ task }, use) => {
      void task;
      const cleanupTasks: Array<() => Promise<void>> = [];

      try {
        const internalAuthServiceToken = "integration-service-token";
        const workflowNamespaceId = "integration";

        const controlPlaneDatabaseStack = await startPostgresWithPgBouncer({
          databaseName: "mistle_control_plane_start_instance_integration",
        });
        cleanupTasks.unshift(async () => {
          await controlPlaneDatabaseStack.stop();
        });
        await runControlPlaneMigrations({
          connectionString: controlPlaneDatabaseStack.directUrl,
          schemaName: CONTROL_PLANE_SCHEMA_NAME,
          migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
          migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
          migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
        });

        const dataPlaneDatabaseStack = await startPostgresWithPgBouncer({
          databaseName: "mistle_data_plane_start_instance_integration",
        });
        cleanupTasks.unshift(async () => {
          await dataPlaneDatabaseStack.stop();
        });
        await runDataPlaneMigrations({
          connectionString: dataPlaneDatabaseStack.directUrl,
          schemaName: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
          migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
          migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
          migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
        });

        const dataPlaneMigrationBackend = await createDataPlaneBackend({
          url: dataPlaneDatabaseStack.directUrl,
          namespaceId: workflowNamespaceId,
          runMigrations: true,
        });
        await dataPlaneMigrationBackend.stop();

        const dataPlaneWorkflowBackend = await createDataPlaneBackend({
          url: dataPlaneDatabaseStack.directUrl,
          namespaceId: workflowNamespaceId,
          runMigrations: false,
        });
        cleanupTasks.unshift(async () => {
          await dataPlaneWorkflowBackend.stop();
        });
        const dataPlaneOpenWorkflow = createDataPlaneOpenWorkflow({
          backend: dataPlaneWorkflowBackend,
        });
        const dataPlaneDbPool = new Pool({
          connectionString: dataPlaneDatabaseStack.directUrl,
        });
        cleanupTasks.unshift(async () => {
          await dataPlaneDbPool.end();
        });
        const dataPlaneDb = createDataPlaneDatabase(dataPlaneDbPool);
        const dataPlaneWorkflowWorker = createDataPlaneWorker({
          openWorkflow: dataPlaneOpenWorkflow,
          concurrency: 1,
          workflowInputs: {
            startSandboxInstance: {
              startSandbox: async (workflowInput) => {
                return {
                  provider: workflowInput.image.provider,
                  providerSandboxId: `integration-${randomUUID()}`,
                  bootstrapTokenJti: randomUUID(),
                };
              },
              stopSandbox: async () => {},
              insertSandboxInstance: async (workflowInput) => {
                const insertedRows = await dataPlaneDb
                  .insert(sandboxInstances)
                  .values({
                    organizationId: workflowInput.organizationId,
                    sandboxProfileId: workflowInput.sandboxProfileId,
                    sandboxProfileVersion: workflowInput.sandboxProfileVersion,
                    provider: workflowInput.provider,
                    providerSandboxId: workflowInput.providerSandboxId,
                    status: SandboxInstanceStatuses.STARTING,
                    startedByKind: workflowInput.startedBy.kind,
                    startedById: workflowInput.startedBy.id,
                    source: workflowInput.source,
                  })
                  .returning({
                    id: sandboxInstances.id,
                  });
                const insertedSandboxInstance = insertedRows[0];

                if (insertedSandboxInstance === undefined) {
                  throw new Error("Expected sandbox instance insert to return one row.");
                }

                return {
                  sandboxInstanceId: insertedSandboxInstance.id,
                };
              },
              waitForSandboxTunnelConnectAck: async () => {
                return true;
              },
              updateSandboxInstanceStatus: async (workflowInput) => {
                if (workflowInput.status === "running") {
                  const updatedRows = await dataPlaneDb
                    .update(sandboxInstances)
                    .set({
                      status: SandboxInstanceStatuses.RUNNING,
                    })
                    .where(
                      and(
                        eq(sandboxInstances.id, workflowInput.sandboxInstanceId),
                        eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
                      ),
                    )
                    .returning({
                      id: sandboxInstances.id,
                    });
                  if (updatedRows[0] === undefined) {
                    throw new Error(
                      "Expected sandbox instance status transition from starting to running.",
                    );
                  }
                  return;
                }

                const updatedRows = await dataPlaneDb
                  .update(sandboxInstances)
                  .set({
                    status: SandboxInstanceStatuses.FAILED,
                    failureCode: workflowInput.failureCode,
                    failureMessage: workflowInput.failureMessage,
                  })
                  .where(
                    and(
                      eq(sandboxInstances.id, workflowInput.sandboxInstanceId),
                      eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
                    ),
                  )
                  .returning({
                    id: sandboxInstances.id,
                  });
                if (updatedRows[0] === undefined) {
                  throw new Error(
                    "Expected sandbox instance status transition from starting to failed.",
                  );
                }
              },
            },
          },
        });
        await dataPlaneWorkflowWorker.start();
        cleanupTasks.unshift(async () => {
          await dataPlaneWorkflowWorker.stop();
        });

        const dataPlaneHost = "127.0.0.1";
        const dataPlanePort = await reserveAvailablePort({ host: dataPlaneHost });
        const dataPlaneConfig: DataPlaneApiConfig = {
          server: {
            host: dataPlaneHost,
            port: dataPlanePort,
          },
          database: {
            url: dataPlaneDatabaseStack.pooledUrl,
          },
          workflow: {
            databaseUrl: dataPlaneDatabaseStack.pooledUrl,
            namespaceId: workflowNamespaceId,
          },
        };
        const dataPlaneRuntime = await createDataPlaneApiRuntime({
          app: dataPlaneConfig,
          internalAuthServiceToken,
        });
        await dataPlaneRuntime.start();
        cleanupTasks.unshift(async () => {
          await dataPlaneRuntime.stop();
        });

        const mailpitService = await startMailpit();
        cleanupTasks.unshift(async () => {
          await mailpitService.stop();
        });

        const controlPlaneWorkflowBackend = await createControlPlaneBackend({
          url: controlPlaneDatabaseStack.directUrl,
          namespaceId: workflowNamespaceId,
          runMigrations: true,
        });
        cleanupTasks.unshift(async () => {
          await controlPlaneWorkflowBackend.stop();
        });
        const controlPlaneOpenWorkflow = createControlPlaneOpenWorkflow({
          backend: controlPlaneWorkflowBackend,
        });
        const controlPlaneWorkflowDbPool = new Pool({
          connectionString: controlPlaneDatabaseStack.pooledUrl,
        });
        cleanupTasks.unshift(async () => {
          await controlPlaneWorkflowDbPool.end();
        });
        const controlPlaneWorkflowDb = createControlPlaneDatabase(controlPlaneWorkflowDbPool);

        const dataPlaneClient = createDataPlaneSandboxInstancesClient({
          baseUrl: `http://${dataPlaneHost}:${String(dataPlanePort)}`,
          serviceToken: internalAuthServiceToken,
        });
        const emailSender = SMTPEmailSender.fromTransportOptions({
          host: mailpitService.smtpHost,
          port: mailpitService.smtpPort,
          secure: false,
        });
        const controlPlaneWorkflowWorker = createControlPlaneWorker({
          openWorkflow: controlPlaneOpenWorkflow,
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
                await controlPlaneWorkflowDb
                  .delete(sandboxProfiles)
                  .where(
                    and(
                      eq(sandboxProfiles.id, input.profileId),
                      eq(sandboxProfiles.organizationId, input.organizationId),
                    ),
                  );
              },
            },
            startSandboxProfileInstance: {
              startSandboxInstance: async (input) => {
                await verifySandboxProfileVersionExists({
                  db: controlPlaneWorkflowDb,
                  organizationId: input.organizationId,
                  sandboxProfileId: input.sandboxProfileId,
                  sandboxProfileVersion: input.sandboxProfileVersion,
                });

                const response = await dataPlaneClient.startSandboxInstance(input);

                return {
                  workflowRunId: response.workflowRunId,
                  sandboxInstanceId: response.sandboxInstanceId,
                  providerSandboxId: response.providerSandboxId,
                };
              },
            },
          },
        });
        await controlPlaneWorkflowWorker.start();
        cleanupTasks.unshift(async () => {
          await controlPlaneWorkflowWorker.stop();
        });

        const controlPlaneConfig: ControlPlaneApiConfig = {
          server: {
            host: "127.0.0.1",
            port: 3000,
          },
          database: {
            url: controlPlaneDatabaseStack.pooledUrl,
          },
          workflow: {
            databaseUrl: controlPlaneDatabaseStack.pooledUrl,
            namespaceId: workflowNamespaceId,
          },
          sandbox: {
            defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
          },
          sandboxProvider: "docker",
          integrations: {
            activeMasterEncryptionKeyVersion: 1,
            masterEncryptionKeys: {
              "1": "integration-master-key-testing",
            },
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
        const controlPlaneRuntime = await createControlPlaneApiRuntime(controlPlaneConfig);
        cleanupTasks.unshift(async () => {
          await controlPlaneRuntime.stop();
        });

        await use({
          controlPlaneDb: controlPlaneRuntime.db,
          dataPlaneDb,
          request: controlPlaneRuntime.request,
          authSession: async (input) =>
            createAuthenticatedSession({
              request: controlPlaneRuntime.request,
              db: controlPlaneRuntime.db,
              mailpitService,
              otpLength: controlPlaneConfig.auth.otpLength,
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
