import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import { createDataPlaneBackend, createDataPlaneOpenWorkflow } from "@mistle/workflows/data-plane";
import { Pool } from "pg";

import type { DataPlaneWorkerConfig } from "../types.js";

export type WorkerRuntimeResources = {
  db: DataPlaneDatabase;
  dbPool: Pool;
  workflowBackend: Awaited<ReturnType<typeof createDataPlaneBackend>>;
  openWorkflow: ReturnType<typeof createDataPlaneOpenWorkflow>;
};

export async function createWorkerRuntimeResources(
  config: DataPlaneWorkerConfig,
): Promise<WorkerRuntimeResources> {
  const dbPool = new Pool({
    connectionString: config.database.url,
  });
  const db = createDataPlaneDatabase(dbPool);

  let workflowBackend: Awaited<ReturnType<typeof createDataPlaneBackend>>;

  try {
    workflowBackend = await createDataPlaneBackend({
      url: config.workflow.databaseUrl,
      namespaceId: config.workflow.namespaceId,
      runMigrations: config.workflow.runMigrations,
    });
  } catch (error) {
    await dbPool.end();
    throw error;
  }

  return {
    db,
    dbPool,
    workflowBackend,
    openWorkflow: createDataPlaneOpenWorkflow({
      backend: workflowBackend,
    }),
  };
}

export async function stopWorkerRuntimeResources(resources: WorkerRuntimeResources): Promise<void> {
  await Promise.all([resources.workflowBackend.stop(), resources.dbPool.end()]);
}
