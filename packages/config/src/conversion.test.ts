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
      MISTLE_GLOBAL_TUNNEL_BOOTSTRAP_TOKEN_SECRET: "fixture-bootstrap-secret",
      MISTLE_GLOBAL_TUNNEL_TOKEN_ISSUER: "data-plane-worker",
      MISTLE_GLOBAL_TUNNEL_TOKEN_AUDIENCE: "data-plane-gateway",
      MISTLE_GLOBAL_SANDBOX_PROVIDER: "modal",
      MISTLE_APPS_CONTROL_PLANE_API_HOST: "127.0.0.1",
      MISTLE_APPS_CONTROL_PLANE_API_PORT: "5000",
      MISTLE_APPS_CONTROL_PLANE_API_SANDBOX_DEFAULT_BASE_IMAGE:
        "127.0.0.1:5001/mistle/sandbox-base:dev",
      MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_ACTIVE_MASTER_ENCRYPTION_KEY_VERSION: "3",
      MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON:
        '{"3":"integration-master-key"}',
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS: "http://a.local,http://b.local",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_LENGTH: "6",
      MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "true",
      MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY: "4",
      MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL: "http://127.0.0.1:5300",
      MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_BOOTSTRAP_TOKEN_TTL_SECONDS: "120",
    });

    expect(tomlRecord).toEqual({
      global: {
        env: "development",
        tunnel: {
          bootstrap_token_secret: "fixture-bootstrap-secret",
          token_issuer: "data-plane-worker",
          token_audience: "data-plane-gateway",
        },
        sandbox: {
          provider: "modal",
        },
      },
      apps: {
        control_plane_api: {
          server: {
            host: "127.0.0.1",
            port: 5000,
          },
          sandbox: {
            default_base_image: "127.0.0.1:5001/mistle/sandbox-base:dev",
          },
          integrations: {
            active_master_encryption_key_version: 3,
            master_encryption_keys: {
              "3": "integration-master-key",
            },
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
        data_plane_worker: {
          tunnel: {
            bootstrap_token_ttl_seconds: 120,
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
        tunnel: {
          bootstrap_token_secret: "prod-bootstrap-secret",
          token_issuer: "data-plane-worker",
          token_audience: "data-plane-gateway",
        },
        sandbox: {
          provider: "docker",
        },
      },
      apps: {
        control_plane_api: {
          sandbox: {
            default_base_image: "registry.example.com/mistle/sandbox-base:prod",
          },
          auth: {
            trusted_origins: ["https://a.example", "https://b.example"],
          },
          integrations: {
            active_master_encryption_key_version: 9,
            master_encryption_keys: {
              "9": "integration-master-key",
            },
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
      MISTLE_GLOBAL_TUNNEL_BOOTSTRAP_TOKEN_SECRET: "prod-bootstrap-secret",
      MISTLE_GLOBAL_TUNNEL_TOKEN_ISSUER: "data-plane-worker",
      MISTLE_GLOBAL_TUNNEL_TOKEN_AUDIENCE: "data-plane-gateway",
      MISTLE_GLOBAL_SANDBOX_PROVIDER: "docker",
      MISTLE_APPS_CONTROL_PLANE_API_SANDBOX_DEFAULT_BASE_IMAGE:
        "registry.example.com/mistle/sandbox-base:prod",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS: "https://a.example,https://b.example",
      MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_ACTIVE_MASTER_ENCRYPTION_KEY_VERSION: "9",
      MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON:
        '{"9":"integration-master-key"}',
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
