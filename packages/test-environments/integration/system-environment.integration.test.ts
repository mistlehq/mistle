import { describe, expect, test } from "vitest";

import { startSystemEnvironment } from "../src/index.js";

describe("system environment", () => {
  test("starts backend services and serves HTTP health checks", async () => {
    const environment = await startSystemEnvironment();

    try {
      const controlPlaneHealthResponse = await environment.requestControlPlane("/__healthz");
      expect(controlPlaneHealthResponse.status).toBe(200);
      await expect(controlPlaneHealthResponse.json()).resolves.toEqual({ ok: true });

      const dataPlaneHealthResponse = await environment.requestDataPlane("/__healthz");
      expect(dataPlaneHealthResponse.status).toBe(200);
      await expect(dataPlaneHealthResponse.json()).resolves.toEqual({ ok: true });
    } finally {
      await environment.stop();
    }

    await expect(environment.stop()).rejects.toThrowError(
      "System environment was already stopped.",
    );
  }, 120_000);
});
