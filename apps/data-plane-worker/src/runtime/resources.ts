import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import { createSandboxAdapter, SandboxProvider, type SandboxAdapter } from "@mistle/sandbox";
import { createDataPlaneBackend, createDataPlaneOpenWorkflow } from "@mistle/workflows/data-plane";
import { Pool } from "pg";

import type { DataPlaneWorkerConfig } from "../types.js";

export type WorkerRuntimeResources = {
  db: DataPlaneDatabase;
  dbPool: Pool;
  sandboxAdapter: SandboxAdapter;
  workflowBackend: Awaited<ReturnType<typeof createDataPlaneBackend>>;
  openWorkflow: ReturnType<typeof createDataPlaneOpenWorkflow>;
};

function createSandboxRuntimeAdapter(config: DataPlaneWorkerConfig): SandboxAdapter {
  if (config.sandbox.provider === SandboxProvider.MODAL) {
    return createSandboxAdapter({
      provider: config.sandbox.provider,
      modal: {
        tokenId: config.sandbox.modal.tokenId,
        tokenSecret: config.sandbox.modal.tokenSecret,
        appName: config.sandbox.modal.appName,
        environmentName: config.sandbox.modal.environmentName,
      },
    });
  }

  if (config.sandbox.provider === SandboxProvider.DOCKER) {
    return createSandboxAdapter({
      provider: config.sandbox.provider,
      docker: {
        socketPath: config.sandbox.docker.socketPath,
        snapshotRepository: config.sandbox.docker.snapshotRepository,
      },
    });
  }

  throw new Error("Unsupported sandbox provider.");
}

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

  const sandboxAdapter = createSandboxRuntimeAdapter(config);

  return {
    db,
    dbPool,
    sandboxAdapter,
    workflowBackend,
    openWorkflow: createDataPlaneOpenWorkflow({
      backend: workflowBackend,
    }),
  };
}

export async function stopWorkerRuntimeResources(resources: WorkerRuntimeResources): Promise<void> {
  await Promise.all([resources.workflowBackend.stop(), resources.dbPool.end()]);
}
