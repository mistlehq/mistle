import type { DataPlaneApiConfig, DataPlaneApiRuntime, StartedServer } from "../types.js";

import { createApp, stopApp } from "../app.js";
import { startServer } from "../server.js";

export async function createDataPlaneApiRuntime(
  config: DataPlaneApiConfig,
): Promise<DataPlaneApiRuntime> {
  const app = await createApp(config);
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
    start: () => {
      if (stopped) {
        throw new Error("Data plane API runtime is already stopped.");
      }
      if (startedServer !== undefined) {
        throw new Error("Data plane API server is already started.");
      }

      startedServer = startServer({
        app,
        host: config.server.host,
        port: config.server.port,
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
