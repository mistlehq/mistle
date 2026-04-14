/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { createHash } from "node:crypto";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { gzipSync } from "node:zlib";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { mintEgressGrant } from "@mistle/sandbox-egress-auth";
import { reserveAvailablePort, startHttpEcho } from "@mistle/test-harness";
import { Hono } from "hono";
import { describe, expect } from "vitest";

import {
  CREDENTIAL_CACHE_DEFAULT_TTL_SECONDS,
  CREDENTIAL_CACHE_MAX_ENTRIES,
  CREDENTIAL_CACHE_REFRESH_SKEW_SECONDS,
  CREDENTIAL_RESOLVER_REQUEST_TIMEOUT_MS,
  EGRESS_BASE_PATH,
  EGRESS_WILDCARD_BASE_PATH,
  EgressRequestHeaders,
} from "../src/egress/constants.js";
import { CredentialCache } from "../src/egress/credential-cache.js";
import { createEgressProxyHandler } from "../src/egress/proxy-handler.js";
import { createTokenizerProxyRuntime } from "../src/runtime/index.js";
import { startServer } from "../src/server.js";
import type { AppContextBindings } from "../src/types.js";
import { it } from "./test-context.js";

const ControlPlaneInternalAuthHeader = "x-mistle-service-token";
const PublicControlPlaneBaseUrl = "https://public-control-plane.example.test";

type StartedControlPlaneCredentialServer = {
  baseUrl: string;
  requests: ReadonlyArray<unknown>;
  stop: () => Promise<void>;
};

const IntegrationEgressGrantConfig = {
  tokenSecret: "integration-egress-grant-secret",
  tokenIssuer: "mistle-tokenizer-proxy-integration",
  tokenAudience: "tokenizer-proxy",
} as const;

type StartedTokenizerProxyServer = {
  baseUrl: string;
  stop: () => Promise<void>;
};

type RequestMiddlewareResolver = NonNullable<
  Parameters<typeof createEgressProxyHandler>[0]["resolveRequestMiddleware"]
>;
type ResolvedRequestMiddleware = NonNullable<ReturnType<RequestMiddlewareResolver>>;

async function mintIntegrationEgressGrant(
  input: {
    egressRuleId: string;
    upstreamBaseUrl: string;
    bindingId: string;
    familyId?: string;
    variantId?: string;
    connectionId: string;
    secretType: string;
    additionalHeaders?: Readonly<Record<string, string>>;
    additionalCredentialHeaders?: ReadonlyArray<{
      header: string;
      connectionId: string;
      secretType: string;
      slotKey?: string;
      resolverKey?: string;
    }>;
    slotKey?: string;
    resolverKey?: string;
    requestMiddleware?: ReadonlyArray<string>;
    allowedMethods?: ReadonlyArray<string>;
    allowedPathPrefixes?: ReadonlyArray<string>;
  } & (
    | {
        authInjectionType: "bearer" | "basic" | "header" | "query";
        authInjectionTarget: string;
        authInjectionUsername?: string;
      }
    | {
        authInjectionType: "aws_sigv4";
        authInjectionService: string;
        authInjectionRegion: string;
      }
  ),
): Promise<string> {
  return await mintEgressGrant({
    config: IntegrationEgressGrantConfig,
    claims: {
      sub: "sandbox_123",
      jti: input.egressRuleId,
      bindingId: input.bindingId,
      familyId: input.familyId ?? "test",
      variantId: input.variantId ?? "test-default",
      connectionId: input.connectionId,
      secretType: input.secretType,
      upstreamBaseUrl: input.upstreamBaseUrl,
      authInjectionType: input.authInjectionType,
      ...(input.additionalHeaders === undefined
        ? {}
        : { additionalHeaders: input.additionalHeaders }),
      ...(input.additionalCredentialHeaders === undefined
        ? {}
        : { additionalCredentialHeaders: input.additionalCredentialHeaders }),
      ...("authInjectionTarget" in input
        ? {
            authInjectionTarget: input.authInjectionTarget,
            ...(input.authInjectionUsername === undefined
              ? {}
              : { authInjectionUsername: input.authInjectionUsername }),
          }
        : {
            authInjectionService: input.authInjectionService,
            authInjectionRegion: input.authInjectionRegion,
          }),
      ...(input.slotKey === undefined ? {} : { slotKey: input.slotKey }),
      ...(input.resolverKey === undefined ? {} : { resolverKey: input.resolverKey }),
      ...(input.requestMiddleware === undefined
        ? {}
        : { requestMiddleware: input.requestMiddleware }),
      ...(input.allowedMethods === undefined ? {} : { allowedMethods: input.allowedMethods }),
      ...(input.allowedPathPrefixes === undefined
        ? {}
        : { allowedPathPrefixes: input.allowedPathPrefixes }),
    },
    ttlSeconds: 60,
  });
}

function createRuntimeConfig(input: {
  host: string;
  port: number;
  controlPlaneBaseUrl: string;
  controlPlanePublicBaseUrl?: string;
}) {
  return {
    app: {
      server: {
        host: input.host,
        port: input.port,
      },
      controlPlaneApi: {
        baseUrl: input.controlPlaneBaseUrl,
        publicBaseUrl: input.controlPlanePublicBaseUrl ?? PublicControlPlaneBaseUrl,
      },
    },
    internalAuthServiceToken: "integration-service-token",
    egressGrantConfig: IntegrationEgressGrantConfig,
  } as const;
}

