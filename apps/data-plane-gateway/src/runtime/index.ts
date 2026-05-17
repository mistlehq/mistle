import { createNodeWebSocket } from "@hono/node-ws";
import {
  Cache,
  InMemoryCacheAdapter,
  ValkeyCacheAdapter,
  closeValkeyClient,
  connectValkeyClient,
  createValkeyClient,
  type ValkeyClient,
} from "@mistle/cache";
import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";
import type { BootstrapTokenConfig } from "@mistle/gateway-tunnel-auth";
import { systemClock, systemScheduler } from "@mistle/time";
import { connect, type NatsConnection } from "@nats-io/transport-node";
import { typeid } from "typeid-js";
import WebSocket, { type WebSocketServer } from "ws";

import { createApp, stopApp } from "../app.js";
import { SandboxDeadlineLifecycleCoordinator } from "../deadlines/sandbox-deadline-lifecycle-coordinator.js";
import {
  DefaultDataPlaneGatewayLifecycleDurations,
  SandboxInstanceDeadlineService,
} from "../deadlines/sandbox-instance-deadline-service.js";
import { ActiveSandboxRuntimePlanCache } from "../egress/active-runtime-plan-cache.js";
import { CredentialCache } from "../egress/credential-cache.js";
import { GatewayEgressTransportService } from "../egress/egress-transport-service.js";
import { SandboxEgressTokenService } from "../egress/sandbox-egress-token-service.js";
import { registerSandboxBootstrapAttachmentTerminateRoute } from "../internal/runtime-state/register-sandbox-bootstrap-attachment-terminate-route.js";
import { registerSandboxRuntimeStateRoute } from "../internal/runtime-state/register-sandbox-runtime-state-route.js";
import { logger } from "../logger.js";
import { createPortAccessNodeEntrypoint } from "../publishing/port-access-node-entrypoint.js";
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
import { installPortAccessUpgradeEntrypoint, startServer } from "../server.js";
import { LocalGatewayForwardingClientAdapter } from "../tunnel/gateway-forwarding/adapters/local-gateway-forwarding-client-adapter.js";
import { LocalGatewayForwardingServerAdapter } from "../tunnel/gateway-forwarding/adapters/local-gateway-forwarding-server-adapter.js";
import { NatsGatewayForwardingAdapter } from "../tunnel/gateway-forwarding/adapters/nats-gateway-forwarding-adapter.js";
import type { GatewayForwardingClientAdapter } from "../tunnel/gateway-forwarding/gateway-forwarding-client-adapter.js";
import { InteractiveStreamRouter } from "../tunnel/gateway-forwarding/index.js";
import { InMemoryLocalPeerRegistryAdapter } from "../tunnel/local-peer-registry/adapters/in-memory-local-peer-registry-adapter.js";
import { LocalRelayPeerResolver } from "../tunnel/local-peer-registry/local-relay-peer-resolver.js";
import { SandboxOperationIngressService } from "../tunnel/operation-ingress/index.js";
import { AttachmentBackedSandboxOwnerResolver } from "../tunnel/ownership/attachment-backed-sandbox-owner-resolver.js";
import { registerSandboxTunnelRoute } from "../tunnel/register-sandbox-tunnel-route.js";
import { registerSandboxTunnelTokenExchangeRoute } from "../tunnel/register-sandbox-tunnel-token-exchange-route.js";
import { TunnelRelayCoordinator } from "../tunnel/relay-coordinator.js";
import type { RelayPeerResolver } from "../tunnel/relay-peer-resolver.js";
import { NatsRelayPeerResolver } from "../tunnel/relay-peer-resolvers/nats-relay-peer-resolver.js";
import { InMemoryRelayTransportAdapter } from "../tunnel/relay-transport/adapters/in-memory-relay-transport-adapter.js";
import { NatsRelayTransportAdapter } from "../tunnel/relay-transport/adapters/nats-relay-transport-adapter.js";
import type { RelayTransportAdapter } from "../tunnel/relay-transport/relay-transport-adapter.js";
import { SandboxSigningRequestService } from "../tunnel/signing/sandbox-signing-request-service.js";
import {
  createSandboxTelemetryIngressSink,
  SandboxTelemetryIngressService,
} from "../tunnel/telemetry-ingress/index.js";
import { InMemoryTunnelSessionRegistryAdapter } from "../tunnel/tunnel-session/adapters/in-memory-tunnel-session-registry-adapter.js";
import { TunnelSessionRegistry } from "../tunnel/tunnel-session/index.js";
import type {
  DataPlaneGatewayConfig,
  DataPlaneGatewayRuntime,
  DataPlaneGatewayRuntimeConfig,
  StartedServer,
} from "../types.js";
import { AsyncTaskTracker } from "./async-task-tracker.js";

