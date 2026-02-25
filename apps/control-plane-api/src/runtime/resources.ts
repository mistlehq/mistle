import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  createControlPlaneBackend,
  createControlPlaneOpenWorkflow,
} from "@mistle/workflows/control-plane";
import { Pool } from "pg";

import type { ControlPlaneApiConfig, ControlPlaneApp } from "../types.js";

export type AppRuntimeResources = {
  db: ControlPlaneDatabase;
  dbPool: Pool;
  workflowBackend: Awaited<ReturnType<typeof createControlPlaneBackend>>;
  openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
};

const AppResourcesByInstance = new WeakMap<ControlPlaneApp, AppRuntimeResources>();

function getAppResources(app: ControlPlaneApp): AppRuntimeResources {
  const appResources = AppResourcesByInstance.get(app);

  if (appResources === undefined) {
    throw new Error("Control plane app instance is unknown.");
  }

  return appResources;
}

export async function createAppResources(
  config: ControlPlaneApiConfig,
): Promise<AppRuntimeResources> {
  const dbPool = new Pool({
    connectionString: config.database.url,
  });
  const db = createControlPlaneDatabase(dbPool);
  const workflowBackend = await createControlPlaneBackend({
    url: config.workflow.databaseUrl,
    namespaceId: config.workflow.namespaceId,
    runMigrations: false,
  });

  return {
    db,
    dbPool,
    workflowBackend,
    openWorkflow: createControlPlaneOpenWorkflow({ backend: workflowBackend }),
  };
}

export function setAppResources(app: ControlPlaneApp, resources: AppRuntimeResources): void {
  AppResourcesByInstance.set(app, resources);
}

export async function stopAppResources(app: ControlPlaneApp): Promise<void> {
  const appResources = getAppResources(app);

  AppResourcesByInstance.delete(app);
  await Promise.all([appResources.dbPool.end(), appResources.workflowBackend.stop()]);
}

export function getAppDatabase(app: ControlPlaneApp): ControlPlaneDatabase {
  return getAppResources(app).db;
}
