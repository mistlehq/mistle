/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";

import {
  derivePublishedTargetHost,
  mintPublishedTargetAccessToken,
} from "@mistle/gateway-published-target-auth";
import { mintBootstrapToken, mintTunnelExchangeToken } from "@mistle/gateway-tunnel-auth";
import { afterEach, describe, expect } from "vitest";
import WebSocket, { WebSocketServer, type RawData } from "ws";

import {
  startTunnelClient,
  type StartedTunnelClient,
} from "../../sandbox-runtime/src/tunnel/client.js";
import { insertSandboxInstanceRow, waitForRuntimeState } from "./runtime-state-test-helpers.js";
import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";

const IntegrationTestTimeoutMs = 30_000;

const startedHttpServers = new Set<HttpServer>();
const startedTunnelClients = new Set<StartedTunnelClient>();
const startedWebSocketClients = new Set<WebSocket>();
const startedWebSocketServers = new Set<WebSocketServer>();

afterEach(async () => {
  for (const client of startedWebSocketClients) {
    client.terminate();
  }
  startedWebSocketClients.clear();

  for (const tunnelClient of startedTunnelClients) {
    await tunnelClient.close().catch(() => undefined);
  }
  startedTunnelClients.clear();

  await Promise.all(
    Array.from(startedWebSocketServers, async (server) => {
      for (const client of server.clients) {
        client.terminate();
      }

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
  startedWebSocketServers.clear();

  await Promise.all(
    Array.from(startedHttpServers, async (server) => {
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
  startedHttpServers.clear();
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

function toBytes(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }
  if (typeof data === "string") {
    return new Uint8Array(Buffer.from(data, "utf8"));
  }

  return new Uint8Array(Buffer.concat(data));
}

async function startLoopbackHttpServer(
  listener: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<HttpServer> {
  const server = createHttpServer(listener);
  startedHttpServers.add(server);

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
  startedWebSocketServers.add(server);
  await once(server, "listening");

  return server;
}

async function startLoopbackHttpAndWebSocketServer(input: {
  onHttpRequest: (request: IncomingMessage, response: ServerResponse) => void;
}): Promise<{
  httpServer: HttpServer;
  webSocketServer: WebSocketServer;
}> {
  const httpServer = await startLoopbackHttpServer(input.onHttpRequest);
  const webSocketServer = new WebSocketServer({
    server: httpServer,
  });
  startedWebSocketServers.add(webSocketServer);

  return {
    httpServer,
    webSocketServer,
  };
}

function createBootstrapToken(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<string> {
  return mintBootstrapToken({
    config: {
      bootstrapTokenSecret: input.fixture.config.sandbox.bootstrap.tokenSecret,
      tokenAudience: input.fixture.config.sandbox.bootstrap.tokenAudience,
      tokenIssuer: input.fixture.config.sandbox.bootstrap.tokenIssuer,
    },
    jti: randomUUID(),
    sandboxInstanceId: input.sandboxInstanceId,
    ttlSeconds: 300,
  });
}

function createTunnelExchangeToken(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<string> {
  return mintTunnelExchangeToken({
    config: {
      tokenSecret: input.fixture.config.sandbox.bootstrap.tokenSecret,
      tokenAudience: input.fixture.config.sandbox.bootstrap.tokenAudience,
      tokenIssuer: input.fixture.config.sandbox.bootstrap.tokenIssuer,
    },
    bootstrapTokenTtlSeconds: 300,
    exchangeTokenTtlSeconds: 3_600,
    jti: randomUUID(),
    sandboxInstanceId: input.sandboxInstanceId,
    ttlSeconds: 3_600,
  });
}

function createPublishedHost(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  port: number;
}): string {
  return derivePublishedTargetHost({
    baseDomain: input.fixture.config.publish.localBaseDomain,
    sandboxInstanceId: input.sandboxInstanceId,
    target: {
      kind: "port",
      port: input.port,
    },
  });
}

function createPublishedUrl(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  host: string;
  path: string;
}): URL {
  const url = new URL(input.path, input.fixture.baseUrl);
  url.hostname = input.host;
  return url;
}

function createPublishedWebSocketUrl(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  host: string;
  path: string;
}): string {
  const url = new URL(input.path, input.fixture.websocketBaseUrl);
  url.hostname = input.host;
  return url.toString();
}

async function startRuntimeTunnel(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  runtimeListenAddr: string;
  sandboxInstanceId: string;
}): Promise<StartedTunnelClient> {
  const tunnelClient = startTunnelClient({
    agentRuntimes: [],
    bootstrapToken: await createBootstrapToken(input),
    gatewayWsUrl: `${input.fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(input.sandboxInstanceId)}`,
    runtimeClients: [],
    runtimeListenAddr: input.runtimeListenAddr,
    signal: new AbortController().signal,
    tunnelExchangeToken: await createTunnelExchangeToken(input),
  });
  startedTunnelClients.add(tunnelClient);

  await waitForRuntimeState({
    fixture: input.fixture,
    sandboxInstanceId: input.sandboxInstanceId,
    predicate: (snapshot) => snapshot.attachment?.sandboxInstanceId === input.sandboxInstanceId,
  });

  return tunnelClient;
}

async function bootstrapPublishedCookiePair(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  host: string;
  port: number;
  sandboxInstanceId: string;
}): Promise<string> {
  const token = await mintPublishedTargetAccessToken({
    config: input.fixture.config.publish.access,
    host: input.host,
    jti: randomUUID(),
    organizationId: "org_publish_ws",
    sandboxInstanceId: input.sandboxInstanceId,
    targetId: String(input.port),
    targetKind: "port",
    ttlSeconds: 300,
    userId: "usr_publish_ws",
  });

  const response = await fetch(
    createPublishedUrl({
      fixture: input.fixture,
      host: input.host,
      path: `/_mistle/bootstrap?token=${encodeURIComponent(token)}`,
    }),
    {
      redirect: "manual",
    },
  );
  expect(response.status).toBe(302);

  const setCookieHeader = response.headers.get("set-cookie");
  if (setCookieHeader === null) {
    throw new Error("Expected bootstrap response to include set-cookie.");
  }

  const cookiePair = setCookieHeader.split(";", 1)[0];
  if (cookiePair === undefined || cookiePair.length === 0) {
    throw new Error("Expected bootstrap set-cookie header to include a cookie pair.");
  }

  return cookiePair;
}

async function connectPublishedWebSocket(input: {
  cookie: string;
  url: string;
}): Promise<WebSocket> {
  const socket = new WebSocket(input.url, {
    headers: {
      cookie: input.cookie,
    },
  });
  startedWebSocketClients.add(socket);

  await new Promise<void>((resolve, reject) => {
    const handleOpen = (): void => {
      cleanup();
      resolve();
    };
    const handleError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const handleUnexpectedResponse = (
      _request: IncomingMessage,
      response: IncomingMessage,
    ): void => {
      cleanup();
      reject(
        new Error(
          `Unexpected websocket upgrade response: ${String(response.statusCode)} ${String(response.statusMessage)}`,
        ),
      );
    };
    const handleClose = (code: number, reason: Buffer): void => {
      cleanup();
      reject(
        new Error(
          `Published websocket closed before open: ${String(code)} ${reason.toString("utf8")}`,
        ),
      );
    };
    const cleanup = (): void => {
      socket.off("open", handleOpen);
      socket.off("error", handleError);
      socket.off("unexpected-response", handleUnexpectedResponse);
      socket.off("close", handleClose);
    };

    socket.once("open", handleOpen);
    socket.once("error", handleError);
    socket.once("unexpected-response", handleUnexpectedResponse);
    socket.once("close", handleClose);
  });

  return socket;
}

async function waitForWebSocketMessage(socket: WebSocket): Promise<{
  data: RawData;
  isBinary: boolean;
}> {
  return new Promise((resolve, reject) => {
    const handleMessage = (data: RawData, isBinary: boolean): void => {
      cleanup();
      resolve({
        data,
        isBinary,
      });
    };
    const handleClose = (code: number, reason: Buffer): void => {
      cleanup();
      reject(
        new Error(`Websocket closed before message: ${String(code)} ${reason.toString("utf8")}`),
      );
    };
    const handleError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("message", handleMessage);
      socket.off("close", handleClose);
      socket.off("error", handleError);
    };

    socket.once("message", handleMessage);
    socket.once("close", handleClose);
    socket.once("error", handleError);
  });
}

async function waitForWebSocketClose(socket: WebSocket): Promise<{
  code: number;
  reason: string;
}> {
  return new Promise((resolve, reject) => {
    const handleClose = (code: number, reason: Buffer): void => {
      cleanup();
      resolve({
        code,
        reason: reason.toString("utf8"),
      });
    };
    const handleError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("close", handleClose);
      socket.off("error", handleError);
    };

    socket.once("close", handleClose);
    socket.once("error", handleError);
  });
}

describe("published target websocket integration", () => {
  it(
    "proxies published websocket frames, rewritten headers, and upstream close codes",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_ws_001";
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_ws_roundtrip",
      });

      const runtimeServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("runtime");
      });
      const upstreamServer = await startLoopbackWebSocketServer();

      const observedRequestHeaders: Record<string, string | undefined> = {};
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

          const text = toText(data);
          if (text === "close-me") {
            socket.close(1012, "restarting");
            return;
          }

          socket.send(`echo:${text}`);
        });
      });

      await startRuntimeTunnel({
        fixture,
        runtimeListenAddr: `127.0.0.1:${String(readListeningPort(runtimeServer))}`,
        sandboxInstanceId,
      });

      const port = readListeningPort(upstreamServer);
      const host = createPublishedHost({
        fixture,
        sandboxInstanceId,
        port,
      });
      const sessionCookie = await bootstrapPublishedCookiePair({
        fixture,
        host,
        port,
        sandboxInstanceId,
      });

      const socket = await connectPublishedWebSocket({
        cookie: sessionCookie,
        url: createPublishedWebSocketUrl({
          fixture,
          host,
          path: "/hmr?token=123",
        }),
      });

      socket.send("hello");
      const textResponse = await waitForWebSocketMessage(socket);
      expect(textResponse.isBinary).toBe(false);
      expect(toText(textResponse.data)).toBe("echo:hello");

      socket.send(Buffer.from([1, 2, 3, 4]));
      const binaryResponse = await waitForWebSocketMessage(socket);
      expect(binaryResponse.isBinary).toBe(true);
      expect(Array.from(toBytes(binaryResponse.data))).toEqual([1, 2, 3, 4]);

      socket.send("close-me");
      expect(await waitForWebSocketClose(socket)).toEqual({
        code: 1012,
        reason: "restarting",
      });

      expect(observedRequestHeaders).toEqual({
        host: `localhost:${String(port)}`,
        origin: `http://localhost:${String(port)}`,
        "x-forwarded-host": host,
        "x-forwarded-port": "80",
        "x-forwarded-proto": "http",
      });
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "allows repeated websocket reconnects against the same published host and cookie",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_ws_002";
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_ws_reconnect",
      });

      const runtimeServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("runtime");
      });
      const upstreamServer = await startLoopbackWebSocketServer();

      let connectionCount = 0;
      upstreamServer.on("connection", (socket) => {
        connectionCount += 1;
        socket.on("message", (data) => {
          socket.send(`echo:${toText(data)}`);
        });
      });

      await startRuntimeTunnel({
        fixture,
        runtimeListenAddr: `127.0.0.1:${String(readListeningPort(runtimeServer))}`,
        sandboxInstanceId,
      });

      const port = readListeningPort(upstreamServer);
      const host = createPublishedHost({
        fixture,
        sandboxInstanceId,
        port,
      });
      const sessionCookie = await bootstrapPublishedCookiePair({
        fixture,
        host,
        port,
        sandboxInstanceId,
      });
      const url = createPublishedWebSocketUrl({
        fixture,
        host,
        path: "/reconnect",
      });

      const firstSocket = await connectPublishedWebSocket({
        cookie: sessionCookie,
        url,
      });
      firstSocket.send("one");
      expect(toText((await waitForWebSocketMessage(firstSocket)).data)).toBe("echo:one");
      firstSocket.close(1000, "done");
      expect(await waitForWebSocketClose(firstSocket)).toEqual({
        code: 1000,
        reason: "done",
      });

      const secondSocket = await connectPublishedWebSocket({
        cookie: sessionCookie,
        url,
      });
      secondSocket.send("two");
      expect(toText((await waitForWebSocketMessage(secondSocket)).data)).toBe("echo:two");
      secondSocket.close(1000, "done");
      expect(await waitForWebSocketClose(secondSocket)).toEqual({
        code: 1000,
        reason: "done",
      });

      expect(connectionCount).toBe(2);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "propagates abrupt upstream websocket termination to the browser-facing socket",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_ws_003";
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_ws_abrupt_close",
      });

      const runtimeServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("runtime");
      });
      const upstreamServer = await startLoopbackWebSocketServer();

      let upstreamSocket!: WebSocket;
      upstreamServer.on("connection", (socket) => {
        upstreamSocket = socket;
      });

      await startRuntimeTunnel({
        fixture,
        runtimeListenAddr: `127.0.0.1:${String(readListeningPort(runtimeServer))}`,
        sandboxInstanceId,
      });

      const port = readListeningPort(upstreamServer);
      const host = createPublishedHost({
        fixture,
        sandboxInstanceId,
        port,
      });
      const sessionCookie = await bootstrapPublishedCookiePair({
        fixture,
        host,
        port,
        sandboxInstanceId,
      });

      const socket = await connectPublishedWebSocket({
        cookie: sessionCookie,
        url: createPublishedWebSocketUrl({
          fixture,
          host,
          path: "/abrupt",
        }),
      });

      upstreamSocket.terminate();

      expect(await waitForWebSocketClose(socket)).toEqual({
        code: 1006,
        reason: "",
      });
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "supports initial published HTTP load and subsequent websocket reconnects on the same origin",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_ws_004";
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_ws_hmr_shape",
      });

      const runtimeServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("runtime");
      });
      const devServer = await startLoopbackHttpAndWebSocketServer({
        onHttpRequest: (_request, response) => {
          response.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
          });
          response.end("<!doctype html><title>hmr</title><script>window.__hmr = true;</script>");
        },
      });

      let webSocketConnections = 0;
      devServer.webSocketServer.on("connection", (socket) => {
        webSocketConnections += 1;
        socket.on("message", (data) => {
          socket.send(`hmr:${toText(data)}`);
        });
      });

      await startRuntimeTunnel({
        fixture,
        runtimeListenAddr: `127.0.0.1:${String(readListeningPort(runtimeServer))}`,
        sandboxInstanceId,
      });

      const port = readListeningPort(devServer.httpServer);
      const host = createPublishedHost({
        fixture,
        sandboxInstanceId,
        port,
      });
      const sessionCookie = await bootstrapPublishedCookiePair({
        fixture,
        host,
        port,
        sandboxInstanceId,
      });

      const htmlResponse = await fetch(
        createPublishedUrl({
          fixture,
          host,
          path: "/",
        }),
        {
          headers: {
            cookie: sessionCookie,
          },
        },
      );
      expect(htmlResponse.status).toBe(200);
      expect(await htmlResponse.text()).toContain("window.__hmr = true");

      const webSocketUrl = createPublishedWebSocketUrl({
        fixture,
        host,
        path: "/hmr",
      });
      const firstSocket = await connectPublishedWebSocket({
        cookie: sessionCookie,
        url: webSocketUrl,
      });
      firstSocket.send("first");
      expect(toText((await waitForWebSocketMessage(firstSocket)).data)).toBe("hmr:first");
      firstSocket.close(1000, "refresh");
      expect(await waitForWebSocketClose(firstSocket)).toEqual({
        code: 1000,
        reason: "refresh",
      });

      const secondSocket = await connectPublishedWebSocket({
        cookie: sessionCookie,
        url: webSocketUrl,
      });
      secondSocket.send("second");
      expect(toText((await waitForWebSocketMessage(secondSocket)).data)).toBe("hmr:second");
      secondSocket.close(1000, "refresh");
      expect(await waitForWebSocketClose(secondSocket)).toEqual({
        code: 1000,
        reason: "refresh",
      });

      expect(webSocketConnections).toBe(2);
    },
    IntegrationTestTimeoutMs,
  );
});
