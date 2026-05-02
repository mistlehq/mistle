import { AsyncLocalStorage } from "node:async_hooks";

import { createDataPlaneBackend } from "./client.js";
import { loadDataPlaneWorkerConfig, type DataPlaneWorkerConfig } from "./config.js";

export type OpenWorkflowRuntime = {
  backend: Awaited<ReturnType<typeof createDataPlaneBackend>>;
  workerConfig: DataPlaneWorkerConfig;
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
      const loadedConfig = loadDataPlaneWorkerConfig(process.env);

      return {
        workerConfig: loadedConfig.app,
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

export function withHostedOpenWorkflowRuntime<T>(
  runtime: OpenWorkflowRuntime,
  callback: () => Promise<T> | T,
): Promise<T> | T {
  return hostedOpenWorkflowRuntimeStorage.run(runtime, callback);
}
