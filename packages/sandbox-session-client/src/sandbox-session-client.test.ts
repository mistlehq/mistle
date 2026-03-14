import {
  decodeDataFrame,
  DefaultStreamWindowBytes,
  encodeDataFrame,
  parseStreamControlMessage,
  PayloadKindWebSocketText,
} from "@mistle/sandbox-session-protocol";
import { systemSleeper } from "@mistle/time";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocketServer } from "ws";

import { SandboxSessionClient, parseStreamOpenControlMessage } from "./client.js";
import { createNodeSandboxSessionRuntime } from "./node.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type TestServerMode = "accept" | "reject";

type TestServer = {
  url: string;
  openRequest: Promise<string>;
  payload: Promise<{ streamId: number; payload: string }>;
  socketClosed: Promise<void>;
  windowUpdate: Promise<{ bytes: number; streamId: number }>;
  sendNotification: (payload: unknown) => void;
  sendWindowUpdate: (bytes: number) => void;
  closeClientSocket: () => void;
  close: () => Promise<void>;
};

function createDeferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | undefined;
  let rejectFn: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  return {
    promise,
    resolve: (value) => {
      if (resolveFn === undefined) {
        throw new Error("Deferred resolve function was not initialized.");
      }
      resolveFn(value);
    },
    reject: (reason) => {
      if (rejectFn === undefined) {
        throw new Error("Deferred reject function was not initialized.");
      }
      rejectFn(reason);
    },
  };
}

function toUint8Array(data: RawData): Uint8Array {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }

  return new Uint8Array(Buffer.concat(data));
}

function toText(data: RawData): string {
  return new TextDecoder().decode(toUint8Array(data));
}

function encodeAgentTextDataFrame(streamId: number, payload: string): Uint8Array {
  return encodeDataFrame({
    streamId,
    payloadKind: PayloadKindWebSocketText,
    payload: new TextEncoder().encode(payload),
  });
}

function decodeAgentTextDataFrame(data: RawData): { streamId: number; payload: string } {
  const dataFrame = decodeDataFrame(toUint8Array(data));
  if (dataFrame.payloadKind !== PayloadKindWebSocketText) {
    throw new Error(
      `Expected websocket text payload kind ${String(PayloadKindWebSocketText)}, received ${String(dataFrame.payloadKind)}.`,
    );
  }

  return {
    streamId: dataFrame.streamId,
    payload: new TextDecoder().decode(dataFrame.payload),
  };
}

