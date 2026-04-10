import { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createNodeSandboxSessionRuntime } from "@mistle/sandbox-session-client/node";
import {
  decodeDataFrame,
  encodeDataFrame,
  parseStreamControlMessage,
  PayloadKindWebSocketText,
} from "@mistle/sandbox-session-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, type WebSocket, WebSocketServer } from "ws";

import {
  createBrowserCodexSessionRuntime,
  CodexJsonRpcClient,
  CodexJsonRpcRequestError,
  AgentStreamClient,
} from "./session-client.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type TestServerMode =
  | "close_after_initialized"
  | "close_before_initialized"
  | "error_on_thread_list"
  | "manual_thread_list"
  | "stay_open";

type TestServer = {
  initializeRequest: Promise<string>;
  url: string;
  initializedNotification: Promise<string>;
  threadListRequest: Promise<string>;
  socketClosed: Promise<void>;
  closeClientSocket: () => void;
  sendStreamReset: (input: { code: string; message: string }) => void;
  sendThreadListResult: (result: unknown) => void;
  close: () => Promise<void>;
};

type ConnectedSocket = {
  close: (code?: number, data?: string) => void;
  send: (data: string | Uint8Array) => void;
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

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

function decodeAgentTextPayload(data: RawData): string {
  const dataFrame = decodeDataFrame(toUint8Array(data));
  if (dataFrame.payloadKind !== PayloadKindWebSocketText) {
    throw new Error(
      `Expected websocket text payload kind ${String(PayloadKindWebSocketText)}, received ${String(dataFrame.payloadKind)}.`,
    );
  }

  return new TextDecoder().decode(dataFrame.payload);
}

function encodeAgentTextPayload(input: { payload: unknown; streamId: number }): Uint8Array {
  return encodeDataFrame({
    streamId: input.streamId,
    payloadKind: PayloadKindWebSocketText,
    payload: new TextEncoder().encode(JSON.stringify(input.payload)),
  });
}

async function startJsonRpcTestServer(mode: TestServerMode): Promise<TestServer> {
  const initializeRequestDeferred = createDeferred<string>();
  const initializedNotificationDeferred = createDeferred<string>();
  const threadListRequestDeferred = createDeferred<string>();
  const socketClosedDeferred = createDeferred<void>();

  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error: Error) => reject(error));
  });

  let connectedSocket: ConnectedSocket | null = null;
  let didHandleOpen = false;
  let latestThreadListRequestId: string | number | null = null;
  let activeStreamId: number | null = null;

  wsServer.on("connection", (socket: WebSocket) => {
    connectedSocket = socket;

    socket.on("message", (message: RawData) => {
      if (!didHandleOpen) {
        didHandleOpen = true;
        const payload = parseJson(toText(message));
        if (
          typeof payload !== "object" ||
          payload === null ||
          Array.isArray(payload) ||
          !("type" in payload) ||
          !("streamId" in payload) ||
          payload.type !== "stream.open" ||
          typeof payload.streamId !== "number"
        ) {
          initializedNotificationDeferred.reject(new Error("Expected stream.open handshake."));
          return;
        }

        activeStreamId = payload.streamId;
        socket.send(
          JSON.stringify({
            type: "stream.open.ok",
            streamId: payload.streamId,
          }),
        );
        return;
      }

      const controlMessage = parseStreamControlMessage(toText(message));
      if (controlMessage !== undefined) {
        return;
      }

      const payload = parseJson(decodeAgentTextPayload(message));
      if (
        typeof payload !== "object" ||
        payload === null ||
        Array.isArray(payload) ||
        !("method" in payload) ||
        typeof payload.method !== "string"
      ) {
        return;
      }

      if (payload.method === "initialize") {
        initializeRequestDeferred.resolve(JSON.stringify(payload));
        if (activeStreamId === null) {
          initializedNotificationDeferred.reject(new Error("Expected active stream id."));
          return;
        }

        socket.send(
          encodeAgentTextPayload({
            streamId: activeStreamId,
            payload: {
              id: "id" in payload ? payload.id : 0,
              result: {
                protocolVersion: "2026-03-14",
              },
            },
          }),
        );

        if (mode === "close_before_initialized") {
          socket.close(1011, "close before initialized notification");
        }
        return;
      }

      if (payload.method === "initialized") {
        initializedNotificationDeferred.resolve(JSON.stringify(payload));
        if (mode === "close_after_initialized") {
          socket.close(1011, "close after initialized notification");
        }
        return;
      }

      if (payload.method === "thread/list") {
        latestThreadListRequestId =
          "id" in payload && (typeof payload.id === "string" || typeof payload.id === "number")
            ? payload.id
            : null;
        if (mode === "error_on_thread_list") {
          if (activeStreamId === null) {
            threadListRequestDeferred.reject(new Error("Expected active stream id."));
            return;
          }

          socket.send(
            encodeAgentTextPayload({
              streamId: activeStreamId,
              payload: {
                id: "id" in payload ? payload.id : 0,
                error: {
                  code: -32600,
                  message: "invalid thread id: thread_missing",
                  data: {
                    threadId: "thread_missing",
                  },
                },
              },
            }),
          );
          return;
        }

        threadListRequestDeferred.resolve(JSON.stringify(payload));
        if (mode === "manual_thread_list") {
          return;
        }
        if (activeStreamId === null) {
          threadListRequestDeferred.reject(new Error("Expected active stream id."));
          return;
        }
        socket.send(
          encodeAgentTextPayload({
            streamId: activeStreamId,
            payload: {
              id: "id" in payload ? payload.id : 0,
              result: {
                items: [],
                nextCursor: null,
              },
            },
          }),
        );
      }
    });

    socket.on("close", () => {
      socketClosedDeferred.resolve();
    });

    socket.on("error", (error: Error) => {
      initializedNotificationDeferred.reject(error);
      threadListRequestDeferred.reject(error);
      socketClosedDeferred.reject(error);
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a concrete socket address.");
  }

  return {
    initializeRequest: initializeRequestDeferred.promise,
    url: `ws://127.0.0.1:${String(address.port)}`,
    initializedNotification: initializedNotificationDeferred.promise,
    threadListRequest: threadListRequestDeferred.promise,
    socketClosed: socketClosedDeferred.promise,
    closeClientSocket: () => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before closing.");
      }

      connectedSocket.close(1011, "forced close");
    },
    sendStreamReset: (input) => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before sending reset.");
      }
      if (activeStreamId === null) {
        throw new Error("Expected stream.open handshake before sending reset.");
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
    sendThreadListResult: (result) => {
      if (connectedSocket === null) {
        throw new Error("Expected websocket client to be connected before sending a response.");
      }
      if (latestThreadListRequestId === null) {
        throw new Error("Expected a thread/list request before sending a response.");
      }
      if (activeStreamId === null) {
        throw new Error("Expected stream.open handshake before sending a response.");
      }

      connectedSocket.send(
        encodeAgentTextPayload({
          streamId: activeStreamId,
          payload: {
            id: latestThreadListRequestId,
            result,
          },
        }),
      );
    },
    close: async () => {
      if (connectedSocket !== null) {
        connectedSocket.close();
      }

      await new Promise<void>((resolve, reject) => {
        wsServer.close((error?: Error) => {
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

async function connectSessionClient(input: {
  connectionUrl: string;
  runtime: ReturnType<typeof createNodeSandboxSessionRuntime>;
}): Promise<AgentStreamClient> {
  const transport = new SandboxSessionTransport({
    runtime: input.runtime,
  });
  await transport.connect({
    connectionUrl: input.connectionUrl,
  });
  const sessionClient = new AgentStreamClient({
    transport,
  });
  await sessionClient.connect();
  return sessionClient;
}

afterEach(async () => {
  await Promise.all(Array.from(openServers, (server) => server.close()));
  openServers.clear();
});

describe("openai codex json-rpc client", () => {
  it("fails initialize when the initialized notification cannot be sent", async () => {
    const server = await startJsonRpcTestServer("close_before_initialized");
    openServers.add(server);

    const sessionClient = await connectSessionClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    const rpcClient = new CodexJsonRpcClient(sessionClient);

    await expect(rpcClient.initialize()).rejects.toThrow(
      /Sandbox websocket connection closed|Sandbox session socket is not open|initialization completed|close (before|after) initialized notification/,
    );
    expect(sessionClient.state).not.toBe("ready");
    await server.socketClosed;
  });

  it("rejects respond when the websocket closes before the response is sent", async () => {
    const server = await startJsonRpcTestServer("stay_open");
    openServers.add(server);

    const sessionClient = await connectSessionClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    const rpcClient = new CodexJsonRpcClient(sessionClient);

    server.closeClientSocket();
    await server.socketClosed;

    await expect(rpcClient.respond(7, { ok: true })).rejects.toThrow(
      "Sandbox session socket is not open.",
    );
  });

  it("waits for a post-initialized roundtrip before marking a browser session ready", async () => {
    const server = await startJsonRpcTestServer("stay_open");
    openServers.add(server);

    const sessionClient = await connectSessionClient({
      connectionUrl: server.url,
      runtime: createBrowserCodexSessionRuntime(),
    });

    const rpcClient = new CodexJsonRpcClient(sessionClient);

    await rpcClient.initialize();

    expect(JSON.parse(await server.initializeRequest)).toMatchObject({
      method: "initialize",
      params: {
        clientInfo: {
          name: "codex_cli_rs",
          version: "0.1.0",
        },
      },
    });
    expect(JSON.parse(await server.initializedNotification)).toMatchObject({
      method: "initialized",
    });
    expect(JSON.parse(await server.threadListRequest)).toMatchObject({
      method: "thread/list",
      params: {
        limit: 1,
      },
    });
    expect(sessionClient.state).toBe("ready");
  });

  it("still marks a browser session ready when the ready probe gets a JSON-RPC error", async () => {
    const server = await startJsonRpcTestServer("error_on_thread_list");
    openServers.add(server);

    const sessionClient = await connectSessionClient({
      connectionUrl: server.url,
      runtime: createBrowserCodexSessionRuntime(),
    });

    const rpcClient = new CodexJsonRpcClient(sessionClient);

    await rpcClient.initialize();

    expect(JSON.parse(await server.initializedNotification)).toMatchObject({
      method: "initialized",
    });
    expect(sessionClient.state).toBe("ready");
  });

  it("surfaces structured request errors for failed Codex calls", async () => {
    const server = await startJsonRpcTestServer("error_on_thread_list");
    openServers.add(server);

    const sessionClient = await connectSessionClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    const rpcClient = new CodexJsonRpcClient(sessionClient);

    await expect(rpcClient.call("thread/list", { limit: 1 })).rejects.toMatchObject({
      name: "CodexJsonRpcRequestError",
      method: "thread/list",
      code: -32600,
      data: {
        threadId: "thread_missing",
      },
    } satisfies Partial<CodexJsonRpcRequestError>);
  });

  it("cancels pending requests so late responses are ignored", async () => {
    const server = await startJsonRpcTestServer("stay_open");
    openServers.add(server);

    const sessionClient = await connectSessionClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    const rpcClient = new CodexJsonRpcClient(sessionClient);
    const requestHandle = rpcClient.callWithHandle("thread/list", {
      limit: 1,
    });

    await server.threadListRequest;
    requestHandle.cancel(new Error("request canceled"));

    await expect(requestHandle.promise).rejects.toThrow("request canceled");

    server.sendThreadListResult({
      items: [],
      nextCursor: null,
    });

    await expect(rpcClient.call("thread/list", { limit: 1 })).resolves.toMatchObject({
      items: [],
      nextCursor: null,
    });
  });

  it("rejects pending requests when the active stream is reset", async () => {
    const server = await startJsonRpcTestServer("manual_thread_list");
    openServers.add(server);

    const sessionClient = await connectSessionClient({
      connectionUrl: server.url,
      runtime: createNodeSandboxSessionRuntime(),
    });

    const rpcClient = new CodexJsonRpcClient(sessionClient);
    const pendingCall = rpcClient.call("thread/list", { limit: 1 });

    await server.threadListRequest;
    server.sendStreamReset({
      code: "bootstrap_disconnected",
      message:
        "Sandbox bootstrap tunnel disconnected and invalidated the active interactive stream.",
    });

    await expect(pendingCall).rejects.toThrow(
      "Sandbox session stream reset (bootstrap_disconnected): Sandbox bootstrap tunnel disconnected and invalidated the active interactive stream.",
    );
  });

  it("fails browser initialize when the socket closes after initialized but before the ready probe completes", async () => {
    const server = await startJsonRpcTestServer("close_after_initialized");
    openServers.add(server);

    const sessionClient = await connectSessionClient({
      connectionUrl: server.url,
      runtime: createBrowserCodexSessionRuntime(),
    });

    const rpcClient = new CodexJsonRpcClient(sessionClient);

    await expect(rpcClient.initialize()).rejects.toThrow(
      /Sandbox websocket connection closed|Sandbox session socket is not open|initialization completed|close (before|after) initialized notification/,
    );
    expect(sessionClient.state).not.toBe("ready");
    await server.socketClosed;
  });
});
