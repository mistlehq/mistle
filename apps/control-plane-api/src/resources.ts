import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";
import { Pool } from "pg";

import { createControlPlaneBackend, createControlPlaneOpenWorkflow } from "./openworkflow.js";
import type { ControlPlaneApiConfig } from "./types.js";

export type AppRuntimeResources = {
  db: ControlPlaneDatabase;
  dbPool: Pool;
  integrationRegistry: IntegrationRegistry;
  workflowBackend: Awaited<ReturnType<typeof createControlPlaneBackend>>;
  openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
};

export async function createAppResources(
  config: ControlPlaneApiConfig,
): Promise<AppRuntimeResources> {
  const dbPool = new Pool({
    connectionString: config.database.url,
  });
  const db = createControlPlaneDatabase(dbPool);
  const integrationRegistry = createIntegrationRegistry();
  let workflowBackend: Awaited<ReturnType<typeof createControlPlaneBackend>>;

  try {
    workflowBackend = await createControlPlaneBackend({
      url: config.workflow.databaseUrl,
      namespaceId: config.workflow.namespaceId,
      runMigrations: false,
    });
  } catch (error) {
    await dbPool.end();
    throw error;
  }

  return {
    db,
    dbPool,
    integrationRegistry,
    workflowBackend,
    openWorkflow: createControlPlaneOpenWorkflow({ backend: workflowBackend }),
  };
}

export async function stopAppResources(resources: AppRuntimeResources): Promise<void> {
  await Promise.all([resources.dbPool.end(), resources.workflowBackend.stop()]);
}
