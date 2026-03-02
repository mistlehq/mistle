import { createNodeWebSocket } from "@hono/node-ws";
import type { BootstrapTokenConfig } from "@mistle/gateway-tunnel-auth";

import { createApp, stopApp } from "../app.js";
import { startServer } from "../server.js";
import { registerSandboxTunnelRoute } from "../tunnel/register-sandbox-tunnel-route.js";
import type {
  DataPlaneGatewayRuntime,
  DataPlaneGatewayRuntimeConfig,
  StartedServer,
} from "../types.js";

export function createDataPlaneGatewayRuntime(
  config: DataPlaneGatewayRuntimeConfig,
): DataPlaneGatewayRuntime {
  const app = createApp(config.app);
  const nodeWebSocket = createNodeWebSocket({ app });

  registerSandboxTunnelRoute({
    app,
    upgradeWebSocket: nodeWebSocket.upgradeWebSocket,
    bootstrapTokenConfig: {
      bootstrapTokenSecret: config.tunnel.bootstrapTokenSecret,
      tokenIssuer: config.tunnel.tokenIssuer,
      tokenAudience: config.tunnel.tokenAudience,
    } satisfies BootstrapTokenConfig,
  });

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
        throw new Error("Data plane gateway runtime is already stopped.");
      }
      if (startedServer !== undefined) {
        throw new Error("Data plane gateway runtime is already started.");
      }

      startedServer = startServer({
        app,
        host: config.app.server.host,
        port: config.app.server.port,
      });
      nodeWebSocket.injectWebSocket(startedServer.server);
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
