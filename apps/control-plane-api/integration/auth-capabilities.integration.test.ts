import { describe, expect } from "vitest";

import { createControlPlaneApiRuntime } from "../src/main.js";
import type { ControlPlaneApiConfig } from "../src/types.js";
import { it } from "./test-context.js";

describe("auth capabilities integration", () => {
  it("reports google as disabled when no google auth config is present", async ({ fixture }) => {
    const response = await fixture.request("/v1/auth/capabilities");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      methods: {
        emailOtp: true,
        google: false,
      },
    });
  });

  it("reports google as enabled when google auth config is present", async ({ fixture }) => {
    const runtimeConfig: ControlPlaneApiConfig = {
      ...fixture.config,
      auth: {
        ...fixture.config.auth,
        google: {
          clientId: "integration-google-client-id",
          clientSecret: "integration-google-client-secret",
        },
      },
    };
    const runtime = await createControlPlaneApiRuntime({
      app: runtimeConfig,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      },
    });

    try {
      const response = await runtime.request("/v1/auth/capabilities");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        methods: {
          emailOtp: true,
          google: true,
        },
      });
    } finally {
      await runtime.stop();
    }
  });
});
