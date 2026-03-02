import { randomUUID } from "node:crypto";

import {
  SandboxInstanceStatuses,
  createDataPlaneDatabase,
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
  DataPlaneWorkerWorkflowIds,
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
          enabledWorkflows: [DataPlaneWorkerWorkflowIds.START_SANDBOX_INSTANCE],
          services: {
            startSandboxInstance: {
              sandboxLifecycle: {
                startSandbox: async () => {
                  return {
                    provider: "docker",
                    providerSandboxId: `integration-${randomUUID()}`,
                    bootstrapTokenJti: randomUUID(),
                  };
                },
                stopSandbox: async () => {},
              },
              sandboxInstances: {
                createSandboxInstance: async (workflowInput) => {
                  const insertedRows = await dbPool.query<{ id: string }>(
                    `
                      insert into data_plane.sandbox_instances (
                        organization_id,
                        sandbox_profile_id,
                        sandbox_profile_version,
                        provider,
                        provider_sandbox_id,
                        status,
                        started_by_kind,
                        started_by_id,
                        source
                      )
                      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                      returning id
                    `,
                    [
                      workflowInput.organizationId,
                      workflowInput.sandboxProfileId,
                      workflowInput.sandboxProfileVersion,
                      workflowInput.provider,
                      workflowInput.providerSandboxId,
                      SandboxInstanceStatuses.STARTING,
                      workflowInput.startedBy.kind,
                      workflowInput.startedBy.id,
                      workflowInput.source,
                    ],
                  );

                  const sandboxInstance = insertedRows.rows[0];
                  if (sandboxInstance === undefined) {
                    throw new Error("Failed to insert sandbox instance row.");
                  }

                  await dbPool.query(
                    `
                      insert into data_plane.sandbox_instance_runtime_plans (
                        sandbox_instance_id,
                        revision,
                        compiled_runtime_plan,
                        compiled_from_profile_id,
                        compiled_from_profile_version
                      )
                      values ($1, $2, $3::jsonb, $4, $5)
                    `,
                    [
                      sandboxInstance.id,
                      1,
                      JSON.stringify(workflowInput.runtimePlan),
                      workflowInput.sandboxProfileId,
                      workflowInput.sandboxProfileVersion,
                    ],
                  );

                  return {
                    sandboxInstanceId: sandboxInstance.id,
                  };
                },
                markSandboxInstanceRunning: async (workflowInput) => {
                  const updatedRows = await dbPool.query<{ id: string }>(
                    `
                      update data_plane.sandbox_instances
                      set
                        status = $2,
                        started_at = now(),
                        failed_at = null,
                        failure_code = null,
                        failure_message = null,
                        updated_at = now()
                      where
                        id = $1
                        and status = $3
                      returning id
                    `,
                    [
                      workflowInput.sandboxInstanceId,
                      SandboxInstanceStatuses.RUNNING,
                      SandboxInstanceStatuses.STARTING,
                    ],
                  );

                  if (updatedRows.rows[0] === undefined) {
                    throw new Error(
                      "Failed to transition sandbox instance status from starting to running.",
                    );
                  }
                },
                markSandboxInstanceFailed: async (workflowInput) => {
                  const updatedRows = await dbPool.query<{ id: string }>(
                    `
                      update data_plane.sandbox_instances
                      set
                        status = $2,
                        failed_at = now(),
                        failure_code = $4,
                        failure_message = $5,
                        updated_at = now()
                      where
                        id = $1
                        and status = $3
                      returning id
                    `,
                    [
                      workflowInput.sandboxInstanceId,
                      SandboxInstanceStatuses.FAILED,
                      SandboxInstanceStatuses.STARTING,
                      workflowInput.failureCode,
                      workflowInput.failureMessage,
                    ],
                  );

                  if (updatedRows.rows[0] === undefined) {
                    throw new Error(
                      "Failed to transition sandbox instance status from starting to failed.",
                    );
                  }
                },
              },
              tunnelConnectAcks: {
                waitForSandboxTunnelConnectAck: async () => true,
              },
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
