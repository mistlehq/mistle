/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";

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

describe("tokenizer proxy integration", () => {
  it("returns healthy status on /__healthz", async ({ fixture }) => {
    const response = await fetch(`${fixture.baseUrl}/__healthz`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
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
    });
    await runtime.start();

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/v1/responses`,
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.EGRESS_RULE_ID]: "egress_rule_123",
            [EgressRequestHeaders.UPSTREAM_BASE_URL]: "https://api.example.com",
            [EgressRequestHeaders.BINDING_ID]: "ibd_missing",
            [EgressRequestHeaders.AUTH_INJECTION_TYPE]: "bearer",
            [EgressRequestHeaders.AUTH_INJECTION_TARGET]: "authorization",
            [EgressRequestHeaders.CONNECTION_ID]: "icn_missing",
            [EgressRequestHeaders.CREDENTIAL_SECRET_TYPE]: "api_key",
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

  it("injects basic auth with an explicit username", async () => {
    const upstreamEchoService = await startHttpEcho();
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "ghs_test_token",
    });

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
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
    });
    await runtime.start();

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/mistlehq/mistle.git/info/refs?service=git-upload-pack`,
        {
          method: "GET",
          headers: {
            [EgressRequestHeaders.EGRESS_RULE_ID]: "egress_rule_git",
            [EgressRequestHeaders.UPSTREAM_BASE_URL]: upstreamEchoService.baseUrl,
            [EgressRequestHeaders.BINDING_ID]: "ibd_github",
            [EgressRequestHeaders.AUTH_INJECTION_TYPE]: "basic",
            [EgressRequestHeaders.AUTH_INJECTION_TARGET]: "authorization",
            [EgressRequestHeaders.AUTH_INJECTION_USERNAME]: "x-access-token",
            [EgressRequestHeaders.CONNECTION_ID]: "icn_github",
            [EgressRequestHeaders.CREDENTIAL_SECRET_TYPE]: "oauth_access_token",
            [EgressRequestHeaders.CREDENTIAL_RESOLVER_KEY]: "github_app_installation_token",
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
          secretType: "oauth_access_token",
        },
      ]);
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.stop(), upstreamEchoService.stop()]);
    }
  });

  it("supports the header-addressed egress endpoint", async () => {
    const upstreamEchoService = await startHttpEcho();
    const controlPlaneServer = await startControlPlaneCredentialServer({
      host: "127.0.0.1",
      serviceToken: "integration-service-token",
      credentialValue: "ghs_test_token",
    });

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
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
    });
    await runtime.start();

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/mistlehq/mistle.git/info/refs?service=git-upload-pack`,
        {
          method: "GET",
          headers: {
            [EgressRequestHeaders.EGRESS_RULE_ID]: "egress_rule_git",
            [EgressRequestHeaders.UPSTREAM_BASE_URL]: upstreamEchoService.baseUrl,
            [EgressRequestHeaders.BINDING_ID]: "ibd_github",
            [EgressRequestHeaders.AUTH_INJECTION_TYPE]: "basic",
            [EgressRequestHeaders.AUTH_INJECTION_TARGET]: "authorization",
            [EgressRequestHeaders.AUTH_INJECTION_USERNAME]: "x-access-token",
            [EgressRequestHeaders.CONNECTION_ID]: "icn_github",
            [EgressRequestHeaders.CREDENTIAL_SECRET_TYPE]: "oauth_access_token",
            [EgressRequestHeaders.CREDENTIAL_RESOLVER_KEY]: "github_app_installation_token",
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
          secretType: "oauth_access_token",
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
    });
    await runtime.start();

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/graphql`,
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.EGRESS_RULE_ID]: "egress_rule_graphql",
            [EgressRequestHeaders.UPSTREAM_BASE_URL]: upstreamService.baseUrl,
            [EgressRequestHeaders.BINDING_ID]: "ibd_github",
            [EgressRequestHeaders.AUTH_INJECTION_TYPE]: "bearer",
            [EgressRequestHeaders.AUTH_INJECTION_TARGET]: "authorization",
            [EgressRequestHeaders.CONNECTION_ID]: "icn_github",
            [EgressRequestHeaders.CREDENTIAL_SECRET_TYPE]: "oauth_access_token",
            [EgressRequestHeaders.CREDENTIAL_RESOLVER_KEY]: "github_app_installation_token",
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
});
