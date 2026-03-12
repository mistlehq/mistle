import { AppIds, loadConfig } from "@mistle/config";
import { createControlPlaneBackend } from "@mistle/workflows/control-plane";

import type { ControlPlaneWorkerConfig, ControlPlaneWorkerGlobalConfig } from "../types.js";

export type OpenWorkflowRuntime = {
  backend: Awaited<ReturnType<typeof createControlPlaneBackend>>;
  globalConfig: ControlPlaneWorkerGlobalConfig;
  workerConfig: ControlPlaneWorkerConfig;
};

let openWorkflowRuntimePromise: Promise<OpenWorkflowRuntime> | undefined;

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
