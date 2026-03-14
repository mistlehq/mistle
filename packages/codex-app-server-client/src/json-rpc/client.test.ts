import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocketServer } from "ws";

import { createBrowserCodexSessionRuntime } from "../browser.js";
import { CodexSessionClient } from "../index.js";
import { createNodeCodexSessionRuntime } from "../node.js";
import { CodexJsonRpcClient } from "./client.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type TestServerMode = "close_after_initialized" | "close_before_initialized" | "stay_open";

type TestServer = {
  url: string;
  initializedNotification: Promise<string>;
  threadListRequest: Promise<string>;
  socketClosed: Promise<void>;
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

function parseJson(value: RawData): unknown {
  return JSON.parse(toText(value));
}

async function startJsonRpcTestServer(mode: TestServerMode): Promise<TestServer> {
  const initializedNotificationDeferred = createDeferred<string>();
  const threadListRequestDeferred = createDeferred<string>();
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
  let didHandleOpen = false;

  wsServer.on("connection", (socket: import("ws").WebSocket) => {
    connectedSocket = socket;

    socket.on("message", (message: RawData) => {
      if (!didHandleOpen) {
        didHandleOpen = true;
        const payload = parseJson(message);
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

        socket.send(
          JSON.stringify({
            type: "stream.open.ok",
            streamId: payload.streamId,
          }),
        );
        return;
      }

      const payload = parseJson(message);
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
        socket.send(
          JSON.stringify({
            id: "id" in payload ? payload.id : 0,
            result: {
              protocolVersion: "2026-03-14",
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
        threadListRequestDeferred.resolve(JSON.stringify(payload));
        socket.send(
          JSON.stringify({
            id: "id" in payload ? payload.id : 0,
            result: {
              items: [],
              nextCursor: null,
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

afterEach(async () => {
  await Promise.all(Array.from(openServers, (server) => server.close()));
  openServers.clear();
});

describe("codex json-rpc client", () => {
  it("fails initialize when the initialized notification cannot be sent", async () => {
    const server = await startJsonRpcTestServer("close_before_initialized");
    openServers.add(server);

    const sessionClient = new CodexSessionClient({
      connectionUrl: server.url,
      runtime: createNodeCodexSessionRuntime(),
    });
    await sessionClient.connect();

    const rpcClient = new CodexJsonRpcClient(sessionClient);

    await expect(rpcClient.initialize()).rejects.toThrow();
    expect(sessionClient.state).not.toBe("ready");
    await server.socketClosed;
  });

  it("rejects respond when the websocket closes before the response is sent", async () => {
    const server = await startJsonRpcTestServer("stay_open");
    openServers.add(server);

    const sessionClient = new CodexSessionClient({
      connectionUrl: server.url,
      runtime: createNodeCodexSessionRuntime(),
    });
    await sessionClient.connect();

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

    const sessionClient = new CodexSessionClient({
      connectionUrl: server.url,
      runtime: createBrowserCodexSessionRuntime(),
    });
    await sessionClient.connect();

    const rpcClient = new CodexJsonRpcClient(sessionClient);

    await rpcClient.initialize();

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

  it("fails browser initialize when the socket closes after initialized but before the ready probe completes", async () => {
    const server = await startJsonRpcTestServer("close_after_initialized");
    openServers.add(server);

    const sessionClient = new CodexSessionClient({
      connectionUrl: server.url,
      runtime: createBrowserCodexSessionRuntime(),
    });
    await sessionClient.connect();

    const rpcClient = new CodexJsonRpcClient(sessionClient);

    await expect(rpcClient.initialize()).rejects.toThrow();
    expect(sessionClient.state).not.toBe("ready");
    await server.socketClosed;
  });
});
