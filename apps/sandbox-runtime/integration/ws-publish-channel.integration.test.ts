import { once } from "node:events";
import { createServer, type Server as HttpServer } from "node:http";

import {
  parsePublishControlMessage,
  type PublishControlMessage,
} from "@mistle/sandbox-session-protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer, type RawData } from "ws";

import { startTunnelClient, type StartedTunnelClient } from "../src/tunnel/client.js";

const IntegrationTestTimeoutMs = 30_000;

const openHttpServers = new Set<HttpServer>();
const openTunnelClients = new Set<StartedTunnelClient>();
const openWebSocketServers = new Set<WebSocketServer>();

afterEach(async () => {
  for (const tunnelClient of openTunnelClients) {
    await tunnelClient.close().catch(() => undefined);
  }
  openTunnelClients.clear();

  await Promise.all(
    Array.from(openWebSocketServers, async (server) => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    }),
  );
  openWebSocketServers.clear();

  await Promise.all(
    Array.from(openHttpServers, async (server) => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    }),
  );
  openHttpServers.clear();
});

function readListeningPort(server: HttpServer | WebSocketServer): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected listening server address.");
  }

  return address.port;
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

class TestMessageQueue<T> {
  readonly #items: T[] = [];
  readonly #waiters: Array<{
    reject: (error: unknown) => void;
    resolve: (value: T) => void;
  }> = [];
  #closedError: unknown;

  public push(item: T): void {
    if (this.#closedError !== undefined) {
      return;
    }

    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(item);
      return;
    }

    this.#items.push(item);
  }

  public fail(error: unknown): void {
    if (this.#closedError !== undefined) {
      return;
    }

    this.#closedError = error;
    while (this.#waiters.length > 0) {
      this.#waiters.shift()?.reject(error);
    }
  }

  public async next(): Promise<T> {
    const nextItem = this.#items.shift();
    if (nextItem !== undefined) {
      return nextItem;
    }

    if (this.#closedError !== undefined) {
      throw this.#closedError;
    }

    return new Promise<T>((resolve, reject) => {
      this.#waiters.push({
        reject,
        resolve,
      });
    });
  }
}

type PublishMessageQueue = {
  dispose(): void;
  next(): Promise<PublishControlMessage>;
};

function createPublishMessageQueue(socket: WebSocket): PublishMessageQueue {
  const queue = new TestMessageQueue<PublishControlMessage>();
  const handleMessage = (payload: RawData): void => {
    const parsedMessage = parsePublishControlMessage(toText(payload));
    if (parsedMessage !== undefined) {
      queue.push(parsedMessage);
    }
  };
  const handleClose = (): void => {
    queue.fail(new Error("Bootstrap websocket closed before the publish test completed."));
  };
  const handleError = (error: Error): void => {
    queue.fail(error);
  };

  socket.on("message", handleMessage);
  socket.once("close", handleClose);
  socket.once("error", handleError);

  return {
    dispose: () => {
      socket.off("message", handleMessage);
      socket.off("close", handleClose);
      socket.off("error", handleError);
    },
    next: () => queue.next(),
  };
}

async function startLoopbackHttpServer(): Promise<HttpServer> {
  const server = createServer((_request, response) => {
    response.writeHead(200);
    response.end("runtime");
  });
  openHttpServers.add(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

async function startLoopbackWebSocketServer(): Promise<WebSocketServer> {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });
  openWebSocketServers.add(server);
  await once(server, "listening");

  return server;
}

async function startGatewayWebSocketServer(): Promise<WebSocketServer> {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });
  openWebSocketServers.add(server);
  await once(server, "listening");

  return server;
}

