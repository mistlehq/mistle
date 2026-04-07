import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";
import { S3CompatibleObjectStore } from "@mistle/object-store";
import { Pool } from "pg";

import { createControlPlaneBackend, createControlPlaneOpenWorkflow } from "./openworkflow.js";
import type { ControlPlaneApiConfig } from "./types.js";

export type AppRuntimeResources = {
  db: ControlPlaneDatabase;
  dbPool: Pool;
  objectStore: S3CompatibleObjectStore;
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
  const objectStore = new S3CompatibleObjectStore({
    bucketName: config.objectStore.bucketName,
    region: config.objectStore.region,
    ...(config.objectStore.endpoint === undefined
      ? {}
      : {
          endpoint: config.objectStore.endpoint,
        }),
    ...(config.objectStore.forcePathStyle === undefined
      ? {}
      : {
          forcePathStyle: config.objectStore.forcePathStyle,
        }),
    credentials: {
      accessKeyId: config.objectStore.accessKeyId,
      secretAccessKey: config.objectStore.secretAccessKey,
    },
  });
  const integrationRegistry = createIntegrationRegistry();
  let workflowBackend: Awaited<ReturnType<typeof createControlPlaneBackend>>;

  try {
    workflowBackend = await createControlPlaneBackend({
      url: config.workflow.databaseUrl,
      namespaceId: config.workflow.namespaceId,
      runMigrations: false,
    });
  } catch (error) {
    objectStore.destroy();
    await dbPool.end();
    throw error;
  }

  return {
    db,
    dbPool,
    objectStore,
    integrationRegistry,
    workflowBackend,
    openWorkflow: createControlPlaneOpenWorkflow({ backend: workflowBackend }),
  };
}

export async function stopAppResources(resources: AppRuntimeResources): Promise<void> {
  resources.objectStore.destroy();
  await Promise.all([resources.dbPool.end(), resources.workflowBackend.stop()]);
}
