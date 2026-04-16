import { describe, expect, it } from "vitest";

import {
  getIntegrationProviderPreset,
  getRequiredIntegrationConfigValues,
  IntegrationSandboxProvider,
} from "../../../scripts/config/presets/integration/index.js";
import { getValueAtPath } from "../src/core/record.js";

describe("integration provider presets", () => {
  it("defaults docker integration config generation to managed Docker volume storage", () => {
    const preset = getIntegrationProviderPreset(IntegrationSandboxProvider.DOCKER);

    expect(preset.defaults).toMatchObject({
      global: {
        sandbox: {
          provider: IntegrationSandboxProvider.DOCKER,
          storage: {
            backend: "docker_volume",
          },
        },
      },
      apps: {
        data_plane_worker: {
          sandbox_storage: {
            docker_volume: {
              name_prefix: "it-system-",
            },
          },
        },
      },
    });
  });

  it("does not require Archil config values for docker_volume storage", () => {
    const requiredValues = getRequiredIntegrationConfigValues({
      provider: IntegrationSandboxProvider.DOCKER,
      configRoot: {
        global: {
          sandbox: {
            storage: {
              backend: "docker_volume",
            },
          },
        },
      },
    });

    expect(requiredValues).toEqual([]);
  });

  it("defaults e2b integration config generation to managed Archil storage", () => {
    const preset = getIntegrationProviderPreset(IntegrationSandboxProvider.E2B);

    expect(preset.defaults).toMatchObject({
      global: {
        sandbox: {
          provider: IntegrationSandboxProvider.E2B,
          storage: {
            backend: "archil",
          },
        },
      },
      apps: {
        data_plane_worker: {
          sandbox_storage: {
            archil: {
              name_prefix: "it-system-",
            },
          },
        },
      },
    });
    expect(getValueAtPath(preset.defaults, ["global", "sandbox", "storage"])).toEqual({
      backend: "archil",
    });
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
