import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/loader.js";
import { AppIds } from "../src/modules.js";
import { createAppConfig, createConfigEnvPatch } from "../src/test/fixtures/config.js";

const configFixturePath = fileURLToPath(new URL("./fixtures/config.toml", import.meta.url));

describe("loadConfig integrations", () => {
  it("loads purely from a config file fixture", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      configPath: configFixturePath,
    });

    expect(config).toEqual({
      global: createAppConfig().global,
      app: {
        host: "0.0.0.0",
        port: 5100,
      },
    });
  });

  it("loads purely from env", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      env: createConfigEnvPatch({
        global: {
          env: "production",
        },
        controlPlaneApi: {
          host: "localhost",
          port: 5300,
        },
      }),
    });

    expect(config).toEqual({
      global: {
        env: "production",
      },
      app: {
        host: "localhost",
        port: 5300,
      },
    });
  });

  it("loads from both config file and env, with env precedence", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      configPath: configFixturePath,
      env: createConfigEnvPatch({
        controlPlaneApi: {
          host: "localhost",
        },
      }),
    });

    expect(config).toEqual({
      global: createAppConfig().global,
      app: {
        host: "localhost",
        port: 5100,
      },
    });
  });

  it("returns only app config when includeGlobal is false", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      includeGlobal: false,
      configPath: configFixturePath,
    });

    expect(config).toEqual({
      app: {
        host: "0.0.0.0",
        port: 5100,
      },
    });
  });
});
