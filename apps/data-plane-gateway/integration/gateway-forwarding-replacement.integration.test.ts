import { releaseReservedPort, reserveAvailablePort } from "@mistle/test-harness";
import { createMutableClock } from "@mistle/time/testing";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

import { GatewayDrainRegistry } from "../src/runtime/gateway-drain-registry.js";
import type { GatewayForwardingReplacementReason } from "../src/runtime/gateway-forwarding-recovery-supervisor.js";
import { createGatewayForwardingReplacementHandler } from "../src/runtime/gateway-forwarding-replacement.js";
import { GatewayLifecycle } from "../src/runtime/gateway-lifecycle.js";
import {
  GatewayWebSocketCloseCodes,
  GatewayWebSocketCloseReasons,
} from "../src/runtime/gateway-websocket-close.js";

const TestHost = "127.0.0.1";

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

describe("gateway forwarding replacement", () => {
  it("closes active gateway websockets through the service-restart drain before replacement", async () => {
    const lifecycle = new GatewayLifecycle(createMutableClock(1_000));
    const drainRegistry = new GatewayDrainRegistry();
    const pair = await createWebSocketPair();
    openPairs.push(pair);
    const clientClose = waitForWebSocketClose(pair.client);
    const unregister = drainRegistry.registerGatewayWebSocket({
      category: "sandbox_tunnel",
      socket: pair.server,
    });
    pair.server.once("close", unregister);
    const replacement = createDeferredReplacement();
    const requestReplacement = createGatewayForwardingReplacementHandler({
      closeForServiceRestartWaitMs: 1_000,
      drainRegistry,
      lifecycle,
      localNodeId: "dpg_test",
      onUnrecoverableForwarding: replacement.resolve,
    });

    requestReplacement("forwarding_check_failure_threshold");

    await expect(clientClose).resolves.toEqual({
      code: GatewayWebSocketCloseCodes.SERVICE_RESTART,
      reason: GatewayWebSocketCloseReasons.SERVICE_RESTART,
    });
    await expect(replacement.promise).resolves.toBe("forwarding_check_failure_threshold");
    expect(lifecycle.getState()).toEqual({
      reason: GatewayWebSocketCloseReasons.SERVICE_RESTART,
      startedAtMs: 1_000,
      status: "draining",
    });
    expect(drainRegistry.activeCounts()).toEqual({
      rawLongLivedConnectionCount: 0,
      webSocketCount: 0,
    });
  });
});

function createDeferredReplacement(): {
  promise: Promise<GatewayForwardingReplacementReason>;
  resolve: (reason: GatewayForwardingReplacementReason) => void;
} {
  let resolveDeferred: (reason: GatewayForwardingReplacementReason) => void = () => {
    throw new Error("Deferred replacement resolve was used before initialization.");
  };
  const promise = new Promise<GatewayForwardingReplacementReason>((resolve) => {
    resolveDeferred = resolve;
  });

  return {
    promise,
    resolve: resolveDeferred,
  };
}

async function createWebSocketPair(): Promise<WebSocketPair> {
  const reservedPort = await reserveAvailablePort({ host: TestHost });
  let shouldReleaseReservedPort = true;
  const webSocketServer = new WebSocketServer({
    host: TestHost,
    port: reservedPort,
  });
  await new Promise<void>((resolve, reject) => {
    webSocketServer.once("listening", async () => {
      shouldReleaseReservedPort = false;
      await releaseReservedPort({ host: TestHost, port: reservedPort });
      resolve();
    });
    webSocketServer.once("error", (error) => reject(error));
  }).catch((error: unknown) => {
    if (shouldReleaseReservedPort) {
      void releaseReservedPort({ host: TestHost, port: reservedPort });
    }
    throw error;
  });

  const acceptedSocket = new Promise<WebSocket>((resolve) => {
    webSocketServer.once("connection", (socket) => {
      resolve(socket);
    });
  });
  const client = new WebSocket(`ws://${TestHost}:${String(reservedPort)}`);
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
        webSocketServer.close((error) => {
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

function waitForWebSocketClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => {
      resolve({
        code,
        reason: reason.toString(),
      });
    });
  });
}
