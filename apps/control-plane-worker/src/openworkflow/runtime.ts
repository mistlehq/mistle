import { AppIds, loadConfig } from "@mistle/config";
import { createControlPlaneBackend } from "@mistle/workflows/control-plane";

import type { ControlPlaneWorkerConfig, ControlPlaneWorkerGlobalConfig } from "../types.js";

export type OpenWorkflowRuntime = {
  backend: Awaited<ReturnType<typeof createControlPlaneBackend>>;
  globalConfig: ControlPlaneWorkerGlobalConfig;
  workerConfig: ControlPlaneWorkerConfig;
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
        app: AppIds.CONTROL_PLANE_WORKER,
        env: process.env,
      });

      if (loadedConfig.global === undefined) {
        throw new Error("Expected global config to be loaded for control-plane-worker workflows.");
      }

      return {
        workerConfig: loadedConfig.app,
        globalConfig: loadedConfig.global,
        backend: await createControlPlaneBackend({
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