describe("sandbox runtime published websocket integration", () => {
  it(
    "round-trips text frames, binary frames, headers, and close codes across publish websocket streams",
    async () => {
      const runtimeServer = await startLoopbackHttpServer();
      const upstreamServer = await startLoopbackWebSocketServer();
      const gatewayServer = await startGatewayWebSocketServer();

      const observedRequestHeaders: Record<string, string | undefined> = {};
      let upstreamClose: { code: number; reason: string } | undefined;
      upstreamServer.on("connection", (socket, request) => {
        observedRequestHeaders.host = request.headers.host;
        observedRequestHeaders.origin =
          typeof request.headers.origin === "string" ? request.headers.origin : undefined;
        observedRequestHeaders["x-forwarded-host"] =
          typeof request.headers["x-forwarded-host"] === "string"
            ? request.headers["x-forwarded-host"]
            : undefined;
        observedRequestHeaders["x-forwarded-port"] =
          typeof request.headers["x-forwarded-port"] === "string"
            ? request.headers["x-forwarded-port"]
            : undefined;
        observedRequestHeaders["x-forwarded-proto"] =
          typeof request.headers["x-forwarded-proto"] === "string"
            ? request.headers["x-forwarded-proto"]
            : undefined;

        socket.on("message", (data, isBinary) => {
          if (isBinary) {
            socket.send(data, { binary: true });
            return;
          }

          socket.send(`echo:${toText(data)}`);
        });
        socket.on("close", (code, reasonBuffer) => {
          upstreamClose = {
            code,
            reason: reasonBuffer.toString("utf8"),
          };
        });
      });

      const tunnelClient = startTunnelClient({
        agentRuntimes: [],
        bootstrapToken: "bootstrap-token",
        gatewayWsUrl: `ws://127.0.0.1:${String(readListeningPort(gatewayServer))}/tunnel/sandbox`,
        runtimeClients: [],
        runtimeListenAddr: `127.0.0.1:${String(readListeningPort(runtimeServer))}`,
        signal: new AbortController().signal,
        tunnelExchangeToken: "exchange-token",
      });
      openTunnelClients.add(tunnelClient);

      const [gatewaySocket] = await once(gatewayServer, "connection");
      if (!(gatewaySocket instanceof WebSocket)) {
        throw new Error("Expected bootstrap websocket connection.");
      }
      const messageQueue = createPublishMessageQueue(gatewaySocket);

      try {
        gatewaySocket.send(
          JSON.stringify({
            type: "publish.ws.open",
            request: {
              headers: {
                host: [`localhost:${String(readListeningPort(upstreamServer))}`],
                origin: [`http://localhost:${String(readListeningPort(upstreamServer))}`],
                "x-forwarded-host": ["p-5173--sbi_publish_ws.mistle.localhost"],
                "x-forwarded-port": ["8787"],
                "x-forwarded-proto": ["http"],
              },
              path: "/hmr",
              query: "token=123",
            },
            streamId: 1,
            target: {
              kind: "port",
              port: readListeningPort(upstreamServer),
            },
          }),
        );

        expect(await messageQueue.next()).toEqual({
          type: "publish.ws.accept",
          headers: {},
          streamId: 1,
        });

        gatewaySocket.send(
          JSON.stringify({
            type: "publish.ws.frame",
            bytes: Buffer.from("hello", "utf8").toString("base64"),
            direction: "request",
            encoding: "base64",
            opcode: "text",
            streamId: 1,
          }),
        );

        expect(await messageQueue.next()).toEqual({
          type: "publish.ws.frame",
          bytes: Buffer.from("echo:hello", "utf8").toString("base64"),
          direction: "response",
          encoding: "base64",
          opcode: "text",
          streamId: 1,
        });

        gatewaySocket.send(
          JSON.stringify({
            type: "publish.ws.frame",
            bytes: Buffer.from([1, 2, 3, 4]).toString("base64"),
            direction: "request",
            encoding: "base64",
            opcode: "binary",
            streamId: 1,
          }),
        );

        expect(await messageQueue.next()).toEqual({
          type: "publish.ws.frame",
          bytes: Buffer.from([1, 2, 3, 4]).toString("base64"),
          direction: "response",
          encoding: "base64",
          opcode: "binary",
          streamId: 1,
        });

        gatewaySocket.send(
          JSON.stringify({
            type: "publish.ws.close",
            code: 1001,
            direction: "request",
            reason: "going away",
            streamId: 1,
          }),
        );

        expect(await messageQueue.next()).toEqual({
          type: "publish.ws.close",
          code: 1001,
          direction: "response",
          reason: "going away",
          streamId: 1,
        });

        expect(observedRequestHeaders).toEqual({
          host: `localhost:${String(readListeningPort(upstreamServer))}`,
          origin: `http://localhost:${String(readListeningPort(upstreamServer))}`,
          "x-forwarded-host": "p-5173--sbi_publish_ws.mistle.localhost",
          "x-forwarded-port": "8787",
          "x-forwarded-proto": "http",
        });
        expect(upstreamClose).toEqual({
          code: 1001,
          reason: "going away",
        });
      } finally {
        messageQueue.dispose();
        gatewaySocket.close();
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects internal and non-live ports at publish websocket open time",
    async () => {
      const runtimeServer = await startLoopbackHttpServer();
      const gatewayServer = await startGatewayWebSocketServer();

      const tunnelClient = startTunnelClient({
        agentRuntimes: [],
        bootstrapToken: "bootstrap-token",
        gatewayWsUrl: `ws://127.0.0.1:${String(readListeningPort(gatewayServer))}/tunnel/sandbox`,
        runtimeClients: [],
        runtimeListenAddr: `127.0.0.1:${String(readListeningPort(runtimeServer))}`,
        signal: new AbortController().signal,
        tunnelExchangeToken: "exchange-token",
      });
      openTunnelClients.add(tunnelClient);

      const [gatewaySocket] = await once(gatewayServer, "connection");
      if (!(gatewaySocket instanceof WebSocket)) {
        throw new Error("Expected bootstrap websocket connection.");
      }
      const messageQueue = createPublishMessageQueue(gatewaySocket);

      try {
        gatewaySocket.send(
          JSON.stringify({
            type: "publish.ws.open",
            request: {
              headers: {
                host: [`localhost:${String(readListeningPort(runtimeServer))}`],
                origin: [`http://localhost:${String(readListeningPort(runtimeServer))}`],
              },
              path: "/internal",
            },
            streamId: 2,
            target: {
              kind: "port",
              port: readListeningPort(runtimeServer),
            },
          }),
        );

        expect(await messageQueue.next()).toEqual({
          type: "publish.stream.error",
          code: "target_internal",
          message: `Published target port ${String(readListeningPort(runtimeServer))} is internal.`,
          streamId: 2,
        });
        expect(await messageQueue.next()).toEqual({
          type: "publish.stream.close",
          streamId: 2,
        });

        gatewaySocket.send(
          JSON.stringify({
            type: "publish.ws.open",
            request: {
              headers: {
                host: ["localhost:65534"],
                origin: ["http://localhost:65534"],
              },
              path: "/missing",
            },
            streamId: 3,
            target: {
              kind: "port",
              port: 65_534,
            },
          }),
        );

        expect(await messageQueue.next()).toEqual({
          type: "publish.stream.error",
          code: "target_not_live",
          message: "Published target port 65534 is not live.",
          streamId: 3,
        });
        expect(await messageQueue.next()).toEqual({
          type: "publish.stream.close",
          streamId: 3,
        });
      } finally {
        messageQueue.dispose();
        gatewaySocket.close();
      }
    },
    IntegrationTestTimeoutMs,
  );
});
