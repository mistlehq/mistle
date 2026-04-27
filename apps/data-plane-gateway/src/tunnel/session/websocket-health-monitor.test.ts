import { EventEmitter } from "node:events";
import { createServer } from "node:http";

import { createManualScheduler, createMutableClock } from "@mistle/time/testing";
import { WSContext } from "hono/ws";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

import type { RelayPeerSocket } from "../types.js";
import { startWebSocketHealthMonitor } from "./websocket-health-monitor.js";

type WebSocketPair = {
  clientSocket: WebSocket;
  closeAll: () => Promise<void>;
  peerSocket: RelayPeerSocket;
  serverSocket: WebSocket;
};

const openPairs = new Set<WebSocketPair>();

afterEach(async () => {
  await Promise.all(Array.from(openPairs, async (pair) => pair.closeAll()));
  openPairs.clear();
});

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

function waitForWebSocketClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onClose = (): void => {
      cleanup();
      resolve();
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

function waitForPong(socket: WebSocket): Promise<Buffer> {
  return new Promise((resolve) => {
    socket.once("pong", (data: RawData) => {
      if (Buffer.isBuffer(data)) {
        resolve(data);
        return;
      }
      if (data instanceof ArrayBuffer) {
        resolve(Buffer.from(data));
        return;
      }
      resolve(Buffer.concat(data));
    });
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

class FakeRawSocket extends EventEmitter {
  public pingCallCount = 0;

  public ping(
    _data: Buffer | undefined,
    _mask: boolean,
    callback?: (error: Error | null | undefined) => void,
  ): void {
    this.pingCallCount += 1;
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
      const clientClosePromise = waitForWebSocketClose(clientSocket);
      clientSocket.close();
      await clientClosePromise;
    }
    if (serverSocket.readyState === WebSocket.OPEN) {
      const serverClosePromise = waitForWebSocketClose(serverSocket);
      serverSocket.close();
      await serverClosePromise;
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

describe("startWebSocketHealthMonitor", () => {
  it("keeps responsive sockets healthy across ping and pong", async () => {
    const pair = await createWebSocketPair();
    openPairs.add(pair);
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    let unhealthyCount = 0;

    const handle = startWebSocketHealthMonitor({
      clock,
      socketKind: "bootstrap",
      tokenKind: "bootstrap",
      socket: pair.peerSocket,
      scheduler,
      pingIntervalMs: 10,
      pongTimeoutMs: 10,
      onUnhealthy: () => {
        unhealthyCount += 1;
      },
    });

    clock.advanceMs(10);
    const pongPromise = waitForPong(pair.serverSocket);
    scheduler.runDue();
    await pongPromise;

    expect(handle.isHealthy()).toBe(true);
    expect(unhealthyCount).toBe(0);
    handle.stop();
  });

  it("marks sockets unhealthy once the peer disconnects before the next ping", async () => {
    const pair = await createWebSocketPair();
    openPairs.add(pair);
    const clock = createMutableClock(2_000);
    const scheduler = createManualScheduler(clock);
    let unhealthyCount = 0;

    const handle = startWebSocketHealthMonitor({
      clock,
      socketKind: "connection",
      tokenKind: "connection",
      socket: pair.peerSocket,
      scheduler,
      pingIntervalMs: 10,
      pongTimeoutMs: 10,
      onUnhealthy: () => {
        unhealthyCount += 1;
      },
    });

    const clientClosePromise = waitForWebSocketClose(pair.clientSocket);
    const serverClosePromise = waitForWebSocketClose(pair.serverSocket);
    pair.clientSocket.terminate();
    await Promise.all([clientClosePromise, serverClosePromise]);

    clock.advanceMs(10);
    scheduler.runDue();

    expect(handle.isHealthy()).toBe(false);
    expect(unhealthyCount).toBe(1);
  });

  it("keeps sockets healthy through a transient missed pong and resets after recovery", () => {
    const clock = createMutableClock(3_000);
    const scheduler = createManualScheduler(clock);
    const rawSocket = new FakeRawSocket();
    const missedPongCounts: number[] = [];
    let unhealthyCount = 0;

    const handle = startWebSocketHealthMonitor({
      clock,
      socketKind: "bootstrap",
      tokenKind: "bootstrap",
      socket: createFakePeerSocket(rawSocket),
      scheduler,
      pingIntervalMs: 10,
      pongTimeoutMs: 10,
      maxConsecutiveMissedPongs: 3,
      onMissedPong: ({ consecutiveMissedPongs }) => {
        missedPongCounts.push(consecutiveMissedPongs);
      },
      onUnhealthy: () => {
        unhealthyCount += 1;
      },
    });

    clock.advanceMs(10);
    scheduler.runDue();
    clock.advanceMs(10);
    scheduler.runDue();

    expect(handle.isHealthy()).toBe(true);
    expect(unhealthyCount).toBe(0);
    expect(missedPongCounts).toEqual([1]);

    rawSocket.emit("pong", Buffer.alloc(0));

    clock.advanceMs(10);
    scheduler.runDue();
    clock.advanceMs(10);
    scheduler.runDue();

    expect(handle.isHealthy()).toBe(true);
    expect(unhealthyCount).toBe(0);
    expect(missedPongCounts).toEqual([1, 1]);
    handle.stop();
  });

  it("marks sockets unhealthy only after the configured missed pong threshold", () => {
    const clock = createMutableClock(4_000);
    const scheduler = createManualScheduler(clock);
    const rawSocket = new FakeRawSocket();
    const missedPongCounts: number[] = [];
    let unhealthyCount = 0;

    const handle = startWebSocketHealthMonitor({
      clock,
      socketKind: "bootstrap",
      tokenKind: "bootstrap",
      socket: createFakePeerSocket(rawSocket),
      scheduler,
      pingIntervalMs: 10,
      pongTimeoutMs: 10,
      maxConsecutiveMissedPongs: 3,
      onMissedPong: ({ consecutiveMissedPongs }) => {
        missedPongCounts.push(consecutiveMissedPongs);
      },
      onUnhealthy: () => {
        unhealthyCount += 1;
      },
    });

    for (let iteration = 0; iteration < 3; iteration += 1) {
      clock.advanceMs(10);
      scheduler.runDue();
      clock.advanceMs(10);
      scheduler.runDue();
    }

    expect(handle.isHealthy()).toBe(false);
    expect(unhealthyCount).toBe(1);
    expect(missedPongCounts).toEqual([1, 2, 3]);
  });
});
