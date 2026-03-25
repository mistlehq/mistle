import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import { Pool } from "pg";

import { createDataPlaneBackend, createDataPlaneOpenWorkflow } from "./openworkflow/index.js";
import { GatewayHttpSandboxRuntimeStateReader } from "./runtime-state/gateway-http-sandbox-runtime-state-reader.js";
import type { SandboxRuntimeStateReader } from "./runtime-state/sandbox-runtime-state-reader.js";
import type { DataPlaneApiRuntimeConfig } from "./types.js";

export type AppRuntimeResources = {
  db: DataPlaneDatabase;
  dbPool: Pool;
  workflowDbPool: Pool;
  workflowBackend: Awaited<ReturnType<typeof createDataPlaneBackend>>;
  openWorkflow: ReturnType<typeof createDataPlaneOpenWorkflow>;
  runtimeStateReader: SandboxRuntimeStateReader;
};

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

export async function stopAppResources(resources: AppRuntimeResources): Promise<void> {
  await Promise.all([
    resources.dbPool.end(),
    resources.workflowDbPool.end(),
    resources.workflowBackend.stop(),
  ]);
}
