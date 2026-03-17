import { once } from "node:events";

import {
  parseBootstrapControlMessage,
  type BootstrapControlMessage,
  type ExecutionLease,
} from "@mistle/sandbox-session-protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer, type RawData } from "ws";

import { AsyncQueue } from "../src/tunnel/async-queue.js";
import { ExecutionLeaseEngine } from "../src/tunnel/execution-lease-engine.js";

type WebSocketPair = {
  readonly server: WebSocketServer;
  readonly clientSocket: WebSocket;
  readonly serverSocket: WebSocket;
  readonly receivedMessages: AsyncQueue<BootstrapControlMessage>;
};

const cleanupCallbacks: Array<() => Promise<void>> = [];

function createExecutionLease(id: string): ExecutionLease {
  return {
    id,
    kind: "agent_busy",
    source: "openai-codex",
  };
}

function rawDataToString(payload: RawData): string {
  if (typeof payload === "string") {
    return payload;
  }
  if (payload instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(payload));
  }
  if (Array.isArray(payload)) {
    return new TextDecoder().decode(Uint8Array.from(Buffer.concat(payload)));
  }

  return new TextDecoder().decode(
    new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength),
  );
}

async function createWebSocketPair(): Promise<WebSocketPair> {
  const server = new WebSocketServer({
    port: 0,
  });
  cleanupCallbacks.push(async () => {
    await closeWebSocketServer(server);
  });

  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("websocket server address must be available");
  }

  const receivedMessages = new AsyncQueue<BootstrapControlMessage>();
  const serverConnection = once(server, "connection").then(([socket]) => {
    if (!(socket instanceof WebSocket)) {
      throw new Error("expected websocket server connection");
    }

    socket.on("message", (payload, isBinary) => {
      if (isBinary) {
        receivedMessages.fail(new Error("expected text lease control message"));
        return;
      }

      const parsedMessage = parseBootstrapControlMessage(rawDataToString(payload));
      if (parsedMessage === undefined) {
        receivedMessages.fail(new Error("expected bootstrap control message"));
        return;
      }

      receivedMessages.push(parsedMessage);
    });
    socket.on("error", (error) => {
      receivedMessages.fail(error);
    });
    socket.on("close", () => {
      receivedMessages.fail(new Error("server websocket closed"));
    });
    return socket;
  });

  const clientSocket = new WebSocket(`ws://127.0.0.1:${String(address.port)}`);
  cleanupCallbacks.push(async () => {
    await closeWebSocket(clientSocket);
  });

  await once(clientSocket, "open");
  const serverSocket = await serverConnection;

  return {
    server,
    clientSocket,
    serverSocket,
    receivedMessages,
  };
}

async function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  const closePromise = once(socket, "close");
  socket.close();
  await closePromise;
}

async function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

describe("ExecutionLeaseEngine", () => {
  afterEach(async () => {
    while (cleanupCallbacks.length > 0) {
      const cleanup = cleanupCallbacks.pop();
      if (cleanup !== undefined) {
        await cleanup();
      }
    }
  });

  it("creates, renews, and removes tracked leases over the tunnel socket", async () => {
    const engine = new ExecutionLeaseEngine();
    const { clientSocket, receivedMessages } = await createWebSocketPair();
    const lease = createExecutionLease("lease_123");

    engine.attachTunnelConnection(clientSocket);

    await engine.create(lease);
    await expect(receivedMessages.next()).resolves.toEqual({
      type: "lease.create",
      lease,
    });
    expect(engine.has(lease.id)).toBe(true);

    await engine.renew(lease.id);
    await expect(receivedMessages.next()).resolves.toEqual({
      type: "lease.renew",
      leaseId: lease.id,
    });

    engine.remove(lease.id);
    expect(engine.has(lease.id)).toBe(false);
    expect(() => engine.renew(lease.id)).toThrow(`execution lease "${lease.id}" is not tracked`);
  });

  it("rejects duplicate lease ids and detaching the active socket disables future creates", async () => {
    const engine = new ExecutionLeaseEngine();
    const { clientSocket, receivedMessages, serverSocket } = await createWebSocketPair();
    const lease = createExecutionLease("lease_duplicate");

    engine.attachTunnelConnection(clientSocket);

    await engine.create(lease);
    await expect(receivedMessages.next()).resolves.toEqual({
      type: "lease.create",
      lease,
    });

    await expect(engine.create(lease)).rejects.toThrow(
      `execution lease "${lease.id}" is already tracked`,
    );
    expect(engine.has(lease.id)).toBe(true);

    engine.detachTunnelConnection(serverSocket);
    await expect(engine.renew(lease.id)).resolves.toBeUndefined();
    await expect(receivedMessages.next()).resolves.toEqual({
      type: "lease.renew",
      leaseId: lease.id,
    });

    engine.detachTunnelConnection(clientSocket);
    await expect(engine.create(createExecutionLease("lease_after_detach"))).rejects.toThrow(
      "sandbox tunnel bootstrap connection is not attached",
    );
  });
});
