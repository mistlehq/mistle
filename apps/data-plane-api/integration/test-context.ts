import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import {
  reserveAvailablePort,
  runCleanupTasks,
  startPostgresWithPgBouncer,
  type PostgresWithPgBouncerService,
} from "@mistle/test-harness";
import { createDataPlaneBackend } from "@mistle/workflows/data-plane";
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
        await runCleanupTasks({
          tasks: cleanupTasks,
          context: "data-plane-api integration fixture cleanup",
        });
      }
    },
    {
      scope: "file",
    },
  ],
});
