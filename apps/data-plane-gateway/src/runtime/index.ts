import { createNodeWebSocket } from "@hono/node-ws";
import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";
import type { BootstrapTokenConfig } from "@mistle/gateway-tunnel-auth";
import { systemClock, systemScheduler } from "@mistle/time";
import { typeid } from "typeid-js";
import WebSocket, { type WebSocketServer } from "ws";

import { createApp, stopApp } from "../app.js";
import {
  resolveDataPlaneGatewayLifecycleDurations,
  SandboxInstanceDeadlineService,
} from "../deadlines/sandbox-instance-deadline-service.js";
import { registerSandboxRuntimeStateRoute } from "../internal/runtime-state/register-sandbox-runtime-state-route.js";
import { PortAccessTransportService } from "../publishing/port-access-transport.js";
import { PortsTargetAuthorizeService } from "../publishing/ports-target-authorize-service.js";
import { registerPortAccessRoutes } from "../publishing/register-port-access-routes.js";
import { createAttachmentBackedActiveBootstrapSessionStore } from "../runtime-state/active-bootstrap-session-store.js";
import { InMemorySandboxKeepaliveStore } from "../runtime-state/adapters/in-memory-sandbox-keepalive-store.js";
import { InMemorySandboxPresenceStore } from "../runtime-state/adapters/in-memory-sandbox-presence-store.js";
import { InMemorySandboxRuntimeAttachmentStore } from "../runtime-state/adapters/in-memory-sandbox-runtime-attachment-store.js";
import { InMemorySandboxRuntimeReadinessStore } from "../runtime-state/adapters/in-memory-sandbox-runtime-readiness-store.js";
import { ValkeySandboxKeepaliveStore } from "../runtime-state/adapters/valkey-sandbox-keepalive-store.js";
import { ValkeySandboxPresenceStore } from "../runtime-state/adapters/valkey-sandbox-presence-store.js";
import { ValkeySandboxRuntimeAttachmentStore } from "../runtime-state/adapters/valkey-sandbox-runtime-attachment-store.js";
import { ValkeySandboxRuntimeReadinessStore } from "../runtime-state/adapters/valkey-sandbox-runtime-readiness-store.js";
import {
  connectValkeyClient,
  createValkeyClient,
  type ValkeyClient,
  closeValkeyClient,
} from "../runtime-state/valkey-client.js";
import { startServer } from "../server.js";
import { createInMemoryTunnelRelayCoordinator } from "../tunnel/create-in-memory-relay-coordinator.js";
import { LocalGatewayForwardingClientAdapter } from "../tunnel/gateway-forwarding/adapters/local-gateway-forwarding-client-adapter.js";
import { LocalGatewayForwardingServerAdapter } from "../tunnel/gateway-forwarding/adapters/local-gateway-forwarding-server-adapter.js";
import { InteractiveStreamRouter } from "../tunnel/gateway-forwarding/index.js";
import { InMemorySandboxOwnerStore } from "../tunnel/ownership/adapters/in-memory-sandbox-owner-store.js";
import { ValkeySandboxOwnerStore } from "../tunnel/ownership/adapters/valkey-sandbox-owner-store.js";
import { AttachmentBackedSandboxOwnerResolver } from "../tunnel/ownership/attachment-backed-sandbox-owner-resolver.js";
import { registerSandboxTunnelRoute } from "../tunnel/register-sandbox-tunnel-route.js";
import { registerSandboxTunnelTokenExchangeRoute } from "../tunnel/register-sandbox-tunnel-token-exchange-route.js";
import { SandboxSigningRequestService } from "../tunnel/signing/sandbox-signing-request-service.js";
import {
  createSandboxTelemetryIngressSink,
  SandboxTelemetryIngressService,
} from "../tunnel/telemetry-ingress/index.js";
import { InMemoryTunnelSessionRegistryAdapter } from "../tunnel/tunnel-session/adapters/in-memory-tunnel-session-registry-adapter.js";
import { TunnelSessionRegistry } from "../tunnel/tunnel-session/index.js";
import type {
  DataPlaneGatewayRuntime,
  DataPlaneGatewayRuntimeConfig,
  StartedServer,
} from "../types.js";
import { AsyncTaskTracker } from "./async-task-tracker.js";

