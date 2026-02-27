import {
  reserveAvailablePort,
  startPostgresWithPgBouncer,
  type PostgresWithPgBouncerService,
} from "@mistle/test-harness";
import { createDataPlaneBackend } from "@mistle/workflows/data-plane";
import { Pool } from "pg";
import { it as vitestIt } from "vitest";

import type { DataPlaneApiConfig } from "../src/types.js";

import { createDataPlaneApiRuntime } from "../src/runtime/index.js";

export type DataPlaneApiIntegrationFixture = {
  baseUrl: string;
  config: DataPlaneApiConfig;
  databaseStack: PostgresWithPgBouncerService;
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

        const runtime = await createDataPlaneApiRuntime(config);
        await runtime.start();
        cleanupTasks.unshift(async () => {
          await runtime.stop();
        });

        await use({
          baseUrl: `http://${config.server.host}:${String(config.server.port)}`,
          config,
          databaseStack,
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
