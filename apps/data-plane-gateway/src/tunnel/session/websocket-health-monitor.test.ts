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

type WebSocketPairOptions = {
  clientAutoPong?: boolean;
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

function waitForPing(socket: WebSocket): Promise<Buffer> {
  return new Promise((resolve) => {
    socket.once("ping", (data: RawData) => {
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

function sendPong(socket: WebSocket, payload: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.pong(payload, true, (error) => {
      if (error != null) {
        reject(error);
        return;
      }
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

async function createWebSocketPair(options?: WebSocketPairOptions): Promise<WebSocketPair> {
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
  const clientSocket = new WebSocket(
    `ws://127.0.0.1:${String(address.port)}`,
    options?.clientAutoPong === undefined
      ? undefined
      : {
          autoPong: options.clientAutoPong,
        },
  );

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

async function sendScheduledPing(input: {
  clock: ReturnType<typeof createMutableClock>;
  clientSocket: WebSocket;
  scheduler: ReturnType<typeof createManualScheduler>;
}): Promise<Buffer> {
  input.clock.advanceMs(10);
  const pingPromise = waitForPing(input.clientSocket);
  input.scheduler.runDue();
  return pingPromise;
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
    const pongPayload = await pongPromise;
    const parsedPongPayload: unknown = JSON.parse(pongPayload.toString("utf8"));

    expect(handle.isHealthy()).toBe(true);
    expect(parsedPongPayload).toEqual({
      type: "mistle.tunnel.health_ping",
      pingSeq: 1,
      sentAtMs: 1_010,
    });
    expect(unhealthyCount).toBe(0);
    handle.stop();
  });

  it("stops monitoring without marking unhealthy once the peer disconnects before the next ping", async () => {
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

    expect(handle.isHealthy()).toBe(true);
    expect(unhealthyCount).toBe(0);
  });

  it("stops monitoring without marking unhealthy when the peer disconnects before pong timeout", async () => {
    const pair = await createWebSocketPair({ clientAutoPong: false });
    openPairs.add(pair);
    const clock = createMutableClock(2_500);
    const scheduler = createManualScheduler(clock);
    const missedPongCounts: number[] = [];
    let unhealthyCount = 0;

    const handle = startWebSocketHealthMonitor({
      clock,
      socketKind: "bootstrap",
      tokenKind: "bootstrap",
      socket: pair.peerSocket,
      scheduler,
      pingIntervalMs: 10,
      pongTimeoutMs: 10,
      maxConsecutiveMissedPongs: 1,
      onMissedPong: ({ consecutiveMissedPongs }) => {
        missedPongCounts.push(consecutiveMissedPongs);
      },
      onUnhealthy: () => {
        unhealthyCount += 1;
      },
    });

    await sendScheduledPing({
      clock,
      clientSocket: pair.clientSocket,
      scheduler,
    });
    const clientClosePromise = waitForWebSocketClose(pair.clientSocket);
    const serverClosePromise = waitForWebSocketClose(pair.serverSocket);
    pair.clientSocket.close();
    await Promise.all([clientClosePromise, serverClosePromise]);
    clock.advanceMs(10);
    scheduler.runDue();

    expect(handle.isHealthy()).toBe(true);
    expect(unhealthyCount).toBe(0);
    expect(missedPongCounts).toEqual([]);
  });

  it("keeps sockets healthy through a transient missed pong and resets after recovery", async () => {
    const pair = await createWebSocketPair({ clientAutoPong: false });
    openPairs.add(pair);
    const clock = createMutableClock(3_000);
    const scheduler = createManualScheduler(clock);
    const missedPongCounts: number[] = [];
    const recoveredMissedPongCounts: number[] = [];
    let unhealthyCount = 0;

    const handle = startWebSocketHealthMonitor({
      clock,
      socketKind: "bootstrap",
      tokenKind: "bootstrap",
      socket: pair.peerSocket,
      scheduler,
      pingIntervalMs: 10,
      pongTimeoutMs: 10,
      maxConsecutiveMissedPongs: 3,
      onMissedPong: ({ consecutiveMissedPongs }) => {
        missedPongCounts.push(consecutiveMissedPongs);
      },
      onRecovered: ({ consecutiveMissedPongs }) => {
        recoveredMissedPongCounts.push(consecutiveMissedPongs);
      },
      onUnhealthy: () => {
        unhealthyCount += 1;
      },
    });

    const firstPingPayload = await sendScheduledPing({
      clock,
      clientSocket: pair.clientSocket,
      scheduler,
    });
    clock.advanceMs(10);
    scheduler.runDue();

    expect(handle.isHealthy()).toBe(true);
    expect(unhealthyCount).toBe(0);
    expect(missedPongCounts).toEqual([1]);
    expect(recoveredMissedPongCounts).toEqual([]);

    const recoveryPongPromise = waitForPong(pair.serverSocket);
    await sendPong(pair.clientSocket, firstPingPayload);
    await recoveryPongPromise;
    expect(recoveredMissedPongCounts).toEqual([1]);
    expect(handle.getSnapshot().pingSeq).toBe(null);

    await sendScheduledPing({
      clock,
      clientSocket: pair.clientSocket,
      scheduler,
    });
    clock.advanceMs(10);
    scheduler.runDue();

    expect(handle.isHealthy()).toBe(true);
    expect(unhealthyCount).toBe(0);
    expect(missedPongCounts).toEqual([1, 1]);
    expect(recoveredMissedPongCounts).toEqual([1]);
    handle.stop();
  });

  it("ignores stale structured pongs while a newer ping is in flight", async () => {
    const pair = await createWebSocketPair({ clientAutoPong: false });
    openPairs.add(pair);
    const clock = createMutableClock(3_500);
    const scheduler = createManualScheduler(clock);
    const missedPongCounts: number[] = [];
    const recoveredMissedPongCounts: number[] = [];
    let unhealthyCount = 0;

    const handle = startWebSocketHealthMonitor({
      clock,
      socketKind: "bootstrap",
      tokenKind: "bootstrap",
      socket: pair.peerSocket,
      scheduler,
      pingIntervalMs: 10,
      pongTimeoutMs: 10,
      maxConsecutiveMissedPongs: 3,
      onMissedPong: ({ consecutiveMissedPongs }) => {
        missedPongCounts.push(consecutiveMissedPongs);
      },
      onRecovered: ({ consecutiveMissedPongs }) => {
        recoveredMissedPongCounts.push(consecutiveMissedPongs);
      },
      onUnhealthy: () => {
        unhealthyCount += 1;
      },
    });

    const firstPingPayload = await sendScheduledPing({
      clock,
      clientSocket: pair.clientSocket,
      scheduler,
    });
    clock.advanceMs(10);
    scheduler.runDue();
    await sendScheduledPing({
      clock,
      clientSocket: pair.clientSocket,
      scheduler,
    });

    expect(handle.getSnapshot().pingSeq).toBe(2);
    const stalePongPromise = waitForPong(pair.serverSocket);
    await sendPong(pair.clientSocket, firstPingPayload);
    await stalePongPromise;

    expect(handle.getSnapshot().pingSeq).toBe(2);
    expect(handle.isHealthy()).toBe(true);
    expect(unhealthyCount).toBe(0);
    expect(missedPongCounts).toEqual([1]);
    expect(recoveredMissedPongCounts).toEqual([]);

    clock.advanceMs(10);
    scheduler.runDue();

    expect(handle.isHealthy()).toBe(true);
    expect(unhealthyCount).toBe(0);
    expect(missedPongCounts).toEqual([1, 2]);
    expect(recoveredMissedPongCounts).toEqual([]);
    handle.stop();
  });

  it("marks sockets unhealthy only after the configured missed pong threshold", async () => {
    const pair = await createWebSocketPair({ clientAutoPong: false });
    openPairs.add(pair);
    const clock = createMutableClock(4_000);
    const scheduler = createManualScheduler(clock);
    const missedPongCounts: number[] = [];
    const pingPayloads: Buffer[] = [];
    let unhealthyCount = 0;

    const handle = startWebSocketHealthMonitor({
      clock,
      socketKind: "bootstrap",
      tokenKind: "bootstrap",
      socket: pair.peerSocket,
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
      pingPayloads.push(
        await sendScheduledPing({
          clock,
          clientSocket: pair.clientSocket,
          scheduler,
        }),
      );
      clock.advanceMs(10);
      scheduler.runDue();
    }

    expect(handle.isHealthy()).toBe(false);
    expect(unhealthyCount).toBe(1);
    expect(missedPongCounts).toEqual([1, 2, 3]);
    expect(pingPayloads.map((payload) => JSON.parse(payload.toString("utf8")))).toEqual([
      {
        type: "mistle.tunnel.health_ping",
        pingSeq: 1,
        sentAtMs: 4_010,
      },
      {
        type: "mistle.tunnel.health_ping",
        pingSeq: 2,
        sentAtMs: 4_030,
      },
      {
        type: "mistle.tunnel.health_ping",
        pingSeq: 3,
        sentAtMs: 4_050,
      },
    ]);
  });
});
