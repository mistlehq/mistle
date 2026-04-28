import { describe, expect, it } from "vitest";

import {
  DataPlaneApiConfigSchema,
  DataPlaneApiSandboxConfigSchema,
  getDataPlaneApiSandboxProviderValidationIssue,
} from "./schema.js";

describe("DataPlaneApiSandboxConfigSchema", () => {
  it("defaults the E2B domain to the hosted cloud domain", () => {
    const parsed = DataPlaneApiSandboxConfigSchema.parse({
      provider: "e2b",
      e2b: {
        apiKey: "test-api-key",
      },
    });

    expect(parsed).toEqual({
      provider: "e2b",
      e2b: {
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
        provider: "docker",
        docker: {
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
          provider: "docker",
          docker: {
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
  it("requires docker settings when the global provider is docker", () => {
    const issue = getDataPlaneApiSandboxProviderValidationIssue({
      appSandbox: {
        provider: "docker",
      },
    });

    expect(issue).toEqual({
      path: ["sandbox", "docker"],
      message: "sandbox.docker is required when sandbox.provider is 'docker'.",
    });
  });
});
