import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadConfig, parseConfigRecord } from "./loader.js";
import { AppIds } from "./modules.js";

const ConfigSamplePath = fileURLToPath(
  new URL("../../../config/config.sample.toml", import.meta.url),
);

describe("parseConfigRecord", () => {
  it("rejects legacy apps root config records", () => {
    expect(() =>
      parseConfigRecord({
        global: {
          env: "development",
        },
        apps: {},
      }),
    ).toThrow(/Unrecognized key/u);
  });
});

describe("loadConfig", () => {
  it("fails when configPath and env are both missing", () => {
    expect(() =>
      loadConfig({
        app: AppIds.CONTROL_PLANE_API,
      }),
    ).toThrow(/Missing config source/);
  });

  it("loads a selected service config from central TOML resources", () => {
    const loadedConfig = loadConfig({
      app: AppIds.DATA_PLANE_GATEWAY,
      includeGlobal: false,
      configPath: ConfigSamplePath,
    });

    expect(loadedConfig.app.server).toEqual({
      host: "0.0.0.0",
      port: 8084,
    });
    expect(loadedConfig.app.database.url).toBe(
      "postgresql://mistle:replace-with-password@pgbouncer:6432/mistle",
    );
    expect(loadedConfig.app.runtimeState).toEqual({
      backend: "valkey",
      valkey: {
        url: "redis://valkey:6379",
        keyPrefix: "mistle:runtime-state",
      },
    });
  });

  it("rejects conflicting env-only aliases for the same central resource", () => {
    expect(() =>
      loadConfig({
        app: AppIds.DATA_PLANE_WORKER,
        includeGlobal: false,
        env: {
          NODE_ENV: "development",
          MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL: "postgresql://runtime.example/mistle",
          MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL:
            "postgresql://workflow.example/mistle",
        },
      }),
    ).toThrow(/Conflicting env overrides for postgres\.data_plane\.pooled_url/);
  });
});
