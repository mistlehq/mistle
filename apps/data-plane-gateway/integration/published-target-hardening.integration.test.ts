/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
  request as httpRequest,
} from "node:http";

import { mintBootstrapToken, mintTunnelExchangeToken } from "@mistle/gateway-tunnel-auth";
import { mintPublishedTargetAccessToken } from "@mistle/published-target-auth";
import { afterEach, describe, expect } from "vitest";

import {
  startTunnelClient,
  type StartedTunnelClient,
} from "../../sandbox-runtime/src/tunnel/client.js";
import {
  createPublishedHttpUrl,
  deriveIntegrationPublishedHost,
} from "./published-target-test-helpers.js";
import { insertSandboxInstanceRow, waitForRuntimeState } from "./runtime-state-test-helpers.js";
import { it, itProduction, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";

const IntegrationTestTimeoutMs = 30_000;

const startedHttpServers = new Set<HttpServer>();
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
});

function readListeningPort(server: HttpServer): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected listening server address.");
  }

  return address.port;
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

async function bootstrapPublishedCookieResponse(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  host: string;
  port: number;
  sandboxInstanceId: string;
}): Promise<Response> {
  const token = await mintPublishedTargetAccessToken({
    config: input.fixture.config.sandbox.publish.access,
    host: input.host,
    jti: randomUUID(),
    organizationId: "org_publish_hardening",
    sandboxInstanceId: input.sandboxInstanceId,
    targetId: String(input.port),
    targetKind: "port",
    ttlSeconds: 300,
    userId: "usr_publish_hardening",
  });

  return fetch(
    createPublishedHttpUrl({
      fixture: input.fixture,
      host: input.host,
      path: `/_mistle/bootstrap?token=${encodeURIComponent(token)}`,
    }),
    {
      redirect: "manual",
    },
  );
}

async function bootstrapPublishedCookiePair(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  host: string;
  port: number;
  sandboxInstanceId: string;
}): Promise<{
  cookie: string;
  setCookieHeader: string;
}> {
  const response = await bootstrapPublishedCookieResponse(input);
  expect(response.status).toBe(302);

  const setCookieHeader = response.headers.get("set-cookie");
  if (setCookieHeader === null) {
    throw new Error("Expected bootstrap response to include set-cookie.");
  }

  const cookie = setCookieHeader.split(";", 1)[0];
  if (cookie === undefined || cookie.length === 0) {
    throw new Error("Expected bootstrap set-cookie header to include a cookie pair.");
  }

  return {
    cookie,
    setCookieHeader,
  };
}

async function requestGatewayWithHostHeader(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  host: string;
  path: string;
}): Promise<{
  body: string;
  headers: IncomingMessage["headers"];
  status: number;
}> {
  const url = new URL(input.path, input.fixture.baseUrl);

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        headers: {
          host: input.host,
        },
        host: url.hostname,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        port: url.port.length > 0 ? Number.parseInt(url.port, 10) : undefined,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            body,
            headers: response.headers,
            status: response.statusCode ?? 500,
          });
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}

describe("published target hardening integration", () => {
  it(
    "routes mistle.localhost published hosts over plain HTTP and issues a non-Secure session cookie",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_hardening_001";
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_hardening_local_http",
      });

      const runtimeServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("runtime");
      });
      const upstreamServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
        });
        response.end("local-http-ok");
      });

      await startRuntimeTunnel({
        fixture,
        runtimeListenAddr: `127.0.0.1:${String(readListeningPort(runtimeServer))}`,
        sandboxInstanceId,
      });

      const port = readListeningPort(upstreamServer);
      const host = deriveIntegrationPublishedHost({
        fixture,
        port,
        sandboxInstanceId,
      });

      expect(host.endsWith(".mistle.localhost")).toBe(true);

      const { cookie, setCookieHeader } = await bootstrapPublishedCookiePair({
        fixture,
        host,
        port,
        sandboxInstanceId,
      });

      expect(setCookieHeader.includes("Secure")).toBe(false);

      const response = await fetch(
        createPublishedHttpUrl({
          fixture,
          host,
          path: "/",
        }),
        {
          headers: {
            cookie,
          },
        },
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("local-http-ok");
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects a bootstrap request when the signed token host does not match the requested canonical host",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_hardening_002";
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_hardening_wrong_host",
      });

      const runtimeServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("runtime");
      });
      const upstreamServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("canonical");
      });

      await startRuntimeTunnel({
        fixture,
        runtimeListenAddr: `127.0.0.1:${String(readListeningPort(runtimeServer))}`,
        sandboxInstanceId,
      });

      const port = readListeningPort(upstreamServer);
      const canonicalHost = deriveIntegrationPublishedHost({
        fixture,
        port,
        sandboxInstanceId,
      });
      const mismatchedHost = deriveIntegrationPublishedHost({
        fixture,
        port: port + 1,
        sandboxInstanceId,
      });

      const token = await mintPublishedTargetAccessToken({
        config: fixture.config.sandbox.publish.access,
        host: canonicalHost,
        jti: randomUUID(),
        organizationId: "org_publish_hardening",
        sandboxInstanceId,
        targetId: String(port),
        targetKind: "port",
        ttlSeconds: 300,
        userId: "usr_publish_hardening",
      });

      const response = await fetch(
        createPublishedHttpUrl({
          fixture,
          host: mismatchedHost,
          path: `/_mistle/bootstrap?token=${encodeURIComponent(token)}`,
        }),
        {
          redirect: "manual",
        },
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("does not match the request host");
    },
    IntegrationTestTimeoutMs,
  );

  itProduction(
    "uses sandbox.publish.baseDomain in production",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_hardening_003";
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_hardening_production_base_domain",
      });

      const runtimeServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("runtime");
      });
      const upstreamServer = await startLoopbackHttpServer((_request, response) => {
        response.writeHead(200);
        response.end("production");
      });

      await startRuntimeTunnel({
        fixture,
        runtimeListenAddr: `127.0.0.1:${String(readListeningPort(runtimeServer))}`,
        sandboxInstanceId,
      });

      const port = readListeningPort(upstreamServer);
      const productionHost = deriveIntegrationPublishedHost({
        fixture,
        port,
        sandboxInstanceId,
      });

      expect(productionHost.endsWith(`.${fixture.config.sandbox.publish.baseDomain}`)).toBe(true);

      const localHost = deriveIntegrationPublishedHost({
        fixture: {
          ...fixture,
          config: {
            ...fixture.config,
            environment: "development",
          },
        },
        port,
        sandboxInstanceId,
      });

      const token = await mintPublishedTargetAccessToken({
        config: fixture.config.sandbox.publish.access,
        host: productionHost,
        jti: randomUUID(),
        organizationId: "org_publish_hardening",
        sandboxInstanceId,
        targetId: String(port),
        targetKind: "port",
        ttlSeconds: 300,
        userId: "usr_publish_hardening",
      });

      const response = await requestGatewayWithHostHeader({
        fixture,
        host: productionHost,
        path: `/_mistle/bootstrap?token=${encodeURIComponent(token)}`,
      });
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe("/");

      const wrongHostResponse = await requestGatewayWithHostHeader({
        fixture,
        host: localHost,
        path: `/_mistle/bootstrap?token=${encodeURIComponent(token)}`,
      });

      expect(wrongHostResponse.status).toBe(400);
      expect(wrongHostResponse.body).toContain("baseDomain");
    },
    IntegrationTestTimeoutMs,
  );
});
