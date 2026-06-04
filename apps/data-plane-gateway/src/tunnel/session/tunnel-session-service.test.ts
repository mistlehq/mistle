import { EventEmitter } from "node:events";
import { createServer } from "node:http";

import type { PutSandboxInstanceDeadlineAcceptedResponse } from "@mistle/data-plane-internal-client";
import type { SandboxInstanceStatus } from "@mistle/sandbox-lifecycle";
import { createManualScheduler, createMutableClock } from "@mistle/time/testing";
import { WSContext } from "hono/ws";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

import { SandboxDeadlineLifecycleCoordinator } from "../../deadlines/sandbox-deadline-lifecycle-coordinator.js";
import {
  DefaultDataPlaneGatewayLifecycleDurations,
  SandboxInstanceDeadlineService,
} from "../../deadlines/sandbox-instance-deadline-service.js";
import { createAttachmentBackedActiveBootstrapSessionStore } from "../../runtime-state/active-bootstrap-session-store.js";
import { InMemorySandboxPresenceStore } from "../../runtime-state/adapters/in-memory-sandbox-presence-store.js";
import { InMemorySandboxRuntimeAttachmentStore } from "../../runtime-state/adapters/in-memory-sandbox-runtime-attachment-store.js";
import {
  OWNER_LEASE_RENEW_INTERVAL_MS,
  WEBSOCKET_PING_INTERVAL_MS,
  WEBSOCKET_PONG_TIMEOUT_MS,
} from "../../runtime-state/durations.js";
import { LocalGatewayForwardingClientAdapter } from "../gateway-forwarding/adapters/local-gateway-forwarding-client-adapter.js";
import { LocalGatewayForwardingServerAdapter } from "../gateway-forwarding/adapters/local-gateway-forwarding-server-adapter.js";
import { InteractiveStreamRouter } from "../gateway-forwarding/interactive-stream-router.js";
import { InMemoryLocalPeerRegistryAdapter } from "../local-peer-registry/adapters/in-memory-local-peer-registry-adapter.js";
import { AttachmentBackedSandboxOwnerResolver } from "../ownership/attachment-backed-sandbox-owner-resolver.js";
import { TunnelRelayCoordinator } from "../relay-coordinator.js";
import { InMemoryRelayTransportAdapter } from "../relay-transport/adapters/in-memory-relay-transport-adapter.js";
import { InMemoryTunnelSessionRegistryAdapter } from "../tunnel-session/adapters/in-memory-tunnel-session-registry-adapter.js";
import { TunnelSessionRegistry } from "../tunnel-session/index.js";
import type { RelayPeerSocket } from "../types.js";
import { BootstrapTunnelCloseCauses, TunnelSessionService } from "./tunnel-session-service.js";

const GatewayNodeId = "dpg_test";
const SandboxInstanceId = "sbi_test";
const BootstrapSessionId = "sess_bootstrap";
const ConnectionSessionId = "conn_1";
const OwnerLeaseId = "lease_test";

type RuntimeLifecycleEventKind =
  | "bootstrap_degraded"
  | "bootstrap_detached"
  | "bootstrap_recovered"
  | "runtime_readiness_reported";

type ReceivedWebSocketMessage = {
  data: string | Buffer;
  isBinary: boolean;
};

type WebSocketPair = {
  clientSocket: WebSocket;
  serverSocket: WebSocket;
  peerSocket: RelayPeerSocket;
  closeAll: () => Promise<void>;
};

class FakeRawSocket extends EventEmitter {
  public ping(
    _data: Buffer | undefined,
    _mask: boolean,
    callback?: (error: Error | null | undefined) => void,
  ): void {
    callback?.(null);
  }
}

function createFakePeerSocket(rawSocket: FakeRawSocket): RelayPeerSocket {
  return {
    send: () => undefined,
    close: () => undefined,
    get readyState() {
      return WebSocket.OPEN;
    },
    raw: rawSocket as unknown as WebSocket,
  } as unknown as RelayPeerSocket;
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  return Buffer.concat(data);
}

function waitForWebSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("open", onOpen);
      socket.off("error", onError);
    };

    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}

function waitForWebSocketMessage(socket: WebSocket): Promise<ReceivedWebSocketMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: RawData, isBinary: boolean): void => {
      cleanup();
      resolve({
        data: isBinary ? toBuffer(data) : toBuffer(data).toString("utf8"),
        isBinary,
      });
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("message", onMessage);
      socket.off("error", onError);
    };

    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}

function toWsReadyState(input: number): 0 | 1 | 2 | 3 {
  if (input === 0 || input === 1 || input === 2 || input === 3) {
    return input;
  }

  throw new Error(`Unexpected websocket ready state: ${String(input)}`);
}

function toPeerSocket(socket: WebSocket): RelayPeerSocket {
  return new WSContext<WebSocket>({
    send: (data, options) => {
      socket.send(data, {
        compress: options.compress,
      });
    },
    close: (code, reason) => {
      socket.close(code, reason);
    },
    get readyState() {
      return toWsReadyState(socket.readyState);
    },
    raw: socket,
  });
}

