/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * Vitest fixture extension file intentionally uses `vitestIt.extend(...)`.
 */

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
import { Pool } from "pg";
import { it as vitestIt } from "vitest";

import { createDataPlaneGatewayRuntime } from "../src/runtime/index.js";
import type { DataPlaneGatewayRuntimeConfig } from "../src/types.js";

const IntegrationBootstrapTokenSecret = "integration-bootstrap-token-secret";
const IntegrationTokenIssuer = "integration-data-plane-worker";
const IntegrationTokenAudience = "integration-data-plane-gateway";

export type DataPlaneGatewayIntegrationFixture = {
  baseUrl: string;
  websocketBaseUrl: string;
  config: DataPlaneGatewayRuntimeConfig;
  databaseStack: PostgresWithPgBouncerService;
  db: DataPlaneDatabase;
  dbPool: Pool;
};

export const it = vitestIt.extend<{ fixture: DataPlaneGatewayIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const cleanupTasks: Array<() => Promise<void>> = [];

      try {
        const databaseName = `mistle_data_plane_gateway_integration_${Date.now().toString()}`;
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

        const dbPool = new Pool({
          connectionString: databaseStack.directUrl,
        });
        cleanupTasks.unshift(async () => {
          await dbPool.end();
        });
        const db = createDataPlaneDatabase(dbPool);

        const runtimeConfig: DataPlaneGatewayRuntimeConfig = {
          app: {
            server: {
              host: "127.0.0.1",
              port: await reserveAvailablePort({ host: "127.0.0.1" }),
            },
            database: {
              url: databaseStack.pooledUrl,
            },
          },
          sandbox: {
            connect: {
              tokenSecret: "integration-connect-token-secret",
              tokenIssuer: "integration-control-plane-api",
              tokenAudience: IntegrationTokenAudience,
            },
            bootstrap: {
              tokenSecret: IntegrationBootstrapTokenSecret,
              tokenIssuer: IntegrationTokenIssuer,
              tokenAudience: IntegrationTokenAudience,
            },
          },
        };

        const runtime = createDataPlaneGatewayRuntime(runtimeConfig);
        await runtime.start();
        cleanupTasks.unshift(async () => {
          await runtime.stop();
        });

        await use({
          baseUrl: `http://${runtimeConfig.app.server.host}:${String(runtimeConfig.app.server.port)}`,
          websocketBaseUrl: `ws://${runtimeConfig.app.server.host}:${String(runtimeConfig.app.server.port)}`,
          config: runtimeConfig,
          databaseStack,
          db,
          dbPool,
        });
      } finally {
        await runCleanupTasks({
          tasks: cleanupTasks,
          context: "data-plane-gateway integration fixture cleanup",
        });
      }
    },
    {
      scope: "file",
    },
  ],
});
