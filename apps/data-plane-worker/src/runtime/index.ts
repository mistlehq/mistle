import { createApp } from "../app.js";
import { startServer } from "../server.js";
import type {
  DataPlaneWorkerRuntime,
  DataPlaneWorkerRuntimeConfig,
  StartedServer,
} from "../types.js";
import { createWorkerRuntimeResources, stopWorkerRuntimeResources } from "./resources.js";
import { createRuntimeWorker } from "./worker.js";

export async function createDataPlaneWorkerRuntime(
  config: DataPlaneWorkerRuntimeConfig,
): Promise<DataPlaneWorkerRuntime> {
  const app = createApp();
  const resources = await createWorkerRuntimeResources(config);
  let worker: ReturnType<typeof createRuntimeWorker>;

  try {
    worker = createRuntimeWorker({
      config,
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
        throw new Error("Data plane worker runtime is already stopped.");
      }
      if (startedServer !== undefined || workerStarted) {
        throw new Error("Data plane worker runtime is already started.");
      }

      startedServer = startServer({
        app,
        host: config.app.server.host,
        port: config.app.server.port,
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
