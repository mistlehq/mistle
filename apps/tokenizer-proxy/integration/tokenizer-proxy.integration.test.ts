/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { reserveAvailablePort, startHttpEcho } from "@mistle/test-core";
import { describe, expect } from "vitest";

import { EgressRequestHeaders } from "../src/egress/constants.js";
import { createTokenizerProxyRuntime } from "../src/runtime/index.js";
import { it } from "./test-context.js";

describe("tokenizer proxy integration", () => {
  it("returns healthy status on /__healthz", async ({ fixture }) => {
    const response = await fetch(`${fixture.baseUrl}/__healthz`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it("returns 502 when control-plane credential resolution fails", async () => {
    const controlPlaneEchoService = await startHttpEcho();

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const runtime = createTokenizerProxyRuntime({
      app: {
        server: {
          host,
          port,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneEchoService.baseUrl,
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
      await Promise.all([runtime.stop(), controlPlaneEchoService.stop()]);
    }
  });
});
