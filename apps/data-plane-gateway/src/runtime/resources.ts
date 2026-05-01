import { createHash } from "node:crypto";

import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import { Pool } from "pg";

import type { DataPlaneGatewayApp, DataPlaneGatewayConfig } from "../types.js";

export type AppRuntimeResources = {
  dbPool: Pool;
  getDb: (input?: { testEnvironmentId?: string }) => DataPlaneDatabase;
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
  const testDbsByEnvironmentId = new Map<string, DataPlaneDatabase>();

  return {
    dbPool,
    getDb: (input = {}) => {
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
    },
  };
}

export function setAppResources(app: DataPlaneGatewayApp, resources: AppRuntimeResources): void {
  AppResourcesByInstance.set(app, resources);
}

export async function stopAppResources(app: DataPlaneGatewayApp): Promise<void> {
  const appResources = getAppResources(app);

  AppResourcesByInstance.delete(app);
  await appResources.dbPool.end();
}

function createDataPlaneTestSchemaName(testEnvironmentId: string): string {
  const normalized = testEnvironmentId.toLowerCase().replaceAll(/[^a-z0-9_]/gu, "_");
  const prefix = /^[a-z]/u.test(normalized) ? normalized : `env_${normalized}`;
  const digest = createHash("sha256").update(testEnvironmentId).digest("hex").slice(0, 10);
  const schemaName = `${prefix.slice(0, 40)}_${digest}_data_plane`;
  if (schemaName.length > 63) {
    throw new Error(`Test data-plane schema name '${schemaName}' exceeds Postgres length limits.`);
  }

  return schemaName;
}
