import { createApp, stopApp } from "../app.js";
import { startServer } from "../server.js";
import type { DataPlaneApiRuntime, DataPlaneApiRuntimeConfig, StartedServer } from "../types.js";

export async function createDataPlaneApiRuntime(
  runtimeConfig: DataPlaneApiRuntimeConfig,
): Promise<DataPlaneApiRuntime> {
  const app = await createApp(runtimeConfig);
  let startedServer: StartedServer | undefined;
  let stopPromise: Promise<void> | undefined;
  let stopped = false;

  async function stopRuntimeResources(): Promise<void> {
    if (startedServer !== undefined) {
      await startedServer.close();
      startedServer = undefined;
    }

    await stopApp(app);
    stopped = true;
  }

  return {
    app,
    request: async (path, init) => app.request(path, init),
    start: async () => {
      if (stopped) {
        throw new Error("Data plane API runtime is already stopped.");
      }
      if (startedServer !== undefined) {
        throw new Error("Data plane API server is already started.");
      }

      startedServer = startServer({
        app,
        host: runtimeConfig.app.server.host,
        port: runtimeConfig.app.server.port,
      });
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
