import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  createControlPlaneBackend,
  createControlPlaneOpenWorkflow,
} from "@mistle/workflows/control-plane";
import { Pool } from "pg";

import type { ControlPlaneWorkerConfig } from "../types.js";

export type WorkerRuntimeResources = {
  db: ControlPlaneDatabase;
  dbPool: Pool;
  workflowBackend: Awaited<ReturnType<typeof createControlPlaneBackend>>;
  openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
};

export async function createWorkerRuntimeResources(
  config: ControlPlaneWorkerConfig,
): Promise<WorkerRuntimeResources> {
  const dbPool = new Pool({
    connectionString: config.workflow.databaseUrl,
  });
  const db = createControlPlaneDatabase(dbPool);
  let workflowBackend: Awaited<ReturnType<typeof createControlPlaneBackend>>;

  try {
    workflowBackend = await createControlPlaneBackend({
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
    openWorkflow: createControlPlaneOpenWorkflow({
      backend: workflowBackend,
    }),
  };
}

export async function stopWorkerRuntimeResources(resources: WorkerRuntimeResources): Promise<void> {
  await Promise.all([resources.workflowBackend.stop(), resources.dbPool.end()]);
}