async function startTokenizerProxyWithRequestMiddleware(input: {
  host: string;
  port: number;
  controlPlaneBaseUrl: string;
  controlPlanePublicBaseUrl?: string;
  resolveRequestMiddleware: RequestMiddlewareResolver;
}): Promise<StartedTokenizerProxyServer> {
  const app = new Hono<AppContextBindings>();
  const controlPlaneInternalClient = new ControlPlaneInternalClient({
    baseUrl: input.controlPlaneBaseUrl,
    internalAuthServiceToken: "integration-service-token",
    requestTimeoutMs: CREDENTIAL_RESOLVER_REQUEST_TIMEOUT_MS,
  });
  const credentialCache = new CredentialCache({
    maxEntries: CREDENTIAL_CACHE_MAX_ENTRIES,
    defaultTtlSeconds: CREDENTIAL_CACHE_DEFAULT_TTL_SECONDS,
    refreshSkewSeconds: CREDENTIAL_CACHE_REFRESH_SKEW_SECONDS,
    now: () => Date.now(),
  });
  const egressProxyHandler = createEgressProxyHandler({
    controlPlaneInternalClient,
    credentialCache,
    egressGrantConfig: IntegrationEgressGrantConfig,
    resolveRequestMiddleware: input.resolveRequestMiddleware,
  });

  app.use("*", async (ctx, next) => {
    ctx.set("config", createRuntimeConfig(input).app);
    ctx.set("internalAuthServiceToken", "integration-service-token");
    await next();
  });
  app.all(EGRESS_BASE_PATH, egressProxyHandler);
  app.all(EGRESS_WILDCARD_BASE_PATH, egressProxyHandler);

  const startedServer = startServer({
    app,
    host: input.host,
    port: input.port,
  });

  return {
    baseUrl: `http://${input.host}:${String(input.port)}`,
    stop: async () => startedServer.close(),
  };
}

function createRequestMiddlewareResolver(
  middlewares: ReadonlyArray<ResolvedRequestMiddleware>,
): RequestMiddlewareResolver {
  return ({ middlewareId }) => middlewares.find((middleware) => middleware.id === middlewareId);
}

