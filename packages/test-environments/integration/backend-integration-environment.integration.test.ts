import { describe, expect, test } from "vitest";

import { resolveIntegrationComponents, startIntegrationEnvironment } from "../src/index.js";

describe("control-plane integration environment", () => {
  test("resolves required components in startup order", () => {
    const components = resolveIntegrationComponents(["sandbox-profiles-crud", "auth-otp"]);

    expect(components).toEqual([
      "postgres-stack",
      "mailpit",
      "workflow-backend",
      "control-plane-api-runtime",
      "control-plane-worker-runtime",
    ]);
  });

  test("requires at least one capability", () => {
    expect(() => resolveIntegrationComponents([])).toThrowError(
      "At least one control-plane integration capability is required.",
    );
  });

  test("starts and stops dependencies in integration mode", async () => {
    const environment = await startIntegrationEnvironment({
      capabilities: ["members-directory"],
    });

    try {
      expect(environment.requiredComponents).toEqual([
        "postgres-stack",
        "workflow-backend",
        "control-plane-api-runtime",
      ]);
      expect(environment.mailpitService).toBeNull();
      expect(environment.workerRuntime).toBeNull();

      const response = await environment.request("/__healthz");
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    } finally {
      await environment.stop();
    }

    await expect(environment.stop()).rejects.toThrowError(
      "Control-plane integration environment was already stopped.",
    );
  }, 90_000);
});