async function startTestServer(mode: TestServerMode): Promise<TestServer> {
  const openRequestDeferred = createDeferred<string>();
  const payloadDeferred = createDeferred<{ streamId: number; payload: string }>();
  const socketClosedDeferred = createDeferred<void>();
  const windowUpdateDeferred = createDeferred<{ bytes: number; streamId: number }>();

  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  let connectedSocket: import("ws").WebSocket | null = null;
  let activeStreamId: number | null = null;

  wsServer.on("connection", (socket) => {
    connectedSocket = socket;
    let didHandleConnect = false;

    socket.on("message", (message) => {
      if (didHandleConnect) {
        const controlMessage = parseStreamControlMessage(toText(message));
        if (controlMessage?.type === "stream.window") {
          windowUpdateDeferred.resolve({
            bytes: controlMessage.bytes,
            streamId: controlMessage.streamId,
          });
          return;
        }

        try {
          payloadDeferred.resolve(decodeAgentTextDataFrame(message));
        } catch (error) {
          payloadDeferred.reject(error);
        }
        return;
      }

      didHandleConnect = true;
      const openRequestText = toText(message);
      openRequestDeferred.resolve(openRequestText);
      const parsedOpenRequest = JSON.parse(openRequestText);
      if (
        typeof parsedOpenRequest !== "object" ||
        parsedOpenRequest === null ||
        Array.isArray(parsedOpenRequest) ||
        !("streamId" in parsedOpenRequest) ||
        typeof parsedOpenRequest.streamId !== "number"
      ) {
        openRequestDeferred.reject(
          new Error("Expected stream.open to provide a numeric streamId."),
        );
        return;
      }
      activeStreamId = parsedOpenRequest.streamId;

      const controlMessage = parseStreamOpenControlMessage(
        JSON.stringify({
          type: mode === "accept" ? "stream.open.ok" : "stream.open.error",
          streamId: 1,
          ...(mode === "reject"
            ? {
                code: "agent_endpoint_unavailable",
                message: "agent endpoint unavailable",
              }
            : {}),
        }),
      );
      if (controlMessage === null) {
        openRequestDeferred.reject(new Error("Expected valid stream.open control message."));
        return;
      }

      socket.send(JSON.stringify(controlMessage));
    });

    socket.on("close", () => {
      socketClosedDeferred.resolve();
    });

    socket.on("error", (error) => {
      openRequestDeferred.reject(error);
      payloadDeferred.reject(error);
      socketClosedDeferred.reject(error);
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a concrete socket address.");
  }

  return {
    url: `ws://127.0.0.1:${String(address.port)}`,
    openRequest: openRequestDeferred.promise,
    payload: payloadDeferred.promise,
    socketClosed: socketClosedDeferred.promise,
    windowUpdate: windowUpdateDeferred.promise,
    sendNotification: (payload) => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before sending payload.");
      }
      if (activeStreamId === null) {
        throw new Error("Expected stream.open to complete before sending framed payload.");
      }

      connectedSocket.send(encodeAgentTextDataFrame(activeStreamId, JSON.stringify(payload)));
    },
    sendWindowUpdate: (bytes) => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before sending window update.");
      }
      if (activeStreamId === null) {
        throw new Error("Expected stream.open to complete before sending window update.");
      }

      connectedSocket.send(
        JSON.stringify({
          type: "stream.window",
          streamId: activeStreamId,
          bytes,
        }),
      );
    },
    closeClientSocket: () => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before closing.");
      }

      connectedSocket.close();
    },
    close: async () => {
      if (connectedSocket !== null) {
        connectedSocket.close();
      }

      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => {
          if (error == null) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    },
  };
}

const openServers = new Set<TestServer>();
const PollIntervalMs = 10;

async function waitForCondition(input: {
  description: string;
  timeoutMs: number;
  evaluate: () => boolean;
}): Promise<void> {
  const deadlineEpochMs = Date.now() + input.timeoutMs;

  while (Date.now() < deadlineEpochMs) {
    if (input.evaluate()) {
      return;
    }

    await systemSleeper.sleep(PollIntervalMs);
  }

  throw new Error(`Timed out waiting for ${input.description} after ${String(input.timeoutMs)}ms.`);
}

async function createManagedTestServer(mode: TestServerMode): Promise<TestServer> {
  const server = await startTestServer(mode);
  openServers.add(server);
  return server;
}

function createClient(connectionUrl: string): SandboxSessionClient {
  return new SandboxSessionClient({
    connectionUrl,
    runtime: createNodeSandboxSessionRuntime(),
  });
}

type RecordedEvent = { type: string; state?: string; method?: string };

function recordConnectionAndNotificationEvents(client: SandboxSessionClient): Array<RecordedEvent> {
  const events: Array<RecordedEvent> = [];

  client.onEvent((event) => {
    if (event.type === "connection_state_changed") {
      events.push({
        type: event.type,
        state: event.state,
      });
      return;
    }

    if (event.type === "notification") {
      events.push({
        type: event.type,
        method: event.notification.method,
      });
    }
  });

  return events;
}

async function expectClientToOpenAgentStream(input: {
  client: SandboxSessionClient;
  server: TestServer;
}): Promise<void> {
  await input.client.connect();

  expect(JSON.parse(await input.server.openRequest)).toEqual({
    type: "stream.open",
    streamId: 1,
    channel: {
      kind: "agent",
    },
  });
}

afterEach(async () => {
  await Promise.all(Array.from(openServers, (server) => server.close()));
  openServers.clear();
});

