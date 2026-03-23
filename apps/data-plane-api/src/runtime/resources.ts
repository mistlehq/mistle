import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import { Pool } from "pg";

import { createDataPlaneBackend, createDataPlaneOpenWorkflow } from "../openworkflow/index.js";
import { GatewayHttpSandboxRuntimeStateReader } from "../runtime-state/gateway-http-sandbox-runtime-state-reader.js";
import type { SandboxRuntimeStateReader } from "../runtime-state/sandbox-runtime-state-reader.js";
import type { DataPlaneApiRuntimeConfig, DataPlaneApp } from "../types.js";

export type AppRuntimeResources = {
  db: DataPlaneDatabase;
  dbPool: Pool;
  workflowDbPool: Pool;
  workflowBackend: Awaited<ReturnType<typeof createDataPlaneBackend>>;
  openWorkflow: ReturnType<typeof createDataPlaneOpenWorkflow>;
  runtimeStateReader: SandboxRuntimeStateReader;
};

const AppResourcesByInstance = new WeakMap<DataPlaneApp, AppRuntimeResources>();

function getAppResources(app: DataPlaneApp): AppRuntimeResources {
  const appResources = AppResourcesByInstance.get(app);

  if (appResources === undefined) {
    throw new Error("Data plane app instance is unknown.");
  }

  return appResources;
}

export async function createAppResources(
  runtimeConfig: DataPlaneApiRuntimeConfig,
): Promise<AppRuntimeResources> {
  const dbPool = new Pool({
    connectionString: runtimeConfig.app.database.url,
  });
  const workflowDbPool = new Pool({
    connectionString: runtimeConfig.app.workflow.databaseUrl,
  });
  const db = createDataPlaneDatabase(dbPool);
  const runtimeStateReader = new GatewayHttpSandboxRuntimeStateReader({
    baseUrl: runtimeConfig.app.runtimeState.gatewayBaseUrl,
    serviceToken: runtimeConfig.internalAuthServiceToken,
  });

  let workflowBackend: Awaited<ReturnType<typeof createDataPlaneBackend>>;

  try {
    workflowBackend = await createDataPlaneBackend({
      url: runtimeConfig.app.workflow.databaseUrl,
      namespaceId: runtimeConfig.app.workflow.namespaceId,
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
    runtimeStateReader,
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
