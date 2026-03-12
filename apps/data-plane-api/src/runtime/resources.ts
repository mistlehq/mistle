import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import { Pool } from "pg";

import { createDataPlaneBackend, createDataPlaneOpenWorkflow } from "../openworkflow/index.js";
import type { DataPlaneApiConfig, DataPlaneApp } from "../types.js";

export type AppRuntimeResources = {
  db: DataPlaneDatabase;
  dbPool: Pool;
  workflowDbPool: Pool;
  workflowBackend: Awaited<ReturnType<typeof createDataPlaneBackend>>;
  openWorkflow: ReturnType<typeof createDataPlaneOpenWorkflow>;
};

const AppResourcesByInstance = new WeakMap<DataPlaneApp, AppRuntimeResources>();

function getAppResources(app: DataPlaneApp): AppRuntimeResources {
  const appResources = AppResourcesByInstance.get(app);

  if (appResources === undefined) {
    throw new Error("Data plane app instance is unknown.");
  }

  return appResources;
}

export async function createAppResources(config: DataPlaneApiConfig): Promise<AppRuntimeResources> {
  const dbPool = new Pool({
    connectionString: config.database.url,
  });
  const workflowDbPool = new Pool({
    connectionString: config.workflow.databaseUrl,
  });
  const db = createDataPlaneDatabase(dbPool);

  let workflowBackend: Awaited<ReturnType<typeof createDataPlaneBackend>>;

  try {
    workflowBackend = await createDataPlaneBackend({
      url: config.workflow.databaseUrl,
      namespaceId: config.workflow.namespaceId,
      runMigrations: false,
    });
  } catch (error) {
    await workflowDbPool.end();
    await dbPool.end();
    throw error;
  }

  return {
    db,
    dbPool,
    workflowDbPool,
    workflowBackend,
    openWorkflow: createDataPlaneOpenWorkflow({ backend: workflowBackend }),
  };
}

export function setAppResources(app: DataPlaneApp, resources: AppRuntimeResources): void {
  AppResourcesByInstance.set(app, resources);
}

export async function stopAppResources(app: DataPlaneApp): Promise<void> {
  const appResources = getAppResources(app);

  AppResourcesByInstance.delete(app);
  await Promise.all([
    appResources.dbPool.end(),
    appResources.workflowDbPool.end(),
    appResources.workflowBackend.stop(),
  ]);
}