describe("sandbox session client", () => {
  it("parses stream.open control messages and rejects invalid payloads", () => {
    expect(
      parseStreamOpenControlMessage(
        JSON.stringify({
          type: "stream.open.ok",
          streamId: 1,
        }),
      ),
    ).toEqual({
      type: "stream.open.ok",
      streamId: 1,
    });

    expect(
      parseStreamOpenControlMessage(
        JSON.stringify({
          type: "stream.open.error",
          streamId: 7,
          code: "agent_unavailable",
          message: "agent unavailable",
        }),
      ),
    ).toEqual({
      type: "stream.open.error",
      streamId: 7,
      code: "agent_unavailable",
      message: "agent unavailable",
    });

    expect(parseStreamOpenControlMessage("{")).toBeNull();
    expect(
      parseStreamOpenControlMessage(
        JSON.stringify({
          type: "stream.open.ok",
          streamId: 0,
        }),
      ),
    ).toBeNull();
  });

  it("opens an agent stream over a real websocket and forwards notifications", async () => {
    const server = await createManagedTestServer("accept");
    const client = createClient(server.url);
    const events = recordConnectionAndNotificationEvents(client);

    await expectClientToOpenAgentStream({
      client,
      server,
    });
    expect(client.state).toBe("connected_socket");

    server.sendNotification({
      method: "turn/completed",
      params: {
        turn: {
          id: "turn_123",
        },
      },
    });

    await waitForCondition({
      description: "notification event",
      timeoutMs: 500,
      evaluate: () => events.some((event) => event.type === "notification"),
    });

    expect(events).toContainEqual({
      type: "connection_state_changed",
      state: "connecting_socket",
    });
    expect(events).toContainEqual({
      type: "connection_state_changed",
      state: "opening_agent_stream",
    });
    expect(events).toContainEqual({
      type: "connection_state_changed",
      state: "connected_socket",
    });
    expect(events).toContainEqual({
      type: "notification",
      method: "turn/completed",
    });

    client.disconnect();
    await server.socketClosed;
    expect(client.state).toBe("closed");
  });

  it("sends framed websocket text data after the agent stream opens", async () => {
    const server = await createManagedTestServer("accept");
    const client = createClient(server.url);

    await expectClientToOpenAgentStream({
      client,
      server,
    });

    client.sendJson({
      jsonrpc: "2.0",
      id: "req-1",
      method: "ping",
    });

    expect(await server.payload).toEqual({
      streamId: 1,
      payload: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-1",
        method: "ping",
      }),
    });
  });

  it("returns stream.window credit after consuming an inbound framed payload", async () => {
    const server = await createManagedTestServer("accept");
    const client = createClient(server.url);

    await expectClientToOpenAgentStream({
      client,
      server,
    });

    const notificationPayload = {
      method: "turn/completed",
      params: {
        turn: {
          id: "turn_123",
        },
      },
    };
    server.sendNotification(notificationPayload);

    expect(await server.windowUpdate).toEqual({
      bytes: Buffer.byteLength(JSON.stringify(notificationPayload)),
      streamId: 1,
    });
  });

  it("restores send credit when the server grants stream.window bytes", async () => {
    const server = await createManagedTestServer("accept");
    const client = createClient(server.url);

    await expectClientToOpenAgentStream({
      client,
      server,
    });

    let exhausted = false;
    for (let iteration = 0; iteration < DefaultStreamWindowBytes; iteration += 1) {
      try {
        client.sendJson({
          payload: "x".repeat(1024),
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Sandbox session stream send window is exhausted."
        ) {
          exhausted = true;
          break;
        }

        throw error;
      }
    }

    expect(exhausted).toBe(true);

    server.sendWindowUpdate(4096);
    await systemSleeper.sleep(PollIntervalMs);

    expect(() =>
      client.sendJson({
        payload: "second-message-after-window-update",
      }),
    ).not.toThrow();
  });

  it("surfaces stream.open errors from the websocket handshake", async () => {
    const server = await createManagedTestServer("reject");
    const client = createClient(server.url);

    await expect(client.connect()).rejects.toThrow("agent endpoint unavailable");
    expect(client.state).toBe("error");
    expect(client.errorMessage).toBe("agent endpoint unavailable");
  });

  it("transitions to closed when the connected websocket closes", async () => {
    const server = await createManagedTestServer("accept");
    const client = createClient(server.url);

    await expectClientToOpenAgentStream({
      client,
      server,
    });

    server.closeClientSocket();

    await waitForCondition({
      description: "client to close after websocket close",
      timeoutMs: 500,
      evaluate: () => client.state === "closed",
    });

    expect(client.errorMessage).toBe("Sandbox websocket connection closed.");
  });
});