async function createWebSocketPair(): Promise<WebSocketPair> {
  const server = createServer();
  const webSocketServer = new WebSocketServer({
    server,
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP server address to be available.");
  }

  const serverSocketPromise = new Promise<WebSocket>((resolve, reject) => {
    webSocketServer.once("connection", (socket) => {
      resolve(socket);
    });
    webSocketServer.once("error", reject);
  });
  const clientSocket = new WebSocket(`ws://127.0.0.1:${String(address.port)}`);

  await waitForWebSocketOpen(clientSocket);
  const serverSocket = await serverSocketPromise;

  const closeAll = async (): Promise<void> => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        clientSocket.once("close", () => {
          resolve();
        });
        clientSocket.close();
      });
    }
    if (serverSocket.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        serverSocket.once("close", () => {
          resolve();
        });
        serverSocket.close();
      });
    }

    await new Promise<void>((resolve, reject) => {
      webSocketServer.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };

  return {
    clientSocket,
    closeAll,
    peerSocket: toPeerSocket(serverSocket),
    serverSocket,
  };
}

const openPairs = new Set<WebSocketPair>();

afterEach(async () => {
  await Promise.all(Array.from(openPairs, (pair) => pair.closeAll()));
  openPairs.clear();
});

function resolveTestLifecycleStatus(kind: RuntimeLifecycleEventKind): SandboxInstanceStatus {
  switch (kind) {
    case "bootstrap_degraded":
      return "degraded";
    case "bootstrap_detached":
      return "reconnecting";
    case "bootstrap_recovered":
      return "running";
    case "runtime_readiness_reported":
      return "initializing";
  }
}

async function createDisconnectTestHarness() {
  const clock = createMutableClock(1_000);
  const scheduler = createManualScheduler(clock);
  const lifecycleEvents: Array<{
    kind: RuntimeLifecycleEventKind;
    ownerLeaseId: string;
    runtimeReady?: boolean;
  }> = [];
  const attachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
  await attachmentStore.upsertAttachment({
    sandboxInstanceId: SandboxInstanceId,
    ownerLeaseId: OwnerLeaseId,
    nodeId: GatewayNodeId,
    sessionId: BootstrapSessionId,
    attachedAtMs: clock.nowMs(),
    ttlMs: 60_000,
    nowMs: clock.nowMs(),
  });

  const tunnelSessionRegistry = new TunnelSessionRegistry(
    new InMemoryTunnelSessionRegistryAdapter(),
  );
  const relayCoordinator = new TunnelRelayCoordinator(
    GatewayNodeId,
    new InMemoryLocalPeerRegistryAdapter(),
    new InMemoryRelayTransportAdapter(GatewayNodeId),
  );
  const interactiveStreamRouter = new InteractiveStreamRouter(
    GatewayNodeId,
    new AttachmentBackedSandboxOwnerResolver(
      GatewayNodeId,
      createAttachmentBackedActiveBootstrapSessionStore(attachmentStore),
      clock,
    ),
    new LocalGatewayForwardingClientAdapter(
      GatewayNodeId,
      new LocalGatewayForwardingServerAdapter(tunnelSessionRegistry),
    ),
  );

  const service = new TunnelSessionService(
    GatewayNodeId,
    interactiveStreamRouter,
    relayCoordinator,
    tunnelSessionRegistry,
    new InMemorySandboxPresenceStore(clock),
    attachmentStore,
    new SandboxInstanceDeadlineService(
      {
        async putSandboxInstanceDeadline() {
          return {
            status: "accepted",
            sandboxInstanceId: SandboxInstanceId,
            kind: "disconnect",
            generation: 1,
            workflowRunId: "owfr_test",
          };
        },
        async deleteSandboxInstanceDeadline() {
          return {
            status: "ok",
            sandboxInstanceId: SandboxInstanceId,
            kind: "idle",
          };
        },
        async applySandboxRuntimeLifecycleEvent(input) {
          lifecycleEvents.push({
            kind: input.kind,
            ownerLeaseId: input.ownerLeaseId,
            ...(input.kind === "runtime_readiness_reported"
              ? { runtimeReady: input.runtimeReady }
              : {}),
          });
          return {
            status: "ok",
            sandboxInstanceId: input.sandboxInstanceId,
            lifecycleStatus: resolveTestLifecycleStatus(input.kind),
          };
        },
      },
      clock,
      DefaultDataPlaneGatewayLifecycleDurations,
    ),
    new SandboxDeadlineLifecycleCoordinator(),
    clock,
    scheduler,
  );

  const bootstrapPair = await createWebSocketPair();
  const connectionPair = await createWebSocketPair();
  openPairs.add(bootstrapPair);
  openPairs.add(connectionPair);

  const attachedBootstrapPeer = {
    relayTarget: relayCoordinator.attachPeer({
      sandboxInstanceId: SandboxInstanceId,
      side: "bootstrap",
      socket: bootstrapPair.peerSocket,
      sessionId: BootstrapSessionId,
    }),
  };
  relayCoordinator.attachPeer({
    sandboxInstanceId: SandboxInstanceId,
    side: "connection",
    socket: connectionPair.peerSocket,
    sessionId: ConnectionSessionId,
  });
  tunnelSessionRegistry.attachBootstrapSession(attachedBootstrapPeer.relayTarget);

  return {
    attachedBootstrapPeer,
    connectionPair,
    interactiveStreamRouter,
    lifecycleEvents,
    service,
    tunnelSessionRegistry,
  };
}

