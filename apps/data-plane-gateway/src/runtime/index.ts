import type { DataPlaneGatewayConfig, DataPlaneGatewayRuntime, StartedServer } from "../types.js";

import { createApp } from "../app.js";
import { startServer } from "../server.js";

export function createDataPlaneGatewayRuntime(
  config: DataPlaneGatewayConfig,
): DataPlaneGatewayRuntime {
  const app = createApp();

  let startedServer: StartedServer | undefined;
  let stopPromise: Promise<void> | undefined;

  return {
    app,
    request: async (path, init) => app.request(path, init),
    start: () => {
      if (startedServer !== undefined) {
        throw new Error("Data plane gateway runtime is already started.");
      }

      startedServer = startServer({
        app,
        host: config.server.host,
        port: config.server.port,
      });
    },
    stop: async () => {
      if (startedServer === undefined) {
        return;
      }
      if (stopPromise !== undefined) {
        await stopPromise;
        return;
      }

      stopPromise = startedServer.close();

      await stopPromise;
      startedServer = undefined;
      stopPromise = undefined;
    },
  };
}
