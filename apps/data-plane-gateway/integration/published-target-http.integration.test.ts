/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { createServer as createNetServer, type Server as NetServer } from "node:net";

import { mintBootstrapToken, mintTunnelExchangeToken } from "@mistle/gateway-tunnel-auth";
import {
  derivePublishedTargetHost,
  mintPublishedTargetAccessToken,
} from "@mistle/published-target-auth";
import { systemSleeper } from "@mistle/time";
import { afterEach, describe, expect } from "vitest";

import {
  startTunnelClient,
  type StartedTunnelClient,
} from "../../sandbox-runtime/src/tunnel/client.js";
import { insertSandboxInstanceRow, waitForRuntimeState } from "./runtime-state-test-helpers.js";
import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";

const IntegrationTestTimeoutMs = 30_000;

const startedHttpServers = new Set<HttpServer>();
const startedNetServers = new Set<NetServer>();
const startedTunnelClients = new Set<StartedTunnelClient>();

afterEach(async () => {
  for (const tunnelClient of startedTunnelClients) {
    await tunnelClient.close().catch(() => undefined);
  }
  startedTunnelClients.clear();

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

  await Promise.all(
    Array.from(startedNetServers, async (server) => {
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
  startedNetServers.clear();
});

function readListeningPort(server: HttpServer | NetServer): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected listening server address.");
  }

  return address.port;
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : Buffer.from(chunk).toString("utf8");
  }

  return body;
}

function readSingleHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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

async function startLoopbackFailureServer(): Promise<NetServer> {
  const server = createNetServer((socket) => {
    socket.destroy();
  });
  startedNetServers.add(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
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
    baseDomain: input.fixture.config.sandbox.publish.baseDomain,
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
    config: input.fixture.config.sandbox.publish.access,
    host: input.host,
    jti: randomUUID(),
    organizationId: "org_publish_http",
    sandboxInstanceId: input.sandboxInstanceId,
    targetId: String(input.port),
    targetKind: "port",
    ttlSeconds: 300,
    userId: "usr_publish_http",
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

describe("published target HTTP integration", () => {
  it(
    "proxies request method, path, body, and rewritten headers to a published port",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_http_001";
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_http_roundtrip",
      });

      const runtimeServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("runtime");
      });

      const observedRequest: {
        body: string | null;
        headers: Readonly<Record<string, string | undefined>> | null;
        method: string | null;
        url: string | null;
      } = {
        body: null,
        headers: null,
        method: null,
        url: null,
      };
      const upstreamServer = await startLoopbackHttpServer(async (request, response) => {
        observedRequest.body = await readRequestBody(request);
        observedRequest.headers = {
          cookie: readSingleHeaderValue(request.headers.cookie),
          host: readSingleHeaderValue(request.headers.host),
          "x-forwarded-host": readSingleHeaderValue(request.headers["x-forwarded-host"]),
          "x-forwarded-port": readSingleHeaderValue(request.headers["x-forwarded-port"]),
          "x-forwarded-proto": readSingleHeaderValue(request.headers["x-forwarded-proto"]),
        };
        observedRequest.method = request.method ?? null;
        observedRequest.url = request.url ?? null;

        response.writeHead(201, {
          "content-type": "text/plain; charset=utf-8",
          "x-upstream": "ok",
        });
        response.end("published-response");
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

      const response = await fetch(
        createPublishedUrl({
          fixture,
          host,
          path: "/nested/path?hello=world",
        }),
        {
          body: "hello published world",
          headers: {
            cookie: `app_cookie=1; ${sessionCookie}`,
            "content-type": "text/plain",
            "x-extra-header": "forward-me",
          },
          method: "POST",
        },
      );

      expect(response.status).toBe(201);
      expect(response.headers.get("x-upstream")).toBe("ok");
      expect(await response.text()).toBe("published-response");

      expect(observedRequest.method).toBe("POST");
      expect(observedRequest.url).toBe("/nested/path?hello=world");
      expect(observedRequest.body).toBe("hello published world");
      expect(observedRequest.headers).toEqual({
        cookie: "app_cookie=1",
        host: `localhost:${String(port)}`,
        "x-forwarded-host": host,
        "x-forwarded-port": String(new URL(fixture.baseUrl).port),
        "x-forwarded-proto": "http",
      });
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "round-trips large request and response bodies through published HTTP streams",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_http_002";
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_http_large",
      });

      const runtimeServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("runtime");
      });

      const requestBody = "x".repeat(96 * 1024);
      const responseBody = "y".repeat(96 * 1024);
      const upstreamServer = await startLoopbackHttpServer(async (request, response) => {
        expect(await readRequestBody(request)).toBe(requestBody);
        response.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
        });
        response.end(responseBody);
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

      const response = await fetch(
        createPublishedUrl({
          fixture,
          host,
          path: "/large",
        }),
        {
          body: requestBody,
          headers: {
            cookie: sessionCookie,
            "content-type": "text/plain",
          },
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(responseBody);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "returns a terminal error when the upstream port closes after bootstrap",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_http_003";
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_http_not_live",
      });

      const runtimeServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("runtime");
      });
      const upstreamServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("ok");
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

      await new Promise<void>((resolve, reject) => {
        upstreamServer.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });
      });
      startedHttpServers.delete(upstreamServer);

      const response = await fetch(
        createPublishedUrl({
          fixture,
          host,
          path: "/after-close",
        }),
        {
          headers: {
            cookie: sessionCookie,
          },
        },
      );

      expect(response.status).toBe(409);
      expect(await response.text()).toContain("not live");
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "returns a terminal error when the upstream connection fails without hanging",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_http_004";
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_http_connect_failure",
      });

      const runtimeServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("runtime");
      });
      const failureServer = await startLoopbackFailureServer();

      await startRuntimeTunnel({
        fixture,
        runtimeListenAddr: `127.0.0.1:${String(readListeningPort(runtimeServer))}`,
        sandboxInstanceId,
      });

      const port = readListeningPort(failureServer);
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

      const response = await fetch(
        createPublishedUrl({
          fixture,
          host,
          path: "/connect-failure",
        }),
        {
          headers: {
            cookie: sessionCookie,
          },
        },
      );

      expect(response.status).toBe(502);
      expect(await response.text()).toContain("Failed connecting");
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "fails in-flight published HTTP requests when the bootstrap tunnel disconnects",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_http_005";
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_http_disconnect",
      });

      const runtimeServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("runtime");
      });

      let releaseResponse!: () => void;
      const releasePromise = new Promise<void>((resolve) => {
        releaseResponse = resolve;
      });
      const upstreamServer = await startLoopbackHttpServer(async (_request, response) => {
        await releasePromise;
        response.writeHead(200);
        response.end("late");
      });

      const tunnelClient = await startRuntimeTunnel({
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

      const responsePromise = fetch(
        createPublishedUrl({
          fixture,
          host,
          path: "/disconnect",
        }),
        {
          headers: {
            cookie: sessionCookie,
          },
        },
      );

      await systemSleeper.sleep(100);
      await tunnelClient.close();
      startedTunnelClients.delete(tunnelClient);
      releaseResponse();

      const response = await responsePromise;
      expect(response.status).toBe(503);
      expect(await response.text()).toContain("disconnected");
    },
    IntegrationTestTimeoutMs,
  );
});
