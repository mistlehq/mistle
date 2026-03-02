/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { reserveAvailablePort, startHttpEcho } from "@mistle/test-core";
import { describe, expect } from "vitest";

import { EgressRequestHeaders } from "../src/egress/constants.js";
import { createTokenizerProxyRuntime } from "../src/runtime/index.js";
import { it } from "./test-context.js";

type StartedHttpServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

async function startHttpServer(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void,
): Promise<StartedHttpServer> {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch((error) => {
      response.statusCode = 500;
      response.end(`server_error:${error instanceof Error ? error.message : "unknown"}`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
    server.on("error", reject);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected server to listen on an inet address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: async () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }
          reject(error);
        });
      }),
  };
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

describe("tokenizer proxy integration", () => {
  it("returns healthy status on /__healthz", async ({ fixture }) => {
    const response = await fetch(`${fixture.baseUrl}/__healthz`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it("resolves credential from control-plane and forwards upstream with bearer auth", async () => {
    const observed = {
      resolveAuthorizationHeader: "",
    };

    const controlPlaneServer = await startHttpServer(async (request, response) => {
      if (
        request.method !== "POST" ||
        request.url !== "/internal/integration-credentials/resolve"
      ) {
        response.statusCode = 404;
        response.end("not_found");
        return;
      }

      observed.resolveAuthorizationHeader =
        request.headers["x-mistle-service-token"]?.toString() ?? "";

      response.setHeader("content-type", "application/json");
      response.statusCode = 200;
      response.end(JSON.stringify({ value: "resolved-credential-token" }));
    });

    const upstreamEchoService = await startHttpEcho();

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
        credentialResolver: {
          requestTimeoutMs: 3000,
        },
        cache: {
          maxEntries: 64,
          defaultTtlSeconds: 60,
          refreshSkewSeconds: 10,
        },
      },
      internalAuthServiceToken: "integration-service-token",
    });

    await runtime.start();

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/routes/route_123/v1/responses?stream=true`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [EgressRequestHeaders.UPSTREAM_BASE_URL]: `${upstreamEchoService.baseUrl}/v1`,
            [EgressRequestHeaders.AUTH_INJECTION_TYPE]: "bearer",
            [EgressRequestHeaders.AUTH_INJECTION_TARGET]: "authorization",
            [EgressRequestHeaders.CONNECTION_ID]: "icn_test",
            [EgressRequestHeaders.CREDENTIAL_SECRET_TYPE]: "api_key",
          },
          body: JSON.stringify({
            model: "gpt-test",
          }),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Reflect.get(body, "method")).toBe("POST");
      expect(Reflect.get(body, "path")).toBe("/v1/responses");
      expect(readHeaderValue(Reflect.get(body, "headers"), "authorization")).toBe(
        "Bearer resolved-credential-token",
      );
      expect(Reflect.get(body, "body")).toBe('{"model":"gpt-test"}');
      expect(observed.resolveAuthorizationHeader).toBe("integration-service-token");
    } finally {
      await Promise.all([runtime.stop(), controlPlaneServer.close(), upstreamEchoService.stop()]);
    }
  }, 60_000);

  it("returns 502 when control-plane credential resolution fails", async () => {
    const controlPlaneServer = await startHttpServer((request, response) => {
      if (
        request.method !== "POST" ||
        request.url !== "/internal/integration-credentials/resolve"
      ) {
        response.statusCode = 404;
        response.end("not_found");
        return;
      }

      response.setHeader("content-type", "application/json");
      response.statusCode = 404;
      response.end(
        JSON.stringify({
          code: "CREDENTIAL_NOT_FOUND",
          message: "No active integration credential was found for this secret type.",
        }),
      );
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
        credentialResolver: {
          requestTimeoutMs: 3000,
        },
        cache: {
          maxEntries: 64,
          defaultTtlSeconds: 60,
          refreshSkewSeconds: 10,
        },
      },
      internalAuthServiceToken: "integration-service-token",
    });
    await runtime.start();

    try {
      const response = await fetch(
        `http://${host}:${String(port)}/tokenizer-proxy/egress/routes/route_123/v1/responses`,
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.UPSTREAM_BASE_URL]: "https://api.example.com",
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
      await Promise.all([runtime.stop(), controlPlaneServer.close()]);
    }
  });
});
