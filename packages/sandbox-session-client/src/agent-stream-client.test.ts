import {
  decodeDataFrame,
  encodeDataFrame,
  MaxStreamWindowBytes,
  parseStreamControlMessage,
  PayloadKindWebSocketText,
} from "@mistle/sandbox-session-protocol";
import { systemSleeper } from "@mistle/time";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, type WebSocket as NodeWebSocket, WebSocketServer } from "ws";

import { AgentStreamClient, parseStreamOpenControlMessage } from "./agent-stream-client.js";
import { createBrowserSandboxSessionRuntime } from "./browser.js";
import { createNodeSandboxSessionRuntime } from "./node.js";
import { SandboxSessionSendGuarantees } from "./runtime.js";
import {
  GatewayServiceRestartCloseCode,
  GatewayServiceRestartCloseReason,
  GatewayServiceRestartReconnectMessage,
  SandboxSessionTransport,
} from "./transport.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type TestServerMode = "accept" | "close_after_payload" | "pending" | "reject";

type TestServer = {
  url: string;
  openRequest: Promise<string>;
  openRequests: string[];
  payload: Promise<{ streamId: number; payload: string }>;
  payloadAt: (index: number) => Promise<{ streamId: number; payload: string }>;
  receivedPayloads: Array<{ streamId: number; payload: string }>;
  socketClosed: Promise<void>;
  windowUpdate: Promise<{ bytes: number; streamId: number }>;
  sendNotification: (payload: unknown) => void;
  sendReset: (input: { code: string; message: string }) => void;
  sendWindowUpdate: (bytes: number) => void;
  closeClientSocket: (code?: number, reason?: string) => void;
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

  let connectedSocket: NodeWebSocket | null = null;
  let activeStreamId: number | null = null;
  const openRequests: string[] = [];
  const receivedPayloads: Array<{ streamId: number; payload: string }> = [];
  const payloadDeferredsByIndex = new Map<
    number,
    Deferred<{ streamId: number; payload: string }>
  >();

  function payloadAt(index: number): Promise<{ streamId: number; payload: string }> {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(
        `Expected payload index to be a non-negative integer, received ${String(index)}.`,
      );
    }

    const existingPayload = receivedPayloads[index];
    if (existingPayload !== undefined) {
      return Promise.resolve(existingPayload);
    }

    const existingDeferred = payloadDeferredsByIndex.get(index);
    if (existingDeferred !== undefined) {
      return existingDeferred.promise;
    }

    const deferred = createDeferred<{ streamId: number; payload: string }>();
    payloadDeferredsByIndex.set(index, deferred);
    return deferred.promise;
  }

  wsServer.on("connection", (socket) => {
    connectedSocket = socket;

    socket.on("message", (message) => {
      const messageText = toText(message);
      const parsedOpenRequest = parseStreamOpenControlMessage(messageText);
      if (parsedOpenRequest !== null) {
        throw new Error("Server should not receive stream.open control responses from the client.");
      }

      try {
        const parsedJson = JSON.parse(messageText) as unknown;
        if (
          typeof parsedJson === "object" &&
          parsedJson !== null &&
          !Array.isArray(parsedJson) &&
          "type" in parsedJson &&
          parsedJson.type === "stream.open" &&
          "streamId" in parsedJson &&
          typeof parsedJson.streamId === "number"
        ) {
          openRequests.push(messageText);
          if (openRequests.length === 1) {
            openRequestDeferred.resolve(messageText);
          }
          activeStreamId = parsedJson.streamId;
          if (mode === "pending") {
            return;
          }

          const controlMessage = parseStreamOpenControlMessage(
            JSON.stringify({
              type: mode === "reject" ? "stream.open.error" : "stream.open.ok",
              streamId: parsedJson.streamId,
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
          return;
        }
      } catch {
        // Continue to framed/control-path handling below.
      }

      const controlMessage = parseStreamControlMessage(messageText);
      if (controlMessage !== undefined) {
        if (controlMessage.type === "stream.window") {
          windowUpdateDeferred.resolve({
            bytes: controlMessage.bytes,
            streamId: controlMessage.streamId,
          });
        }
        return;
      }

      try {
        const decodedPayload = decodeAgentTextDataFrame(message);
        receivedPayloads.push(decodedPayload);
        const payloadDeferredByIndex = payloadDeferredsByIndex.get(receivedPayloads.length - 1);
        if (payloadDeferredByIndex !== undefined) {
          payloadDeferredsByIndex.delete(receivedPayloads.length - 1);
          payloadDeferredByIndex.resolve(decodedPayload);
        }
        if (receivedPayloads.length === 1) {
          payloadDeferred.resolve(decodedPayload);
        }
      } catch (error) {
        payloadDeferred.reject(error);
      }

      if (mode === "close_after_payload") {
        socket.close(1011, "close after payload");
      }
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
    openRequests,
    payload: payloadDeferred.promise,
    payloadAt,
    receivedPayloads,
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
    sendReset: (input) => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before sending reset.");
      }
      if (activeStreamId === null) {
        throw new Error("Expected stream.open to complete before sending reset.");
      }

      connectedSocket.send(
        JSON.stringify({
          type: "stream.reset",
          streamId: activeStreamId,
          code: input.code,
          message: input.message,
        }),
      );
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
    closeClientSocket: (code, reason) => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before closing.");
      }

      connectedSocket.close(code, reason);
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

const transportByClient = new WeakMap<AgentStreamClient, SandboxSessionTransport>();

function createClient(connectionUrl: string): AgentStreamClient {
  const transport = new SandboxSessionTransport({
    runtime: createNodeSandboxSessionRuntime(),
  });
  const client = new AgentStreamClient({
    transport,
  });
  transportByClient.set(client, transport);
  connectionUrlByClient.set(client, connectionUrl);
  return client;
}

function createBrowserClient(connectionUrl: string): AgentStreamClient {
  const transport = new SandboxSessionTransport({
    runtime: createBrowserSandboxSessionRuntime(),
  });
  const client = new AgentStreamClient({
    transport,
  });
  transportByClient.set(client, transport);
  connectionUrlByClient.set(client, connectionUrl);
  return client;
}

const connectionUrlByClient = new WeakMap<AgentStreamClient, string>();

async function connectClient(client: AgentStreamClient): Promise<void> {
  const transport = transportByClient.get(client);
  const connectionUrl = connectionUrlByClient.get(client);
  if (transport === undefined || connectionUrl === undefined) {
    throw new Error("Expected test client transport metadata.");
  }

  await transport.connect({
    connectionUrl,
  });
  await client.connect();
}

function disconnectClient(client: AgentStreamClient): void {
  client.disconnect();
  transportByClient.get(client)?.disconnect();
}

type RecordedEvent = {
  type: string;
  gatewayServiceRestart?: boolean;
  state?: string;
  method?: string;
  resetInfo?: { code: string; message: string };
};

function recordConnectionAndNotificationEvents(client: AgentStreamClient): Array<RecordedEvent> {
  const events: Array<RecordedEvent> = [];

  client.onEvent((event) => {
    if (event.type === "connection_state_changed") {
      events.push({
        type: event.type,
        ...(event.gatewayServiceRestart === undefined
          ? {}
          : { gatewayServiceRestart: event.gatewayServiceRestart.reason === "service_restart" }),
        state: event.state,
      });
      return;
    }

    if (event.type === "notification") {
      events.push({
        type: event.type,
        method: event.notification.method,
      });
      return;
    }

    if (event.type === "stream_reset") {
      events.push({
        type: event.type,
        resetInfo: event.resetInfo,
      });
    }
  });

  return events;
}

async function expectClientToOpenAgentStream(input: {
  client: AgentStreamClient;
  server: TestServer;
}): Promise<void> {
  await connectClient(input.client);

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

describe("agent stream client", () => {
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

    disconnectClient(client);
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

    await client.sendJson({
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

    let exhaustionError: Error | null = null;
    let successfulSendCount = 0;
    const largePayloadTextBytes = Math.min(2 * 1024 * 1024, Math.floor(MaxStreamWindowBytes / 4));
    const largePayload = {
      payload: "x".repeat(largePayloadTextBytes),
    };
    const largePayloadBytes = Buffer.byteLength(JSON.stringify(largePayload));
    expect(largePayloadBytes).toBeLessThan(MaxStreamWindowBytes);
    for (
      let sentBytes = 0;
      sentBytes <= MaxStreamWindowBytes + largePayloadBytes;
      sentBytes += largePayloadBytes
    ) {
      try {
        await client.sendJson(largePayload);
        successfulSendCount += 1;
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error;
        }
        exhaustionError = error;
        break;
      }
    }

    expect(exhaustionError?.message).toBe("Sandbox session stream send window is exhausted.");

    if (successfulSendCount > 0) {
      await server.payloadAt(successfulSendCount - 1);
    }

    const recoveredPayloadPromise = server.payloadAt(successfulSendCount);
    server.sendWindowUpdate(MaxStreamWindowBytes);

    await client.sendJson({
      payload: "recovered",
    });

    expect(await recoveredPayloadPromise).toEqual({
      streamId: 1,
      payload: JSON.stringify({
        payload: "recovered",
      }),
    });
  });

  it("surfaces stream.open errors from the websocket handshake", async () => {
    const server = await createManagedTestServer("reject");
    const client = createClient(server.url);

    await expect(connectClient(client)).rejects.toThrow("agent endpoint unavailable");
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

  it("marks gateway service restart closes as recoverable connection-state events", async () => {
    const server = await createManagedTestServer("accept");
    const client = createClient(server.url);
    const events = recordConnectionAndNotificationEvents(client);

    await expectClientToOpenAgentStream({
      client,
      server,
    });

    server.closeClientSocket(GatewayServiceRestartCloseCode, GatewayServiceRestartCloseReason);

    await waitForCondition({
      description: "client to close after gateway service restart",
      timeoutMs: 500,
      evaluate: () =>
        events.some(
          (event) =>
            event.type === "connection_state_changed" &&
            event.state === "closed" &&
            event.gatewayServiceRestart === true,
        ),
    });

    expect(client.errorMessage).toBe(GatewayServiceRestartReconnectMessage);
  });

  it("keeps pending agent stream opens in the recoverable gateway restart state", async () => {
    const server = await createManagedTestServer("pending");
    const client = createClient(server.url);
    const events = recordConnectionAndNotificationEvents(client);
    const transport = transportByClient.get(client);
    if (transport === undefined) {
      throw new Error("Expected test client transport metadata.");
    }

    await transport.connect({
      connectionUrl: server.url,
    });
    const openPromise = client.openAgentStream();

    expect(JSON.parse(await server.openRequest)).toEqual({
      type: "stream.open",
      streamId: 1,
      channel: {
        kind: "agent",
      },
    });

    server.closeClientSocket(GatewayServiceRestartCloseCode, GatewayServiceRestartCloseReason);

    await expect(openPromise).rejects.toThrow(GatewayServiceRestartReconnectMessage);
    expect(client.state).toBe("closed");
    expect(client.errorMessage).toBe(GatewayServiceRestartReconnectMessage);
    expect(events).toContainEqual({
      type: "connection_state_changed",
      state: "closed",
      gatewayServiceRestart: true,
    });
    expect(events).not.toContainEqual({
      type: "connection_state_changed",
      state: "error",
    });
  });

  it("surfaces active stream reset without closing the websocket", async () => {
    const server = await createManagedTestServer("accept");
    const client = createClient(server.url);
    const events = recordConnectionAndNotificationEvents(client);

    await expectClientToOpenAgentStream({
      client,
      server,
    });

    server.sendReset({
      code: "bootstrap_disconnected",
      message:
        "Sandbox bootstrap tunnel disconnected and invalidated the active interactive stream.",
    });

    await waitForCondition({
      description: "stream reset event",
      timeoutMs: 500,
      evaluate: () => events.some((event) => event.type === "stream_reset"),
    });

    expect(client.state).toBe("connected_socket");
    expect(client.streamId).toBeNull();
    expect(client.resetInfo).toEqual({
      code: "bootstrap_disconnected",
      message:
        "Sandbox bootstrap tunnel disconnected and invalidated the active interactive stream.",
    });
    expect(events).toContainEqual({
      type: "stream_reset",
      resetInfo: {
        code: "bootstrap_disconnected",
        message:
          "Sandbox bootstrap tunnel disconnected and invalidated the active interactive stream.",
      },
    });
    await expect(client.sendJson({ method: "after-reset" })).rejects.toThrow(
      "Sandbox session stream is not open.",
    );
  });

  it("reopens the agent stream on the existing websocket after a reset", async () => {
    const server = await createManagedTestServer("accept");
    const client = createClient(server.url);

    await expectClientToOpenAgentStream({
      client,
      server,
    });

    server.sendReset({
      code: "bootstrap_disconnected",
      message: "Sandbox bootstrap tunnel disconnected.",
    });

    await waitForCondition({
      description: "client to observe stream reset",
      timeoutMs: 500,
      evaluate: () => client.streamId === null && client.state === "connected_socket",
    });

    await client.openAgentStream();

    expect(server.openRequests).toHaveLength(2);
    expect(JSON.parse(server.openRequests[1] ?? "")).toEqual({
      type: "stream.open",
      streamId: 2,
      channel: {
        kind: "agent",
      },
    });

    const reopenedPayloadPromise = server.payloadAt(server.receivedPayloads.length);
    await client.sendJson({
      jsonrpc: "2.0",
      id: "req-2",
      method: "ping",
    });

    expect(await reopenedPayloadPromise).toEqual({
      streamId: 2,
      payload: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-2",
        method: "ping",
      }),
    });
  });

  it("reports queued send guarantees in the browser runtime", async () => {
    const server = await createManagedTestServer("close_after_payload");
    const client = createBrowserClient(server.url);

    await expectClientToOpenAgentStream({
      client,
      server,
    });

    expect(client.sendGuarantee).toBe(SandboxSessionSendGuarantees.QUEUED);
    await client.sendText(JSON.stringify({ method: "initialized" }));
    expect(await server.payload).toEqual({
      streamId: 1,
      payload: JSON.stringify({ method: "initialized" }),
    });
    await server.socketClosed;
  });

  it("exposes written send guarantees in the node runtime", async () => {
    const server = await createManagedTestServer("accept");
    const client = createClient(server.url);

    await expectClientToOpenAgentStream({
      client,
      server,
    });

    expect(client.sendGuarantee).toBe(SandboxSessionSendGuarantees.WRITTEN);
  });
});
