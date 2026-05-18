import { createServer } from "node:http";

import { systemSleeper } from "@mistle/time";
import { WSContext } from "hono/ws";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { InMemoryLocalPeerRegistryAdapter } from "./local-peer-registry/adapters/in-memory-local-peer-registry-adapter.js";
import { TunnelRelayCoordinator } from "./relay-coordinator.js";
import { InMemoryRelayTransportAdapter } from "./relay-transport/adapters/in-memory-relay-transport-adapter.js";
import type { RelayPeerSocket, RelayTarget } from "./types.js";

type WebSocketPair = {
  clientSocket: WebSocket;
  serverSocket: WebSocket;
  peerSocket: RelayPeerSocket;
  closeAll: () => Promise<void>;
};

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

function waitForWebSocketClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const onClose = (code: number, reason: Buffer): void => {
      cleanup();
      resolve({
        code,
        reason: reason.toString("utf8"),
      });
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("close", onClose);
      socket.off("error", onError);
    };

    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

async function expectWebSocketToRemainOpen(socket: WebSocket): Promise<void> {
  await systemSleeper.sleep(150);
  expect(socket.readyState).toBe(WebSocket.OPEN);
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
    serverSocket,
    peerSocket: toPeerSocket(serverSocket),
    closeAll,
  };
}

function createRelayCoordinator(): TunnelRelayCoordinator {
  const nodeId = "dpg_local";
  return new TunnelRelayCoordinator(
    nodeId,
    new InMemoryLocalPeerRegistryAdapter(),
    new InMemoryRelayTransportAdapter(nodeId),
  );
}

function attachPeer(input: {
  coordinator: TunnelRelayCoordinator;
  pair: WebSocketPair;
  sandboxInstanceId?: string;
  sessionId: string;
  side: RelayTarget["side"];
}): RelayTarget {
  return input.coordinator.attachPeer({
    sandboxInstanceId: input.sandboxInstanceId ?? "sbi_abc",
    side: input.side,
    socket: input.pair.peerSocket,
    sessionId: input.sessionId,
  });
}

describe("TunnelRelayCoordinator", () => {
  const openPairs: WebSocketPair[] = [];

  afterEach(async () => {
    await Promise.all(openPairs.splice(0).map(async (pair) => pair.closeAll()));
  });

  it("keeps connection peers open when a PTY client peer detaches", async () => {
    const coordinator = createRelayCoordinator();
    const connectionPair = await createWebSocketPair();
    const ptyClientPair = await createWebSocketPair();
    const ptySandboxPair = await createWebSocketPair();
    const otherPtySandboxPair = await createWebSocketPair();
    openPairs.push(connectionPair, ptyClientPair, ptySandboxPair, otherPtySandboxPair);
    attachPeer({
      coordinator,
      pair: connectionPair,
      side: "connection",
      sessionId: "agent_session",
    });
    const ptyClientTarget = attachPeer({
      coordinator,
      pair: ptyClientPair,
      side: "ptyClient",
      sessionId: "terminal_one",
    });
    attachPeer({
      coordinator,
      pair: ptySandboxPair,
      side: "ptySandbox",
      sessionId: "terminal_one",
    });
    attachPeer({
      coordinator,
      pair: otherPtySandboxPair,
      side: "ptySandbox",
      sessionId: "terminal_two",
    });

    const ptySandboxClosePromise = waitForWebSocketClose(ptySandboxPair.clientSocket);
    coordinator.detachPeer(ptyClientTarget);

    await expect(ptySandboxClosePromise).resolves.toMatchObject({
      code: 1012,
      reason: "Sandbox tunnel peer disconnected.",
    });
    await expectWebSocketToRemainOpen(connectionPair.clientSocket);
    await expectWebSocketToRemainOpen(otherPtySandboxPair.clientSocket);
  });

  it("keeps connection peers open when a PTY sandbox peer detaches", async () => {
    const coordinator = createRelayCoordinator();
    const connectionPair = await createWebSocketPair();
    const ptyClientPair = await createWebSocketPair();
    const ptySandboxPair = await createWebSocketPair();
    openPairs.push(connectionPair, ptyClientPair, ptySandboxPair);
    attachPeer({
      coordinator,
      pair: connectionPair,
      side: "connection",
      sessionId: "agent_session",
    });
    attachPeer({
      coordinator,
      pair: ptyClientPair,
      side: "ptyClient",
      sessionId: "terminal_one",
    });
    const ptySandboxTarget = attachPeer({
      coordinator,
      pair: ptySandboxPair,
      side: "ptySandbox",
      sessionId: "terminal_one",
    });

    const ptyClientClosePromise = waitForWebSocketClose(ptyClientPair.clientSocket);
    coordinator.detachPeer(ptySandboxTarget);

    await expect(ptyClientClosePromise).resolves.toMatchObject({
      code: 1012,
      reason: "Sandbox tunnel peer disconnected.",
    });
    await expectWebSocketToRemainOpen(connectionPair.clientSocket);
  });

  it("closes connection and PTY peers when the bootstrap peer detaches", async () => {
    const coordinator = createRelayCoordinator();
    const bootstrapPair = await createWebSocketPair();
    const connectionPair = await createWebSocketPair();
    const ptyClientPair = await createWebSocketPair();
    const ptySandboxPair = await createWebSocketPair();
    openPairs.push(bootstrapPair, connectionPair, ptyClientPair, ptySandboxPair);
    const bootstrapTarget = attachPeer({
      coordinator,
      pair: bootstrapPair,
      side: "bootstrap",
      sessionId: "bootstrap_session",
    });
    attachPeer({
      coordinator,
      pair: connectionPair,
      side: "connection",
      sessionId: "agent_session",
    });
    attachPeer({
      coordinator,
      pair: ptyClientPair,
      side: "ptyClient",
      sessionId: "terminal_one",
    });
    attachPeer({
      coordinator,
      pair: ptySandboxPair,
      side: "ptySandbox",
      sessionId: "terminal_one",
    });

    const connectionClosePromise = waitForWebSocketClose(connectionPair.clientSocket);
    const ptyClientClosePromise = waitForWebSocketClose(ptyClientPair.clientSocket);
    const ptySandboxClosePromise = waitForWebSocketClose(ptySandboxPair.clientSocket);
    coordinator.detachPeer(bootstrapTarget);

    await expect(connectionClosePromise).resolves.toMatchObject({
      code: 1012,
      reason: "Sandbox tunnel peer disconnected.",
    });
    await expect(ptyClientClosePromise).resolves.toMatchObject({
      code: 1012,
      reason: "Sandbox tunnel peer disconnected.",
    });
    await expect(ptySandboxClosePromise).resolves.toMatchObject({
      code: 1012,
      reason: "Sandbox tunnel peer disconnected.",
    });
  });
});
