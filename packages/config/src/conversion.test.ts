import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";

import {
  convertDotenvContentToTomlContent,
  convertEnvToTomlRecord,
  convertTomlContentToDotenvContent,
  convertTomlToEnvRecord,
  parseDotenvContent,
} from "./conversion.js";

describe("convertEnvToTomlRecord", () => {
  it("maps env vars to TOML paths with parsed value types", () => {
    const tomlRecord = convertEnvToTomlRecord({
      IGNORED_VALUE: "ignored",
      NODE_ENV: "test",
      MISTLE_APPS_CONTROL_PLANE_API_HOST: "127.0.0.1",
      MISTLE_APPS_CONTROL_PLANE_API_PORT: "5000",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS: "http://a.local,http://b.local",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_LENGTH: "6",
      MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "true",
      MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY: "4",
      MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL: "http://127.0.0.1:5300",
    });

    expect(tomlRecord).toEqual({
      global: {
        env: "development",
      },
      apps: {
        control_plane_api: {
          server: {
            host: "127.0.0.1",
            port: 5000,
          },
          auth: {
            trusted_origins: ["http://a.local", "http://b.local"],
            otp_length: 6,
          },
        },
        control_plane_worker: {
          workflow: {
            run_migrations: true,
            concurrency: 4,
          },
          data_plane_api: {
            base_url: "http://127.0.0.1:5300",
          },
        },
      },
    });
  });
});

describe("convertTomlToEnvRecord", () => {
  it("maps TOML values to env vars with string serialization", () => {
    const envRecord = convertTomlToEnvRecord({
      global: {
        env: "production",
      },
      apps: {
        control_plane_api: {
          auth: {
            trusted_origins: ["https://a.example", "https://b.example"],
          },
        },
        control_plane_worker: {
          data_plane_api: {
            base_url: "http://127.0.0.1:5300",
          },
          workflow: {
            run_migrations: false,
            concurrency: 2,
          },
        },
      },
    });

    expect(envRecord).toEqual({
      NODE_ENV: "production",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS: "https://a.example,https://b.example",
      MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "false",
      MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY: "2",
      MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL: "http://127.0.0.1:5300",
    });
  });
});

describe("content conversion helpers", () => {
  it("converts dotenv content to TOML content", () => {
    const tomlContent = convertDotenvContentToTomlContent(`
NODE_ENV=production
MISTLE_APPS_CONTROL_PLANE_API_HOST=127.0.0.1
MISTLE_APPS_CONTROL_PLANE_API_PORT=5100
MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS="https://app.example,https://admin.example"
`);

    expect(parseToml(tomlContent)).toEqual({
      global: {
        env: "production",
      },
      apps: {
        control_plane_api: {
          server: {
            host: "127.0.0.1",
            port: 5100,
          },
          auth: {
            trusted_origins: ["https://app.example", "https://admin.example"],
          },
        },
      },
    });
  });

  it("converts TOML content to dotenv content that parses back correctly", () => {
    const dotenvContent = convertTomlContentToDotenvContent(`
[global]
env = "production"

[apps.control_plane_worker.email]
from_name = "Mistle Local Team"
`);

    const parsedDotenv = parseDotenvContent(dotenvContent);

    expect(parsedDotenv).toEqual({
      NODE_ENV: "production",
      MISTLE_APPS_CONTROL_PLANE_WORKER_EMAIL_FROM_NAME: "Mistle Local Team",
    });
  });
});