function createBootstrapHealthTestHarness() {
  const clock = createMutableClock(1_000);
  const scheduler = createManualScheduler(clock);
  const lifecycleEvents: Array<{
    kind: RuntimeLifecycleEventKind;
    ownerLeaseId: string;
    runtimeReady?: boolean;
  }> = [];
  const attachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
  const tunnelSessionRegistry = new TunnelSessionRegistry(
    new InMemoryTunnelSessionRegistryAdapter(),
  );
  const lifecycleCoordinator = new SandboxDeadlineLifecycleCoordinator();
  const relayCoordinator = new TunnelRelayCoordinator(
    GatewayNodeId,
    new InMemoryLocalPeerRegistryAdapter(),
    new InMemoryRelayTransportAdapter(GatewayNodeId),
  );
  const interactiveStreamRouter = new InteractiveStreamRouter(
    GatewayNodeId,
    new AttachmentBackedSandboxOwnerResolver(
      GatewayNodeId,
      createAttachmentBackedActiveBootstrapSessionStore(attachmentStore),
      clock,
    ),
    new LocalGatewayForwardingClientAdapter(
      GatewayNodeId,
      new LocalGatewayForwardingServerAdapter(tunnelSessionRegistry),
    ),
  );
  const service = new TunnelSessionService(
    GatewayNodeId,
    interactiveStreamRouter,
    relayCoordinator,
    tunnelSessionRegistry,
    new InMemorySandboxPresenceStore(clock),
    attachmentStore,
    new SandboxInstanceDeadlineService(
      {
        async putSandboxInstanceDeadline(input) {
          return {
            status: "accepted",
            sandboxInstanceId: input.sandboxInstanceId,
            kind: input.kind,
            generation: 1,
            workflowRunId: "owfr_test",
          } satisfies PutSandboxInstanceDeadlineAcceptedResponse;
        },
        async deleteSandboxInstanceDeadline(input) {
          return {
            status: "ok",
            sandboxInstanceId: input.sandboxInstanceId,
            kind: input.kind,
          };
        },
        async applySandboxRuntimeLifecycleEvent(input) {
          lifecycleEvents.push({
            kind: input.kind,
            ownerLeaseId: input.ownerLeaseId,
            ...(input.kind === "runtime_readiness_reported"
              ? { runtimeReady: input.runtimeReady }
              : {}),
          });
          return {
            status: "ok",
            sandboxInstanceId: input.sandboxInstanceId,
            lifecycleStatus: resolveTestLifecycleStatus(input.kind),
          };
        },
      },
      clock,
      DefaultDataPlaneGatewayLifecycleDurations,
    ),
    lifecycleCoordinator,
    clock,
    scheduler,
  );

  return {
    clock,
    lifecycleCoordinator,
    lifecycleEvents,
    rawSocket: new FakeRawSocket(),
    scheduler,
    service,
  };
}

