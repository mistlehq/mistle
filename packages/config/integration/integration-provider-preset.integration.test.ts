import { describe, expect, it } from "vitest";

import {
  getIntegrationProviderPreset,
  getRequiredIntegrationConfigValues,
  IntegrationSandboxProvider,
} from "../../../scripts/config/presets/integration/index.js";

describe("integration provider presets", () => {
  it("defaults docker integration config generation to no persistent sandbox storage", () => {
    const preset = getIntegrationProviderPreset(IntegrationSandboxProvider.DOCKER);

    expect(preset.defaults).toMatchObject({
      global: {
        sandbox: {
          provider: IntegrationSandboxProvider.DOCKER,
          storage: {
            backend: "none",
          },
        },
      },
    });
  });

  it("does not require Archil config values when storage backend remains none", () => {
    const requiredValues = getRequiredIntegrationConfigValues({
      provider: IntegrationSandboxProvider.DOCKER,
      configRoot: {
        global: {
          sandbox: {
            storage: {
              backend: "none",
            },
          },
        },
      },
    });

    expect(requiredValues).toEqual([]);
  });

  it("requires a complete managed Archil profile when integration storage backend is archil", () => {
    const requiredValues = getRequiredIntegrationConfigValues({
      provider: IntegrationSandboxProvider.DOCKER,
      configRoot: {
        global: {
          sandbox: {
            storage: {
              backend: "archil",
            },
          },
        },
      },
    });

    expect(requiredValues).toEqual([
      {
        path: ["apps", "data_plane_worker", "sandbox_storage", "archil", "api_key"],
        envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_API_KEY",
      },
      {
        path: ["apps", "data_plane_worker", "sandbox_storage", "archil", "region"],
        envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_REGION",
      },
      {
        path: ["apps", "data_plane_worker", "sandbox_storage", "archil", "mounts"],
        envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON",
      },
    ]);
  });
});
