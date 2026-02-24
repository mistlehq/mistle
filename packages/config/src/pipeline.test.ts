import { describe, expect, it } from "vitest";

import { configModules } from "./modules.js";
import { loadFromEnv, loadFromToml, validateModules } from "./pipeline.js";
import { createAppConfig, createConfigEnvPatch, createTomlRoot } from "./test/fixtures/config.js";

describe("pipeline", () => {
  it("loads namespaced values from TOML", () => {
    const loaded = loadFromToml(configModules, createTomlRoot());

    expect(loaded).toEqual(createAppConfig());
  });

  it("loads namespaced values from env", () => {
    const loaded = loadFromEnv(
      configModules,
      createConfigEnvPatch({
        global: {
          env: "production",
        },
        controlPlaneApi: {
          host: "localhost",
          port: 5300,
        },
      }),
    );

    expect(loaded).toEqual(
      createAppConfig({
        global: {
          env: "production",
        },
        controlPlaneApi: {
          host: "localhost",
          port: 5300,
        },
      }),
    );
  });

  it("validates parsed module values", () => {
    const validated = validateModules(
      configModules,
      createAppConfig({
        controlPlaneApi: {
          host: "0.0.0.0",
          port: 5100,
        },
      }),
    );

    expect(validated).toEqual(
      createAppConfig({
        controlPlaneApi: {
          host: "0.0.0.0",
          port: 5100,
        },
      }),
    );
  });

  it("throws when a module namespace fails validation", () => {
    expect(() =>
      validateModules(
        configModules,
        createAppConfig({
          controlPlaneApi: {
            host: "",
            port: 99999,
          },
        }),
      ),
    ).toThrowError(/./);
  });
});
