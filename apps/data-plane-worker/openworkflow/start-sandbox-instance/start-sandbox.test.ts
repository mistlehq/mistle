import { describe, expect, it } from "vitest";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { createSandboxRuntimeEnv } from "./start-sandbox.js";

function createTestRuntimeConfig(input: {
  sandboxdTestFaultsEnabled?: boolean;
}): DataPlaneWorkerRuntimeConfig {
  const sandbox: DataPlaneWorkerRuntimeConfig["sandbox"] = {
    provider: "docker",
    internalGatewayWsUrl: "ws://gateway/tunnel/sandbox",
    bootstrap: {
      tokenSecret: "bootstrap-secret",
      tokenIssuer: "issuer",
      tokenAudience: "audience",
    },
    ...(input.sandboxdTestFaultsEnabled === undefined
      ? {}
      : { sandboxdTestFaultsEnabled: input.sandboxdTestFaultsEnabled }),
  };
  const telemetry: DataPlaneWorkerRuntimeConfig["telemetry"] = {
    enabled: false,
    debug: false,
  };

  return {
    app: {
      database: {
        url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
      },
      workflow: {
        databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
        namespaceId: "development",
        runMigrations: false,
        concurrency: 1,
      },
      runtimeState: {
        gatewayBaseUrl: "http://127.0.0.1:5202",
      },
      controlPlaneApi: {
        baseUrl: "http://127.0.0.1:5100",
      },
      sandbox,
      internalAuth: {
        serviceToken: "internal-service-token",
      },
      telemetry,
    },
    sandbox,
    telemetry,
  };
}

describe("createSandboxRuntimeEnv", () => {
  it("includes the sandboxd test faults env when the worker config enables it", () => {
    const runtimeEnv = createSandboxRuntimeEnv({
      config: createTestRuntimeConfig({ sandboxdTestFaultsEnabled: true }),
      processEnv: {},
      sandboxInstanceId: "sbi_123",
    });

    expect(runtimeEnv).toEqual({
      SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID: "sbi_123",
      MISTLE_SANDBOXD_ENABLE_TEST_FAULTS: "1",
    });
  });

  it("omits the sandboxd test faults env when the worker config leaves it disabled", () => {
    const runtimeEnv = createSandboxRuntimeEnv({
      config: createTestRuntimeConfig({}),
      processEnv: {},
      sandboxInstanceId: "sbi_123",
    });

    expect(runtimeEnv).toEqual({
      SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID: "sbi_123",
    });
  });

  it("propagates the gateway proxy env when the worker process enables local gateway proxying", () => {
    const runtimeEnv = createSandboxRuntimeEnv({
      config: createTestRuntimeConfig({}),
      processEnv: { GATEWAY_PROXY_ENABLED: "1" },
      sandboxInstanceId: "sbi_123",
    });

    expect(runtimeEnv).toEqual({
      SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID: "sbi_123",
      GATEWAY_PROXY_ENABLED: "1",
    });
  });

  it("rejects invalid gateway proxy env values instead of silently changing sandbox networking", () => {
    expect(() =>
      createSandboxRuntimeEnv({
        config: createTestRuntimeConfig({}),
        processEnv: { GATEWAY_PROXY_ENABLED: "true" },
        sandboxInstanceId: "sbi_123",
      }),
    ).toThrow("GATEWAY_PROXY_ENABLED must be '1' when set.");
  });
});
