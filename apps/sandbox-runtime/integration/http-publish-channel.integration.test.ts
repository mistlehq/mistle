import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";

import {
  parsePublishControlMessage,
  type PublishControlMessage,
} from "@mistle/sandbox-session-protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer, type RawData } from "ws";

import { startTunnelClient, type StartedTunnelClient } from "../src/tunnel/client.js";

const IntegrationTestTimeoutMs = 30_000;
const LargePayload = "x".repeat(96 * 1024);
const LargeResponsePayload = "y".repeat(96 * 1024);

const openHttpServers = new Set<HttpServer>();
const openWebSocketServers = new Set<WebSocketServer>();
const openTunnelClients = new Set<StartedTunnelClient>();

afterEach(async () => {
  for (const tunnelClient of openTunnelClients) {
    await tunnelClient.close().catch(() => undefined);
  }
  openTunnelClients.clear();

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

function chunkBase64Payload(text: string): string[] {
  const bytes = Buffer.from(text, "utf8");
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 32 * 1024) {
    chunks.push(
      bytes.subarray(offset, Math.min(offset + 32 * 1024, bytes.byteLength)).toString("base64"),
    );
  }

  return chunks;
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : Buffer.from(chunk).toString("utf8");
  }

  return body;
}

async function startLoopbackHttpServer(
  listener: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<HttpServer> {
  const server = createServer(listener);
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

async function startGatewayWebSocketServer(): Promise<WebSocketServer> {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });
  openWebSocketServers.add(server);
  await once(server, "listening");

  return server;
}

describe("sandbox runtime published HTTP integration", () => {
  it(
    "chunks large request and response bodies across publish.http.body.chunk messages",
    async () => {
      const runtimeServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("runtime");
      });

      let observedRequestBody = "";
      const upstreamServer = await startLoopbackHttpServer(async (request, response) => {
        observedRequestBody = await readRequestBody(request);
        response.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
        });
        response.end(LargeResponsePayload);
      });
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
            type: "publish.http.open",
            request: {
              headers: {
                host: [`localhost:${String(readListeningPort(upstreamServer))}`],
              },
              method: "POST",
              path: "/chunked",
            },
            streamId: 1,
            target: {
              kind: "port",
              port: readListeningPort(upstreamServer),
            },
          }),
        );

        for (const chunk of chunkBase64Payload(LargePayload)) {
          gatewaySocket.send(
            JSON.stringify({
              type: "publish.http.body.chunk",
              bytes: chunk,
              direction: "request",
              encoding: "base64",
              streamId: 1,
            }),
          );
        }
        gatewaySocket.send(
          JSON.stringify({
            type: "publish.http.body.end",
            direction: "request",
            streamId: 1,
          }),
        );

        const responseChunks: string[] = [];
        let responseChunkCount = 0;
        let sawResponseEnd = false;
        let responseStatus: number | undefined;
        let sawStreamClose = false;

        while (!sawResponseEnd || !sawStreamClose) {
          const controlMessage = await messageQueue.next();

          if (controlMessage.type === "publish.http.response.start") {
            responseStatus = controlMessage.status;
            continue;
          }
          if (
            controlMessage.type === "publish.http.body.chunk" &&
            controlMessage.direction === "response"
          ) {
            responseChunkCount += 1;
            responseChunks.push(Buffer.from(controlMessage.bytes, "base64").toString("utf8"));
            continue;
          }
          if (
            controlMessage.type === "publish.http.body.end" &&
            controlMessage.direction === "response"
          ) {
            sawResponseEnd = true;
            continue;
          }
          if (controlMessage.type === "publish.stream.close") {
            sawStreamClose = true;
            continue;
          }

          throw new Error(`Unexpected publish control message '${controlMessage.type}'.`);
        }

        expect(observedRequestBody).toBe(LargePayload);
        expect(responseStatus).toBe(200);
        expect(responseChunkCount).toBeGreaterThan(1);
        expect(responseChunks.join("")).toBe(LargeResponsePayload);
      } finally {
        messageQueue.dispose();
        gatewaySocket.close();
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects internal and non-live ports at publish stream open time",
    async () => {
      const runtimeServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("runtime");
      });
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
            type: "publish.http.open",
            request: {
              headers: {
                host: [`localhost:${String(readListeningPort(runtimeServer))}`],
              },
              method: "GET",
              path: "/internal",
            },
            streamId: 2,
            target: {
              kind: "port",
              port: readListeningPort(runtimeServer),
            },
          }),
        );

        const internalError = await messageQueue.next();
        expect(internalError).toEqual({
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
            type: "publish.http.open",
            request: {
              headers: {
                host: ["localhost:65534"],
              },
              method: "GET",
              path: "/missing",
            },
            streamId: 3,
            target: {
              kind: "port",
              port: 65_534,
            },
          }),
        );

        const missingError = await messageQueue.next();
        expect(missingError).toEqual({
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
