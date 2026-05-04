import {
  createDataPlaneDatabase,
  getDataPlaneDatabaseSchema,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import { createDataPlaneTestSchemaName } from "@mistle/db/test-environment";
import { Pool } from "pg";

import type { DataPlaneGatewayApp, DataPlaneGatewayConfig } from "../types.js";

export type AppRuntimeResources = {
  dbPool: Pool;
  getDb: (input?: { testEnvironmentId?: string }) => DataPlaneDatabase;
  getTables: (input?: { testEnvironmentId?: string }) => DataPlaneTables;
};

const AppResourcesByInstance = new WeakMap<DataPlaneGatewayApp, AppRuntimeResources>();

function getAppResources(app: DataPlaneGatewayApp): AppRuntimeResources {
  const appResources = AppResourcesByInstance.get(app);

  if (appResources === undefined) {
    throw new Error("Data plane gateway app instance is unknown.");
  }

  return appResources;
}

export function createAppResources(config: DataPlaneGatewayConfig): AppRuntimeResources {
  const dbPool = new Pool({
    connectionString: config.database.url,
  });
  const defaultDb = createDataPlaneDatabase(dbPool);
  const defaultTables = getDataPlaneDatabaseSchema(defaultDb);
  const testDbsByEnvironmentId = new Map<string, DataPlaneDatabase>();
  const testTablesByEnvironmentId = new Map<string, DataPlaneTables>();

  return {
    dbPool,
    getDb: (input = {}) => getDataPlaneDb(input),
    getTables: (input = {}) => {
      const testIsolation = config.__dangerouslyEnableTestIsolation;
      if (testIsolation === undefined) {
        return defaultTables;
      }

      const testEnvironmentId = input.testEnvironmentId;
      if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
        throw new Error("Expected test environment id for isolated data-plane gateway tables.");
      }

      const existingTables = testTablesByEnvironmentId.get(testEnvironmentId);
      if (existingTables !== undefined) {
        return existingTables;
      }

      const tables = getDataPlaneDatabaseSchema(getDataPlaneDb({ testEnvironmentId }));
      testTablesByEnvironmentId.set(testEnvironmentId, tables);
      return tables;
    },
  };

  function getDataPlaneDb(input: { testEnvironmentId?: string }): DataPlaneDatabase {
    const testIsolation = config.__dangerouslyEnableTestIsolation;
    if (testIsolation === undefined) {
      return defaultDb;
    }

    const testEnvironmentId = input.testEnvironmentId;
    if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
      throw new Error("Expected test environment id for isolated data-plane gateway request.");
    }

    const existingDb = testDbsByEnvironmentId.get(testEnvironmentId);
    if (existingDb !== undefined) {
      return existingDb;
    }

    const db = createDataPlaneDatabase(dbPool, {
      schemaName: createDataPlaneTestSchemaName(testEnvironmentId),
    });
    testDbsByEnvironmentId.set(testEnvironmentId, db);
    return db;
  }
}

export function setAppResources(app: DataPlaneGatewayApp, resources: AppRuntimeResources): void {
  AppResourcesByInstance.set(app, resources);
}

export async function stopAppResources(app: DataPlaneGatewayApp): Promise<void> {
  const appResources = getAppResources(app);

  AppResourcesByInstance.delete(app);
  await appResources.dbPool.end();
}
