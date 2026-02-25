import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/loader.js";
import { AppIds } from "../src/modules.js";
import { createIntegrationEnv } from "./fixtures/env.js";

const configFixturePath = fileURLToPath(new URL("./fixtures/config.toml", import.meta.url));

const baseAppConfig = {
  server: {
    host: "127.0.0.1",
    port: 5000,
  },
  database: {
    url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_control_plane",
  },
  auth: {
    baseUrl: "http://127.0.0.1:5000",
    secret: "test-secret",
    trustedOrigins: ["http://127.0.0.1:3000"],
    otpLength: 6,
    otpExpiresInSeconds: 300,
    otpAllowedAttempts: 3,
  },
  email: {
    fromAddress: "no-reply@mistle.local",
    fromName: "Mistle Local",
    smtpHost: "127.0.0.1",
    smtpPort: 1025,
    smtpSecure: false,
    smtpUsername: "mailpit",
    smtpPassword: "mailpit",
  },
} as const;

describe("loadConfig integrations", () => {
  it("loads purely from a config file fixture", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      configPath: configFixturePath,
    });

    expect(config).toEqual({
      global: {
        env: "development",
      },
      app: {
        ...baseAppConfig,
        server: {
          host: "0.0.0.0",
          port: 5100,
        },
      },
    });
  });

  it("loads purely from env", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      env: createIntegrationEnv({
        NODE_ENV: "production",
        MISTLE_APPS_CONTROL_PLANE_API_HOST: "localhost",
        MISTLE_APPS_CONTROL_PLANE_API_PORT: "5300",
      }),
    });

    expect(config).toEqual({
      global: {
        env: "production",
      },
      app: {
        ...baseAppConfig,
        server: {
          host: "localhost",
          port: 5300,
        },
      },
    });
  });

  it("loads from both config file and env, with env precedence", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      configPath: configFixturePath,
      env: {
        MISTLE_APPS_CONTROL_PLANE_API_HOST: "localhost",
      },
    });

    expect(config).toEqual({
      global: {
        env: "development",
      },
      app: {
        ...baseAppConfig,
        server: {
          host: "localhost",
          port: 5100,
        },
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
        ...baseAppConfig,
        server: {
          host: "0.0.0.0",
          port: 5100,
        },
      },
    });
  });
});
