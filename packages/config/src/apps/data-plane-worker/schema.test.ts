import { describe, expect, it } from "vitest";

import {
  DataPlaneWorkerSandboxConfigSchema,
  DataPlaneWorkerSandboxStorageArchilConfigSchema,
  getDataPlaneWorkerPersistentSandboxValidationIssue,
  getDataPlaneWorkerSandboxProviderValidationIssue,
} from "./schema.js";

describe("DataPlaneWorkerSandboxConfigSchema", () => {
  it("defaults the E2B domain to the hosted cloud domain", () => {
    const parsed = DataPlaneWorkerSandboxConfigSchema.parse({
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      e2b: {
        apiKey: "test-api-key",
      },
    });

    expect(parsed).toEqual({
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
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      sandboxdTestFaultsEnabled: true,
    });

    expect(parsed).toEqual({
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      sandboxdTestFaultsEnabled: true,
    });
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
  it("requires E2B settings when the global provider is e2b", () => {
    const issue = getDataPlaneWorkerSandboxProviderValidationIssue({
      globalSandboxProvider: "e2b",
      appSandbox: {
        tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      },
    });

    expect(issue).toEqual({
      path: ["sandbox", "e2b"],
      message:
        "apps.data_plane_worker.sandbox.e2b is required when global.sandbox.provider is 'e2b'.",
    });
  });
});

describe("getDataPlaneWorkerPersistentSandboxValidationIssue", () => {
  it("requires control-plane API config when Archil storage is enabled", () => {
    const issue = getDataPlaneWorkerPersistentSandboxValidationIssue({
      globalSandboxStorageBackend: "archil",
      appConfig: {
        database: {
          url: "postgresql://127.0.0.1/mistle",
        },
        workflow: {
          databaseUrl: "postgresql://127.0.0.1/mistle",
          namespaceId: "development",
          runMigrations: true,
          concurrency: 1,
        },
        tunnel: {
          bootstrapTokenTtlSeconds: 120,
          exchangeTokenTtlSeconds: 3600,
        },
        runtimeState: {
          gatewayBaseUrl: "http://127.0.0.1:5202",
        },
        sandbox: {
          tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
        },
      },
    });

    expect(issue).toEqual({
      path: ["controlPlaneApi"],
      message:
        "apps.data_plane_worker.control_plane_api.base_url is required when global.sandbox.storage.backend is 'archil'.",
    });
  });
});
