import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import { createDataPlaneBackend } from "@mistle/workflows/data-plane";

import { createDataPlaneApiRuntime } from "../runtime/index.js";
import type { DataPlaneApiConfig, DataPlaneApiRuntime } from "../types.js";

export type StartDataPlaneApiTestingRuntimeInput = {
  databaseDirectUrl: string;
  databasePooledUrl: string;
  workflowNamespaceId: string;
  internalAuthServiceToken?: string;
  server?: {
    host?: string;
    port?: number;
  };
};

function createTestingConfig(input: StartDataPlaneApiTestingRuntimeInput): DataPlaneApiConfig {
  return {
    server: {
      host: input.server?.host ?? "127.0.0.1",
      port: input.server?.port ?? 0,
    },
    database: {
      url: input.databasePooledUrl,
    },
    workflow: {
      databaseUrl: input.databasePooledUrl,
      namespaceId: input.workflowNamespaceId,
    },
  };
}

async function runTestingBootstrap(input: {
  databaseDirectUrl: string;
  workflowNamespaceId: string;
}): Promise<void> {
  await runDataPlaneMigrations({
    connectionString: input.databaseDirectUrl,
    schemaName: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
    migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
    migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
    migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
  });

  const workflowBackend = await createDataPlaneBackend({
    url: input.databaseDirectUrl,
    namespaceId: input.workflowNamespaceId,
    runMigrations: true,
  });
  await workflowBackend.stop();
}

export async function startDataPlaneApiTestingRuntime(
  input: StartDataPlaneApiTestingRuntimeInput,
): Promise<DataPlaneApiRuntime> {
  await runTestingBootstrap({
    databaseDirectUrl: input.databaseDirectUrl,
    workflowNamespaceId: input.workflowNamespaceId,
  });

  return createDataPlaneApiRuntime({
    app: createTestingConfig(input),
    internalAuthServiceToken: input.internalAuthServiceToken ?? "integration-service-token",
  });
}

export type { DataPlaneApiRuntime };
