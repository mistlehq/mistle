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
      MISTLE_GLOBAL_TELEMETRY_ENABLED: "true",
      MISTLE_GLOBAL_TELEMETRY_DEBUG: "false",
      MISTLE_GLOBAL_TELEMETRY_TRACES_ENDPOINT: "http://127.0.0.1:4318/v1/traces",
      MISTLE_GLOBAL_TELEMETRY_LOGS_ENDPOINT: "http://127.0.0.1:4318/v1/logs",
      MISTLE_GLOBAL_TELEMETRY_METRICS_ENDPOINT: "http://127.0.0.1:4318/v1/metrics",
      MISTLE_GLOBAL_TELEMETRY_RESOURCE_ATTRIBUTES: "deployment.environment=test",
      MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_SECRET: "fixture-bootstrap-secret",
      MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_ISSUER: "data-plane-worker",
      MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_AUDIENCE: "data-plane-gateway",
      MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_SECRET: "fixture-connection-secret",
      MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_ISSUER: "control-plane-api",
      MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_AUDIENCE: "data-plane-gateway",
      MISTLE_GLOBAL_SANDBOX_PROVIDER: "docker",
      MISTLE_APPS_CONTROL_PLANE_API_HOST: "127.0.0.1",
      MISTLE_APPS_CONTROL_PLANE_API_PORT: "5000",
      MISTLE_APPS_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL: "http://127.0.0.1:5300",
      MISTLE_GLOBAL_SANDBOX_DEFAULT_BASE_IMAGE: "127.0.0.1:5001/mistle/sandbox-base:dev",
      MISTLE_GLOBAL_SANDBOX_INTERNAL_GATEWAY_WS_URL: "ws://127.0.0.1:5302/tunnel/sandbox",
      MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_ACTIVE_MASTER_ENCRYPTION_KEY_VERSION: "3",
      MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON:
        '{"3":"integration-master-key"}',
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS: "http://a.local,http://b.local",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_LENGTH: "6",
      MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "true",
      MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY: "4",
      MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL: "http://127.0.0.1:5300",
      MISTLE_APPS_CONTROL_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL: "http://127.0.0.1:5100",
      MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_BOOTSTRAP_TOKEN_TTL_SECONDS: "120",
      MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_EXCHANGE_TOKEN_TTL_SECONDS: "3600",
      MISTLE_APPS_DATA_PLANE_WORKER_REAPER_POLL_INTERVAL_SECONDS: "30",
      MISTLE_APPS_DATA_PLANE_WORKER_REAPER_WEBHOOK_IDLE_TIMEOUT_SECONDS: "300",
      MISTLE_APPS_DATA_PLANE_WORKER_REAPER_EXECUTION_LEASE_FRESHNESS_SECONDS: "30",
      MISTLE_APPS_DATA_PLANE_WORKER_REAPER_TUNNEL_DISCONNECT_GRACE_SECONDS: "60",
      MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL:
        "http://127.0.0.1:5100/tokenizer-proxy/egress",
    });

    expect(tomlRecord).toEqual({
      global: {
        env: "development",
        telemetry: {
          enabled: true,
          debug: false,
          traces: {
            endpoint: "http://127.0.0.1:4318/v1/traces",
          },
          logs: {
            endpoint: "http://127.0.0.1:4318/v1/logs",
          },
          metrics: {
            endpoint: "http://127.0.0.1:4318/v1/metrics",
          },
          resource_attributes: "deployment.environment=test",
        },
        sandbox: {
          provider: "docker",
          default_base_image: "127.0.0.1:5001/mistle/sandbox-base:dev",
          internal_gateway_ws_url: "ws://127.0.0.1:5302/tunnel/sandbox",
          bootstrap: {
            token_secret: "fixture-bootstrap-secret",
            token_issuer: "data-plane-worker",
            token_audience: "data-plane-gateway",
          },
          connect: {
            token_secret: "fixture-connection-secret",
            token_issuer: "control-plane-api",
            token_audience: "data-plane-gateway",
          },
        },
      },
      apps: {
        control_plane_api: {
          server: {
            host: "127.0.0.1",
            port: 5000,
          },
          data_plane_api: {
            base_url: "http://127.0.0.1:5300",
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
          control_plane_api: {
            base_url: "http://127.0.0.1:5100",
          },
        },
        data_plane_worker: {
          tunnel: {
            bootstrap_token_ttl_seconds: 120,
            exchange_token_ttl_seconds: 3600,
          },
          reaper: {
            poll_interval_seconds: 30,
            webhook_idle_timeout_seconds: 300,
            execution_lease_freshness_seconds: 30,
            tunnel_disconnect_grace_seconds: 60,
          },
          sandbox: {
            tokenizer_proxy_egress_base_url: "http://127.0.0.1:5100/tokenizer-proxy/egress",
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
        telemetry: {
          enabled: true,
          debug: false,
          traces: {
            endpoint: "http://otel-collector:4318/v1/traces",
          },
          logs: {
            endpoint: "http://otel-collector:4318/v1/logs",
          },
          metrics: {
            endpoint: "http://otel-collector:4318/v1/metrics",
          },
          resource_attributes: "deployment.environment=production",
        },
        sandbox: {
          provider: "docker",
          default_base_image: "registry.example.com/mistle/sandbox-base:prod",
          internal_gateway_ws_url: "ws://data-plane-gateway:8084/tunnel/sandbox",
          bootstrap: {
            token_secret: "prod-bootstrap-secret",
            token_issuer: "data-plane-worker",
            token_audience: "data-plane-gateway",
          },
          connect: {
            token_secret: "prod-connection-secret",
            token_issuer: "control-plane-api",
            token_audience: "data-plane-gateway",
          },
        },
      },
      apps: {
        control_plane_api: {
          data_plane_api: {
            base_url: "http://127.0.0.1:5300",
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
          control_plane_api: {
            base_url: "http://127.0.0.1:5100",
          },
          workflow: {
            run_migrations: false,
            concurrency: 2,
          },
        },
        data_plane_worker: {
          tunnel: {
            bootstrap_token_ttl_seconds: 120,
            exchange_token_ttl_seconds: 3600,
          },
          reaper: {
            poll_interval_seconds: 30,
            webhook_idle_timeout_seconds: 300,
            execution_lease_freshness_seconds: 30,
            tunnel_disconnect_grace_seconds: 60,
          },
          sandbox: {
            tokenizer_proxy_egress_base_url: "http://127.0.0.1:5100/tokenizer-proxy/egress",
          },
        },
      },
    });

    expect(envRecord).toEqual({
      NODE_ENV: "production",
      MISTLE_GLOBAL_TELEMETRY_ENABLED: "true",
      MISTLE_GLOBAL_TELEMETRY_DEBUG: "false",
      MISTLE_GLOBAL_TELEMETRY_TRACES_ENDPOINT: "http://otel-collector:4318/v1/traces",
      MISTLE_GLOBAL_TELEMETRY_LOGS_ENDPOINT: "http://otel-collector:4318/v1/logs",
      MISTLE_GLOBAL_TELEMETRY_METRICS_ENDPOINT: "http://otel-collector:4318/v1/metrics",
      MISTLE_GLOBAL_TELEMETRY_RESOURCE_ATTRIBUTES: "deployment.environment=production",
      MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_SECRET: "prod-bootstrap-secret",
      MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_ISSUER: "data-plane-worker",
      MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_AUDIENCE: "data-plane-gateway",
      MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_SECRET: "prod-connection-secret",
      MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_ISSUER: "control-plane-api",
      MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_AUDIENCE: "data-plane-gateway",
      MISTLE_GLOBAL_SANDBOX_PROVIDER: "docker",
      MISTLE_GLOBAL_SANDBOX_DEFAULT_BASE_IMAGE: "registry.example.com/mistle/sandbox-base:prod",
      MISTLE_GLOBAL_SANDBOX_INTERNAL_GATEWAY_WS_URL: "ws://data-plane-gateway:8084/tunnel/sandbox",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS: "https://a.example,https://b.example",
      MISTLE_APPS_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL: "http://127.0.0.1:5300",
      MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_ACTIVE_MASTER_ENCRYPTION_KEY_VERSION: "9",
      MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON:
        '{"9":"integration-master-key"}',
      MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "false",
      MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY: "2",
      MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL: "http://127.0.0.1:5300",
      MISTLE_APPS_CONTROL_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL: "http://127.0.0.1:5100",
      MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_BOOTSTRAP_TOKEN_TTL_SECONDS: "120",
      MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_EXCHANGE_TOKEN_TTL_SECONDS: "3600",
      MISTLE_APPS_DATA_PLANE_WORKER_REAPER_POLL_INTERVAL_SECONDS: "30",
      MISTLE_APPS_DATA_PLANE_WORKER_REAPER_WEBHOOK_IDLE_TIMEOUT_SECONDS: "300",
      MISTLE_APPS_DATA_PLANE_WORKER_REAPER_EXECUTION_LEASE_FRESHNESS_SECONDS: "30",
      MISTLE_APPS_DATA_PLANE_WORKER_REAPER_TUNNEL_DISCONNECT_GRACE_SECONDS: "60",
      MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL:
        "http://127.0.0.1:5100/tokenizer-proxy/egress",
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
