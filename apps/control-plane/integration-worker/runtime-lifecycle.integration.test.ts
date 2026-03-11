import { reserveAvailablePort } from "@mistle/test-harness";
import { describe, expect } from "vitest";

import { createControlPlaneWorkerRuntime } from "../src/worker/runtime/index.js";
import type { ControlPlaneWorkerConfig } from "../src/worker/types.js";
import { it } from "./test-context.js";

function createRuntimeConfigWithPort(input: {
  config: ControlPlaneWorkerConfig;
  host: string;
  port: number;
}): ControlPlaneWorkerConfig {
  return {
    ...input.config,
    server: {
      ...input.config.server,
      host: input.host,
      port: input.port,
    },
  };
}

describe("runtime lifecycle integration", () => {
  it("enforces start/stop runtime lifecycle semantics", async ({ fixture }) => {
    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const runtime = await createControlPlaneWorkerRuntime({
      app: createRuntimeConfigWithPort({
        config: fixture.config,
        host,
        port,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      },
    });

    try {
      await runtime.start();
      const healthURL = `http://${host}:${String(port)}/__healthz`;
      const healthResponse = await fetch(healthURL);
      expect(healthResponse.status).toBe(200);

      await expect(runtime.start()).rejects.toThrowError(
        "Control plane worker runtime is already started.",
      );

      await Promise.all([runtime.stop(), runtime.stop(), runtime.stop()]);
      await expect(runtime.start()).rejects.toThrowError(
        "Control plane worker runtime is already stopped.",
      );
    } finally {
      await runtime.stop();
    }
  }, 60_000);

  it("serves health checks over HTTP when started and closes listener on stop", async ({
    fixture,
  }) => {
    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const runtime = await createControlPlaneWorkerRuntime({
      app: createRuntimeConfigWithPort({
        config: fixture.config,
        host,
        port,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      },
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

    await expect(fetch(healthURL)).rejects.toThrowError("fetch failed");
  }, 60_000);
});
