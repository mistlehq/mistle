import { createApp, getAppDatabase, stopApp } from "../app.js";
import { startServer } from "../server.js";
import type {
  ControlPlaneApiRuntime,
  ControlPlaneApiRuntimeConfig,
  StartedServer,
} from "../types.js";

export async function createControlPlaneApiRuntime(
  runtimeConfig: ControlPlaneApiRuntimeConfig,
): Promise<ControlPlaneApiRuntime> {
  const app = await createApp(runtimeConfig);
  const db = getAppDatabase(app);
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
    db,
    request: async (path, init) => app.request(path, init),
    start: async () => {
      if (stopped) {
        throw new Error("Control plane API runtime is already stopped.");
      }
      if (startedServer !== undefined) {
        throw new Error("Control plane API server is already started.");
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
