import { describe, expect, it } from "vitest";

import {
  getIntegrationProviderPreset,
  getRequiredIntegrationConfigValues,
  IntegrationSandboxProvider,
} from "../../../scripts/config/presets/integration/index.js";
import { buildIntegrationTomlConfig } from "../../../scripts/config/toml-config.js";
import { getValueAtPath } from "../src/core/record.js";

describe("integration provider presets", () => {
  it("generates Docker integration config without sandbox storage", async () => {
    const configRoot = buildIntegrationTomlConfig({
      providers: [IntegrationSandboxProvider.DOCKER],
      environment: {},
    });

    expect(configRoot).toMatchObject({
      sandbox: {
        docker: {
          enabled: true,
        },
      },
    });
    expect(getValueAtPath(configRoot, ["sandbox", "storage"])).toBeUndefined();
    expect(getValueAtPath(configRoot, ["object_store", "sandbox_storage"])).toBeUndefined();
  });

  it("does not require storage config values for Docker integration config", () => {
    const requiredValues = getRequiredIntegrationConfigValues({
      providers: [IntegrationSandboxProvider.DOCKER],
      configRoot: {},
    });

    expect(requiredValues).toEqual([]);
  });

  it("generates E2B integration config without sandbox storage", async () => {
    const preset = await getIntegrationProviderPreset(IntegrationSandboxProvider.E2B);
    const remoteSandboxBaseImage = preset.remoteSandboxBaseImage;
    if (remoteSandboxBaseImage === undefined) {
      throw new Error("E2B integration preset must include an E2B sandbox base image.");
    }

    const configRoot = buildIntegrationTomlConfig({
      providers: [IntegrationSandboxProvider.E2B],
      environment: {
        MISTLE_SANDBOX_E2B_API_KEY: "e2b-test-key",
      },
      remoteSandboxBaseImage,
    });

    expect(configRoot).toMatchObject({
      sandbox: {
        e2b: {
          enabled: true,
          api_key: "e2b-test-key",
        },
      },
    });
    expect(getValueAtPath(configRoot, ["sandbox", "storage"])).toBeUndefined();
    expect(getValueAtPath(configRoot, ["object_store", "sandbox_storage"])).toBeUndefined();
    expect(getValueAtPath(configRoot, ["sandbox", "default_base_image"])).toEqual(
      expect.stringMatching(/^ghcr\.io\/mistlehq\/sandbox-base@sha256:[a-f0-9]{64}$/),
    );
  });

  it("generates Tensorlake integration config without sandbox storage", () => {
    const configRoot = buildIntegrationTomlConfig({
      providers: [IntegrationSandboxProvider.TENSORLAKE],
      environment: {
        MISTLE_SANDBOX_TENSORLAKE_API_KEY: "tensorlake-test-key",
      },
      remoteSandboxBaseImage: "ghcr.io/mistlehq/sandbox-base:test",
    });

    expect(configRoot).toMatchObject({
      sandbox: {
        tensorlake: {
          enabled: true,
          api_key: "tensorlake-test-key",
        },
      },
    });
    expect(getValueAtPath(configRoot, ["sandbox", "e2b"])).toBeUndefined();
    expect(getValueAtPath(configRoot, ["sandbox", "storage"])).toBeUndefined();
    expect(getValueAtPath(configRoot, ["object_store", "sandbox_storage"])).toBeUndefined();
    expect(getValueAtPath(configRoot, ["sandbox", "default_base_image"])).toEqual(
      "ghcr.io/mistlehq/sandbox-base:test",
    );
  });

  it("requires tensorlake credentials when the tensorlake provider is enabled", () => {
    const requiredValues = getRequiredIntegrationConfigValues({
      providers: [IntegrationSandboxProvider.TENSORLAKE],
      configRoot: {},
    });

    expect(requiredValues).toEqual([
      {
        path: ["sandbox", "tensorlake", "api_key"],
        envVar: "MISTLE_SANDBOX_TENSORLAKE_API_KEY",
      },
    ]);
  });
});
