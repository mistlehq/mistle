/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { gzipSync } from "node:zlib";

import { mintEgressGrant } from "@mistle/sandbox-egress-auth";
import { reserveAvailablePort, startHttpEcho } from "@mistle/test-harness";
import { describe, expect } from "vitest";

import { EgressRequestHeaders } from "../src/egress/constants.js";
import { createTokenizerProxyRuntime } from "../src/runtime/index.js";
import { it } from "./test-context.js";

const ControlPlaneInternalAuthHeader = "x-mistle-service-token";

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

async function mintIntegrationEgressGrant(input: {
  egressRuleId: string;
  upstreamBaseUrl: string;
  bindingId: string;
  authInjectionType: "bearer" | "basic" | "header" | "query";
  authInjectionTarget: string;
  authInjectionUsername?: string;
  connectionId: string;
  secretType: string;
  purpose?: string;
  resolverKey?: string;
  allowedMethods?: ReadonlyArray<string>;
  allowedPathPrefixes?: ReadonlyArray<string>;
}): Promise<string> {
  return await mintEgressGrant({
    config: IntegrationEgressGrantConfig,
    claims: {
      sub: "sandbox_123",
      jti: input.egressRuleId,
      bindingId: input.bindingId,
      connectionId: input.connectionId,
      secretType: input.secretType,
      upstreamBaseUrl: input.upstreamBaseUrl,
      authInjectionType: input.authInjectionType,
      authInjectionTarget: input.authInjectionTarget,
      ...(input.authInjectionUsername === undefined
        ? {}
        : { authInjectionUsername: input.authInjectionUsername }),
      ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
      ...(input.resolverKey === undefined ? {} : { resolverKey: input.resolverKey }),
      ...(input.allowedMethods === undefined ? {} : { allowedMethods: input.allowedMethods }),
      ...(input.allowedPathPrefixes === undefined
        ? {}
        : { allowedPathPrefixes: input.allowedPathPrefixes }),
    },
    ttlSeconds: 60,
  });
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
  credentialValue: string;
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
        value: input.credentialValue,
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
  capturedAuthorizationHeader: () => string | undefined;
  stop: () => Promise<void>;
}> {
  const port = await reserveAvailablePort({ host: input.host });
  let authorizationHeader: string | undefined;

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

    authorizationHeader =
      typeof request.headers.authorization === "string"
        ? request.headers.authorization
        : request.headers.authorization?.[0];

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
    capturedAuthorizationHeader: () => authorizationHeader,
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

  it("supports the grant-authorized egress endpoint", async () => {
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

  it("forwards websocket upgrades to the upstream with injected auth", async () => {
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
      connectionId: "icn_openai",
      secretType: "api_key",
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
        },
      });

      expect(message).toBe("pong\n");
      expect(upstreamService.capturedAuthorizationHeader()).toBe("Bearer sk-live-proxy");
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamService.stop()]);
    }
  });
});
