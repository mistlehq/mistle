import { reserveAvailablePort } from "@mistle/test-harness";
import { describe, expect } from "vitest";

import { createApp, getAppDatabase, stopApp } from "../src/app.js";
import { createControlPlaneApiRuntime } from "../src/runtime.js";
import { createRuntimeConfigWithPort } from "./config.js";
import { it } from "./test-context.js";

describe("runtime lifecycle integration", () => {
  it("enforces start/stop runtime lifecycle semantics", async ({ fixture }) => {
    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const runtime = await createControlPlaneApiRuntime(
      createRuntimeConfigWithPort({
        config: fixture.config,
        host,
        port,
      }),
    );

    try {
      runtime.start();
      const healthURL = `http://${host}:${String(port)}/__healthz`;
      const healthResponse = await fetch(healthURL);
      expect(healthResponse.status).toBe(200);

      expect(() => runtime.start()).toThrowError("Control plane API server is already started.");

      await Promise.all([runtime.stop(), runtime.stop(), runtime.stop()]);
      expect(() => runtime.start()).toThrowError("Control plane API runtime is already stopped.");
    } finally {
      await runtime.stop();
    }
  }, 60_000);

  it("serves health checks over HTTP when started and closes listener on stop", async ({
    fixture,
  }) => {
    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const runtime = await createControlPlaneApiRuntime(
      createRuntimeConfigWithPort({
        config: fixture.config,
        host,
        port,
      }),
    );
    const healthURL = `http://${host}:${String(port)}/__healthz`;

    runtime.start();

    try {
      const response = await fetch(healthURL);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
      });
    } finally {
      await runtime.stop();
    }

    await expect(fetch(healthURL)).rejects.toThrowError();
  }, 60_000);

  it("releases app resources after stopApp", async ({ fixture }) => {
    const app = await createApp(fixture.config);
    expect(getAppDatabase(app)).toBeDefined();

    await stopApp(app);

    expect(() => getAppDatabase(app)).toThrowError("Control plane app instance is unknown.");
  }, 60_000);
});
