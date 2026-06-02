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
import type { BootstrapTokenConfig, PtyTransportTokenConfig } from "@mistle/gateway-tunnel-auth";
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
import { DirectEgressProxyService } from "../egress/direct-egress-proxy-service.js";
import { registerDirectEgressRoutes } from "../egress/register-direct-egress-routes.js";
import { SandboxEgressTokenService } from "../egress/sandbox-egress-token-service.js";
import { registerCredentialCacheInvalidationRoute } from "../internal/egress/register-credential-cache-invalidation-route.js";
import { registerSandboxBootstrapAttachmentTerminateRoute } from "../internal/runtime-state/register-sandbox-bootstrap-attachment-terminate-route.js";
import { registerSandboxRuntimeStateRoute } from "../internal/runtime-state/register-sandbox-runtime-state-route.js";
import { logger } from "../logger.js";
import { PtyTransportService } from "../pty/pty-transport-service.js";
import { registerPtyTransportRoutes } from "../pty/register-pty-transport-routes.js";
import { createPortAccessNodeEntrypoint } from "../publishing/port-access-node-entrypoint.js";
import { PortAccessTransportService } from "../publishing/port-access-transport.js";
import {
  PortsTargetAuthorizeBootstrapDisconnectedError,
  PortsTargetAuthorizeService,
  PortsTargetAuthorizeTimedOutError,
} from "../publishing/ports-target-authorize-service.js";
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
import { BootstrapTunnelNotConnectedError } from "../tunnel/bootstrap-tunnel-not-connected-error.js";
import { LocalGatewayForwardingClientAdapter } from "../tunnel/gateway-forwarding/adapters/local-gateway-forwarding-client-adapter.js";
import { LocalGatewayForwardingServerAdapter } from "../tunnel/gateway-forwarding/adapters/local-gateway-forwarding-server-adapter.js";
import { NatsGatewayForwardingAdapter } from "../tunnel/gateway-forwarding/adapters/nats-gateway-forwarding-adapter.js";
import type { GatewayForwardingClientAdapter } from "../tunnel/gateway-forwarding/gateway-forwarding-client-adapter.js";
import { InteractiveStreamRouter } from "../tunnel/gateway-forwarding/index.js";
import {
  GatewayForwardingPortAccessAuthorizationError,
  GatewayForwardingPortAccessAuthorizationErrorCodes,
} from "../tunnel/gateway-forwarding/types.js";
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
import { AsyncTaskTracker, type AsyncTaskDrainResult } from "./async-task-tracker.js";
import { GatewayDrainRegistry } from "./gateway-drain-registry.js";
import { GatewayLifecycle } from "./gateway-lifecycle.js";
export {
  GatewayWebSocketCloseCodes,
  GatewayWebSocketCloseReasons,
  type GatewayWebSocketCloseReason,
} from "./gateway-websocket-close.js";
import { GatewayWebSocketCloseReasons } from "./gateway-websocket-close.js";

const DefaultMaxActiveBindingsPerSandbox = 32;
const ServiceRestartConnectionDrainTimeoutMs = 25_000;
const ShutdownTunnelTaskDrainTimeoutMs = 5_000;

type GatewayRelayRuntimeResources = {
  gatewayForwardingClient: GatewayForwardingClientAdapter;
  relayCoordinator: TunnelRelayCoordinator;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

async function measureShutdownPhase<T>(
  timings: Map<string, number>,
  label: string,
  callback: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await callback();
  } finally {
    timings.set(label, performance.now() - startedAt);
  }
}

function formatShutdownTimings(timings: Map<string, number>): Record<string, number> {
  const formatted: Record<string, number> = {};
  for (const [label, durationMs] of timings.entries()) {
    formatted[label] = Math.round(durationMs);
  }
  return formatted;
}

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

