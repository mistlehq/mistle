import { systemSleeper } from "@mistle/time";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocketServer } from "ws";

import { createBrowserSandboxSessionRuntime } from "./browser.js";
import { SandboxSessionClient, parseStreamOpenControlMessage } from "./client.js";
import { createNodeSandboxSessionRuntime } from "./node.js";
import { SandboxSessionSendGuarantees } from "./runtime.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type TestServerMode = "accept" | "close_after_payload" | "reject";

type TestServer = {
  url: string;
  openRequest: Promise<string>;
  payload: Promise<string>;
  socketClosed: Promise<void>;
  sendNotification: (payload: unknown) => void;
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

function toText(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
}

async function startTestServer(mode: TestServerMode): Promise<TestServer> {
  const openRequestDeferred = createDeferred<string>();
  const payloadDeferred = createDeferred<string>();
  const socketClosedDeferred = createDeferred<void>();

  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  let connectedSocket: import("ws").WebSocket | null = null;

  wsServer.on("connection", (socket) => {
    connectedSocket = socket;
    let didHandleOpenRequest = false;

    socket.on("message", (message) => {
      const payloadText = toText(message);
      if (!didHandleOpenRequest) {
        didHandleOpenRequest = true;
        openRequestDeferred.resolve(payloadText);

        const controlMessage = parseStreamOpenControlMessage(
          JSON.stringify({
            type: mode === "reject" ? "stream.open.error" : "stream.open.ok",
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
        return;
      }

      payloadDeferred.resolve(payloadText);
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
    payload: payloadDeferred.promise,
    socketClosed: socketClosedDeferred.promise,
    sendNotification: (payload) => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before sending payload.");
      }

      connectedSocket.send(JSON.stringify(payload));
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

function createBrowserClient(connectionUrl: string): SandboxSessionClient {
  return new SandboxSessionClient({
    connectionUrl,
    runtime: createBrowserSandboxSessionRuntime(),
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

  it("reports queued send guarantees in the browser runtime", async () => {
    const server = await createManagedTestServer("close_after_payload");
    const client = createBrowserClient(server.url);

    await expectClientToOpenAgentStream({
      client,
      server,
    });

    expect(client.sendGuarantee).toBe(SandboxSessionSendGuarantees.QUEUED);
    await client.sendText(JSON.stringify({ method: "initialized" }));
    expect(await server.payload).toBe(JSON.stringify({ method: "initialized" }));
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
