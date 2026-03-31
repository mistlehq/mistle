import { once } from "node:events";
import { createServer, type Server as HttpServer } from "node:http";

import { parsePublishControlMessage } from "@mistle/sandbox-session-protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer, type RawData } from "ws";

import { startTunnelClient } from "../src/tunnel/client.js";

const IntegrationTestTimeoutMs = 30_000;
const openHttpServers = new Set<HttpServer>();
const openWebSocketServers = new Set<WebSocketServer>();

afterEach(async () => {
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

async function startLoopbackHttpServer(): Promise<HttpServer> {
  const server = createServer((_request, response) => {
    response.writeHead(200);
    response.end("ok");
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

async function startGatewayWebSocketServer(): Promise<WebSocketServer> {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });
  openWebSocketServers.add(server);
  await once(server, "listening");

  return server;
}

describe("sandbox runtime publish live listeners integration", () => {
  it(
    "responds to publish.listeners.get with internal and user_selectable loopback listeners",
    async () => {
      const runtimeServer = await startLoopbackHttpServer();
      const userServer = await startLoopbackHttpServer();
      const runtimeClientServer = await startGatewayWebSocketServer();
      const gatewayServer = await startGatewayWebSocketServer();

      const tunnelClient = startTunnelClient({
        agentRuntimes: [],
        bootstrapToken: "bootstrap-token",
        gatewayWsUrl: `ws://127.0.0.1:${String(readListeningPort(gatewayServer))}/tunnel/sandbox`,
        runtimeClients: [
          {
            clientId: "codex_app_server",
            endpoints: [
              {
                connectionMode: "shared",
                endpointKey: "server",
                transport: {
                  type: "ws",
                  url: `ws://127.0.0.1:${String(readListeningPort(runtimeClientServer))}/session`,
                },
              },
            ],
            processes: [],
            setup: {
              env: {},
              files: [],
            },
          },
        ],
        runtimeListenAddr: `127.0.0.1:${String(readListeningPort(runtimeServer))}`,
        signal: new AbortController().signal,
        tunnelExchangeToken: "exchange-token",
      });

      const [gatewaySocket] = await once(gatewayServer, "connection");
      if (!(gatewaySocket instanceof WebSocket)) {
        throw new Error("Expected bootstrap websocket connection.");
      }

      try {
        gatewaySocket.send(
          JSON.stringify({
            type: "publish.listeners.get",
            requestId: "req_1",
          }),
        );

        const [messagePayload] = await once(gatewaySocket, "message");
        const snapshotMessage = parsePublishControlMessage(toText(messagePayload));
        expect(snapshotMessage?.type).toBe("publish.listeners.snapshot");

        expect(snapshotMessage).toEqual({
          type: "publish.listeners.snapshot",
          requestId: "req_1",
          observedAt: expect.any(String),
          listeners: expect.arrayContaining([
            {
              bindAddress: "127.0.0.1",
              command: expect.any(String),
              observedAt: expect.any(String),
              owner: {
                kind: "sandbox-runtime",
              },
              pid: expect.any(Number),
              port: readListeningPort(runtimeServer),
              visibility: "internal",
            },
            {
              bindAddress: "127.0.0.1",
              command: expect.any(String),
              observedAt: expect.any(String),
              owner: {
                clientId: "codex_app_server",
                endpointKey: "server",
                kind: "managed-runtime-client",
              },
              pid: expect.any(Number),
              port: readListeningPort(runtimeClientServer),
              visibility: "internal",
            },
            {
              bindAddress: "127.0.0.1",
              command: expect.any(String),
              observedAt: expect.any(String),
              owner: {
                kind: "unknown-process",
              },
              pid: expect.any(Number),
              port: readListeningPort(userServer),
              visibility: "user_selectable",
            },
          ]),
        });
      } finally {
        gatewaySocket.close();
        await tunnelClient.close();
      }
    },
    IntegrationTestTimeoutMs,
  );
});
