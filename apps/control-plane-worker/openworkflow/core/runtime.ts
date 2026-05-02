import { AsyncLocalStorage } from "node:async_hooks";

import { AppIds, loadConfig } from "@mistle/config";

import { createControlPlaneBackend } from "./client.js";
import type { ControlPlaneWorkerConfig } from "./config.js";

export type OpenWorkflowRuntime = {
  backend: Awaited<ReturnType<typeof createControlPlaneBackend>>;
  workerConfig: ControlPlaneWorkerConfig;
};

let openWorkflowRuntimePromise: Promise<OpenWorkflowRuntime> | undefined;
let closeOpenWorkflowRuntimePromise: Promise<void> | undefined;
const hostedOpenWorkflowRuntimeStorage = new AsyncLocalStorage<OpenWorkflowRuntime>();

export function getOpenWorkflowRuntime(): Promise<OpenWorkflowRuntime> {
  const hostedRuntime = hostedOpenWorkflowRuntimeStorage.getStore();
  if (hostedRuntime !== undefined) {
    return Promise.resolve(hostedRuntime);
  }

  if (openWorkflowRuntimePromise !== undefined) {
    return openWorkflowRuntimePromise;
  }

  openWorkflowRuntimePromise = Promise.resolve()
    .then(async () => {
      const loadedConfig = loadConfig({
        app: AppIds.CONTROL_PLANE_WORKER,
        env: process.env,
      });

      return {
        workerConfig: loadedConfig.app,
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

export function withHostedOpenWorkflowRuntime<T>(
  runtime: OpenWorkflowRuntime,
  callback: () => Promise<T> | T,
): Promise<T> | T {
  return hostedOpenWorkflowRuntimeStorage.run(runtime, callback);
}