describe("TunnelSessionService", () => {
  it("summarizes bootstrap close cause and heartbeat state for close logs", async () => {
    const { clock, rawSocket, service } = createBootstrapHealthTestHarness();
    const openedAtMs = clock.nowMs();
    const attachedPeer = service.attachBootstrapPeer({
      leaseId: OwnerLeaseId,
      onFatalError: () => {
        throw new Error("Bootstrap attach should not fail in this test.");
      },
      onLeaseLost: () => {
        throw new Error("Bootstrap lease should not be lost in this test.");
      },
      onTransportUnhealthy: () => {
        throw new Error("Bootstrap transport should remain healthy in this test.");
      },
      openedAtMs,
      ownerLeaseTtlMs: 60_000,
      relaySessionId: BootstrapSessionId,
      sandboxInstanceId: SandboxInstanceId,
      socket: createFakePeerSocket(rawSocket),
    });
    await attachedPeer.activationPromise;

    clock.advanceMs(1_250);
    service.markBootstrapCloseInitiated({
      attachedPeer,
      cause: BootstrapTunnelCloseCauses.GATEWAY_PROTOCOL_ERROR,
      reason: "protocol violation",
    });

    expect(service.bootstrapCloseDiagnostics(attachedPeer)).toEqual({
      closeCause: BootstrapTunnelCloseCauses.GATEWAY_PROTOCOL_ERROR,
      closeCauseReason: "protocol violation",
      closeInitiatedAtMs: clock.nowMs(),
      gatewayInitiatedClose: true,
      health: {
        consecutiveMissedPongs: 0,
        healthy: true,
        lastPongAgeMs: 1_250,
        pingInFlight: false,
      },
      socketAgeMs: 1_250,
    });
  });

  it("preserves the first bootstrap close cause when later paths report transport errors", async () => {
    const { clock, rawSocket, service } = createBootstrapHealthTestHarness();
    const attachedPeer = service.attachBootstrapPeer({
      leaseId: OwnerLeaseId,
      onFatalError: () => {
        throw new Error("Bootstrap attach should not fail in this test.");
      },
      onLeaseLost: () => {
        throw new Error("Bootstrap lease should not be lost in this test.");
      },
      onTransportUnhealthy: () => {
        throw new Error("Bootstrap transport should remain healthy in this test.");
      },
      ownerLeaseTtlMs: 60_000,
      relaySessionId: BootstrapSessionId,
      sandboxInstanceId: SandboxInstanceId,
      socket: createFakePeerSocket(rawSocket),
    });
    await attachedPeer.activationPromise;

    service.markBootstrapCloseInitiated({
      attachedPeer,
      cause: BootstrapTunnelCloseCauses.GATEWAY_PRESENCE_DEADLINE_FAILED,
      reason: "Failed to persist sandbox presence lease.",
    });
    const firstInitiatedAtMs = clock.nowMs();
    clock.advanceMs(250);
    service.markBootstrapCloseInitiated({
      attachedPeer,
      cause: BootstrapTunnelCloseCauses.TRANSPORT_ERROR,
      reason: "Bootstrap websocket emitted transport error.",
    });

    expect(service.bootstrapCloseDiagnostics(attachedPeer)).toMatchObject({
      closeCause: BootstrapTunnelCloseCauses.GATEWAY_PRESENCE_DEADLINE_FAILED,
      closeCauseReason: "Failed to persist sandbox presence lease.",
      closeInitiatedAtMs: firstInitiatedAtMs,
      gatewayInitiatedClose: true,
    });
  });

  it("prefers session close context over later direct peer close context writes", async () => {
    const { clock, rawSocket, service } = createBootstrapHealthTestHarness();
    const attachedPeer = service.attachBootstrapPeer({
      leaseId: OwnerLeaseId,
      onFatalError: () => {
        throw new Error("Bootstrap attach should not fail in this test.");
      },
      onLeaseLost: () => {
        throw new Error("Bootstrap lease should not be lost in this test.");
      },
      onTransportUnhealthy: () => {
        throw new Error("Bootstrap transport should remain healthy in this test.");
      },
      ownerLeaseTtlMs: 60_000,
      relaySessionId: BootstrapSessionId,
      sandboxInstanceId: SandboxInstanceId,
      socket: createFakePeerSocket(rawSocket),
    });
    await attachedPeer.activationPromise;

    service.markBootstrapCloseInitiated({
      attachedPeer,
      cause: BootstrapTunnelCloseCauses.GATEWAY_PRESENCE_DEADLINE_FAILED,
      reason: "Failed to persist sandbox presence lease.",
    });
    const firstInitiatedAtMs = clock.nowMs();
    clock.advanceMs(250);
    attachedPeer.bootstrapCloseContext = {
      cause: BootstrapTunnelCloseCauses.GATEWAY_HEALTH_MISSED_PONGS,
      gatewayInitiated: true,
      initiatedAtMs: clock.nowMs(),
      reason: "Sandbox bootstrap websocket stopped responding to ping.",
    };

    expect(service.bootstrapCloseDiagnostics(attachedPeer)).toMatchObject({
      closeCause: BootstrapTunnelCloseCauses.GATEWAY_PRESENCE_DEADLINE_FAILED,
      closeCauseReason: "Failed to persist sandbox presence lease.",
      closeInitiatedAtMs: firstInitiatedAtMs,
      gatewayInitiatedClose: true,
    });
  });

  it("adopts peer-only close context before later close attempts", async () => {
    const { clock, rawSocket, service } = createBootstrapHealthTestHarness();
    const attachedPeer = service.attachBootstrapPeer({
      leaseId: OwnerLeaseId,
      onFatalError: () => {
        throw new Error("Bootstrap attach should not fail in this test.");
      },
      onLeaseLost: () => {
        throw new Error("Bootstrap lease should not be lost in this test.");
      },
      onTransportUnhealthy: () => {
        throw new Error("Bootstrap transport should remain healthy in this test.");
      },
      ownerLeaseTtlMs: 60_000,
      relaySessionId: BootstrapSessionId,
      sandboxInstanceId: SandboxInstanceId,
      socket: createFakePeerSocket(rawSocket),
    });
    await attachedPeer.activationPromise;

    attachedPeer.bootstrapCloseContext = {
      cause: BootstrapTunnelCloseCauses.GATEWAY_HEALTH_MISSED_PONGS,
      gatewayInitiated: true,
      initiatedAtMs: clock.nowMs(),
      reason: "Sandbox bootstrap websocket stopped responding to ping.",
    };
    const firstInitiatedAtMs = clock.nowMs();
    clock.advanceMs(250);
    service.markBootstrapCloseInitiated({
      attachedPeer,
      cause: BootstrapTunnelCloseCauses.TRANSPORT_ERROR,
      reason: "Bootstrap websocket emitted transport error.",
    });
    clock.advanceMs(250);
    attachedPeer.bootstrapCloseContext = {
      cause: BootstrapTunnelCloseCauses.GATEWAY_ATTACH_FATAL_ERROR,
      gatewayInitiated: true,
      initiatedAtMs: clock.nowMs(),
      reason: "Failed to refresh sandbox runtime attachment.",
    };

    expect(service.bootstrapCloseDiagnostics(attachedPeer)).toMatchObject({
      closeCause: BootstrapTunnelCloseCauses.GATEWAY_HEALTH_MISSED_PONGS,
      closeCauseReason: "Sandbox bootstrap websocket stopped responding to ping.",
      closeInitiatedAtMs: firstInitiatedAtMs,
      gatewayInitiatedClose: true,
    });
  });

  it("classifies bootstrap websocket close frames separately from abnormal transport closes", async () => {
    const { clock, rawSocket, service } = createBootstrapHealthTestHarness();
    const openedAtMs = clock.nowMs();
    const attachedPeer = service.attachBootstrapPeer({
      leaseId: OwnerLeaseId,
      onFatalError: () => {
        throw new Error("Bootstrap attach should not fail in this test.");
      },
      onLeaseLost: () => {
        throw new Error("Bootstrap lease should not be lost in this test.");
      },
      onTransportUnhealthy: () => {
        throw new Error("Bootstrap transport should remain healthy in this test.");
      },
      openedAtMs,
      ownerLeaseTtlMs: 60_000,
      relaySessionId: BootstrapSessionId,
      sandboxInstanceId: SandboxInstanceId,
      socket: createFakePeerSocket(rawSocket),
    });
    await attachedPeer.activationPromise;

    clock.advanceMs(375);

    expect(
      service.bootstrapCloseDiagnostics(attachedPeer, {
        closeCode: 1000,
        closeReason: "sandbox process exited",
      }),
    ).toEqual({
      closeCause: BootstrapTunnelCloseCauses.PEER_CLOSE_FRAME,
      closeCauseReason: "sandbox process exited",
      closeInitiatedAtMs: null,
      gatewayInitiatedClose: false,
      health: {
        consecutiveMissedPongs: 0,
        healthy: true,
        lastPongAgeMs: 375,
        pingInFlight: false,
      },
      socketAgeMs: 375,
    });
  });

  it("marks bootstrap sessions degraded on missed pong and recovered on the next pong", async () => {
    const { clock, lifecycleEvents, rawSocket, scheduler, service } =
      createBootstrapHealthTestHarness();
    const attachedPeer = service.attachBootstrapPeer({
      leaseId: OwnerLeaseId,
      onFatalError: () => {
        throw new Error("Bootstrap attach should not fail in this test.");
      },
      onLeaseLost: () => {
        throw new Error("Bootstrap lease should not be lost in this test.");
      },
      onTransportUnhealthy: () => {
        throw new Error("Bootstrap transport should remain healthy in this test.");
      },
      ownerLeaseTtlMs: 60_000,
      relaySessionId: BootstrapSessionId,
      sandboxInstanceId: SandboxInstanceId,
      socket: createFakePeerSocket(rawSocket),
    });

    await attachedPeer.activationPromise;
    expect(lifecycleEvents).toEqual(
      expect.arrayContaining([
        {
          kind: "bootstrap_recovered",
          ownerLeaseId: OwnerLeaseId,
        },
        {
          kind: "runtime_readiness_reported",
          ownerLeaseId: OwnerLeaseId,
          runtimeReady: false,
        },
      ]),
    );

    clock.advanceMs(WEBSOCKET_PING_INTERVAL_MS);
    scheduler.runDue();
    clock.advanceMs(WEBSOCKET_PONG_TIMEOUT_MS);
    scheduler.runDue();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve();
    }

    expect(lifecycleEvents).toContainEqual({
      kind: "bootstrap_degraded",
      ownerLeaseId: OwnerLeaseId,
    });

    rawSocket.emit("pong", Buffer.alloc(0));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve();
    }

    expect(lifecycleEvents).toContainEqual({
      kind: "bootstrap_recovered",
      ownerLeaseId: OwnerLeaseId,
    });
    attachedPeer.websocketHealthHandle?.stop();
  });

  it("ignores queued bootstrap health changes from a replaced bootstrap peer", async () => {
    const { clock, lifecycleCoordinator, lifecycleEvents, rawSocket, scheduler, service } =
      createBootstrapHealthTestHarness();
    const attachedPeer = service.attachBootstrapPeer({
      leaseId: OwnerLeaseId,
      onFatalError: () => {
        throw new Error("Initial bootstrap attach should not fail in this test.");
      },
      onLeaseLost: () => {
        throw new Error("Initial bootstrap lease should not be lost in this test.");
      },
      onTransportUnhealthy: () => {
        throw new Error("Initial bootstrap transport should remain healthy in this test.");
      },
      ownerLeaseTtlMs: 60_000,
      relaySessionId: BootstrapSessionId,
      sandboxInstanceId: SandboxInstanceId,
      socket: createFakePeerSocket(rawSocket),
    });

    await attachedPeer.activationPromise;

    let releaseBlockedLifecycleOperation: (() => void) | undefined;
    const blockedLifecycleOperation = lifecycleCoordinator.enqueue({
      sandboxInstanceId: SandboxInstanceId,
      operation: () =>
        new Promise<void>((resolve) => {
          releaseBlockedLifecycleOperation = resolve;
        }),
    });
    for (
      let attempt = 0;
      releaseBlockedLifecycleOperation === undefined && attempt < 10;
      attempt += 1
    ) {
      await Promise.resolve();
    }

    clock.advanceMs(WEBSOCKET_PING_INTERVAL_MS);
    scheduler.runDue();
    clock.advanceMs(WEBSOCKET_PONG_TIMEOUT_MS);
    scheduler.runDue();

    const replacementLeaseId = "lease_replacement";
    const replacementRawSocket = new FakeRawSocket();
    const replacementAttachedPeer = service.attachBootstrapPeer({
      leaseId: replacementLeaseId,
      onFatalError: () => {
        throw new Error("Replacement bootstrap attach should not fail in this test.");
      },
      onLeaseLost: () => {
        throw new Error("Replacement bootstrap lease should not be lost in this test.");
      },
      onTransportUnhealthy: () => {
        throw new Error("Replacement bootstrap transport should remain healthy in this test.");
      },
      ownerLeaseTtlMs: 60_000,
      relaySessionId: "sess_bootstrap_replacement",
      sandboxInstanceId: SandboxInstanceId,
      socket: createFakePeerSocket(replacementRawSocket),
    });

    if (releaseBlockedLifecycleOperation === undefined) {
      throw new Error("Expected lifecycle operation to be blocked before replacement attach.");
    }
    releaseBlockedLifecycleOperation();
    await blockedLifecycleOperation;
    await replacementAttachedPeer.activationPromise;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve();
    }

    expect(lifecycleEvents).not.toContainEqual({
      kind: "bootstrap_degraded",
      ownerLeaseId: OwnerLeaseId,
    });
    expect(lifecycleEvents).toContainEqual({
      kind: "runtime_readiness_reported",
      ownerLeaseId: replacementLeaseId,
      runtimeReady: false,
    });

    attachedPeer.websocketHealthHandle?.stop();
    replacementAttachedPeer.websocketHealthHandle?.stop();
  });

  it("renews the active runtime attachment while the bootstrap attachment remains healthy", async () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const relayCoordinator = new TunnelRelayCoordinator(
      GatewayNodeId,
      new InMemoryLocalPeerRegistryAdapter(),
      new InMemoryRelayTransportAdapter(GatewayNodeId),
    );
    const tunnelSessionRegistry = new TunnelSessionRegistry(
      new InMemoryTunnelSessionRegistryAdapter(),
    );
    const attachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
    const interactiveStreamRouter = new InteractiveStreamRouter(
      GatewayNodeId,
      new AttachmentBackedSandboxOwnerResolver(
        GatewayNodeId,
        createAttachmentBackedActiveBootstrapSessionStore(attachmentStore),
        clock,
      ),
      new LocalGatewayForwardingClientAdapter(
        GatewayNodeId,
        new LocalGatewayForwardingServerAdapter(tunnelSessionRegistry),
      ),
    );
    const service = new TunnelSessionService(
      GatewayNodeId,
      interactiveStreamRouter,
      relayCoordinator,
      tunnelSessionRegistry,
      new InMemorySandboxPresenceStore(clock),
      attachmentStore,
      new SandboxInstanceDeadlineService(
        {
          async putSandboxInstanceDeadline(input) {
            return {
              status: "accepted",
              sandboxInstanceId: input.sandboxInstanceId,
              kind: input.kind,
              generation: 1,
              workflowRunId: "owfr_test",
            } satisfies PutSandboxInstanceDeadlineAcceptedResponse;
          },
          async deleteSandboxInstanceDeadline(input) {
            return {
              status: "ok",
              sandboxInstanceId: input.sandboxInstanceId,
              kind: input.kind,
            };
          },
          async applySandboxRuntimeLifecycleEvent(input) {
            return {
              status: "ok",
              sandboxInstanceId: input.sandboxInstanceId,
              lifecycleStatus: resolveTestLifecycleStatus(input.kind),
            };
          },
        },
        clock,
        DefaultDataPlaneGatewayLifecycleDurations,
      ),
      new SandboxDeadlineLifecycleCoordinator(),
      clock,
      scheduler,
    );

    const bootstrapPair = await createWebSocketPair();
    openPairs.add(bootstrapPair);

    const attachedPeer = service.attachBootstrapPeer({
      leaseId: OwnerLeaseId,
      onFatalError: () => {
        throw new Error("Bootstrap attach should not fail in this test.");
      },
      onLeaseLost: () => {
        throw new Error("Bootstrap lease should not be lost in this test.");
      },
      onTransportUnhealthy: () => {
        throw new Error("Bootstrap transport should remain healthy in this test.");
      },
      ownerLeaseTtlMs: 60_000,
      relaySessionId: BootstrapSessionId,
      sandboxInstanceId: SandboxInstanceId,
      socket: bootstrapPair.peerSocket,
    });

    let attachment = await attachmentStore.getAttachment({
      sandboxInstanceId: SandboxInstanceId,
      nowMs: clock.nowMs(),
    });
    for (
      let attempt = 0;
      (attachment?.ownerLeaseId !== OwnerLeaseId ||
        attachedPeer.leaseHeartbeatHandle === undefined) &&
      attempt < 10;
      attempt += 1
    ) {
      await Promise.resolve();
      attachment = await attachmentStore.getAttachment({
        sandboxInstanceId: SandboxInstanceId,
        nowMs: clock.nowMs(),
      });
    }
    expect(attachment?.ownerLeaseId).toBe(OwnerLeaseId);
    expect(attachedPeer.leaseHeartbeatHandle).toBeDefined();

    clock.advanceMs(OWNER_LEASE_RENEW_INTERVAL_MS);
    scheduler.runDue();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve();
    }

    clock.advanceMs(25_000);
    const renewedAttachment = await attachmentStore.getAttachment({
      sandboxInstanceId: SandboxInstanceId,
      nowMs: clock.nowMs(),
    });
    expect(renewedAttachment?.ownerLeaseId).toBe(OwnerLeaseId);
  });

  it("keeps the bootstrap peer open when initial idle deadline persistence fails", async () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const relayCoordinator = new TunnelRelayCoordinator(
      GatewayNodeId,
      new InMemoryLocalPeerRegistryAdapter(),
      new InMemoryRelayTransportAdapter(GatewayNodeId),
    );
    const tunnelSessionRegistry = new TunnelSessionRegistry(
      new InMemoryTunnelSessionRegistryAdapter(),
    );
    const attachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
    const interactiveStreamRouter = new InteractiveStreamRouter(
      GatewayNodeId,
      new AttachmentBackedSandboxOwnerResolver(
        GatewayNodeId,
        createAttachmentBackedActiveBootstrapSessionStore(attachmentStore),
        clock,
      ),
      new LocalGatewayForwardingClientAdapter(
        GatewayNodeId,
        new LocalGatewayForwardingServerAdapter(tunnelSessionRegistry),
      ),
    );
    const service = new TunnelSessionService(
      GatewayNodeId,
      interactiveStreamRouter,
      relayCoordinator,
      tunnelSessionRegistry,
      new InMemorySandboxPresenceStore(clock),
      attachmentStore,
      new SandboxInstanceDeadlineService(
        {
          async putSandboxInstanceDeadline(input) {
            if (input.kind === "idle") {
              throw new Error("Synthetic idle deadline failure.");
            }

            return {
              status: "accepted",
              sandboxInstanceId: input.sandboxInstanceId,
              kind: input.kind,
              generation: 1,
              workflowRunId: "owfr_test",
            } satisfies PutSandboxInstanceDeadlineAcceptedResponse;
          },
          async deleteSandboxInstanceDeadline(input) {
            return {
              status: "ok",
              sandboxInstanceId: input.sandboxInstanceId,
              kind: input.kind,
            };
          },
          async applySandboxRuntimeLifecycleEvent(input) {
            return {
              status: "ok",
              sandboxInstanceId: input.sandboxInstanceId,
              lifecycleStatus: resolveTestLifecycleStatus(input.kind),
            };
          },
        },
        clock,
        DefaultDataPlaneGatewayLifecycleDurations,
      ),
      new SandboxDeadlineLifecycleCoordinator(),
      clock,
      scheduler,
    );

    const bootstrapPair = await createWebSocketPair();
    openPairs.add(bootstrapPair);

    let fatalErrorMessage: string | undefined;
    const attachedPeer = service.attachBootstrapPeer({
      leaseId: OwnerLeaseId,
      onFatalError: (failure) => {
        fatalErrorMessage = failure.statusMessage;
      },
      onLeaseLost: () => {
        throw new Error("Bootstrap lease should not be lost in this test.");
      },
      onTransportUnhealthy: () => {
        throw new Error("Bootstrap transport should remain healthy in this test.");
      },
      ownerLeaseTtlMs: 60_000,
      relaySessionId: BootstrapSessionId,
      sandboxInstanceId: SandboxInstanceId,
      socket: bootstrapPair.peerSocket,
    });

    let attachment = await attachmentStore.getAttachment({
      sandboxInstanceId: SandboxInstanceId,
      nowMs: clock.nowMs(),
    });
    for (
      let attempt = 0;
      (attachment?.ownerLeaseId !== OwnerLeaseId ||
        attachedPeer.leaseHeartbeatHandle === undefined) &&
      attempt < 10;
      attempt += 1
    ) {
      await Promise.resolve();
      attachment = await attachmentStore.getAttachment({
        sandboxInstanceId: SandboxInstanceId,
        nowMs: clock.nowMs(),
      });
    }

    expect(fatalErrorMessage).toBeUndefined();
    expect(attachment?.ownerLeaseId).toBe(OwnerLeaseId);
    expect(attachedPeer.leaseHeartbeatHandle).toBeDefined();
    expect(bootstrapPair.clientSocket.readyState).toBe(WebSocket.OPEN);
  });

  it("keeps the bootstrap peer open when presence deadline persistence fails", async () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const relayCoordinator = new TunnelRelayCoordinator(
      GatewayNodeId,
      new InMemoryLocalPeerRegistryAdapter(),
      new InMemoryRelayTransportAdapter(GatewayNodeId),
    );
    const tunnelSessionRegistry = new TunnelSessionRegistry(
      new InMemoryTunnelSessionRegistryAdapter(),
    );
    const attachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
    const interactiveStreamRouter = new InteractiveStreamRouter(
      GatewayNodeId,
      new AttachmentBackedSandboxOwnerResolver(
        GatewayNodeId,
        createAttachmentBackedActiveBootstrapSessionStore(attachmentStore),
        clock,
      ),
      new LocalGatewayForwardingClientAdapter(
        GatewayNodeId,
        new LocalGatewayForwardingServerAdapter(tunnelSessionRegistry),
      ),
    );
    let idlePutAttempts = 0;

    const service = new TunnelSessionService(
      GatewayNodeId,
      interactiveStreamRouter,
      relayCoordinator,
      tunnelSessionRegistry,
      new InMemorySandboxPresenceStore(clock),
      attachmentStore,
      new SandboxInstanceDeadlineService(
        {
          async putSandboxInstanceDeadline(input) {
            if (input.kind === "idle") {
              idlePutAttempts += 1;
              if (idlePutAttempts >= 2) {
                throw new Error("Synthetic idle deadline failure.");
              }
            }

            return {
              status: "accepted",
              sandboxInstanceId: input.sandboxInstanceId,
              kind: input.kind,
              generation: 1,
              workflowRunId: "owfr_test",
            } satisfies PutSandboxInstanceDeadlineAcceptedResponse;
          },
          async deleteSandboxInstanceDeadline(input) {
            return {
              status: "ok",
              sandboxInstanceId: input.sandboxInstanceId,
              kind: input.kind,
            };
          },
          async applySandboxRuntimeLifecycleEvent(input) {
            return {
              status: "ok",
              sandboxInstanceId: input.sandboxInstanceId,
              lifecycleStatus: resolveTestLifecycleStatus(input.kind),
            };
          },
        },
        clock,
        DefaultDataPlaneGatewayLifecycleDurations,
      ),
      new SandboxDeadlineLifecycleCoordinator(),
      clock,
      scheduler,
    );

    const bootstrapPair = await createWebSocketPair();
    const connectionPair = await createWebSocketPair();
    openPairs.add(bootstrapPair);
    openPairs.add(connectionPair);

    const bootstrapAttachedPeer = service.attachBootstrapPeer({
      leaseId: OwnerLeaseId,
      onFatalError: () => {
        throw new Error("Bootstrap attach should not fail in this test.");
      },
      onLeaseLost: () => {
        throw new Error("Bootstrap lease should not be lost in this test.");
      },
      onTransportUnhealthy: () => {
        throw new Error("Bootstrap transport should remain healthy in this test.");
      },
      ownerLeaseTtlMs: 60_000,
      relaySessionId: BootstrapSessionId,
      sandboxInstanceId: SandboxInstanceId,
      socket: bootstrapPair.peerSocket,
    });
    let activeAttachment = await attachmentStore.getAttachment({
      sandboxInstanceId: SandboxInstanceId,
      nowMs: clock.nowMs(),
    });
    for (
      let attempt = 0;
      (activeAttachment?.ownerLeaseId !== OwnerLeaseId || idlePutAttempts !== 1) && attempt < 10;
      attempt += 1
    ) {
      await Promise.resolve();
      activeAttachment = await attachmentStore.getAttachment({
        sandboxInstanceId: SandboxInstanceId,
        nowMs: clock.nowMs(),
      });
    }
    expect(activeAttachment?.ownerLeaseId).toBe(OwnerLeaseId);
    expect(idlePutAttempts).toBe(1);

    let connectionFatalErrorMessage: string | undefined;
    service.attachConnectionPeer({
      onFatalError: (failure) => {
        connectionFatalErrorMessage = failure.statusMessage;
      },
      onTransportUnhealthy: () => {
        throw new Error("Connection transport should remain healthy in this test.");
      },
      relaySessionId: ConnectionSessionId,
      sandboxInstanceId: SandboxInstanceId,
      socket: connectionPair.peerSocket,
    });

    for (let attempt = 0; idlePutAttempts < 2 && attempt < 10; attempt += 1) {
      await Promise.resolve();
    }
    expect(idlePutAttempts).toBe(2);

    expect(connectionFatalErrorMessage).toBeUndefined();
    expect(bootstrapPair.clientSocket.readyState).toBe(WebSocket.OPEN);
    expect(connectionPair.clientSocket.readyState).toBe(WebSocket.OPEN);

    await service.detachBootstrapPeer({
      attachedPeer: bootstrapAttachedPeer,
      leaseId: OwnerLeaseId,
      sandboxInstanceId: SandboxInstanceId,
    });
  });

  it("releases active file upload bindings and notifies the connection peer on bootstrap disconnect", async () => {
    const {
      attachedBootstrapPeer,
      connectionPair,
      interactiveStreamRouter,
      lifecycleEvents,
      service,
      tunnelSessionRegistry,
    } = await createDisconnectTestHarness();

    await interactiveStreamRouter.openInteractiveStream({
      sandboxInstanceId: SandboxInstanceId,
      channelKind: "fileUpload",
      clientSessionId: ConnectionSessionId,
      clientStreamId: 42,
    });

    const disconnectNotificationPromise = waitForWebSocketMessage(connectionPair.clientSocket);

    await service.detachBootstrapPeer({
      attachedPeer: attachedBootstrapPeer,
      leaseId: OwnerLeaseId,
      sandboxInstanceId: SandboxInstanceId,
    });

    expect(lifecycleEvents).toContainEqual({
      kind: "bootstrap_detached",
      ownerLeaseId: OwnerLeaseId,
    });

    expect(
      tunnelSessionRegistry.getBindingByClientStream({
        sandboxInstanceId: SandboxInstanceId,
        clientSessionId: ConnectionSessionId,
        clientStreamId: 42,
      }),
    ).toBeUndefined();

    await expect(disconnectNotificationPromise).resolves.toEqual({
      data: JSON.stringify({
        type: "stream.reset",
        streamId: 42,
        code: "bootstrap_disconnected",
        message:
          "Sandbox bootstrap tunnel disconnected and invalidated the active interactive stream.",
      }),
      isBinary: false,
    });
  });
});
