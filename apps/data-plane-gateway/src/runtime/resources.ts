import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import { Pool } from "pg";

import type { DataPlaneGatewayApp, DataPlaneGatewayConfig } from "../types.js";

export type AppRuntimeResources = {
  db: DataPlaneDatabase;
  dbPool: Pool;
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

  return {
    db: createDataPlaneDatabase(dbPool),
    dbPool,
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
