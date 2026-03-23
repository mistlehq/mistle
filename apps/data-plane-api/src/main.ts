import { createApp } from "./app.js";
import { createAppResources, stopAppResources } from "./resources.js";
import { startServer } from "./server.js";
import type {
  DataPlaneApiRuntime,
  DataPlaneApiRuntimeConfig,
  DataPlaneApp,
  StartedServer,
} from "./types.js";

export async function createDataPlaneApiRuntime(
  runtimeConfig: DataPlaneApiRuntimeConfig,
): Promise<DataPlaneApiRuntime> {
  const resources = await createAppResources(runtimeConfig);
  let app: DataPlaneApp;

  try {
    app = createApp({
      config: runtimeConfig.app,
      internalAuthServiceToken: runtimeConfig.internalAuthServiceToken,
      resources,
      sandboxProvider: runtimeConfig.sandboxProvider,
    });
  } catch (error) {
    await stopAppResources(resources);
    throw error;
  }

  let startedServer: StartedServer | undefined;
  let stopPromise: Promise<void> | undefined;
  let stopped = false;

  async function stopRuntimeResources(): Promise<void> {
    if (startedServer !== undefined) {
      await startedServer.close();
      startedServer = undefined;
    }

    await stopAppResources(resources);
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
