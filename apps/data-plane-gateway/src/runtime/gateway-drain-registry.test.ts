import { PassThrough } from "node:stream";

import { systemSleeper } from "@mistle/time";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

import { GatewayDrainRegistry } from "./gateway-drain-registry.js";
import {
  GatewayWebSocketCloseCodes,
  GatewayWebSocketCloseReasons,
} from "./gateway-websocket-close.js";

type WebSocketPair = {
  client: WebSocket;
  close: () => Promise<void>;
  server: WebSocket;
};

const openPairs: WebSocketPair[] = [];

afterEach(async () => {
  while (openPairs.length > 0) {
    await openPairs.pop()?.close();
  }
});

describe("GatewayDrainRegistry", () => {
  it("closes registered gateway websockets with service_restart and waits for unregister", async () => {
    const registry = new GatewayDrainRegistry();
    const pair = await createWebSocketPair();
    openPairs.push(pair);
    const clientClose = waitForWebSocketClose(pair.client);
    const unregister = registry.registerGatewayWebSocket({
      category: "sandbox_tunnel",
      socket: pair.server,
    });
    pair.server.once("close", unregister);

    const result = await registry.closeForServiceRestart({ waitMs: 1_000 });

    await expect(clientClose).resolves.toEqual({
      code: GatewayWebSocketCloseCodes.SERVICE_RESTART,
      reason: GatewayWebSocketCloseReasons.SERVICE_RESTART,
    });
    expect(result).toEqual({
      directEgressWebSocketCount: 0,
      forcedRawLongLivedConnectionCount: 0,
      forcedWebSocketCount: 0,
      graceful: true,
      portAccessRawConnectionCount: 0,
      ptyTransportWebSocketCount: 0,
      rawLongLivedConnectionCount: 0,
      rawLongLivedConnectionEndCount: 0,
      sandboxTunnelWebSocketCount: 1,
      serviceRestartWebSocketCloseCount: 1,
      webSocketCount: 1,
    });
    expect(registry.activeCounts()).toEqual({
      rawLongLivedConnectionCount: 0,
      webSocketCount: 0,
    });
  });

  it("ends registered raw long-lived Port Access sockets without websocket close frames", async () => {
    const registry = new GatewayDrainRegistry();
    const rawClientSocket = new PassThrough();
    const rawPeerSocket = new PassThrough();
    rawClientSocket.pipe(rawPeerSocket).pipe(rawClientSocket);
    registry.registerRawLongLivedConnection({
      category: "port_access",
      socket: rawClientSocket,
    });
    const peerEnded = waitForStreamEnd(rawPeerSocket);

    const result = await registry.closeForServiceRestart({ waitMs: 1_000 });

    await peerEnded;
    expect(result).toEqual({
      directEgressWebSocketCount: 0,
      forcedRawLongLivedConnectionCount: 0,
      forcedWebSocketCount: 0,
      graceful: true,
      portAccessRawConnectionCount: 1,
      ptyTransportWebSocketCount: 0,
      rawLongLivedConnectionCount: 1,
      rawLongLivedConnectionEndCount: 1,
      sandboxTunnelWebSocketCount: 0,
      serviceRestartWebSocketCloseCount: 0,
      webSocketCount: 0,
    });
  });

  it("force closes entries that do not unregister before the bounded wait expires", async () => {
    const registry = new GatewayDrainRegistry();
    const rawClientSocket = new PassThrough();
    registry.registerRawLongLivedConnection({
      category: "port_access",
      socket: rawClientSocket,
    });

    const result = await registry.closeForServiceRestart({ waitMs: 10 });

    await waitForCondition(() => rawClientSocket.destroyed);
    expect(result).toEqual({
      directEgressWebSocketCount: 0,
      forcedRawLongLivedConnectionCount: 1,
      forcedWebSocketCount: 0,
      graceful: false,
      portAccessRawConnectionCount: 1,
      ptyTransportWebSocketCount: 0,
      rawLongLivedConnectionCount: 1,
      rawLongLivedConnectionEndCount: 1,
      sandboxTunnelWebSocketCount: 0,
      serviceRestartWebSocketCloseCount: 0,
      webSocketCount: 0,
    });
  });

  it("immediately closes websocket registrations that arrive during service restart drain", async () => {
    const registry = new GatewayDrainRegistry();
    const blockingPair = await createWebSocketPair();
    const latePair = await createWebSocketPair();
    openPairs.push(blockingPair, latePair);
    const unregisterBlockingPair = registry.registerGatewayWebSocket({
      category: "sandbox_tunnel",
      socket: blockingPair.server,
    });
    blockingPair.server.once("close", unregisterBlockingPair);
    const lateClientClose = waitForWebSocketClose(latePair.client);

    const closeResult = registry.closeForServiceRestart({ waitMs: 1_000 });
    const unregisterLatePair = registry.registerGatewayWebSocket({
      category: "direct_egress",
      socket: latePair.server,
    });
    latePair.server.once("close", unregisterLatePair);
    blockingPair.server.terminate();

    await expect(lateClientClose).resolves.toEqual({
      code: GatewayWebSocketCloseCodes.SERVICE_RESTART,
      reason: GatewayWebSocketCloseReasons.SERVICE_RESTART,
    });
    expect(await closeResult).toMatchObject({
      graceful: true,
      serviceRestartWebSocketCloseCount: 2,
    });
  });

  it("immediately ends raw connection registrations that arrive during service restart drain", async () => {
    const registry = new GatewayDrainRegistry();
    const blockingSocket = new PassThrough();
    const lateClientSocket = new PassThrough();
    const latePeerSocket = new PassThrough();
    lateClientSocket.pipe(latePeerSocket).pipe(lateClientSocket);
    registry.registerRawLongLivedConnection({
      category: "port_access",
      socket: blockingSocket,
    });
    const latePeerEnded = waitForStreamEnd(latePeerSocket);

    const closeResult = registry.closeForServiceRestart({ waitMs: 1_000 });
    registry.registerRawLongLivedConnection({
      category: "port_access",
      socket: lateClientSocket,
    });
    blockingSocket.destroy();

    await latePeerEnded;
    expect(await closeResult).toMatchObject({
      graceful: true,
      rawLongLivedConnectionEndCount: 2,
    });
  });
});

async function createWebSocketPair(): Promise<WebSocketPair> {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", (error) => reject(error));
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a concrete socket address.");
  }

  const acceptedSocket = new Promise<WebSocket>((resolve) => {
    server.once("connection", (socket) => {
      resolve(socket);
    });
  });
  const client = new WebSocket(`ws://127.0.0.1:${String(address.port)}`);
  const socket = await acceptedSocket;
  await new Promise<void>((resolve, reject) => {
    client.once("open", () => resolve());
    client.once("error", (error) => reject(error));
  });

  return {
    client,
    close: async () => {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    },
    server: socket,
  };
}

async function waitForWebSocketClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return await new Promise((resolve) => {
    socket.once("close", (code, reason) => {
      resolve({
        code,
        reason: reason.toString("utf8"),
      });
    });
  });
}

async function waitForStreamEnd(stream: PassThrough): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.once("end", () => resolve());
    stream.once("error", (error) => reject(error));
  });
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await systemSleeper.sleep(10);
  }

  throw new Error("Timed out waiting for drain registry condition.");
}
