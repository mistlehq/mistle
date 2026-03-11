import { createNodeWebSocket } from "@hono/node-ws";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";
import type { BootstrapTokenConfig } from "@mistle/gateway-tunnel-auth";
import { typeid } from "typeid-js";

import { createApp, stopApp } from "../app.js";
import { startServer } from "../server.js";
import { createInMemoryTunnelRelayCoordinator } from "../tunnel/create-in-memory-relay-coordinator.js";
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
  const nodeId = typeid("dpg").toString();
  const relayCoordinator = createInMemoryTunnelRelayCoordinator(nodeId);

  registerSandboxTunnelRoute({
    app,
    upgradeWebSocket: nodeWebSocket.upgradeWebSocket,
    bootstrapTokenConfig: {
      bootstrapTokenSecret: config.sandbox.bootstrap.tokenSecret,
      tokenIssuer: config.sandbox.bootstrap.tokenIssuer,
      tokenAudience: config.sandbox.bootstrap.tokenAudience,
    } satisfies BootstrapTokenConfig,
    connectionTokenConfig: {
      connectionTokenSecret: config.sandbox.connect.tokenSecret,
      tokenIssuer: config.sandbox.connect.tokenIssuer,
      tokenAudience: config.sandbox.connect.tokenAudience,
    } satisfies ConnectionTokenConfig,
    relayCoordinator,
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
