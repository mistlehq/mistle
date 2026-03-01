import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import { createSandboxAdapter, SandboxProvider, type SandboxAdapter } from "@mistle/sandbox";
import { createDataPlaneBackend, createDataPlaneOpenWorkflow } from "@mistle/workflows/data-plane";
import { Pool } from "pg";

import type { DataPlaneWorkerRuntimeConfig } from "../types.js";

export type WorkerRuntimeResources = {
  db: DataPlaneDatabase;
  dbPool: Pool;
  sandboxAdapter: SandboxAdapter;
  workflowBackend: Awaited<ReturnType<typeof createDataPlaneBackend>>;
  openWorkflow: ReturnType<typeof createDataPlaneOpenWorkflow>;
};

function assertUnreachable(_value: never): never {
  throw new Error("Unsupported sandbox provider.");
}

function createSandboxRuntimeAdapter(
  config: Pick<DataPlaneWorkerRuntimeConfig, "app" | "sandboxProvider">,
): SandboxAdapter {
  if (config.sandboxProvider === SandboxProvider.MODAL) {
    if (config.app.sandbox.modal === undefined) {
      throw new Error(
        "Missing apps.data_plane_worker.sandbox.modal config for global sandbox provider modal.",
      );
    }

    return createSandboxAdapter({
      provider: config.sandboxProvider,
      modal: {
        tokenId: config.app.sandbox.modal.tokenId,
        tokenSecret: config.app.sandbox.modal.tokenSecret,
        appName: config.app.sandbox.modal.appName,
        environmentName: config.app.sandbox.modal.environmentName,
      },
    });
  }

  if (config.sandboxProvider === SandboxProvider.DOCKER) {
    if (config.app.sandbox.docker === undefined) {
      throw new Error(
        "Missing apps.data_plane_worker.sandbox.docker config for global sandbox provider docker.",
      );
    }

    return createSandboxAdapter({
      provider: config.sandboxProvider,
      docker: {
        socketPath: config.app.sandbox.docker.socketPath,
        snapshotRepository: config.app.sandbox.docker.snapshotRepository,
      },
    });
  }

  return assertUnreachable(config.sandboxProvider);
}

export async function createWorkerRuntimeResources(
  config: DataPlaneWorkerRuntimeConfig,
): Promise<WorkerRuntimeResources> {
  const dbPool = new Pool({
    connectionString: config.app.database.url,
  });
  const db = createDataPlaneDatabase(dbPool);

  let workflowBackend: Awaited<ReturnType<typeof createDataPlaneBackend>>;

  try {
    workflowBackend = await createDataPlaneBackend({
      url: config.app.workflow.databaseUrl,
      namespaceId: config.app.workflow.namespaceId,
      runMigrations: config.app.workflow.runMigrations,
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