const DefaultMaxActiveBindingsPerSandbox = 32;

type GatewayRelayRuntimeResources = {
  gatewayForwardingClient: GatewayForwardingClientAdapter;
  relayCoordinator: TunnelRelayCoordinator;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

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

function createGatewayRelayRuntimeResources(input: {
  activeBootstrapSessionStore: ReturnType<typeof createAttachmentBackedActiveBootstrapSessionStore>;
  config: DataPlaneGatewayConfig["gatewayRelay"];
  gatewayForwardingServer: LocalGatewayForwardingServerAdapter;
  nodeId: string;
}): GatewayRelayRuntimeResources {
  const peerRegistry = new InMemoryLocalPeerRegistryAdapter();
  let relayTransport: RelayTransportAdapter;
  let peerResolver: RelayPeerResolver;
  let gatewayForwardingClient: GatewayForwardingClientAdapter;
  let natsConnection: NatsConnection | undefined;
  let natsRelayTransport: NatsRelayTransportAdapter | undefined;
  let natsPeerResolver: NatsRelayPeerResolver | undefined;
  let natsGatewayForwarding: NatsGatewayForwardingAdapter | undefined;

  if (input.config.backend === "memory") {
    relayTransport = new InMemoryRelayTransportAdapter(input.nodeId);
    peerResolver = new LocalRelayPeerResolver(peerRegistry);
    gatewayForwardingClient = new LocalGatewayForwardingClientAdapter(
      input.nodeId,
      input.gatewayForwardingServer,
    );
  } else {
    const subjectPrefix = `${input.config.nats.namePrefix}.gateway`;
    natsRelayTransport = new NatsRelayTransportAdapter(input.nodeId, subjectPrefix);
    natsPeerResolver = new NatsRelayPeerResolver(
      input.nodeId,
      subjectPrefix,
      input.activeBootstrapSessionStore,
      peerRegistry,
      systemClock,
    );
    natsGatewayForwarding = new NatsGatewayForwardingAdapter(
      input.nodeId,
      subjectPrefix,
      input.gatewayForwardingServer,
    );
    relayTransport = natsRelayTransport;
    peerResolver = natsPeerResolver;
    gatewayForwardingClient = natsGatewayForwarding;
  }

  return {
    gatewayForwardingClient,
    relayCoordinator: new TunnelRelayCoordinator(
      input.nodeId,
      peerRegistry,
      relayTransport,
      peerResolver,
    ),
    start: async () => {
      if (input.config.backend === "memory") {
        return;
      }
      if (
        natsRelayTransport === undefined ||
        natsPeerResolver === undefined ||
        natsGatewayForwarding === undefined
      ) {
        throw new Error("Expected NATS gateway relay resources to be initialized.");
      }
      if (natsConnection !== undefined) {
        throw new Error("NATS gateway relay resources are already started.");
      }

      const connection = await connect({
        name: `mistle-data-plane-gateway-${input.nodeId}`,
        noEcho: true,
        servers: input.config.nats.url,
      });
      natsConnection = connection;
      natsRelayTransport.start(connection);
      natsPeerResolver.start(connection);
      natsGatewayForwarding.start(connection);
    },
    stop: async () => {
      if (input.config.backend === "memory") {
        return;
      }

      await natsGatewayForwarding?.stop();
      await natsPeerResolver?.stop();
      await natsRelayTransport?.stop();
      const connection = natsConnection;
      natsConnection = undefined;
      await connection?.close();
    },
  };
}

export function createDataPlaneGatewayRuntime(
  config: DataPlaneGatewayRuntimeConfig,
): DataPlaneGatewayRuntime {
  const app = createApp(config.app);
  const nodeWebSocket = createNodeWebSocket({ app });
  const nodeId = typeid("dpg").toString();
  const sandboxTunnelTaskTracker = new AsyncTaskTracker();
  let hasValkeyClient = false;
  let valkeyClient!: ValkeyClient;
  let sandboxKeepaliveStore: InMemorySandboxKeepaliveStore | ValkeySandboxKeepaliveStore;
  let sandboxPresenceStore: InMemorySandboxPresenceStore | ValkeySandboxPresenceStore;
  let sandboxRuntimeReadinessStore:
    | InMemorySandboxRuntimeReadinessStore
    | ValkeySandboxRuntimeReadinessStore;
  let sandboxRuntimeAttachmentStore:
    | InMemorySandboxRuntimeAttachmentStore
    | ValkeySandboxRuntimeAttachmentStore;
  let activeRuntimePlanCache: ActiveSandboxRuntimePlanCache;
  let credentialCache: CredentialCache;

  if (config.app.runtimeState.backend === "memory") {
    sandboxKeepaliveStore = new InMemorySandboxKeepaliveStore(systemClock);
    sandboxPresenceStore = new InMemorySandboxPresenceStore(systemClock);
    sandboxRuntimeReadinessStore = new InMemorySandboxRuntimeReadinessStore();
    sandboxRuntimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(systemClock);
    activeRuntimePlanCache = new ActiveSandboxRuntimePlanCache(
      new Cache({
        adapter: new InMemoryCacheAdapter(),
      }),
    );
    credentialCache = new CredentialCache({
      cache: new Cache({
        adapter: new InMemoryCacheAdapter(),
      }),
      defaultTtlSeconds: 300,
      refreshSkewSeconds: 30,
      now: () => Date.now(),
    });
  } else {
    const valkeyConfig = config.app.runtimeState.valkey;
    if (valkeyConfig === undefined) {
      throw new Error(
        "Expected gateway runtimeState.valkey config when runtimeState.backend is 'valkey'.",
      );
    }

    valkeyClient = createValkeyClient({
      onError: (error) => {
        logger.error(
          {
            err: error,
          },
          "Valkey runtime-state client error",
        );
      },
      url: valkeyConfig.url,
    });
    hasValkeyClient = true;

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
    activeRuntimePlanCache = new ActiveSandboxRuntimePlanCache(
      new Cache({
        adapter: new ValkeyCacheAdapter(valkeyClient, valkeyConfig.keyPrefix),
      }),
    );
    credentialCache = new CredentialCache({
      cache: new Cache({
        adapter: new ValkeyCacheAdapter(valkeyClient, valkeyConfig.keyPrefix),
      }),
      defaultTtlSeconds: 300,
      refreshSkewSeconds: 30,
      now: () => Date.now(),
    });
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
  const relayResources = createGatewayRelayRuntimeResources({
    activeBootstrapSessionStore,
    config: config.app.gatewayRelay,
    gatewayForwardingServer,
    nodeId,
  });
  const relayCoordinator = relayResources.relayCoordinator;
  const gatewayForwardingClient = relayResources.gatewayForwardingClient;
  const interactiveStreamRouter = new InteractiveStreamRouter(
    nodeId,
    sandboxOwnerResolver,
    gatewayForwardingClient,
  );
  const portsTargetAuthorizeService = new PortsTargetAuthorizeService(
    relayCoordinator,
    systemScheduler,
  );
  const portAccessTransportService = new PortAccessTransportService(
    relayCoordinator,
    tunnelSessionRegistry,
    {
      clock: systemClock,
      scheduler: systemScheduler,
    },
  );
  const gatewayEgressTransportService = new GatewayEgressTransportService(
    activeRuntimePlanCache,
    config.app.controlPlaneApi.publicBaseUrl,
    new ControlPlaneInternalClient({
      baseUrl: config.app.controlPlaneApi.baseUrl,
      internalAuthServiceToken: config.app.internalAuth.serviceToken,
      ...(config.app.__dangerouslyEnableTestIsolation === undefined
        ? {}
        : {
            testEnvironmentIdHeader:
              config.app.__dangerouslyEnableTestIsolation.testEnvironmentIdHeader,
          }),
    }),
    credentialCache,
  );
  const portAccessNodeEntrypoint = createPortAccessNodeEntrypoint({
    bootstrapTokenConfig: {
      tokenSecret: config.app.sandbox.publish.access.tokenSecret,
      tokenIssuer: config.app.sandbox.publish.access.tokenIssuer,
      tokenAudience: config.app.sandbox.publish.access.tokenAudience,
    },
    clock: systemClock,
    hostConfig: {
      baseDomain: config.app.sandbox.publish.baseDomain,
    },
    portAccessTransportService,
    portsTargetAuthorizeService,
    sessionConfig: {
      cookieSigningSecret: config.app.sandbox.publish.session.cookieSigningSecret,
    },
  });
  const sandboxSigningRequestService = new SandboxSigningRequestService({
    bootstrapTokenSecret: config.app.sandbox.bootstrap.tokenSecret,
    tokenIssuer: config.app.sandbox.bootstrap.tokenIssuer,
    tokenAudience: config.app.sandbox.bootstrap.tokenAudience,
    controlPlaneClient: new ControlPlaneInternalClient({
      baseUrl: config.app.controlPlaneApi.baseUrl,
      internalAuthServiceToken: config.app.internalAuth.serviceToken,
      ...(config.app.__dangerouslyEnableTestIsolation === undefined
        ? {}
        : {
            testEnvironmentIdHeader:
              config.app.__dangerouslyEnableTestIsolation.testEnvironmentIdHeader,
          }),
    }),
  });
  const sandboxEgressTokenService = new SandboxEgressTokenService({
    tokenSecret: config.app.sandbox.egress.tokenSecret,
    tokenIssuer: config.app.sandbox.egress.tokenIssuer,
    tokenAudience: config.app.sandbox.egress.tokenAudience,
  });
  const telemetryIngressSink = createSandboxTelemetryIngressSink({
    clock: systemClock,
    gatewayNodeId: nodeId,
    telemetry: config.app.telemetry,
  });
  const telemetryIngressService = new SandboxTelemetryIngressService(telemetryIngressSink);
  const operationIngressService = new SandboxOperationIngressService();
  const dataPlaneClient = createDataPlaneSandboxInstancesClient({
    baseUrl: config.app.dataPlaneApi.baseUrl,
    serviceToken: config.app.internalAuth.serviceToken,
    ...(config.app.__dangerouslyEnableTestIsolation === undefined
      ? {}
      : {
          testEnvironmentIdHeader:
            config.app.__dangerouslyEnableTestIsolation.testEnvironmentIdHeader,
        }),
  });
  const sandboxInstanceDeadlineService = new SandboxInstanceDeadlineService(
    dataPlaneClient,
    systemClock,
    DefaultDataPlaneGatewayLifecycleDurations,
  );
  const sandboxDeadlineLifecycleCoordinator = new SandboxDeadlineLifecycleCoordinator();

  registerSandboxRuntimeStateRoute({
    app,
    clock: systemClock,
    internalAuthServiceToken: config.app.internalAuth.serviceToken,
    activeBootstrapSessionStore,
    sandboxKeepaliveStore,
    sandboxPresenceStore,
    sandboxRuntimeReadinessStore,
  });
  registerSandboxBootstrapAttachmentTerminateRoute({
    app,
    clock: systemClock,
    internalAuthServiceToken: config.app.internalAuth.serviceToken,
    activeBootstrapSessionStore,
    sandboxRuntimeAttachmentStore,
    relayCoordinator,
  });

  registerSandboxTunnelRoute({
    app,
    upgradeWebSocket: nodeWebSocket.upgradeWebSocket,
    gatewayNodeId: nodeId,
    bootstrapTokenConfig: {
      bootstrapTokenSecret: config.app.sandbox.bootstrap.tokenSecret,
      tokenIssuer: config.app.sandbox.bootstrap.tokenIssuer,
      tokenAudience: config.app.sandbox.bootstrap.tokenAudience,
    } satisfies BootstrapTokenConfig,
    connectionTokenConfig: {
      connectionTokenSecret: config.app.sandbox.connect.tokenSecret,
      tokenIssuer: config.app.sandbox.connect.tokenIssuer,
      tokenAudience: config.app.sandbox.connect.tokenAudience,
    } satisfies ConnectionTokenConfig,
    sandboxSigningRequestService,
    sandboxEgressTokenService,
    portAccessTransportService,
    portsTargetAuthorizeService,
    interactiveStreamRouter,
    relayCoordinator,
    tunnelSessionRegistry,
    sandboxOwnerResolver,
    sandboxKeepaliveStore,
    sandboxRuntimeReadinessStore,
    sandboxPresenceStore,
    sandboxRuntimeAttachmentStore,
    activeBootstrapSessionStore,
    sandboxInstanceDeadlineService,
    sandboxDeadlineLifecycleCoordinator,
    operationIngressService,
    telemetryIngressService,
    sandboxTunnelTaskTracker,
    gatewayEgressTransportService,
    allowRemoteOwnerConnections: config.app.gatewayRelay.backend === "nats",
    clock: systemClock,
    scheduler: systemScheduler,
  });
  registerSandboxTunnelTokenExchangeRoute({
    app,
    bootstrapTokenConfig: {
      bootstrapTokenSecret: config.app.sandbox.bootstrap.tokenSecret,
      tokenIssuer: config.app.sandbox.bootstrap.tokenIssuer,
      tokenAudience: config.app.sandbox.bootstrap.tokenAudience,
    },
    tunnelExchangeTokenConfig: {
      tokenSecret: config.app.sandbox.bootstrap.tokenSecret,
      tokenIssuer: config.app.sandbox.bootstrap.tokenIssuer,
      tokenAudience: config.app.sandbox.bootstrap.tokenAudience,
    },
  });
  registerPortAccessRoutes({
    app,
    bootstrapTokenConfig: {
      tokenSecret: config.app.sandbox.publish.access.tokenSecret,
      tokenIssuer: config.app.sandbox.publish.access.tokenIssuer,
      tokenAudience: config.app.sandbox.publish.access.tokenAudience,
    },
    hostConfig: {
      baseDomain: config.app.sandbox.publish.baseDomain,
    },
    portAccessTransportService,
    sessionConfig: {
      cookieSigningSecret: config.app.sandbox.publish.session.cookieSigningSecret,
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
    operationIngressService.shutdown();
    await telemetryIngressService.shutdown();
    await relayResources.stop();

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
      gatewayEgressTransportService,
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
      await relayResources.start();

      startedServer = startServer({
        app,
        host: config.app.server.host,
        port: config.app.server.port,
      });
      nodeWebSocket.injectWebSocket(startedServer.server);
      installPortAccessUpgradeEntrypoint({
        portAccessNodeEntrypoint,
        server: startedServer.server,
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
