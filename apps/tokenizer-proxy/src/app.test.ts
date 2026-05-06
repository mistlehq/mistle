import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import type { TokenizerProxyConfig } from "./types.js";

describe("tokenizer proxy app", () => {
  it("does not expose test-environment egress routes outside test isolation", async () => {
    const app = createApp(createConfig());

    const response = await app.request(
      "/__test-environments/test-env/tokenizer-proxy/egress/v1/responses",
    );

    expect(response.status).toBe(404);
  });

  it("exposes test-environment egress routes when test isolation is enabled", async () => {
    const app = createApp({
      ...createConfig(),
      __dangerouslyEnableTestIsolation: {
        testEnvironmentIdHeader: "x-mistle-test-environment-id",
      },
    });

    const response = await app.request(
      "/__test-environments/test-env/tokenizer-proxy/egress/v1/responses",
    );

    expect(response.status).not.toBe(404);
  });
});

function createConfig(): TokenizerProxyConfig {
  return {
    server: {
      host: "127.0.0.1",
      port: 5005,
    },
    controlPlaneApi: {
      baseUrl: "http://127.0.0.1:5000",
      publicBaseUrl: "http://127.0.0.1:5000",
    },
    internalAuth: {
      serviceToken: "test-service-token",
    },
    egressGrant: {
      tokenSecret: "test-egress-token-secret",
      tokenIssuer: "test-egress-token-issuer",
      tokenAudience: "test-egress-token-audience",
    },
  };
}
