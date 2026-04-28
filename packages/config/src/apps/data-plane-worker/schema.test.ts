import { describe, expect, it } from "vitest";

import {
  DataPlaneWorkerConfigSchema,
  type DataPlaneWorkerConfig,
  DataPlaneWorkerSandboxConfigSchema,
  DataPlaneWorkerSandboxStorageArchilConfigSchema,
  getDataPlaneWorkerPersistentSandboxValidationIssue,
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

function createWorkerConfig(input: {
  sandbox?: Partial<DataPlaneWorkerConfig["sandbox"]>;
  sandboxStorage?: DataPlaneWorkerConfig["sandboxStorage"];
}): DataPlaneWorkerConfig {
  return {
    database: {
      url: "postgresql://127.0.0.1/mistle",
    },
    workflow: {
      databaseUrl: "postgresql://127.0.0.1/mistle",
      namespaceId: "development",
      runMigrations: true,
      concurrency: 1,
    },
    runtimeState: {
      gatewayBaseUrl: "http://127.0.0.1:5202",
    },
    controlPlaneApi: {
      baseUrl: "http://127.0.0.1:5100",
    },
    sandbox: {
      provider: "docker",
      storage: undefined,
      internalGatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      bootstrap: SandboxTokenConfig,
      egress: SandboxTokenConfig,
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      ...input.sandbox,
    },
    sandboxStorage: input.sandboxStorage,
    internalAuth: {
      serviceToken: "internal-service-token",
    },
    telemetry: DisabledTelemetryConfig,
  };
}

describe("DataPlaneWorkerSandboxConfigSchema", () => {
  it("defaults the E2B domain to the hosted cloud domain", () => {
    const parsed = DataPlaneWorkerSandboxConfigSchema.parse({
      provider: "e2b",
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: SandboxTokenConfig,
      egress: SandboxTokenConfig,
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      e2b: {
        apiKey: "test-api-key",
      },
    });

    expect(parsed).toEqual({
      provider: "e2b",
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: SandboxTokenConfig,
      egress: SandboxTokenConfig,
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      e2b: {
        apiKey: "test-api-key",
        domain: "e2b.app",
        cpuCount: 2,
        memoryMb: 4096,
      },
    });
  });

  it("parses E2B sandbox settings", () => {
    const parsed = DataPlaneWorkerSandboxConfigSchema.parse({
      provider: "e2b",
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: SandboxTokenConfig,
      egress: SandboxTokenConfig,
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      sandboxdTestFaultsEnabled: true,
      e2b: {
        apiKey: "test-api-key",
        domain: "e2b.example.com",
        cpuCount: 4,
        memoryMb: 16384,
      },
    });

    expect(parsed).toEqual({
      provider: "e2b",
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: SandboxTokenConfig,
      egress: SandboxTokenConfig,
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      sandboxdTestFaultsEnabled: true,
      e2b: {
        apiKey: "test-api-key",
        domain: "e2b.example.com",
        cpuCount: 4,
        memoryMb: 16384,
      },
    });
  });

  it("accepts the optional sandboxd test faults toggle", () => {
    const parsed = DataPlaneWorkerSandboxConfigSchema.parse({
      provider: "docker",
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: SandboxTokenConfig,
      egress: SandboxTokenConfig,
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      sandboxdTestFaultsEnabled: true,
    });

    expect(parsed).toEqual({
      provider: "docker",
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: SandboxTokenConfig,
      egress: SandboxTokenConfig,
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
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
        },
        runtimeState: {
          gatewayBaseUrl: "http://127.0.0.1:5202",
        },
        sandbox: {
          provider: "docker",
          internalGatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
          bootstrap: SandboxTokenConfig,
          egress: SandboxTokenConfig,
          tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
        },
        internalAuth: {
          serviceToken: "internal-service-token",
        },
        telemetry: DisabledTelemetryConfig,
      }),
    ).toThrow(/controlPlaneApi/);
  });
});

describe("DataPlaneWorkerSandboxStorageArchilConfigSchema", () => {
  it("parses the managed Archil config shape", () => {
    const parsed = DataPlaneWorkerSandboxStorageArchilConfigSchema.parse({
      apiKey: "archil-api-key",
      region: "gcp-us-central1",
      namePrefix: "mistle-",
      mounts: [
        {
          type: "s3-compatible",
          bucket: "mistle-archil-workspaces",
          endpoint: "https://s3.example.com",
          accessKeyId: "access-key-id",
          secretAccessKey: "secret-access-key",
        },
      ],
    });

    expect(parsed).toEqual({
      apiKey: "archil-api-key",
      region: "gcp-us-central1",
      namePrefix: "mistle-",
      mounts: [
        {
          type: "s3-compatible",
          bucket: "mistle-archil-workspaces",
          endpoint: "https://s3.example.com",
          accessKeyId: "access-key-id",
          secretAccessKey: "secret-access-key",
        },
      ],
    });
  });

  it("rejects more than one configured Archil mount", () => {
    expect(() =>
      DataPlaneWorkerSandboxStorageArchilConfigSchema.parse({
        apiKey: "archil-api-key",
        region: "gcp-us-central1",
        mounts: [
          {
            type: "s3-compatible",
            bucket: "bucket-a",
            endpoint: "https://s3-a.example.com",
            accessKeyId: "access-key-id-a",
            secretAccessKey: "secret-access-key-a",
          },
          {
            type: "s3-compatible",
            bucket: "bucket-b",
            endpoint: "https://s3-b.example.com",
            accessKeyId: "access-key-id-b",
            secretAccessKey: "secret-access-key-b",
          },
        ],
      }),
    ).toThrow(/Too big: expected array to have <=1 items/);
  });
});

describe("getDataPlaneWorkerSandboxProviderValidationIssue", () => {
  it("requires E2B settings when the worker provider is e2b", () => {
    const issue = getDataPlaneWorkerSandboxProviderValidationIssue({
      appSandbox: {
        provider: "e2b",
        internalGatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
        bootstrap: SandboxTokenConfig,
        egress: SandboxTokenConfig,
        tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      },
    });

    expect(issue).toEqual({
      path: ["sandbox", "e2b"],
      message: "sandbox.e2b is required when sandbox.provider is 'e2b'.",
    });
  });
});

describe("getDataPlaneWorkerPersistentSandboxValidationIssue", () => {
  it("requires Archil worker config when Archil storage is enabled", () => {
    const issue = getDataPlaneWorkerPersistentSandboxValidationIssue({
      appConfig: createWorkerConfig({
        sandbox: {
          storage: {
            backend: "archil",
          },
        },
      }),
    });

    expect(issue).toEqual({
      path: ["sandboxStorage", "archil"],
      message: "sandboxStorage.archil is required when sandbox.storage.backend is 'archil'.",
    });
  });

  it("requires docker volume worker config when Docker volume storage is enabled", () => {
    const issue = getDataPlaneWorkerPersistentSandboxValidationIssue({
      appConfig: createWorkerConfig({
        sandbox: {
          storage: {
            backend: "docker_volume",
          },
        },
      }),
    });

    expect(issue).toEqual({
      path: ["sandboxStorage", "dockerVolume"],
      message:
        "sandboxStorage.dockerVolume is required when sandbox.storage.backend is 'docker_volume'.",
    });
  });
});