function toGatewayForwardingPortAccessAuthorizationError(
  error: unknown,
): GatewayForwardingPortAccessAuthorizationError {
  if (error instanceof GatewayForwardingPortAccessAuthorizationError) {
    return error;
  }
  if (error instanceof BootstrapTunnelNotConnectedError) {
    return new GatewayForwardingPortAccessAuthorizationError(
      GatewayForwardingPortAccessAuthorizationErrorCodes.BOOTSTRAP_NOT_CONNECTED,
      error.message,
    );
  }
  if (error instanceof PortsTargetAuthorizeTimedOutError) {
    return new GatewayForwardingPortAccessAuthorizationError(
      GatewayForwardingPortAccessAuthorizationErrorCodes.TARGET_AUTHORIZE_TIMED_OUT,
      error.message,
    );
  }
  if (error instanceof PortsTargetAuthorizeBootstrapDisconnectedError) {
    return new GatewayForwardingPortAccessAuthorizationError(
      GatewayForwardingPortAccessAuthorizationErrorCodes.BOOTSTRAP_DISCONNECTED,
      error.message,
    );
  }

  throw error;
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
  const lifecycle = new GatewayLifecycle(systemClock);
  const app = createApp(config.app, lifecycle);
  const nodeWebSocket = createNodeWebSocket({ app });
  const nodeId = typeid("dpg").toString();
  const drainRegistry = new GatewayDrainRegistry();
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
  let portsTargetAuthorizeService: PortsTargetAuthorizeService;
  let portAccessTransportService: PortAccessTransportService;
  const gatewayForwardingServer = new LocalGatewayForwardingServerAdapter(
    tunnelSessionRegistry,
    async (target, input) => {
      try {
        return await portsTargetAuthorizeService.requestLocalTargetAuthorize({
          ...input,
          targetBootstrapSessionId: target.targetBootstrapSessionId,
        });
      } catch (error) {
        throw toGatewayForwardingPortAccessAuthorizationError(error);
      }
    },
    {
      open: async (target, input) =>
        portAccessTransportService.openForwardedPortAccessStream({
          ...input,
          target,
        }),
      release: async (target, input) => {
        portAccessTransportService.releaseForwardedPortAccessStream({
          ...input,
          target,
        });
      },
    },
  );
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
  portsTargetAuthorizeService = new PortsTargetAuthorizeService(relayCoordinator, systemScheduler, {
    client: gatewayForwardingClient,
    localNodeId: nodeId,
  });
  portAccessTransportService = new PortAccessTransportService(
    relayCoordinator,
    tunnelSessionRegistry,
    {
      clock: systemClock,
      scheduler: systemScheduler,
    },
    {
      client: gatewayForwardingClient,
      localNodeId: nodeId,
    },
  );
  const directEgressProxyService = new DirectEgressProxyService(
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
    {
      tokenSecret: config.app.sandbox.egress.tokenSecret,
      tokenIssuer: config.app.sandbox.egress.tokenIssuer,
      tokenAudience: config.app.sandbox.egress.tokenAudience,
    },
    {
      tokenSecret: config.app.controlPlaneApi.mcp.auth.secret,
      tokenIssuer: config.app.controlPlaneApi.mcp.auth.issuer,
      tokenAudience: config.app.controlPlaneApi.mcp.auth.audience,
    },
    config.app.__dangerouslyTrustDirectEgressTlsCaCertificates,
  );
  const ptyTransportService = new PtyTransportService({
    config: config.app.sandbox,
    clock: systemClock,
    relayCoordinator,
    sandboxOwnerResolver,
    scheduler: systemScheduler,
    tokenConfig: {
      tokenSecret: config.app.sandbox.ptyTransport.tokenSecret,
      tokenIssuer: config.app.sandbox.ptyTransport.tokenIssuer,
      tokenAudience: config.app.sandbox.ptyTransport.tokenAudience,
    } satisfies PtyTransportTokenConfig,
  });
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
    drainRegistry,
    lifecycle,
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
  registerCredentialCacheInvalidationRoute({
    app,
    credentialCache,
    internalAuthServiceToken: config.app.internalAuth.serviceToken,
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
    allowRemoteOwnerConnections: config.app.gatewayRelay.backend === "nats",
    clock: systemClock,
    drainRegistry,
    lifecycle,
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
  registerDirectEgressRoutes({
    app,
    directEgressProxyService,
    drainRegistry,
    lifecycle,
    trustedUpstreamCaCertificates: config.app.__dangerouslyTrustDirectEgressTlsCaCertificates,
    upgradeWebSocket: nodeWebSocket.upgradeWebSocket,
    ...(config.app.__dangerouslyDelayDirectEgressWebSocketUpstreamResolutionMs === undefined
      ? {}
      : {
          webSocketUpstreamResolutionDelayMs:
            config.app.__dangerouslyDelayDirectEgressWebSocketUpstreamResolutionMs,
        }),
  });
  registerPtyTransportRoutes({
    app,
    drainRegistry,
    lifecycle,
    ptyTransportService,
    ...(config.app.__dangerouslyEnableTestIsolation === undefined
      ? {}
      : {
          testEnvironmentIdQueryParam:
            config.app.__dangerouslyEnableTestIsolation.testEnvironmentIdHeader,
        }),
    upgradeWebSocket: nodeWebSocket.upgradeWebSocket,
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
    lifecycle,
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
    const shutdownTimings = new Map<string, number>();
    try {
      const drainState = lifecycle.startDrain({
        reason: GatewayWebSocketCloseReasons.SERVICE_RESTART,
      });
      if (drainState.status !== "draining") {
        throw new Error("Expected data-plane gateway lifecycle to enter draining state.");
      }
      logger.info(
        {
          eventName: "data_plane_gateway.runtime_shutdown.service_restart_drain_started",
          activeConnections: drainRegistry.activeCounts(),
          activeConnectionCategories: drainRegistry.activeCategoryCounts(),
          drainReason: drainState.reason,
          drainStartedAtMs: drainState.startedAtMs,
          timeoutMs: ServiceRestartConnectionDrainTimeoutMs,
        },
        "Data-plane gateway runtime service-restart drain started.",
      );
      const closeResult = await measureShutdownPhase(
        shutdownTimings,
        "service-restart-connection-drain",
        async () =>
          drainRegistry.closeForServiceRestart({
            waitMs: ServiceRestartConnectionDrainTimeoutMs,
          }),
      );
      logger.info(
        {
          eventName: "data_plane_gateway.runtime_shutdown.service_restart_drain_completed",
          ...closeResult,
          remainingActiveConnections: drainRegistry.activeCounts(),
          remainingActiveConnectionCategories: drainRegistry.activeCategoryCounts(),
          timeoutMs: ServiceRestartConnectionDrainTimeoutMs,
        },
        "Data-plane gateway runtime service-restart drain completed.",
      );
      await measureShutdownPhase(shutdownTimings, "close-websocket-server", async () => {
        await closeWebSocketServer(nodeWebSocket.wss);
      });
      const drainResult = await measureShutdownPhase(
        shutdownTimings,
        "drain-sandbox-tunnel-tasks",
        async (): Promise<AsyncTaskDrainResult> =>
          sandboxTunnelTaskTracker.drain({
            timeoutMs: ShutdownTunnelTaskDrainTimeoutMs,
          }),
      );
      if (drainResult.timedOut) {
        logger.warn(
          {
            eventName: "data_plane_gateway.runtime_shutdown.tunnel_task_drain_timed_out",
            activeTaskCount: drainResult.activeTaskCount,
            timeoutMs: ShutdownTunnelTaskDrainTimeoutMs,
          },
          "Timed out draining sandbox tunnel tasks during data-plane gateway runtime shutdown.",
        );
      }
      await measureShutdownPhase(shutdownTimings, "operation-ingress-shutdown", async () => {
        operationIngressService.shutdown();
      });
      await measureShutdownPhase(shutdownTimings, "telemetry-ingress-shutdown", async () => {
        await telemetryIngressService.shutdown();
      });
      await measureShutdownPhase(shutdownTimings, "relay-resources-stop", async () => {
        await relayResources.stop();
      });

      const serverToClose = startedServer;
      if (serverToClose !== undefined) {
        await measureShutdownPhase(shutdownTimings, "http-server-close", async () => {
          const closeResult = await serverToClose.close();
          if (closeResult.forcedConnectionClose) {
            logger.warn(
              {
                eventName: "data_plane_gateway.runtime_shutdown.http_server_forced_closed",
              },
              "Forced data-plane gateway HTTP server connections closed during runtime shutdown.",
            );
          }
          startedServer = undefined;
        });
      }

      if (hasValkeyClient) {
        await measureShutdownPhase(shutdownTimings, "valkey-close", async () => {
          await closeValkeyClient(valkeyClient);
          hasValkeyClient = false;
        });
      }

      await measureShutdownPhase(shutdownTimings, "app-stop", async () => {
        await stopApp(app);
      });
      drainRegistry.finishServiceRestartDrain();
      logger.info(
        {
          eventName: "data_plane_gateway.runtime_shutdown.completed",
          shutdownPhases: formatShutdownTimings(shutdownTimings),
        },
        "Data-plane gateway runtime shutdown completed.",
      );
      stopped = true;
    } catch (error) {
      logger.error(
        {
          err: error,
          eventName: "data_plane_gateway.runtime_shutdown.failed",
          shutdownPhases: formatShutdownTimings(shutdownTimings),
        },
        "Data-plane gateway runtime shutdown failed.",
      );
      throw error;
    }
  }

  return {
    app,
    internals: {
      portAccessTransportService,
      portsTargetAuthorizeService,
    },
    request: async (path, init) => app.request(path, init),
    startDrain: () => {
      lifecycle.startDrain({
        reason: GatewayWebSocketCloseReasons.SERVICE_RESTART,
      });
    },
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

      lifecycle.startDrain({
        reason: GatewayWebSocketCloseReasons.SERVICE_RESTART,
      });
      stopPromise = stopRuntimeResources();
      await stopPromise;
    },
  };
}
