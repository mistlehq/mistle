import { createServer } from "node:http";

import { createManualScheduler, createMutableClock } from "@mistle/time/testing";
import { WSContext } from "hono/ws";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

import { SandboxIdleControllerRegistry } from "../../idle/sandbox-idle-controller-registry.js";
import { InMemorySandboxPresenceStore } from "../../runtime-state/adapters/in-memory-sandbox-presence-store.js";
import { InMemorySandboxRuntimeAttachmentStore } from "../../runtime-state/adapters/in-memory-sandbox-runtime-attachment-store.js";
import { LocalGatewayForwardingClientAdapter } from "../gateway-forwarding/adapters/local-gateway-forwarding-client-adapter.js";
import { LocalGatewayForwardingServerAdapter } from "../gateway-forwarding/adapters/local-gateway-forwarding-server-adapter.js";
import { InteractiveStreamRouter } from "../gateway-forwarding/interactive-stream-router.js";
import { InMemoryLocalPeerRegistryAdapter } from "../local-peer-registry/adapters/in-memory-local-peer-registry-adapter.js";
import { InMemorySandboxOwnerStore } from "../ownership/adapters/in-memory-sandbox-owner-store.js";
import { SandboxOwnerLeaseHeartbeat } from "../ownership/sandbox-owner-lease-heartbeat.js";
import { StoreBackedSandboxOwnerResolver } from "../ownership/store-backed-sandbox-owner-resolver.js";
import { TunnelRelayCoordinator } from "../relay-coordinator.js";
import { InMemoryRelayTransportAdapter } from "../relay-transport/adapters/in-memory-relay-transport-adapter.js";
import { InMemoryTunnelSessionRegistryAdapter } from "../tunnel-session/adapters/in-memory-tunnel-session-registry-adapter.js";
import { TunnelSessionRegistry } from "../tunnel-session/index.js";
import type { RelayPeerSocket } from "../types.js";
import { TunnelSessionService } from "./tunnel-session-service.js";

const GatewayNodeId = "dpg_test";
const SandboxInstanceId = "sbi_test";
const BootstrapSessionId = "sess_bootstrap";
const ConnectionSessionId = "conn_1";
const OwnerLeaseId = "lease_test";

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

async function createDisconnectTestHarness() {
  const clock = createMutableClock(1_000);
  const scheduler = createManualScheduler(clock);
  const ownerStore = new InMemorySandboxOwnerStore(clock);
  await ownerStore.claimOwner({
    sandboxInstanceId: SandboxInstanceId,
    nodeId: GatewayNodeId,
    sessionId: BootstrapSessionId,
    ttlMs: 60_000,
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
    new StoreBackedSandboxOwnerResolver(GatewayNodeId, ownerStore),
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
    ownerStore,
    new SandboxOwnerLeaseHeartbeat(ownerStore, scheduler, 5_000),
    new InMemorySandboxPresenceStore(clock),
    new InMemorySandboxRuntimeAttachmentStore(clock),
    new SandboxIdleControllerRegistry(() => {
      throw new Error("Sandbox idle controller should not be created in this test.");
    }),
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
    service,
  };
}

describe("TunnelSessionService", () => {
  it("releases active file upload bindings and notifies the connection peer on bootstrap disconnect", async () => {
    const { attachedBootstrapPeer, connectionPair, interactiveStreamRouter, service } =
      await createDisconnectTestHarness();

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

    await expect(
      interactiveStreamRouter.findInteractiveStreamByClient({
        sandboxInstanceId: SandboxInstanceId,
        clientSessionId: ConnectionSessionId,
        clientStreamId: 42,
      }),
    ).resolves.toBeUndefined();

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
