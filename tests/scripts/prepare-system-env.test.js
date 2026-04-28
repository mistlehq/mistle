import { describe, expect, test } from "vitest";

import { buildPrepareEnvironment, resolveIntegrationProviders } from "./prepare-system-env.mjs";

describe("resolveIntegrationProviders", () => {
  test("prefers explicitly configured integration providers", () => {
    expect(
      resolveIntegrationProviders({
        MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS: "docker,e2b",
        MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER: "docker",
      }),
    ).toBe("docker,e2b");
  });

  test("uses the selected docker provider when configured", () => {
    expect(
      resolveIntegrationProviders({
        MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER: "docker",
      }),
    ).toBe("docker");
  });

  test("uses the selected e2b provider when configured", () => {
    expect(
      resolveIntegrationProviders({
        MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER: "e2b",
      }),
    ).toBe("e2b");
  });

  test("defaults to preparing both providers when no provider is selected", () => {
    expect(resolveIntegrationProviders({})).toBe("docker,e2b");
  });

  test("rejects unsupported providers", () => {
    expect(() =>
      resolveIntegrationProviders({
        MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER: "bogus",
      }),
    ).toThrow("Unsupported MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER 'bogus'");
  });
});

describe("buildPrepareEnvironment", () => {
  test("derives e2b and archil variables from the selected provider and fallback env", () => {
    const environment = buildPrepareEnvironment({
      E2B_API_KEY: "e2b-api-key",
      MISTLE_TEST_ARCHIL_API_KEY: "archil-api-key",
      MISTLE_TEST_ARCHIL_REGION: "gcp-asia-southeast1",
      MISTLE_TEST_ARCHIL_S3_ACCESS_KEY_ID: "access-key-id",
      MISTLE_TEST_ARCHIL_S3_BUCKET: "bucket-name",
      MISTLE_TEST_ARCHIL_S3_ENDPOINT: "https://archil.example.com",
      MISTLE_TEST_ARCHIL_S3_SECRET_ACCESS_KEY: "secret-access-key",
      MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER: "e2b",
    });

    expect(environment.MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS).toBe("e2b");
    expect(environment.MISTLE_APPS_DATA_PLANE_API_SANDBOX_E2B_API_KEY).toBe("e2b-api-key");
    expect(environment.MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_API_KEY).toBe("e2b-api-key");
    expect(environment.MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_API_KEY).toBe(
      "archil-api-key",
    );
    expect(environment.MISTLE_TEST_ARCHIL_API_KEY).toBe("archil-api-key");
    expect(environment.MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_REGION).toBe(
      "gcp-asia-southeast1",
    );
    expect(
      JSON.parse(environment.MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON),
    ).toEqual([
      {
        accessKeyId: "access-key-id",
        bucket: "bucket-name",
        endpoint: "https://archil.example.com",
        secretAccessKey: "secret-access-key",
        type: "s3-compatible",
      },
    ]);
  });

  test("preserves explicitly provided app environment values", () => {
    const environment = buildPrepareEnvironment({
      E2B_API_KEY: "fallback-e2b-api-key",
      MISTLE_APPS_DATA_PLANE_API_SANDBOX_E2B_API_KEY: "explicit-api-key",
      MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_API_KEY: "explicit-worker-key",
      MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_API_KEY: "explicit-archil-key",
      MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON: '[{"type":"s3"}]',
      MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_REGION: "explicit-region",
      MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER: "docker",
    });

    expect(environment.MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS).toBe("docker");
    expect(environment.MISTLE_APPS_DATA_PLANE_API_SANDBOX_E2B_API_KEY).toBe("explicit-api-key");
    expect(environment.MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_API_KEY).toBe(
      "explicit-worker-key",
    );
    expect(environment.MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_API_KEY).toBe(
      "explicit-archil-key",
    );
    expect(environment.MISTLE_TEST_ARCHIL_API_KEY).toBe("explicit-archil-key");
    expect(environment.MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_REGION).toBe(
      "explicit-region",
    );
    expect(environment.MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON).toBe(
      '[{"type":"s3"}]',
    );
  });
});
