import { createServer } from "node:http";

import { systemSleeper } from "@mistle/time";
import { WSContext } from "hono/ws";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

import type { TunnelPeerLocation, TunnelPeerSocket } from "../../types.js";
import { InMemoryTunnelFrameTransportAdapter } from "./in-memory-frame-transport-adapter.js";

type ReceivedWebSocketMessage = {
  data: string | Buffer;
  isBinary: boolean;
};

type WebSocketPair = {
  clientSocket: WebSocket;
  serverSocket: WebSocket;
  peerSocket: TunnelPeerSocket;
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

function expectNoWebSocketMessage(socket: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (): void => {
      cleanup();
      reject(new Error("Expected websocket to receive no message."));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("message", onMessage);
      socket.off("error", onError);
    };

    socket.on("message", onMessage);
    socket.on("error", onError);

    void systemSleeper.sleep(timeoutMs).then(() => {
      cleanup();
      resolve();
    });
  });
}

function toWsReadyState(input: number): 0 | 1 | 2 | 3 {
  if (input === 0 || input === 1 || input === 2 || input === 3) {
    return input;
  }

  throw new Error(`Unexpected websocket ready state: ${String(input)}`);
}

function toPeerSocket(socket: WebSocket): TunnelPeerSocket {
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

function createPeerLocation(input: {
  instanceId: string;
  side: TunnelPeerLocation["side"];
  nodeId: string;
  sessionId: string;
}): TunnelPeerLocation {
  return {
    instanceId: input.instanceId,
    side: input.side,
    nodeId: input.nodeId,
    sessionId: input.sessionId,
  };
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
  const port = address.port;

  const serverSocketPromise = new Promise<WebSocket>((resolve, reject) => {
    webSocketServer.once("connection", (socket) => {
      resolve(socket);
    });
    webSocketServer.once("error", reject);
  });
  const clientSocket = new WebSocket(`ws://127.0.0.1:${String(port)}`);

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

describe("InMemoryTunnelFrameTransportAdapter", () => {
  const openPairs: WebSocketPair[] = [];

  afterEach(async () => {
    await Promise.all(openPairs.splice(0).map(async (pair) => pair.closeAll()));
  });

  it("forwards text payloads to the registered local peer socket", async () => {
    const pair = await createWebSocketPair();
    openPairs.push(pair);
    const adapter = new InMemoryTunnelFrameTransportAdapter("dpg_local");
    const target = createPeerLocation({
      instanceId: "sbi_abc",
      side: "connection",
      nodeId: "dpg_local",
      sessionId: "session_one",
    });

    adapter.registerLocalPeer({
      location: target,
      socket: pair.peerSocket,
    });

    const receivedPromise = waitForWebSocketMessage(pair.clientSocket);
    await adapter.forwardToPeer({
      target,
      payload: "hello from adapter",
    });
    const received = await receivedPromise;

    expect(received.isBinary).toBe(false);
    expect(received.data).toBe("hello from adapter");
  });

  it("forwards binary payloads to the registered local peer socket", async () => {
    const pair = await createWebSocketPair();
    openPairs.push(pair);
    const adapter = new InMemoryTunnelFrameTransportAdapter("dpg_local");
    const target = createPeerLocation({
      instanceId: "sbi_abc",
      side: "connection",
      nodeId: "dpg_local",
      sessionId: "session_one",
    });
    const payload = Uint8Array.from([1, 2, 3]).buffer;

    adapter.registerLocalPeer({
      location: target,
      socket: pair.peerSocket,
    });

    const receivedPromise = waitForWebSocketMessage(pair.clientSocket);
    await adapter.forwardToPeer({
      target,
      payload,
    });
    const received = await receivedPromise;

    expect(received.isBinary).toBe(true);
    expect(typeof received.data).toBe("object");
    if (typeof received.data === "string") {
      throw new Error("Expected binary websocket message.");
    }
    expect(received.data.equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it("does not forward payloads after local peer is unregistered", async () => {
    const pair = await createWebSocketPair();
    openPairs.push(pair);
    const adapter = new InMemoryTunnelFrameTransportAdapter("dpg_local");
    const target = createPeerLocation({
      instanceId: "sbi_abc",
      side: "connection",
      nodeId: "dpg_local",
      sessionId: "session_one",
    });

    adapter.registerLocalPeer({
      location: target,
      socket: pair.peerSocket,
    });
    adapter.unregisterLocalPeer({
      location: target,
    });

    await adapter.forwardToPeer({
      target,
      payload: "not delivered",
    });
    await expectNoWebSocketMessage(pair.clientSocket, 150);
  });

  it("closes the local peer socket with the requested code and reason", async () => {
    const pair = await createWebSocketPair();
    openPairs.push(pair);
    const adapter = new InMemoryTunnelFrameTransportAdapter("dpg_local");
    const target = createPeerLocation({
      instanceId: "sbi_abc",
      side: "connection",
      nodeId: "dpg_local",
      sessionId: "session_one",
    });

    adapter.registerLocalPeer({
      location: target,
      socket: pair.peerSocket,
    });

    const closedPromise = waitForWebSocketClose(pair.clientSocket);
    adapter.closePeer({
      target,
      closeCode: 1012,
      closeReason: "Closed by adapter",
    });
    const closed = await closedPromise;

    expect(closed.code).toBe(1012);
    expect(closed.reason).toBe("Closed by adapter");
  });

  it("throws when registering a peer for a different gateway node", async () => {
    const pair = await createWebSocketPair();
    openPairs.push(pair);
    const adapter = new InMemoryTunnelFrameTransportAdapter("dpg_local");
    const nonLocalTarget = createPeerLocation({
      instanceId: "sbi_abc",
      side: "connection",
      nodeId: "dpg_other",
      sessionId: "session_one",
    });

    expect(() =>
      adapter.registerLocalPeer({
        location: nonLocalTarget,
        socket: pair.peerSocket,
      }),
    ).toThrow("Expected local peer registration to target current gateway node.");
  });

  it("throws when forwarding to a peer that belongs to a different gateway node", async () => {
    const adapter = new InMemoryTunnelFrameTransportAdapter("dpg_local");
    const nonLocalTarget = createPeerLocation({
      instanceId: "sbi_abc",
      side: "connection",
      nodeId: "dpg_other",
      sessionId: "session_one",
    });

    await expect(
      adapter.forwardToPeer({
        target: nonLocalTarget,
        payload: "hello",
      }),
    ).rejects.toThrow("Expected in-memory frame transport target to be local.");
  });
});
