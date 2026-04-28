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
      provider: IntegrationSandboxProvider.DOCKER,
      environment: {},
    });

    expect(configRoot).toMatchObject({
      sandbox: {
        provider: IntegrationSandboxProvider.DOCKER,
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
      provider: IntegrationSandboxProvider.DOCKER,
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
    const e2bSandboxBaseImage = preset.e2bSandboxBaseImage;
    if (e2bSandboxBaseImage === undefined) {
      throw new Error("E2B integration preset must include an E2B sandbox base image.");
    }

    const configRoot = buildIntegrationTomlConfig({
      provider: IntegrationSandboxProvider.E2B,
      environment: {
        MISTLE_SANDBOX_E2B_API_KEY: "e2b-test-key",
        MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY: "archil-test-key",
        MISTLE_SANDBOX_STORAGE_ARCHIL_REGION: "gcp-us-central1",
        MISTLE_OBJECT_STORE_SANDBOX_STORAGE_BUCKET_NAME: "sandbox-storage",
        MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ENDPOINT: "https://storage.example.test",
        MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ACCESS_KEY_ID: "access-key",
        MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY: "secret-key",
      },
      e2bSandboxBaseImage,
    });

    expect(configRoot).toMatchObject({
      sandbox: {
        provider: IntegrationSandboxProvider.E2B,
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

  it("requires a complete managed Archil profile when integration storage backend is archil", () => {
    const requiredValues = getRequiredIntegrationConfigValues({
      provider: IntegrationSandboxProvider.DOCKER,
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
});
