import { describe, expect, it } from "vitest";

import {
  DataPlaneApiConfigSchema,
  DataPlaneApiSandboxConfigSchema,
  getDataPlaneApiSandboxProviderValidationIssue,
} from "./schema.js";

describe("DataPlaneApiSandboxConfigSchema", () => {
  it("defaults the E2B domain to the hosted cloud domain", () => {
    const parsed = DataPlaneApiSandboxConfigSchema.parse({
      e2b: {
        enabled: true,
        apiKey: "test-api-key",
      },
    });

    expect(parsed).toEqual({
      e2b: {
        enabled: true,
        apiKey: "test-api-key",
        domain: "e2b.app",
      },
    });
  });

  it("accepts control-plane API config alongside sandbox config", () => {
    const parsed = DataPlaneApiConfigSchema.parse({
      server: {
        host: "127.0.0.1",
        port: 5200,
      },
      database: {
        url: "postgresql://127.0.0.1/mistle",
        migrationUrl: "postgresql://127.0.0.1/mistle",
      },
      workflow: {
        databaseUrl: "postgresql://127.0.0.1/mistle",
        namespaceId: "development",
      },
      runtimeState: {
        gatewayBaseUrl: "http://127.0.0.1:5202",
      },
      controlPlaneApi: {
        baseUrl: "http://127.0.0.1:5100",
      },
      sandbox: {
        docker: {
          enabled: true,
          socketPath: "/var/run/docker.sock",
        },
      },
      internalAuth: {
        serviceToken: "test-service-token",
      },
    });

    expect(parsed.controlPlaneApi).toEqual({
      baseUrl: "http://127.0.0.1:5100",
    });
  });

  it("accepts disabled Docker settings without enabling Docker runtime inspection", () => {
    const parsed = DataPlaneApiSandboxConfigSchema.parse({
      docker: {
        enabled: false,
        socketPath: "/var/run/docker.sock",
      },
    });

    expect(parsed.docker).toEqual({
      enabled: false,
      socketPath: "/var/run/docker.sock",
    });
  });

  it("requires control-plane API config", () => {
    expect(() =>
      DataPlaneApiConfigSchema.parse({
        server: {
          host: "127.0.0.1",
          port: 5200,
        },
        database: {
          url: "postgresql://127.0.0.1/mistle",
          migrationUrl: "postgresql://127.0.0.1/mistle",
        },
        workflow: {
          databaseUrl: "postgresql://127.0.0.1/mistle",
          namespaceId: "development",
        },
        runtimeState: {
          gatewayBaseUrl: "http://127.0.0.1:5202",
        },
        sandbox: {
          docker: {
            enabled: true,
            socketPath: "/var/run/docker.sock",
          },
        },
        internalAuth: {
          serviceToken: "test-service-token",
        },
      }),
    ).toThrow(/controlPlaneApi/);
  });
});

describe("getDataPlaneApiSandboxProviderValidationIssue", () => {
  it("does not require a singleton sandbox provider", () => {
    const issue = getDataPlaneApiSandboxProviderValidationIssue({
      appSandbox: {},
    });

    expect(issue).toBeNull();
  });

  it("does not require E2B credentials for the data-plane API", () => {
    const issue = getDataPlaneApiSandboxProviderValidationIssue({
      appSandbox: {
        e2b: {
          enabled: false,
        },
      },
    });

    expect(issue).toBeNull();
  });
});
