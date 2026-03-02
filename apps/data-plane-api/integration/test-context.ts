import { randomUUID } from "node:crypto";

import {
  SandboxInstanceStatuses,
  createDataPlaneDatabase,
  sandboxInstanceRuntimePlans,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import {
  reserveAvailablePort,
  startPostgresWithPgBouncer,
  type PostgresWithPgBouncerService,
} from "@mistle/test-core";
import {
  createDataPlaneBackend,
  createDataPlaneOpenWorkflow,
  createDataPlaneWorker,
} from "@mistle/workflows/data-plane";
import { Pool } from "pg";
import { it as vitestIt } from "vitest";

import { createDataPlaneApiRuntime } from "../src/runtime/index.js";
import type { DataPlaneApiConfig } from "../src/types.js";

export type DataPlaneApiIntegrationFixture = {
  baseUrl: string;
  config: DataPlaneApiConfig;
  internalAuthServiceToken: string;
  databaseStack: PostgresWithPgBouncerService;
  db: DataPlaneDatabase;
  dbPool: Pool;
};

export const it = vitestIt.extend<{ fixture: DataPlaneApiIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const cleanupTasks: Array<() => Promise<void>> = [];

      try {
        const databaseName = `mistle_data_plane_api_integration_${Date.now().toString()}`;
        const databaseStack = await startPostgresWithPgBouncer({
          databaseName,
        });
        cleanupTasks.unshift(async () => {
          await databaseStack.stop();
        });
        await runDataPlaneMigrations({
          connectionString: databaseStack.directUrl,
          schemaName: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
          migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
          migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
          migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
        });

        const workflowNamespaceId = "integration";
        const migrationBackend = await createDataPlaneBackend({
          url: databaseStack.directUrl,
          namespaceId: workflowNamespaceId,
          runMigrations: true,
        });
        await migrationBackend.stop();

        const dbPool = new Pool({
          connectionString: databaseStack.directUrl,
        });
        cleanupTasks.unshift(async () => {
          await dbPool.end();
        });
        const db = createDataPlaneDatabase(dbPool);

        const workflowBackend = await createDataPlaneBackend({
          url: databaseStack.directUrl,
          namespaceId: workflowNamespaceId,
          runMigrations: false,
        });
        cleanupTasks.unshift(async () => {
          await workflowBackend.stop();
        });
        const openWorkflow = createDataPlaneOpenWorkflow({
          backend: workflowBackend,
        });
        const workflowWorker = createDataPlaneWorker({
          openWorkflow,
          maxConcurrentWorkflows: 1,
          deps: {
            startSandbox: async () => {
              return {
                provider: "docker",
                providerSandboxId: `integration-${randomUUID()}`,
                bootstrapTokenJti: randomUUID(),
              };
            },
            stopSandbox: async () => {},
            insertSandboxInstance: async (workflowInput) => {
              return db.transaction(async (tx) => {
                const insertedRows = await tx
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

                await tx.insert(sandboxInstanceRuntimePlans).values({
                  sandboxInstanceId: insertedSandboxInstance.id,
                  revision: 1,
                  compiledRuntimePlan: workflowInput.runtimePlan,
                  compiledFromProfileId: workflowInput.sandboxProfileId,
                  compiledFromProfileVersion: workflowInput.sandboxProfileVersion,
                });

                return {
                  sandboxInstanceId: insertedSandboxInstance.id,
                };
              });
            },
            waitForSandboxTunnelConnectAck: async () => {
              return true;
            },
            updateSandboxInstanceStatus: async (workflowInput) => {
              if (workflowInput.status === "running") {
                const updateResult = await dbPool.query<{ id: string }>(
                  `
                    update data_plane.sandbox_instances
                    set
                      status = $1,
                      started_at = now(),
                      failed_at = null,
                      failure_code = null,
                      failure_message = null,
                      updated_at = now()
                    where
                      id = $2
                      and status = $3
                    returning id
                  `,
                  [
                    SandboxInstanceStatuses.RUNNING,
                    workflowInput.sandboxInstanceId,
                    SandboxInstanceStatuses.STARTING,
                  ],
                );
                if (updateResult.rows[0] === undefined) {
                  throw new Error(
                    "Expected sandbox instance status transition from starting to running.",
                  );
                }
                return;
              }

              const updateResult = await dbPool.query<{ id: string }>(
                `
                  update data_plane.sandbox_instances
                  set
                    status = $1,
                    failed_at = now(),
                    failure_code = $2,
                    failure_message = $3,
                    updated_at = now()
                  where
                    id = $4
                    and status = $5
                  returning id
                `,
                [
                  SandboxInstanceStatuses.FAILED,
                  workflowInput.failureCode,
                  workflowInput.failureMessage,
                  workflowInput.sandboxInstanceId,
                  SandboxInstanceStatuses.STARTING,
                ],
              );
              if (updateResult.rows[0] === undefined) {
                throw new Error(
                  "Expected sandbox instance status transition from starting to failed.",
                );
              }
            },
          },
        });
        await workflowWorker.start();
        cleanupTasks.unshift(async () => {
          await workflowWorker.stop();
        });

        const config: DataPlaneApiConfig = {
          server: {
            host: "127.0.0.1",
            port: await reserveAvailablePort({ host: "127.0.0.1" }),
          },
          database: {
            url: databaseStack.pooledUrl,
          },
          workflow: {
            databaseUrl: databaseStack.pooledUrl,
            namespaceId: workflowNamespaceId,
          },
        };
        const internalAuthServiceToken = "integration-service-token";

        const runtime = await createDataPlaneApiRuntime({
          app: config,
          internalAuthServiceToken,
        });
        await runtime.start();
        cleanupTasks.unshift(async () => {
          await runtime.stop();
        });

        await use({
          baseUrl: `http://${config.server.host}:${String(config.server.port)}`,
          config,
          internalAuthServiceToken,
          databaseStack,
          db,
          dbPool,
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
