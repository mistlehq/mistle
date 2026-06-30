import { describe, expect, it } from "vitest";
import { type RawData, WebSocket as NodeWebSocket, WebSocketServer } from "ws";

import { connectDirectCodexJsonRpcClient } from "./direct-codex-json-rpc-client.ts";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
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

describe("Direct Codex JSON-RPC client", () => {
  it("sends the Codex app-server websocket bearer token when provided", async () => {
    const server = await startRawJsonRpcServer();
    const client = await connectDirectCodexJsonRpcClient({
      authorizationBearerToken: "eval-websocket-token",
      websocketUrl: server.url,
    });

    try {
      await expect(server.authorizationHeader).resolves.toBe("Bearer eval-websocket-token");
    } finally {
      client.dispose();
      await server.close();
    }
  });

  it("exchanges calls, notifications, and server requests over a raw websocket", async () => {
    const server = await startRawJsonRpcServer();
    const client = await connectDirectCodexJsonRpcClient({
      websocketUrl: server.url,
    });
    const socket = await server.connectedSocket;

    try {
      const initializeResult = await client.initialize();
      expect(initializeResult).toEqual({
        protocolVersion: "2026-03-14",
      });
      await expect(server.initialized).resolves.toMatchObject({
        method: "initialized",
      });

      const notification = createDeferred<unknown>();
      const unsubscribeNotification = client.onNotification((event) => {
        notification.resolve(event);
      });
      socket.send(
        JSON.stringify({
          method: "turn/completed",
          params: {
            threadId: "thread_123",
            turnId: "turn_123",
          },
        }),
      );
      await expect(notification.promise).resolves.toMatchObject({
        method: "turn/completed",
        params: {
          threadId: "thread_123",
          turnId: "turn_123",
        },
      });
      unsubscribeNotification();

      const serverRequest = createDeferred<unknown>();
      const unsubscribeServerRequest = client.onServerRequest((request) => {
        serverRequest.resolve(request);
        void client.respond(request.id, {
          success: true,
        });
      });
      socket.send(
        JSON.stringify({
          id: "dashboard_request_1",
          method: "dashboard_control",
          params: {
            action: "request_user_input",
          },
        }),
      );
      await expect(serverRequest.promise).resolves.toMatchObject({
        id: "dashboard_request_1",
        method: "dashboard_control",
      });
      await expect(server.serverRequestResponse).resolves.toEqual({
        id: "dashboard_request_1",
        result: {
          success: true,
        },
      });
      unsubscribeServerRequest();

      await expect(client.call("thread/list", { limit: 1 })).resolves.toEqual({
        data: [],
      });
    } finally {
      client.dispose();
      await server.close();
    }
  });
});

async function startRawJsonRpcServer(): Promise<{
  connectedSocket: Promise<NodeWebSocket>;
  authorizationHeader: Promise<string | undefined>;
  initialized: Promise<unknown>;
  serverRequestResponse: Promise<unknown>;
  url: string;
  close: () => Promise<void>;
}> {
  const initialized = createDeferred<unknown>();
  const authorizationHeader = createDeferred<string | undefined>();
  const connectedSocket = createDeferred<NodeWebSocket>();
  const serverRequestResponse = createDeferred<unknown>();
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error: Error) => reject(error));
  });

  wsServer.on("connection", (socket, request) => {
    authorizationHeader.resolve(request.headers.authorization);
    connectedSocket.resolve(socket);
    socket.on("message", (message) => {
      const payload = parseJsonObject(rawDataToText(message));
      if (Reflect.get(payload, "method") === "initialize") {
        socket.send(
          JSON.stringify({
            id: Reflect.get(payload, "id"),
            result: {
              protocolVersion: "2026-03-14",
            },
          }),
        );
        return;
      }

      if (Reflect.get(payload, "method") === "initialized") {
        initialized.resolve(payload);
        return;
      }

      if (Reflect.get(payload, "method") === "thread/list") {
        socket.send(
          JSON.stringify({
            id: Reflect.get(payload, "id"),
            result: {
              data: [],
            },
          }),
        );
        return;
      }

      if (Reflect.get(payload, "id") === "dashboard_request_1") {
        serverRequestResponse.resolve(payload);
      }
    });
  });

  const address = wsServer.address();
  if (
    typeof address !== "object" ||
    address === null ||
    typeof address.address !== "string" ||
    typeof address.port !== "number"
  ) {
    await closeWebSocketServer(wsServer);
    throw new Error("Raw JSON-RPC test server did not bind to a TCP port.");
  }

  return {
    authorizationHeader: authorizationHeader.promise,
    connectedSocket: connectedSocket.promise,
    initialized: initialized.promise,
    serverRequestResponse: serverRequestResponse.promise,
    url: `ws://${address.address}:${String(address.port)}`,
    close: async () => {
      await closeWebSocketServer(wsServer);
    },
  };
}

function rawDataToText(data: RawData): string {
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

function parseJsonObject(text: string): object {
  const payload: unknown = JSON.parse(text);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Expected JSON object websocket payload.");
  }

  return payload;
}

async function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
