import { describe, expect, it } from "vitest";

import {
  getIntegrationProviderPreset,
  getRequiredIntegrationConfigValues,
  IntegrationSandboxProvider,
} from "../../../scripts/config/presets/integration/index.js";
import { buildIntegrationTomlConfig } from "../../../scripts/config/toml-config.js";
import { getValueAtPath } from "../src/core/record.js";

describe("integration provider presets", () => {
  it("defaults docker integration config generation to managed Docker volume storage", async () => {
    const configRoot = buildIntegrationTomlConfig({
      providers: [IntegrationSandboxProvider.DOCKER],
      environment: {},
    });

    expect(configRoot).toMatchObject({
      sandbox: {
        docker: {
          enabled: true,
        },
        storage: {
          backend: "docker_volume",
          docker_volume: {
            name_prefix: "it-system-",
          },
        },
      },
    });
    expect(getValueAtPath(configRoot, ["object_store", "sandbox_storage"])).toBeUndefined();
  });

  it("does not require Archil config values for docker_volume storage", () => {
    const requiredValues = getRequiredIntegrationConfigValues({
      providers: [IntegrationSandboxProvider.DOCKER],
      configRoot: {
        sandbox: {
          storage: {
            backend: "docker_volume",
          },
        },
      },
    });

    expect(requiredValues).toEqual([]);
  });

  it("defaults e2b integration config generation to managed Archil storage", async () => {
    const preset = await getIntegrationProviderPreset(IntegrationSandboxProvider.E2B);
    const remoteSandboxBaseImage = preset.remoteSandboxBaseImage;
    if (remoteSandboxBaseImage === undefined) {
      throw new Error("E2B integration preset must include an E2B sandbox base image.");
    }

    const configRoot = buildIntegrationTomlConfig({
      providers: [IntegrationSandboxProvider.E2B],
      environment: {
        MISTLE_SANDBOX_E2B_API_KEY: "e2b-test-key",
        MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY: "archil-test-key",
        MISTLE_SANDBOX_STORAGE_ARCHIL_REGION: "gcp-us-central1",
        MISTLE_OBJECT_STORE_SANDBOX_STORAGE_BUCKET_NAME: "sandbox-storage",
        MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ENDPOINT: "https://storage.example.test",
        MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ACCESS_KEY_ID: "access-key",
        MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY: "secret-key",
      },
      remoteSandboxBaseImage,
    });

    expect(configRoot).toMatchObject({
      sandbox: {
        e2b: {
          enabled: true,
          api_key: "e2b-test-key",
        },
        storage: {
          backend: "archil",
          archil: {
            name_prefix: "it-system-",
          },
        },
      },
      object_store: {
        sandbox_storage: {
          bucket_name: "sandbox-storage",
          endpoint: "https://storage.example.test",
        },
      },
    });
    expect(getValueAtPath(configRoot, ["sandbox", "storage"])).toMatchObject({
      backend: "archil",
    });
    expect(getValueAtPath(configRoot, ["sandbox", "default_base_image"])).toEqual(
      expect.stringMatching(/^ghcr\.io\/mistlehq\/sandbox-base@sha256:[a-f0-9]{64}$/),
    );
  });

  it("defaults tensorlake integration config generation to managed Archil storage", () => {
    const configRoot = buildIntegrationTomlConfig({
      providers: [IntegrationSandboxProvider.TENSORLAKE],
      environment: {
        MISTLE_SANDBOX_TENSORLAKE_API_KEY: "tensorlake-test-key",
        MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY: "archil-test-key",
        MISTLE_SANDBOX_STORAGE_ARCHIL_REGION: "gcp-us-central1",
        MISTLE_OBJECT_STORE_SANDBOX_STORAGE_BUCKET_NAME: "sandbox-storage",
        MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ENDPOINT: "https://storage.example.test",
        MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ACCESS_KEY_ID: "access-key",
        MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY: "secret-key",
      },
      remoteSandboxBaseImage: "ghcr.io/mistlehq/sandbox-base:test",
    });

    expect(configRoot).toMatchObject({
      sandbox: {
        tensorlake: {
          enabled: true,
          api_key: "tensorlake-test-key",
        },
        storage: {
          backend: "archil",
          archil: {
            name_prefix: "it-system-",
          },
        },
      },
      object_store: {
        sandbox_storage: {
          bucket_name: "sandbox-storage",
          endpoint: "https://storage.example.test",
        },
      },
    });
    expect(getValueAtPath(configRoot, ["sandbox", "e2b"])).toBeUndefined();
    expect(getValueAtPath(configRoot, ["sandbox", "default_base_image"])).toEqual(
      "ghcr.io/mistlehq/sandbox-base:test",
    );
  });

  it("requires a complete managed Archil profile when integration storage backend is archil", () => {
    const requiredValues = getRequiredIntegrationConfigValues({
      providers: [IntegrationSandboxProvider.DOCKER],
      configRoot: {
        sandbox: {
          storage: {
            backend: "archil",
          },
        },
      },
    });

    expect(requiredValues).toEqual([
      {
        path: ["sandbox", "storage", "archil", "api_key"],
        envVar: "MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY",
      },
      {
        path: ["sandbox", "storage", "archil", "region"],
        envVar: "MISTLE_SANDBOX_STORAGE_ARCHIL_REGION",
      },
      {
        path: ["object_store", "sandbox_storage", "bucket_name"],
        envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_BUCKET_NAME",
      },
      {
        path: ["object_store", "sandbox_storage", "endpoint"],
        envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ENDPOINT",
      },
      {
        path: ["object_store", "sandbox_storage", "access_key_id"],
        envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ACCESS_KEY_ID",
      },
      {
        path: ["object_store", "sandbox_storage", "secret_access_key"],
        envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY",
      },
    ]);
  });

  it("requires tensorlake credentials when the tensorlake provider is enabled", () => {
    const requiredValues = getRequiredIntegrationConfigValues({
      providers: [IntegrationSandboxProvider.TENSORLAKE],
      configRoot: {
        sandbox: {
          storage: {
            backend: "docker_volume",
          },
        },
      },
    });

    expect(requiredValues).toEqual([
      {
        path: ["sandbox", "tensorlake", "api_key"],
        envVar: "MISTLE_SANDBOX_TENSORLAKE_API_KEY",
      },
    ]);
  });
});
