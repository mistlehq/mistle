import { reserveAvailablePort } from "@mistle/test-harness";
import { describe, expect } from "vitest";

import { createApp, stopApp } from "../src/app.js";
import { createControlPlaneApiRuntime } from "../src/runtime/index.js";
import { getAppDatabase } from "../src/runtime/resources.js";
import type { ControlPlaneApiConfig } from "../src/types.js";
import { it } from "./test-context.js";

const IntegrationConnectionTokenConfig = {
  secret: "integration-connection-secret",
  issuer: "integration-issuer",
  audience: "integration-audience",
} as const;

const IntegrationSandboxRuntimeConfig = {
  defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
  gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
} as const;

function createRuntimeConfigWithPort(input: {
  config: ControlPlaneApiConfig;
  host: string;
  port: number;
}): ControlPlaneApiConfig {
  const baseUrl = `http://${input.host}:${String(input.port)}`;

  return {
    ...input.config,
    server: {
      ...input.config.server,
      host: input.host,
      port: input.port,
    },
    auth: {
      ...input.config.auth,
      baseUrl,
      trustedOrigins: [baseUrl],
    },
  };
}

describe("runtime lifecycle integration", () => {
  it("enforces start/stop runtime lifecycle semantics", async ({ fixture }) => {
    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const runtime = await createControlPlaneApiRuntime({
      app: createRuntimeConfigWithPort({
        config: fixture.config,
        host,
        port,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: IntegrationConnectionTokenConfig,
      sandbox: IntegrationSandboxRuntimeConfig,
    });

    try {
      await runtime.start();
      const healthURL = `http://${host}:${String(port)}/__healthz`;
      const healthResponse = await fetch(healthURL);
      expect(healthResponse.status).toBe(200);

      await expect(runtime.start()).rejects.toThrow("Control plane API server is already started.");

      await Promise.all([runtime.stop(), runtime.stop(), runtime.stop()]);
      await expect(runtime.start()).rejects.toThrow(
        "Control plane API runtime is already stopped.",
      );
    } finally {
      await runtime.stop();
    }
  });

  it("serves health checks over HTTP when started and closes listener on stop", async ({
    fixture,
  }) => {
    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const runtime = await createControlPlaneApiRuntime({
      app: createRuntimeConfigWithPort({
        config: fixture.config,
        host,
        port,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: IntegrationConnectionTokenConfig,
      sandbox: IntegrationSandboxRuntimeConfig,
    });
    const healthURL = `http://${host}:${String(port)}/__healthz`;

    await runtime.start();

    try {
      const response = await fetch(healthURL);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
      });
    } finally {
      await runtime.stop();
    }

    await expect(fetch(healthURL)).rejects.toThrow();
  });

  it("releases app resources after stopApp", async ({ fixture }) => {
    const app = await createApp({
      app: fixture.config,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: IntegrationConnectionTokenConfig,
      sandbox: IntegrationSandboxRuntimeConfig,
    });
    expect(getAppDatabase(app)).toBeDefined();

    await stopApp(app);

    expect(() => getAppDatabase(app)).toThrow("Control plane app instance is unknown.");
  });
});