function readHeaderValue(headers: unknown, headerName: string): string | undefined {
  if (typeof headers !== "object" || headers === null) {
    return undefined;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== headerName.toLowerCase()) {
      continue;
    }

    if (typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

async function startControlPlaneCredentialServer(input: {
  host: string;
  serviceToken: string;
  credentialValue?: string;
  statusCode?: number;
  responseBody?: unknown;
}): Promise<StartedControlPlaneCredentialServer> {
  const port = await reserveAvailablePort({ host: input.host });
  const requests: unknown[] = [];

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== "POST" || request.url !== "/internal/integration-credentials/resolve") {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    if (request.headers[ControlPlaneInternalAuthHeader] !== input.serviceToken) {
      writeJson(response, 401, {
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      });
      return;
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of request) {
      if (typeof chunk === "string") {
        chunks.push(Buffer.from(chunk));
        continue;
      }

      chunks.push(chunk);
    }

    const bodyText = Buffer.concat(chunks).toString("utf8");
    requests.push(bodyText.length === 0 ? undefined : JSON.parse(bodyText));

    writeJson(
      response,
      input.statusCode ?? 200,
      input.responseBody ?? {
        kind: "value",
        value: input.credentialValue ?? "test-secret",
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, input.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    baseUrl: `http://${input.host}:${String(port)}`,
    requests,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

async function startGzipUpstream(input: {
  host: string;
  path: string;
  body: string;
}): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const port = await reserveAvailablePort({ host: input.host });
  const gzippedBody = gzipSync(input.body);

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url !== input.path) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.setHeader("content-encoding", "gzip");
    response.setHeader("content-length", String(gzippedBody.byteLength));
    response.end(gzippedBody);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, input.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    baseUrl: `http://${input.host}:${String(port)}`,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

async function startWebSocketUpstream(input: { host: string; path: string }): Promise<{
  baseUrl: string;
  capturedHeaders: () => Readonly<Record<string, string | ReadonlyArray<string>>> | undefined;
  capturedAuthorizationHeader: () => string | undefined;
  capturedChatGptAccountIdHeader: () => string | undefined;
  stop: () => Promise<void>;
}> {
  const port = await reserveAvailablePort({ host: input.host });
  let authorizationHeader: string | undefined;
  let chatGptAccountIdHeader: string | undefined;
  let capturedHeaders: Readonly<Record<string, string | ReadonlyArray<string>>> | undefined;

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url === input.path) {
      response.statusCode = 426;
      response.end("upgrade required");
      return;
    }

    response.statusCode = 404;
    response.end("not found");
  });

  server.on("upgrade", (request, socket, head) => {
    if (request.url !== input.path) {
      socket.destroy();
      return;
    }

    capturedHeaders = Object.fromEntries(
      Object.entries(request.headers).flatMap(([headerName, headerValue]) => {
        if (headerValue === undefined) {
          return [];
        }

        return [[headerName, Array.isArray(headerValue) ? [...headerValue] : headerValue] as const];
      }),
    );

    authorizationHeader =
      typeof request.headers.authorization === "string"
        ? request.headers.authorization
        : request.headers.authorization?.[0];
    chatGptAccountIdHeader =
      typeof request.headers["chatgpt-account-id"] === "string"
        ? request.headers["chatgpt-account-id"]
        : request.headers["chatgpt-account-id"]?.[0];

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    if (head.length > 0) {
      socket.unshift(head);
    }
    socket.once("data", (payload) => {
      expect(payload.toString("utf8")).toBe("ping\n");
      socket.write("pong\n");
      socket.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, input.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    baseUrl: `http://${input.host}:${String(port)}`,
    capturedHeaders: () => capturedHeaders,
    capturedAuthorizationHeader: () => authorizationHeader,
    capturedChatGptAccountIdHeader: () => chatGptAccountIdHeader,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

async function performUpgradeRequest(input: {
  baseUrl: string;
  path: string;
  headers: Record<string, string>;
}): Promise<string> {
  const targetUrl = new URL(input.baseUrl);

  return await new Promise<string>((resolve, reject) => {
    const request = httpRequest({
      host: targetUrl.hostname,
      port: targetUrl.port,
      method: "GET",
      path: input.path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        ...input.headers,
      },
    });

    request.once("upgrade", (_response, socket, head) => {
      if (head.length > 0) {
        socket.unshift(head);
      }

      const onData = (payload: Buffer): void => {
        const message = payload.toString("utf8");
        if (message.endsWith("pong\n")) {
          socket.off("data", onData);
          socket.end();
          resolve("pong\n");
        }
      };

      socket.on("data", onData);
      socket.once("error", reject);
      socket.write("ping\n");
    });
    request.once("response", (response) => {
      response.resume();
      reject(
        new Error(
          `Expected upgrade response, received status ${String(response.statusCode ?? 0)}.`,
        ),
      );
    });
    request.once("error", reject);
    request.end();
  });
}

describe("tokenizer proxy integration", () => {
  it("returns healthy status on /__healthz", async ({ fixture }) => {
    const response = await fetch(`${fixture.baseUrl}/__healthz`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it("returns 401 when egress grant is missing", async ({ fixture }) => {
    const response = await fetch(`${fixture.baseUrl}/tokenizer-proxy/egress/v1/responses`, {
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      code: "INVALID_EGRESS_GRANT",
      message: "Egress grant token is required.",
    });
  });

  it("returns 401 when forged authority headers are present without a grant", async ({
    fixture,
  }) => {
    const response = await fetch(`${fixture.baseUrl}/tokenizer-proxy/egress/v1/responses`, {
      method: "POST",
      headers: {
        "X-Mistle-Egress-Connection-Id": "icn_forged",
        "X-Mistle-Egress-Binding-Id": "ibd_forged",
        "X-Mistle-Egress-Upstream-Base-Url": "https://attacker.invalid",
      },
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      code: "INVALID_EGRESS_GRANT",
      message: "Egress grant token is required.",
    });
  });

  it("returns 502 when control-plane credential resolution fails", async () => {
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "unused",
      statusCode: 500,
      responseBody: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to resolve integration credential.",
      },
    });

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_123",
      upstreamBaseUrl: "https://api.example.com",
      bindingId: "ibd_missing",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      connectionId: "icn_missing",
      secretType: "api_key",
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/v1"],
    });
    const runtime = createTokenizerProxyRuntime({
      app: {
        server: {
          host,
          port,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneServer.baseUrl,
          publicBaseUrl: PublicControlPlaneBaseUrl,
        },
      },
      internalAuthServiceToken: "integration-service-token",
      egressGrantConfig: IntegrationEgressGrantConfig,
    });
    await runtime.start();

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/v1/responses`,
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
          },
        },
      );
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body).toEqual({
        code: "CREDENTIAL_RESOLUTION_FAILED",
        message: "Failed to resolve integration credential.",
      });
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop()]);
    }
  });

  it("returns 403 when the request method falls outside the grant scope", async () => {
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "unused",
    });

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_openai",
      upstreamBaseUrl: "https://api.openai.com/v1",
      bindingId: "ibd_openai",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      connectionId: "icn_openai",
      secretType: "api_key",
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/v1"],
    });
    const runtime = createTokenizerProxyRuntime({
      app: {
        server: {
          host,
          port,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneServer.baseUrl,
          publicBaseUrl: PublicControlPlaneBaseUrl,
        },
      },
      internalAuthServiceToken: "integration-service-token",
      egressGrantConfig: IntegrationEgressGrantConfig,
    });
    await runtime.start();

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/v1/responses`,
        {
          method: "GET",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
          },
        },
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual({
        code: "EGRESS_GRANT_SCOPE_VIOLATION",
        message: "Egress grant does not allow method 'GET'.",
      });
      expect(controlPlaneServer.requests).toEqual([]);
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop()]);
    }
  });

  it("returns 403 when the request path falls outside the grant scope", async () => {
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "unused",
    });

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_openai",
      upstreamBaseUrl: "https://api.openai.com/v1",
      bindingId: "ibd_openai",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      connectionId: "icn_openai",
      secretType: "api_key",
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/v1"],
    });
    const runtime = createTokenizerProxyRuntime({
      app: {
        server: {
          host,
          port,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneServer.baseUrl,
          publicBaseUrl: PublicControlPlaneBaseUrl,
        },
      },
      internalAuthServiceToken: "integration-service-token",
      egressGrantConfig: IntegrationEgressGrantConfig,
    });
    await runtime.start();

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/graphql`,
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
          },
        },
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual({
        code: "EGRESS_GRANT_SCOPE_VIOLATION",
        message: "Egress grant does not allow path '/graphql'.",
      });
      expect(controlPlaneServer.requests).toEqual([]);
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop()]);
    }
  });

  it("injects basic auth with an explicit username", async () => {
    const upstreamEchoService = await startHttpEcho();
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "ghs_test_token",
    });

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_git",
      upstreamBaseUrl: upstreamEchoService.baseUrl,
      bindingId: "ibd_github",
      authInjectionType: "basic",
      authInjectionTarget: "authorization",
      authInjectionUsername: "x-access-token",
      connectionId: "icn_github",
      secretType: "github_app_installation_token",
      resolverKey: "github_app_installation_token",
      allowedMethods: ["GET"],
      allowedPathPrefixes: ["/mistlehq/mistle.git"],
    });
    const runtime = createTokenizerProxyRuntime({
      app: {
        server: {
          host,
          port,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneServer.baseUrl,
          publicBaseUrl: PublicControlPlaneBaseUrl,
        },
      },
      internalAuthServiceToken: "integration-service-token",
      egressGrantConfig: IntegrationEgressGrantConfig,
    });
    await runtime.start();

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/mistlehq/mistle.git/info/refs?service=git-upload-pack`,
        {
          method: "GET",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "X-Mistle-Egress-Connection-Id": "icn_forged",
            "X-Mistle-Egress-Upstream-Base-Url": "https://attacker.invalid",
          },
        },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        method: "GET",
        path: "/mistlehq/mistle.git/info/refs",
        query: {
          service: "git-upload-pack",
        },
      });
      if (typeof body !== "object" || body === null || !("headers" in body)) {
        throw new Error("Expected echoed response headers.");
      }
      expect(readHeaderValue(body.headers, "authorization")).toBe(
        "Basic eC1hY2Nlc3MtdG9rZW46Z2hzX3Rlc3RfdG9rZW4=",
      );
      expect(controlPlaneServer.requests).toEqual([
        {
          bindingId: "ibd_github",
          connectionId: "icn_github",
          resolverKey: "github_app_installation_token",
          secretType: "github_app_installation_token",
        },
      ]);
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamEchoService.stop()]);
    }
  }, 15_000);

  it("supports the grant-authorized egress endpoint with fixed additional headers", async () => {
    const upstreamEchoService = await startHttpEcho();
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "ghs_test_token",
    });

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_git",
      upstreamBaseUrl: upstreamEchoService.baseUrl,
      bindingId: "ibd_github",
      authInjectionType: "basic",
      authInjectionTarget: "authorization",
      authInjectionUsername: "x-access-token",
      additionalHeaders: {
        "chatgpt-account-id": "acct_from_grant",
      },
      connectionId: "icn_github",
      secretType: "github_app_installation_token",
      resolverKey: "github_app_installation_token",
      allowedMethods: ["GET"],
      allowedPathPrefixes: ["/mistlehq/mistle.git"],
    });
    const runtime = createTokenizerProxyRuntime({
      app: {
        server: {
          host,
          port,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneServer.baseUrl,
          publicBaseUrl: PublicControlPlaneBaseUrl,
        },
      },
      internalAuthServiceToken: "integration-service-token",
      egressGrantConfig: IntegrationEgressGrantConfig,
    });
    await runtime.start();

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/mistlehq/mistle.git/info/refs?service=git-upload-pack`,
        {
          method: "GET",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "ChatGPT-Account-ID": "acct_from_request",
          },
        },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        method: "GET",
        path: "/mistlehq/mistle.git/info/refs",
        query: {
          service: "git-upload-pack",
        },
      });
      if (typeof body !== "object" || body === null || !("headers" in body)) {
        throw new Error("Expected echoed response headers.");
      }
      expect(readHeaderValue(body.headers, "authorization")).toBe(
        "Basic eC1hY2Nlc3MtdG9rZW46Z2hzX3Rlc3RfdG9rZW4=",
      );
      expect(readHeaderValue(body.headers, "chatgpt-account-id")).toBe("acct_from_grant");
      expect(controlPlaneServer.requests).toEqual([
        {
          bindingId: "ibd_github",
          connectionId: "icn_github",
          resolverKey: "github_app_installation_token",
          secretType: "github_app_installation_token",
        },
      ]);
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamEchoService.stop()]);
    }
  });

  it("resolves and applies request middleware before forwarding the upstream request", async () => {
    const upstreamEchoService = await startHttpEcho();
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "slack-secret",
    });
    const sessionLinkUrl = `${PublicControlPlaneBaseUrl}/p/sessions/sandbox_123`;
    const appendSessionLinkMiddleware: ResolvedRequestMiddleware = {
      id: "append-session-link",
      handle({ ctx, request }) {
        const currentBody =
          request.body === undefined ? "" : Buffer.from(request.body).toString("utf8");
        request.headers.set("x-session-link-url", ctx.sessionUrl);
        request.body = Buffer.from(`${currentBody}\n\n${ctx.sessionUrl}`);
        return request;
      },
    };

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_slack",
      upstreamBaseUrl: upstreamEchoService.baseUrl,
      bindingId: "ibd_slack",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      connectionId: "icn_slack",
      secretType: "bot_token",
      requestMiddleware: ["append-session-link"],
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/api/chat.postMessage"],
    });
    const runtime = await startTokenizerProxyWithRequestMiddleware({
      host,
      port,
      controlPlaneBaseUrl: controlPlaneServer.baseUrl,
      resolveRequestMiddleware: createRequestMiddlewareResolver([appendSessionLinkMiddleware]),
    });

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/api/chat.postMessage`,
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "content-type": "text/plain",
          },
          body: "hello from middleware",
        },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      if (typeof body !== "object" || body === null || !("headers" in body) || !("body" in body)) {
        throw new Error("Expected echoed upstream request details.");
      }
      expect(body).toMatchObject({
        method: "POST",
        path: "/api/chat.postMessage",
        body: `hello from middleware\n\n${sessionLinkUrl}`,
      });
      expect(readHeaderValue(body.headers, "authorization")).toBe("Bearer slack-secret");
      expect(readHeaderValue(body.headers, "x-session-link-url")).toBe(sessionLinkUrl);
      expect(controlPlaneServer.requests).toEqual([
        {
          bindingId: "ibd_slack",
          connectionId: "icn_slack",
          secretType: "bot_token",
        },
      ]);
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamEchoService.stop()]);
    }
  }, 60_000);

  it("preserves the configured control-plane path prefix when building the session link URL", async () => {
    const upstreamEchoService = await startHttpEcho();
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "slack-secret",
    });
    const sessionLinkUrl =
      "https://public-control-plane.example.test/mistle/control-plane/p/sessions/sandbox_123";
    const appendSessionLinkMiddleware: ResolvedRequestMiddleware = {
      id: "append-prefixed-session-link",
      handle({ ctx, request }) {
        request.body = Buffer.from(ctx.sessionUrl);
        return request;
      },
    };

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_slack_prefixed_public_base",
      upstreamBaseUrl: upstreamEchoService.baseUrl,
      bindingId: "ibd_slack",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      connectionId: "icn_slack",
      secretType: "bot_token",
      requestMiddleware: ["append-prefixed-session-link"],
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/api/chat.postMessage"],
    });
    const runtime = await startTokenizerProxyWithRequestMiddleware({
      host,
      port,
      controlPlaneBaseUrl: controlPlaneServer.baseUrl,
      controlPlanePublicBaseUrl: "https://public-control-plane.example.test/mistle/control-plane",
      resolveRequestMiddleware: createRequestMiddlewareResolver([appendSessionLinkMiddleware]),
    });

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/api/chat.postMessage`,
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "content-type": "text/plain",
          },
          body: "ignored",
        },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        body: sessionLinkUrl,
      });
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamEchoService.stop()]);
    }
  }, 60_000);

  it("continues forwarding when request middleware cannot be resolved", async () => {
    const upstreamEchoService = await startHttpEcho();
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "ghs_test_token",
    });

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_github_comment",
      upstreamBaseUrl: upstreamEchoService.baseUrl,
      bindingId: "ibd_github",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      connectionId: "icn_github",
      secretType: "github_app_installation_token",
      resolverKey: "github_app_installation_token",
      requestMiddleware: ["missing-session-link-middleware"],
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/repos/mistlehq/mistle/issues/123/comments"],
    });
    const runtime = await startTokenizerProxyWithRequestMiddleware({
      host,
      port,
      controlPlaneBaseUrl: controlPlaneServer.baseUrl,
      resolveRequestMiddleware: createRequestMiddlewareResolver([]),
    });

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/repos/mistlehq/mistle/issues/123/comments`,
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "content-type": "text/plain",
          },
          body: "comment without resolved middleware",
        },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      if (typeof body !== "object" || body === null || !("headers" in body) || !("body" in body)) {
        throw new Error("Expected echoed upstream request details.");
      }
      expect(body).toMatchObject({
        method: "POST",
        path: "/repos/mistlehq/mistle/issues/123/comments",
        body: "comment without resolved middleware",
      });
      expect(readHeaderValue(body.headers, "authorization")).toBe("Bearer ghs_test_token");
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamEchoService.stop()]);
    }
  }, 60_000);

  it("continues forwarding when request middleware throws during execution", async () => {
    const upstreamEchoService = await startHttpEcho();
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "ghs_test_token",
    });
    const throwingMiddleware: ResolvedRequestMiddleware = {
      id: "throwing-middleware",
      handle() {
        throw new Error("middleware exploded");
      },
    };

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_github_comment_throw",
      upstreamBaseUrl: upstreamEchoService.baseUrl,
      bindingId: "ibd_github",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      connectionId: "icn_github",
      secretType: "github_app_installation_token",
      resolverKey: "github_app_installation_token",
      requestMiddleware: ["throwing-middleware"],
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/repos/mistlehq/mistle/issues/124/comments"],
    });
    const runtime = await startTokenizerProxyWithRequestMiddleware({
      host,
      port,
      controlPlaneBaseUrl: controlPlaneServer.baseUrl,
      resolveRequestMiddleware: createRequestMiddlewareResolver([throwingMiddleware]),
    });

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/repos/mistlehq/mistle/issues/124/comments`,
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "content-type": "text/plain",
          },
          body: "comment after thrown middleware",
        },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        body: "comment after thrown middleware",
      });
      if (typeof body !== "object" || body === null || !("headers" in body)) {
        throw new Error("Expected echoed upstream request details.");
      }
      expect(readHeaderValue(body.headers, "authorization")).toBe("Bearer ghs_test_token");
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamEchoService.stop()]);
    }
  }, 60_000);

  it("continues forwarding when request middleware returns an invalid URL change", async () => {
    const upstreamEchoService = await startHttpEcho();
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "ghs_test_token",
    });
    const invalidUrlMiddleware: ResolvedRequestMiddleware = {
      id: "invalid-url-middleware",
      handle({ request }) {
        request.url = new URL("https://attacker.invalid/escaped");
        return request;
      },
    };

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_github_comment_invalid_url",
      upstreamBaseUrl: upstreamEchoService.baseUrl,
      bindingId: "ibd_github",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      connectionId: "icn_github",
      secretType: "github_app_installation_token",
      resolverKey: "github_app_installation_token",
      requestMiddleware: ["invalid-url-middleware"],
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/repos/mistlehq/mistle/issues/125/comments"],
    });
    const runtime = await startTokenizerProxyWithRequestMiddleware({
      host,
      port,
      controlPlaneBaseUrl: controlPlaneServer.baseUrl,
      resolveRequestMiddleware: createRequestMiddlewareResolver([invalidUrlMiddleware]),
    });

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/repos/mistlehq/mistle/issues/125/comments`,
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "content-type": "text/plain",
          },
          body: "comment after invalid url middleware",
        },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        path: "/repos/mistlehq/mistle/issues/125/comments",
        body: "comment after invalid url middleware",
      });
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamEchoService.stop()]);
    }
  }, 60_000);

  it("runs request middleware before additional headers and auth injection", async () => {
    const upstreamEchoService = await startHttpEcho();
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "xoxb-ordering-secret",
    });
    const observePreInjectionMiddleware: ResolvedRequestMiddleware = {
      id: "observe-pre-injection-state",
      handle({ request }) {
        request.headers.set(
          "x-middleware-chatgpt-account-id",
          request.headers.get("chatgpt-account-id") ?? "missing",
        );
        request.headers.set(
          "x-middleware-authorization",
          request.headers.get("authorization") ?? "missing",
        );
        return request;
      },
    };

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_slack_ordering",
      upstreamBaseUrl: upstreamEchoService.baseUrl,
      bindingId: "ibd_slack",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      additionalHeaders: {
        "chatgpt-account-id": "acct_from_grant",
      },
      connectionId: "icn_slack",
      secretType: "bot_token",
      requestMiddleware: ["observe-pre-injection-state"],
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/api/chat.update"],
    });
    const runtime = await startTokenizerProxyWithRequestMiddleware({
      host,
      port,
      controlPlaneBaseUrl: controlPlaneServer.baseUrl,
      resolveRequestMiddleware: createRequestMiddlewareResolver([observePreInjectionMiddleware]),
    });

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/api/chat.update`,
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "content-type": "text/plain",
          },
          body: "ordering check",
        },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      if (typeof body !== "object" || body === null || !("headers" in body)) {
        throw new Error("Expected echoed upstream request headers.");
      }
      expect(readHeaderValue(body.headers, "x-middleware-chatgpt-account-id")).toBe("missing");
      expect(readHeaderValue(body.headers, "x-middleware-authorization")).toBe("missing");
      expect(readHeaderValue(body.headers, "chatgpt-account-id")).toBe("acct_from_grant");
      expect(readHeaderValue(body.headers, "authorization")).toBe("Bearer xoxb-ordering-secret");
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamEchoService.stop()]);
    }
  }, 60_000);

  it("signs the middleware-mutated request body for aws sigv4 egress", async () => {
    const upstreamEchoService = await startHttpEcho();
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      responseBody: {
        kind: "aws_session",
        accessKeyId: "ASIAEXAMPLEACCESS",
        secretAccessKey: "example-secret-access-key",
        sessionToken: "example-session-token",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    });
    const sessionLinkUrl = `${PublicControlPlaneBaseUrl}/p/sessions/sandbox_123`;
    const appendSigV4BodyMiddleware: ResolvedRequestMiddleware = {
      id: "append-session-link-before-sigv4",
      handle({ ctx, request }) {
        const currentBody =
          request.body === undefined ? "" : Buffer.from(request.body).toString("utf8");
        request.body = Buffer.from(`${currentBody}\n\n${ctx.sessionUrl}`);
        return request;
      },
    };

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_linear_sigv4",
      upstreamBaseUrl: upstreamEchoService.baseUrl,
      bindingId: "ibd_aws",
      authInjectionType: "aws_sigv4",
      authInjectionService: "execute-api",
      authInjectionRegion: "us-east-1",
      connectionId: "icn_aws",
      secretType: "aws_secret_access_key",
      resolverKey: "assume-role-session",
      requestMiddleware: ["append-session-link-before-sigv4"],
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/mcp"],
    });
    const runtime = await startTokenizerProxyWithRequestMiddleware({
      host,
      port,
      controlPlaneBaseUrl: controlPlaneServer.baseUrl,
      resolveRequestMiddleware: createRequestMiddlewareResolver([appendSigV4BodyMiddleware]),
    });

    try {
      const response = await fetch(`http://${host}:${String(port)}/tokenizer-proxy/egress/mcp`, {
        method: "POST",
        headers: {
          [EgressRequestHeaders.GRANT]: egressGrant,
          "content-type": "text/plain",
        },
        body: "linear create issue",
      });
      const body: unknown = await response.json();
      const expectedBody = `linear create issue\n\n${sessionLinkUrl}`;
      const expectedSha256 = createHash("sha256").update(expectedBody).digest("hex");

      expect(response.status).toBe(200);
      if (typeof body !== "object" || body === null || !("headers" in body) || !("body" in body)) {
        throw new Error("Expected echoed upstream request details.");
      }
      expect(body).toMatchObject({
        method: "POST",
        path: "/mcp",
        body: expectedBody,
      });
      expect(readHeaderValue(body.headers, "x-amz-content-sha256")).toBe(expectedSha256);
      expect(readHeaderValue(body.headers, "x-amz-security-token")).toBe("example-session-token");
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamEchoService.stop()]);
    }
  }, 60_000);

  it("supports additional credential-backed headers for HTTP egress", async () => {
    const upstreamEchoService = await startHttpEcho();
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "dd-secret",
    });

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_datadog",
      upstreamBaseUrl: upstreamEchoService.baseUrl,
      bindingId: "ibd_datadog",
      authInjectionType: "header",
      authInjectionTarget: "dd_api_key",
      connectionId: "icn_datadog",
      secretType: "api_key",
      slotKey: "datadog.datadog-default.api-key.api-key",
      additionalCredentialHeaders: [
        {
          header: "dd_application_key",
          connectionId: "icn_datadog",
          secretType: "api_key",
          slotKey: "datadog.datadog-default.api-key.application-key",
        },
      ],
      allowedMethods: ["GET"],
      allowedPathPrefixes: ["/mcp"],
    });
    const runtime = createTokenizerProxyRuntime({
      app: {
        server: {
          host,
          port,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneServer.baseUrl,
          publicBaseUrl: PublicControlPlaneBaseUrl,
        },
      },
      internalAuthServiceToken: "integration-service-token",
      egressGrantConfig: IntegrationEgressGrantConfig,
    });
    await runtime.start();

    try {
      const response = await fetch(`http://${host}:${String(port)}/tokenizer-proxy/egress/mcp`, {
        method: "GET",
        headers: {
          [EgressRequestHeaders.GRANT]: egressGrant,
        },
      });
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      if (typeof body !== "object" || body === null || !("headers" in body)) {
        throw new Error("Expected echoed response headers.");
      }
      expect(readHeaderValue(body.headers, "dd_api_key")).toBe("dd-secret");
      expect(readHeaderValue(body.headers, "dd_application_key")).toBe("dd-secret");
      expect(controlPlaneServer.requests).toEqual([
        {
          bindingId: "ibd_datadog",
          connectionId: "icn_datadog",
          secretType: "api_key",
          slotKey: "datadog.datadog-default.api-key.api-key",
        },
        {
          bindingId: "ibd_datadog",
          connectionId: "icn_datadog",
          secretType: "api_key",
          slotKey: "datadog.datadog-default.api-key.application-key",
        },
      ]);
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamEchoService.stop()]);
    }
  });

  it("strips proxy forwarding headers before forwarding HTTP egress upstream", async () => {
    const upstreamEchoService = await startHttpEcho();
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "sk-live-proxy",
    });

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_openai_http_forwarded",
      upstreamBaseUrl: upstreamEchoService.baseUrl,
      bindingId: "ibd_openai",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      additionalHeaders: {
        "chatgpt-account-id": "acct_from_grant",
      },
      connectionId: "icn_openai",
      secretType: "api_key",
      slotKey: "openai.openai-default.api-key.api-key",
      resolverKey: "default",
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/backend-api/codex"],
    });
    const runtime = createTokenizerProxyRuntime({
      app: {
        server: {
          host,
          port,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneServer.baseUrl,
          publicBaseUrl: PublicControlPlaneBaseUrl,
        },
      },
      internalAuthServiceToken: "integration-service-token",
      egressGrantConfig: IntegrationEgressGrantConfig,
    });
    await runtime.start();

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/backend-api/codex/responses`,
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "cf-ray": "test-cf-ray",
            "cdn-loop": "cloudflare; loops=1",
            forwarded: "for=203.0.113.1;proto=https",
            "x-forwarded-for": "203.0.113.1",
            "x-forwarded-proto": "https",
            "x-real-ip": "203.0.113.1",
          },
          body: JSON.stringify({ model: "gpt-5.4" }),
        },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      if (typeof body !== "object" || body === null || !("headers" in body)) {
        throw new Error("Expected echoed response headers.");
      }
      expect(readHeaderValue(body.headers, "authorization")).toBe("Bearer sk-live-proxy");
      expect(readHeaderValue(body.headers, "chatgpt-account-id")).toBe("acct_from_grant");
      expect(readHeaderValue(body.headers, "cf-ray")).toBeUndefined();
      expect(readHeaderValue(body.headers, "cdn-loop")).toBeUndefined();
      expect(readHeaderValue(body.headers, "forwarded")).toBeUndefined();
      expect(readHeaderValue(body.headers, "x-forwarded-for")).toBeUndefined();
      expect(readHeaderValue(body.headers, "x-forwarded-proto")).toBeUndefined();
      expect(readHeaderValue(body.headers, "x-real-ip")).toBeUndefined();
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamEchoService.stop()]);
    }
  });

  it("strips stale compression headers after forwarding a transparently decompressed upstream body", async () => {
    const upstreamService = await startGzipUpstream({
      host: "127.0.0.1",
      path: "/graphql",
      body: JSON.stringify({ data: { viewer: { login: "mistle-bot" } } }),
    });
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "ghs_test_token",
    });

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_graphql",
      upstreamBaseUrl: upstreamService.baseUrl,
      bindingId: "ibd_github",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      connectionId: "icn_github",
      secretType: "github_app_installation_token",
      resolverKey: "github_app_installation_token",
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/graphql"],
    });
    const runtime = createTokenizerProxyRuntime({
      app: {
        server: {
          host,
          port,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneServer.baseUrl,
          publicBaseUrl: PublicControlPlaneBaseUrl,
        },
      },
      internalAuthServiceToken: "integration-service-token",
      egressGrantConfig: IntegrationEgressGrantConfig,
    });
    await runtime.start();

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/graphql`,
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
          },
          body: JSON.stringify({ query: "{ viewer { login } }" }),
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-encoding")).toBeNull();
      expect(response.headers.get("content-length")).toBeNull();
      await expect(response.json()).resolves.toEqual({
        data: {
          viewer: {
            login: "mistle-bot",
          },
        },
      });
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamService.stop()]);
    }
  });

  it("signs aws sigv4 requests with temporary session credentials", async () => {
    const upstreamEchoService = await startHttpEcho();
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      responseBody: {
        kind: "aws_session",
        accessKeyId: "ASIAEXAMPLEACCESS",
        secretAccessKey: "example-secret-access-key",
        sessionToken: "example-session-token",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    });

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_aws_sm",
      upstreamBaseUrl: upstreamEchoService.baseUrl,
      bindingId: "ibd_aws",
      authInjectionType: "aws_sigv4",
      authInjectionService: "secretsmanager",
      authInjectionRegion: "us-east-1",
      connectionId: "icn_aws",
      secretType: "aws_secret_access_key",
      resolverKey: "assume-role-session",
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/"],
    });
    const runtime = createTokenizerProxyRuntime({
      app: {
        server: {
          host,
          port,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneServer.baseUrl,
          publicBaseUrl: PublicControlPlaneBaseUrl,
        },
      },
      internalAuthServiceToken: "integration-service-token",
      egressGrantConfig: IntegrationEgressGrantConfig,
    });
    await runtime.start();

    try {
      for (const requestIndex of [1, 2]) {
        const response = await fetch(`http://${host}:${String(port)}/tokenizer-proxy/egress/`, {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            requestIndex,
          }),
        });
        const body: unknown = await response.json();

        expect(response.status).toBe(200);
        if (typeof body !== "object" || body === null || !("headers" in body)) {
          throw new Error("Expected echoed response headers.");
        }

        const authorizationHeader = readHeaderValue(body.headers, "authorization");
        if (authorizationHeader === undefined) {
          throw new Error("Expected SigV4 authorization header.");
        }
        expect(authorizationHeader).toContain("AWS4-HMAC-SHA256");
        expect(authorizationHeader).toContain("Credential=ASIAEXAMPLEACCESS/");
        expect(authorizationHeader).toContain("/us-east-1/secretsmanager/aws4_request");
        expect(authorizationHeader).toContain("SignedHeaders=");
        expect(authorizationHeader).toContain("host");
        expect(authorizationHeader).toContain("x-amz-content-sha256");
        expect(authorizationHeader).toContain("x-amz-date");
        expect(authorizationHeader).toContain("x-amz-security-token");
        expect(readHeaderValue(body.headers, "x-amz-security-token")).toBe("example-session-token");
        expect(readHeaderValue(body.headers, "x-amz-date")).toBeDefined();
        expect(readHeaderValue(body.headers, "x-amz-content-sha256")).toBeDefined();
      }

      expect(controlPlaneServer.requests).toEqual([
        {
          bindingId: "ibd_aws",
          connectionId: "icn_aws",
          resolverKey: "assume-role-session",
          secretType: "aws_secret_access_key",
        },
      ]);
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamEchoService.stop()]);
    }
  }, 15_000);

  it("forwards websocket upgrades to the upstream with injected auth and fixed headers", async () => {
    const upstreamService = await startWebSocketUpstream({
      host: "127.0.0.1",
      path: "/v1/responses?stream=true",
    });
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "sk-live-proxy",
    });

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_openai",
      upstreamBaseUrl: upstreamService.baseUrl,
      bindingId: "ibd_openai",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      additionalHeaders: {
        "chatgpt-account-id": "acct_from_grant",
      },
      connectionId: "icn_openai",
      secretType: "api_key",
      slotKey: "openai.openai-default.api-key.api-key",
      resolverKey: "default",
      allowedMethods: ["GET"],
      allowedPathPrefixes: ["/v1"],
    });
    const runtime = createTokenizerProxyRuntime({
      app: {
        server: {
          host,
          port,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneServer.baseUrl,
          publicBaseUrl: PublicControlPlaneBaseUrl,
        },
      },
      internalAuthServiceToken: "integration-service-token",
      egressGrantConfig: IntegrationEgressGrantConfig,
    });
    await runtime.start();

    try {
      const message = await performUpgradeRequest({
        baseUrl: `http://${host}:${String(port)}`,
        path: "/tokenizer-proxy/egress/v1/responses?stream=true",
        headers: {
          [EgressRequestHeaders.GRANT]: egressGrant,
          "ChatGPT-Account-ID": "acct_from_request",
          "cf-ray": "test-cf-ray",
          "cdn-loop": "cloudflare; loops=1",
          forwarded: "for=203.0.113.1;proto=https",
          "x-forwarded-for": "203.0.113.1",
          "x-forwarded-proto": "https",
          "x-real-ip": "203.0.113.1",
        },
      });

      expect(message).toBe("pong\n");
      expect(upstreamService.capturedAuthorizationHeader()).toBe("Bearer sk-live-proxy");
      expect(upstreamService.capturedChatGptAccountIdHeader()).toBe("acct_from_grant");
      expect(upstreamService.capturedHeaders()?.["cf-ray"]).toBeUndefined();
      expect(upstreamService.capturedHeaders()?.["cdn-loop"]).toBeUndefined();
      expect(upstreamService.capturedHeaders()?.forwarded).toBeUndefined();
      expect(upstreamService.capturedHeaders()?.["x-forwarded-for"]).toBeUndefined();
      expect(upstreamService.capturedHeaders()?.["x-forwarded-proto"]).toBeUndefined();
      expect(upstreamService.capturedHeaders()?.["x-real-ip"]).toBeUndefined();
      expect(controlPlaneServer.requests).toEqual([
        {
          bindingId: "ibd_openai",
          connectionId: "icn_openai",
          resolverKey: "default",
          secretType: "api_key",
          slotKey: "openai.openai-default.api-key.api-key",
        },
      ]);
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamService.stop()]);
    }
  });

  it("supports additional credential-backed headers for websocket egress", async () => {
    const upstreamService = await startWebSocketUpstream({
      host: "127.0.0.1",
      path: "/mcp",
    });
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "dd-secret",
    });

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const egressGrant = await mintIntegrationEgressGrant({
      egressRuleId: "egress_rule_datadog_ws",
      upstreamBaseUrl: upstreamService.baseUrl,
      bindingId: "ibd_datadog",
      authInjectionType: "header",
      authInjectionTarget: "dd_api_key",
      connectionId: "icn_datadog",
      secretType: "api_key",
      slotKey: "datadog.datadog-default.api-key.api-key",
      additionalCredentialHeaders: [
        {
          header: "dd_application_key",
          connectionId: "icn_datadog",
          secretType: "api_key",
          slotKey: "datadog.datadog-default.api-key.application-key",
        },
      ],
      allowedMethods: ["GET"],
      allowedPathPrefixes: ["/mcp"],
    });
    const runtime = createTokenizerProxyRuntime({
      app: {
        server: {
          host,
          port,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneServer.baseUrl,
          publicBaseUrl: PublicControlPlaneBaseUrl,
        },
      },
      internalAuthServiceToken: "integration-service-token",
      egressGrantConfig: IntegrationEgressGrantConfig,
    });
    await runtime.start();

    try {
      const message = await performUpgradeRequest({
        baseUrl: `http://${host}:${String(port)}`,
        path: "/tokenizer-proxy/egress/mcp",
        headers: {
          [EgressRequestHeaders.GRANT]: egressGrant,
        },
      });

      expect(message).toBe("pong\n");
      expect(readHeaderValue(upstreamService.capturedHeaders(), "dd_api_key")).toBe("dd-secret");
      expect(readHeaderValue(upstreamService.capturedHeaders(), "dd_application_key")).toBe(
        "dd-secret",
      );
      expect(controlPlaneServer.requests).toEqual([
        {
          bindingId: "ibd_datadog",
          connectionId: "icn_datadog",
          secretType: "api_key",
          slotKey: "datadog.datadog-default.api-key.api-key",
        },
        {
          bindingId: "ibd_datadog",
          connectionId: "icn_datadog",
          secretType: "api_key",
          slotKey: "datadog.datadog-default.api-key.application-key",
        },
      ]);
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamService.stop()]);
    }
  });
});
