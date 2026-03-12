import { AppIds, loadConfig } from "@mistle/config";

import type { DataPlaneWorkerConfig, DataPlaneWorkerGlobalConfig } from "../types.js";
import { createDataPlaneBackend } from "./client.js";

export type OpenWorkflowRuntime = {
  backend: Awaited<ReturnType<typeof createDataPlaneBackend>>;
  globalConfig: DataPlaneWorkerGlobalConfig;
  workerConfig: DataPlaneWorkerConfig;
};

let openWorkflowRuntimePromise: Promise<OpenWorkflowRuntime> | undefined;
let closeOpenWorkflowRuntimePromise: Promise<void> | undefined;

export function getOpenWorkflowRuntime(): Promise<OpenWorkflowRuntime> {
  if (openWorkflowRuntimePromise !== undefined) {
    return openWorkflowRuntimePromise;
  }

  openWorkflowRuntimePromise = Promise.resolve()
    .then(async () => {
      const loadedConfig = loadConfig({
        app: AppIds.DATA_PLANE_WORKER,
        env: process.env,
      });

      if (loadedConfig.global === undefined) {
        throw new Error("Expected global config to be loaded for data-plane-worker workflows.");
      }

      return {
        workerConfig: loadedConfig.app,
        globalConfig: loadedConfig.global,
        backend: await createDataPlaneBackend({
          url: loadedConfig.app.workflow.databaseUrl,
          namespaceId: loadedConfig.app.workflow.namespaceId,
          runMigrations: loadedConfig.app.workflow.runMigrations,
        }),
      };
    })
    .catch((error: unknown) => {
      openWorkflowRuntimePromise = undefined;
      throw error;
    });

  return openWorkflowRuntimePromise;
}

export async function closeOpenWorkflowRuntime(): Promise<void> {
  const runtimePromise = openWorkflowRuntimePromise;
  if (runtimePromise === undefined) {
    return;
  }

  if (closeOpenWorkflowRuntimePromise !== undefined) {
    await closeOpenWorkflowRuntimePromise;
    return;
  }

  closeOpenWorkflowRuntimePromise = (async () => {
    const runtime = await runtimePromise;
    await runtime.backend.stop();
    openWorkflowRuntimePromise = undefined;
    closeOpenWorkflowRuntimePromise = undefined;
  })().catch((error: unknown) => {
    closeOpenWorkflowRuntimePromise = undefined;
    throw error;
  });

  await closeOpenWorkflowRuntimePromise;
}
