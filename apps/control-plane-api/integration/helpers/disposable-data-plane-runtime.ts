import { randomUUID } from "node:crypto";

import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import { reserveAvailablePort } from "@mistle/test-harness";
import { Client, Pool } from "pg";

import { createDataPlaneApiRuntime } from "../../../data-plane-api/src/main.js";
import { createDataPlaneBackend } from "../../../data-plane-api/src/openworkflow/index.js";
import type { DataPlaneApiConfig } from "../../../data-plane-api/src/types.js";

export type DisposableDataPlaneRuntime = {
  baseUrl: string;
  db: DataPlaneDatabase;
  dbPool: Pool;
  stop: () => Promise<void>;
};

function parseDatabaseConnectionString(connectionString: string): {
  username: string;
  password: string;
  host: string;
  port: number;
} {
  const url = new URL(connectionString);
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1) {
    throw new Error("Expected database connection string to include a valid port.");
  }

  return {
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: url.hostname,
    port,
  };
}

function createDatabaseUrl(input: {
  username: string;
  password: string;
  host: string;
  port: number;
  databaseName: string;
}): string {
  return `postgresql://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${input.host}:${String(input.port)}/${input.databaseName}`;
}

export async function createDisposableDataPlaneRuntime(input: {
  controlPlaneDatabaseUrl: string;
  internalAuthServiceToken: string;
  workflowNamespaceId: string;
  databaseNamePrefix: string;
  baseUrl: string;
}): Promise<DisposableDataPlaneRuntime> {
  const adminConnection = parseDatabaseConnectionString(input.controlPlaneDatabaseUrl);
  const databaseName = `${input.databaseNamePrefix}_${randomUUID().replaceAll("-", "_")}`;
  const databaseUrl = createDatabaseUrl({
    ...adminConnection,
    databaseName,
  });
  const adminClient = new Client({
    connectionString: createDatabaseUrl({
      ...adminConnection,
      databaseName: "postgres",
    }),
  });

  let runtime: Awaited<ReturnType<typeof createDataPlaneApiRuntime>> | undefined;
  let dbPool: Pool | undefined;

  await adminClient.connect();

  try {
    await adminClient.query(`CREATE DATABASE "${databaseName}"`);
    await runDataPlaneMigrations({
      connectionString: databaseUrl,
      schemaName: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
    });

    const workflowBackend = await createDataPlaneBackend({
      url: databaseUrl,
      namespaceId: input.workflowNamespaceId,
      runMigrations: true,
    });
    await workflowBackend.stop();

    dbPool = new Pool({
      connectionString: databaseUrl,
    });

    const configuredBaseUrl = new URL(input.baseUrl);
    const host = configuredBaseUrl.hostname;
    const configuredPort = Number(configuredBaseUrl.port);
    const port =
      Number.isInteger(configuredPort) && configuredPort > 0
        ? configuredPort
        : await reserveAvailablePort({ host });
    const gatewayPort = await reserveAvailablePort({ host });
    const config: DataPlaneApiConfig = {
      server: {
        host,
        port,
      },
      database: {
        url: databaseUrl,
        migrationUrl: databaseUrl,
      },
      workflow: {
        databaseUrl,
        namespaceId: input.workflowNamespaceId,
      },
      runtimeState: {
        gatewayBaseUrl: `http://${host}:${String(gatewayPort)}`,
      },
    };

    runtime = await createDataPlaneApiRuntime({
      app: config,
      internalAuthServiceToken: input.internalAuthServiceToken,
      sandboxProvider: "docker",
    });
    await runtime.start();

    return {
      baseUrl: `${configuredBaseUrl.protocol}//${host}:${String(port)}`,
      db: createDataPlaneDatabase(dbPool),
      dbPool,
      stop: async () => {
        if (runtime !== undefined) {
          await runtime.stop();
        }
        if (dbPool !== undefined) {
          await dbPool.end();
        }

        await adminClient.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
        await adminClient.end();
      },
    };
  } catch (error) {
    if (runtime !== undefined) {
      await runtime.stop();
    }
    if (dbPool !== undefined) {
      await dbPool.end();
    }

    await adminClient.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await adminClient.end();
    throw error;
  }
}
