import { createApp } from "../app.js";
import { startServer } from "../server.js";
import type {
  ControlPlaneWorkerRuntime,
  ControlPlaneWorkerRuntimeConfig,
  StartedServer,
} from "../types.js";
import { createWorkerRuntimeResources, stopWorkerRuntimeResources } from "./resources.js";
import { createRuntimeWorker } from "./worker.js";

export async function createControlPlaneWorkerRuntime(
  runtimeConfig: ControlPlaneWorkerRuntimeConfig,
): Promise<ControlPlaneWorkerRuntime> {
  const app = createApp(runtimeConfig);
  const resources = await createWorkerRuntimeResources(runtimeConfig.app);
  let worker: ReturnType<typeof createRuntimeWorker>;

  try {
    worker = createRuntimeWorker({
      config: runtimeConfig.app,
      internalAuthServiceToken: runtimeConfig.internalAuthServiceToken,
      resources,
    });
  } catch (error) {
    await stopWorkerRuntimeResources(resources);
    throw error;
  }
  let startedServer: StartedServer | undefined;
  let workerStarted = false;
  let stopPromise: Promise<void> | undefined;
  let stopped = false;

  async function stopRuntimeResources(): Promise<void> {
    if (workerStarted) {
      await worker.stop();
      workerStarted = false;
    }

    if (startedServer !== undefined) {
      await startedServer.close();
      startedServer = undefined;
    }

    await stopWorkerRuntimeResources(resources);
    stopped = true;
  }

  return {
    app,
    request: async (path, init) => app.request(path, init),
    start: async () => {
      if (stopped) {
        throw new Error("Control plane worker runtime is already stopped.");
      }
      if (startedServer !== undefined || workerStarted) {
        throw new Error("Control plane worker runtime is already started.");
      }

      startedServer = startServer({
        app,
        host: runtimeConfig.app.server.host,
        port: runtimeConfig.app.server.port,
      });

      try {
        await worker.start();
        workerStarted = true;
      } catch (error) {
        await startedServer.close();
        startedServer = undefined;
        throw error;
      }
    },
    stop: async () => {
      if (stopped) {
        return;
      }
      if (stopPromise !== undefined) {
        await stopPromise;
        return;
      }

      stopPromise = stopRuntimeResources();

      await stopPromise;
    },
  };
}
