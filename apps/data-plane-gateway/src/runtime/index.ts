import { createNodeWebSocket } from "@hono/node-ws";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";
import type { BootstrapTokenConfig } from "@mistle/gateway-tunnel-auth";
import { systemClock, systemScheduler } from "@mistle/time";
import { typeid } from "typeid-js";
import type { WebSocketServer } from "ws";

import { createApp, stopApp } from "../app.js";
import { startServer } from "../server.js";
import { createInMemoryTunnelRelayCoordinator } from "../tunnel/create-in-memory-relay-coordinator.js";
import { LocalGatewayForwardingClientAdapter } from "../tunnel/gateway-forwarding/adapters/local-gateway-forwarding-client-adapter.js";
import { LocalGatewayForwardingServerAdapter } from "../tunnel/gateway-forwarding/adapters/local-gateway-forwarding-server-adapter.js";
import { InteractiveStreamRouter } from "../tunnel/gateway-forwarding/index.js";
import { InMemorySandboxOwnerStore } from "../tunnel/ownership/adapters/in-memory-sandbox-owner-store.js";
import { SandboxOwnerLeaseHeartbeat } from "../tunnel/ownership/sandbox-owner-lease-heartbeat.js";
import { StoreBackedSandboxOwnerResolver } from "../tunnel/ownership/store-backed-sandbox-owner-resolver.js";
import { registerSandboxTunnelRoute } from "../tunnel/register-sandbox-tunnel-route.js";
import { registerSandboxTunnelTokenExchangeRoute } from "../tunnel/register-sandbox-tunnel-token-exchange-route.js";
import { InMemoryTunnelSessionRegistryAdapter } from "../tunnel/tunnel-session/adapters/in-memory-tunnel-session-registry-adapter.js";
import { TunnelSessionRegistry } from "../tunnel/tunnel-session/index.js";
import type {
  DataPlaneGatewayRuntime,
  DataPlaneGatewayRuntimeConfig,
  StartedServer,
} from "../types.js";

const OwnerLeaseRenewIntervalMs = 10_000;
const DefaultMaxActiveBindingsPerSandbox = 32;

function closeWebSocketServer(webSocketServer: WebSocketServer): Promise<void> {
  for (const client of webSocketServer.clients) {
    client.terminate();
  }

  return new Promise((resolve, reject) => {
    webSocketServer.close((error?: Error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function createDataPlaneGatewayRuntime(
  config: DataPlaneGatewayRuntimeConfig,
): DataPlaneGatewayRuntime {
  const app = createApp(config.app);
  const nodeWebSocket = createNodeWebSocket({ app });
  const nodeId = typeid("dpg").toString();
  const relayCoordinator = createInMemoryTunnelRelayCoordinator(nodeId);
  const sandboxOwnerStore = new InMemorySandboxOwnerStore(systemClock);
  const sandboxOwnerResolver = new StoreBackedSandboxOwnerResolver(nodeId, sandboxOwnerStore);
  const tunnelSessionRegistry = new TunnelSessionRegistry(
    new InMemoryTunnelSessionRegistryAdapter(DefaultMaxActiveBindingsPerSandbox),
  );
  const gatewayForwardingServer = new LocalGatewayForwardingServerAdapter(tunnelSessionRegistry);
  const gatewayForwardingClient = new LocalGatewayForwardingClientAdapter(
    nodeId,
    gatewayForwardingServer,
  );
  const interactiveStreamRouter = new InteractiveStreamRouter(
    nodeId,
    sandboxOwnerResolver,
    gatewayForwardingClient,
  );
  const sandboxOwnerLeaseHeartbeat = new SandboxOwnerLeaseHeartbeat(
    sandboxOwnerStore,
    systemScheduler,
    OwnerLeaseRenewIntervalMs,
  );

  registerSandboxTunnelRoute({
    app,
    upgradeWebSocket: nodeWebSocket.upgradeWebSocket,
    gatewayNodeId: nodeId,
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
    interactiveStreamRouter,
    relayCoordinator,
    tunnelSessionRegistry,
    sandboxOwnerStore,
    sandboxOwnerResolver,
    sandboxOwnerLeaseHeartbeat,
  });
  registerSandboxTunnelTokenExchangeRoute({
    app,
    bootstrapTokenConfig: {
      bootstrapTokenSecret: config.sandbox.bootstrap.tokenSecret,
      tokenIssuer: config.sandbox.bootstrap.tokenIssuer,
      tokenAudience: config.sandbox.bootstrap.tokenAudience,
    },
    tunnelExchangeTokenConfig: {
      tokenSecret: config.sandbox.bootstrap.tokenSecret,
      tokenIssuer: config.sandbox.bootstrap.tokenIssuer,
      tokenAudience: config.sandbox.bootstrap.tokenAudience,
    },
  });

  let startedServer: StartedServer | undefined;
  let stopPromise: Promise<void> | undefined;
  let stopped = false;

  async function stopRuntimeResources(): Promise<void> {
    await closeWebSocketServer(nodeWebSocket.wss);

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
