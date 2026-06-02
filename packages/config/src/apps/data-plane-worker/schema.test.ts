import { describe, expect, it } from "vitest";

import {
  DataPlaneWorkerConfigSchema,
  type DataPlaneWorkerConfig,
  DataPlaneWorkerSandboxConfigSchema,
  getDataPlaneWorkerSandboxProviderValidationIssue,
} from "./schema.js";

const SandboxTokenConfig: DataPlaneWorkerConfig["sandbox"]["bootstrap"] = {
  tokenSecret: "sandbox-token-secret",
  tokenIssuer: "mistle",
  tokenAudience: "sandbox",
};

const DisabledTelemetryConfig: DataPlaneWorkerConfig["telemetry"] = {
  enabled: false,
  debug: false,
};

describe("DataPlaneWorkerSandboxConfigSchema", () => {
  it("defaults the E2B domain to the hosted cloud domain", () => {
    const parsed = DataPlaneWorkerSandboxConfigSchema.parse({
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: SandboxTokenConfig,
      e2b: {
        enabled: true,
        apiKey: "test-api-key",
      },
    });

    expect(parsed).toEqual({
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: SandboxTokenConfig,
      e2b: {
        enabled: true,
        apiKey: "test-api-key",
        domain: "e2b.app",
        cpuCount: 2,
        memoryMb: 4096,
      },
    });
  });

  it("parses E2B sandbox settings", () => {
    const parsed = DataPlaneWorkerSandboxConfigSchema.parse({
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: SandboxTokenConfig,
      sandboxdTestFaultsEnabled: true,
      e2b: {
        enabled: true,
        apiKey: "test-api-key",
        domain: "e2b.example.com",
        cpuCount: 4,
        memoryMb: 16384,
      },
    });

    expect(parsed).toEqual({
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: SandboxTokenConfig,
      sandboxdTestFaultsEnabled: true,
      e2b: {
        enabled: true,
        apiKey: "test-api-key",
        domain: "e2b.example.com",
        cpuCount: 4,
        memoryMb: 16384,
      },
    });
  });

  it("accepts disabled Docker settings without enabling Docker execution", () => {
    const parsed = DataPlaneWorkerSandboxConfigSchema.parse({
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: SandboxTokenConfig,
      docker: {
        enabled: false,
        socketPath: "/var/run/docker.sock",
        networkName: "mistle-sandbox-dev",
      },
    });

    expect(parsed.docker).toEqual({
      enabled: false,
      socketPath: "/var/run/docker.sock",
      networkName: "mistle-sandbox-dev",
    });
  });

  it("accepts the optional sandboxd test faults toggle", () => {
    const parsed = DataPlaneWorkerSandboxConfigSchema.parse({
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: SandboxTokenConfig,
      sandboxdTestFaultsEnabled: true,
    });

    expect(parsed).toEqual({
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: SandboxTokenConfig,
      sandboxdTestFaultsEnabled: true,
    });
  });

  it("requires control-plane API config on the full worker config", () => {
    expect(() =>
      DataPlaneWorkerConfigSchema.parse({
        database: {
          url: "postgresql://127.0.0.1/mistle",
        },
        workflow: {
          databaseUrl: "postgresql://127.0.0.1/mistle",
          namespaceId: "development",
          runMigrations: true,
          concurrency: 1,
          databasePoolMax: 2,
        },
        runtimeState: {
          gatewayBaseUrl: "http://127.0.0.1:5202",
        },
        sandbox: {
          internalGatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
          bootstrap: SandboxTokenConfig,
        },
        internalAuth: {
          serviceToken: "internal-service-token",
        },
        telemetry: DisabledTelemetryConfig,
      }),
    ).toThrow(/controlPlaneApi/);
  });
});

describe("getDataPlaneWorkerSandboxProviderValidationIssue", () => {
  it("does not require a singleton sandbox provider", () => {
    const issue = getDataPlaneWorkerSandboxProviderValidationIssue({
      appSandbox: {
        internalGatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
        bootstrap: SandboxTokenConfig,
      },
    });

    expect(issue).toBeNull();
  });

  it("does not require E2B credentials for the data-plane worker", () => {
    const issue = getDataPlaneWorkerSandboxProviderValidationIssue({
      appSandbox: {
        internalGatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
        bootstrap: SandboxTokenConfig,
      },
    });

    expect(issue).toBeNull();
  });
});