const DefaultMaxActiveBindingsPerSandbox = 32;

function closeWebSocketClient(client: WebSocket): Promise<void> {
  if (client.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const cleanup = (): void => {
      client.off("close", onClose);
      client.off("error", onError);
    };
    const onClose = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      resolve();
    };

    client.once("close", onClose);
    client.once("error", onError);
    client.terminate();
  });
}

async function closeWebSocketServer(webSocketServer: WebSocketServer): Promise<void> {
  await Promise.all([...webSocketServer.clients].map(closeWebSocketClient));

  await new Promise<void>((resolve, reject) => {
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
  const sandboxTunnelTaskTracker = new AsyncTaskTracker();
  let hasValkeyClient = false;
  let valkeyClient!: ValkeyClient;
  let sandboxOwnerStore: InMemorySandboxOwnerStore | ValkeySandboxOwnerStore;
  let sandboxKeepaliveStore: InMemorySandboxKeepaliveStore | ValkeySandboxKeepaliveStore;
  let sandboxPresenceStore: InMemorySandboxPresenceStore | ValkeySandboxPresenceStore;
  let sandboxRuntimeReadinessStore:
    | InMemorySandboxRuntimeReadinessStore
    | ValkeySandboxRuntimeReadinessStore;
  let sandboxRuntimeAttachmentStore:
    | InMemorySandboxRuntimeAttachmentStore
    | ValkeySandboxRuntimeAttachmentStore;

  if (config.app.runtimeState.backend === "memory") {
    sandboxOwnerStore = new InMemorySandboxOwnerStore(systemClock);
    sandboxKeepaliveStore = new InMemorySandboxKeepaliveStore(systemClock);
    sandboxPresenceStore = new InMemorySandboxPresenceStore(systemClock);
    sandboxRuntimeReadinessStore = new InMemorySandboxRuntimeReadinessStore();
    sandboxRuntimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(systemClock);
  } else {
    const valkeyConfig = config.app.runtimeState.valkey;
    if (valkeyConfig === undefined) {
      throw new Error(
        "Expected gateway runtimeState.valkey config when runtimeState.backend is 'valkey'.",
      );
    }

    valkeyClient = createValkeyClient({
      url: valkeyConfig.url,
    });
    hasValkeyClient = true;

    sandboxOwnerStore = new ValkeySandboxOwnerStore(valkeyClient, valkeyConfig.keyPrefix);
    sandboxKeepaliveStore = new ValkeySandboxKeepaliveStore(valkeyClient, valkeyConfig.keyPrefix);
    sandboxPresenceStore = new ValkeySandboxPresenceStore(valkeyClient, valkeyConfig.keyPrefix);
    sandboxRuntimeReadinessStore = new ValkeySandboxRuntimeReadinessStore(
      valkeyClient,
      valkeyConfig.keyPrefix,
    );
    sandboxRuntimeAttachmentStore = new ValkeySandboxRuntimeAttachmentStore(
      valkeyClient,
      valkeyConfig.keyPrefix,
    );
  }
  const activeBootstrapSessionStore = createAttachmentBackedActiveBootstrapSessionStore(
    sandboxRuntimeAttachmentStore,
  );
  const sandboxOwnerResolver = new AttachmentBackedSandboxOwnerResolver(
    nodeId,
    activeBootstrapSessionStore,
    systemClock,
  );
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
  const portsTargetAuthorizeService = new PortsTargetAuthorizeService(
    relayCoordinator,
    systemScheduler,
  );
  const portAccessTransportService = new PortAccessTransportService(relayCoordinator);
  const sandboxSigningRequestService = new SandboxSigningRequestService({
    bootstrapTokenSecret: config.sandbox.bootstrap.tokenSecret,
    tokenIssuer: config.sandbox.bootstrap.tokenIssuer,
    tokenAudience: config.sandbox.bootstrap.tokenAudience,
    controlPlaneClient: new ControlPlaneInternalClient({
      baseUrl: config.app.controlPlaneApi.baseUrl,
      internalAuthServiceToken: config.internalAuth.serviceToken,
    }),
  });
  const telemetryIngressSink = createSandboxTelemetryIngressSink({
    clock: systemClock,
    gatewayNodeId: nodeId,
    telemetry: config.telemetry,
  });
  const telemetryIngressService = new SandboxTelemetryIngressService(telemetryIngressSink);
  const dataPlaneClient = createDataPlaneSandboxInstancesClient({
    baseUrl: config.app.dataPlaneApi.baseUrl,
    serviceToken: config.internalAuth.serviceToken,
  });
  const sandboxInstanceDeadlineService = new SandboxInstanceDeadlineService(
    dataPlaneClient,
    systemClock,
    resolveDataPlaneGatewayLifecycleDurations(config.app.lifecycle),
  );

  registerSandboxRuntimeStateRoute({
    app,
    clock: systemClock,
    internalAuthServiceToken: config.internalAuth.serviceToken,
    activeBootstrapSessionStore,
    sandboxKeepaliveStore,
    sandboxPresenceStore,
    sandboxRuntimeReadinessStore,
  });

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
    sandboxSigningRequestService,
    portAccessTransportService,
    portsTargetAuthorizeService,
    interactiveStreamRouter,
    relayCoordinator,
    tunnelSessionRegistry,
    sandboxOwnerStore,
    sandboxOwnerResolver,
    sandboxKeepaliveStore,
    sandboxRuntimeReadinessStore,
    sandboxPresenceStore,
    sandboxRuntimeAttachmentStore,
    activeBootstrapSessionStore,
    sandboxInstanceDeadlineService,
    telemetryIngressService,
    sandboxTunnelTaskTracker,
    clock: systemClock,
    scheduler: systemScheduler,
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
  registerPortAccessRoutes({
    app,
    upgradeWebSocket: nodeWebSocket.upgradeWebSocket,
    bootstrapTokenConfig: {
      tokenSecret: config.sandbox.publish.access.tokenSecret,
      tokenIssuer: config.sandbox.publish.access.tokenIssuer,
      tokenAudience: config.sandbox.publish.access.tokenAudience,
    },
    hostConfig: {
      baseDomain: config.sandbox.publish.baseDomain,
    },
    portAccessTransportService,
    sessionConfig: {
      cookieSigningSecret: config.sandbox.publish.session.cookieSigningSecret,
    },
    portsTargetAuthorizeService,
    clock: systemClock,
  });

  let startedServer: StartedServer | undefined;
  let stopPromise: Promise<void> | undefined;
  let stopped = false;

  async function stopRuntimeResources(): Promise<void> {
    await closeWebSocketServer(nodeWebSocket.wss);
    await sandboxTunnelTaskTracker.drain();
    await telemetryIngressService.shutdown();

    if (startedServer !== undefined) {
      await startedServer.close();
      startedServer = undefined;
    }

    if (hasValkeyClient) {
      await closeValkeyClient(valkeyClient);
      hasValkeyClient = false;
    }

    await stopApp(app);
    stopped = true;
  }

  return {
    app,
    internals: {
      portAccessTransportService,
      portsTargetAuthorizeService,
    },
    request: async (path, init) => app.request(path, init),
    start: async () => {
      if (stopped) {
        throw new Error("Data plane gateway runtime is already stopped.");
      }
      if (startedServer !== undefined) {
        throw new Error("Data plane gateway runtime is already started.");
      }
      if (hasValkeyClient) {
        await connectValkeyClient(valkeyClient);
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
