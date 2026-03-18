import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ConfigModule } from "./core/module.js";
import { asObjectRecord } from "./core/record.js";
import { loadFromEnv, loadFromToml, validateModules } from "./pipeline.js";

const GlobalSchema = z
  .object({
    env: z.enum(["development", "production"]),
  })
  .strict();

const AppSchema = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  })
  .strict();

const modules: readonly ConfigModule[] = [
  {
    namespace: ["global"],
    schema: GlobalSchema,
    loadToml: (tomlRoot) => {
      const globalRecord = asObjectRecord(tomlRoot.global);
      return GlobalSchema.partial().parse({
        env: globalRecord.env,
      });
    },
    loadEnv: (env) =>
      GlobalSchema.partial().parse({
        env: env.NODE_ENV,
      }),
  },
  {
    namespace: ["apps", "control_plane_api"],
    schema: AppSchema,
    loadToml: (tomlRoot) => {
      const apps = asObjectRecord(tomlRoot.apps);
      const controlPlaneApi = asObjectRecord(apps.control_plane_api);
      return AppSchema.partial().parse({
        host: controlPlaneApi.host,
        port: controlPlaneApi.port,
      });
    },
    loadEnv: (env) =>
      AppSchema.partial().parse({
        host: env.TEST_APP_HOST,
        port: env.TEST_APP_PORT === undefined ? undefined : Number(env.TEST_APP_PORT),
      }),
  },
];

describe("pipeline", () => {
  it("loads namespaced values from TOML", () => {
    const loaded = loadFromToml(modules, {
      global: {
        env: "development",
      },
      apps: {
        control_plane_api: {
          host: "127.0.0.1",
          port: 5000,
        },
      },
    });

    expect(loaded).toEqual({
      global: {
        env: "development",
      },
      apps: {
        control_plane_api: {
          host: "127.0.0.1",
          port: 5000,
        },
      },
    });
  });

  it("loads namespaced values from env", () => {
    const loaded = loadFromEnv(modules, {
      NODE_ENV: "production",
      TEST_APP_HOST: "localhost",
      TEST_APP_PORT: "5300",
    });

    expect(loaded).toEqual({
      global: {
        env: "production",
      },
      apps: {
        control_plane_api: {
          host: "localhost",
          port: 5300,
        },
      },
    });
  });

  it("validates parsed module values", () => {
    const validated = validateModules(modules, {
      global: {
        env: "development",
      },
      apps: {
        control_plane_api: {
          host: "0.0.0.0",
          port: 5100,
        },
      },
    });

    expect(validated).toEqual({
      global: {
        env: "development",
      },
      apps: {
        control_plane_api: {
          host: "0.0.0.0",
          port: 5100,
        },
      },
    });
  });

  it("throws when a module namespace fails validation", () => {
    expect(() =>
      validateModules(modules, {
        global: {
          env: "development",
        },
        apps: {
          control_plane_api: {
            host: "",
            port: 99999,
          },
        },
      }),
    ).toThrow(/./);
  });
});
