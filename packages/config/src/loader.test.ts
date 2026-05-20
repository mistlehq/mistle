import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadConfig, loadControlPlaneMaintenanceConfig, parseConfigRecord } from "./loader.js";
import { AppIds } from "./modules.js";
import { exportServiceConfigToEnv, type RuntimeEnvExportEntry } from "./runtime-env-export.js";

const ConfigSamplePath = fileURLToPath(
  new URL("../../../config/config.sample.toml", import.meta.url),
);

function buildControlPlaneApiServiceEnv(): NodeJS.ProcessEnv {
  return {
    MISTLE_SERVICES_CONTROL_PLANE_API_HOST: "0.0.0.0",
    MISTLE_SERVICES_CONTROL_PLANE_API_PORT: "8080",
    MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL: "postgresql://pooled.example/mistle",
    MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL: "postgresql://direct.example/mistle",
    MISTLE_OBJECT_STORE_ASSETS_BUCKET_NAME: "assets",
    MISTLE_OBJECT_STORE_ASSETS_REGION: "us-east-1",
    MISTLE_OBJECT_STORE_ASSETS_ACCESS_KEY_ID: "assets-access-key",
    MISTLE_OBJECT_STORE_ASSETS_SECRET_ACCESS_KEY: "assets-secret-key",
    MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL: "https://api.example",
    MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_SECRET: "auth-secret",
    MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS: "https://app.example",
    MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_OTP_LENGTH: "6",
    MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_OTP_EXPIRES_IN_SECONDS: "300",
    MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_OTP_ALLOWED_ATTEMPTS: "5",
    MISTLE_SERVICES_CONTROL_PLANE_API_MCP_AUTH_SECRET: "mcp-auth-secret",
    MISTLE_SERVICES_CONTROL_PLANE_API_MCP_AUTH_ISSUER: "control-plane-api",
    MISTLE_SERVICES_CONTROL_PLANE_API_MCP_AUTH_AUDIENCE: "mistle-mcp",
    MISTLE_SERVICES_DASHBOARD_PUBLIC_URL: "https://app.example",
    MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID: "staging",
    MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL: "http://data-plane-api:8082",
    MISTLE_INTERNAL_AUTH_SHARED_TOKEN: "internal-service-token",
    MISTLE_SANDBOX_TOKENS_CONNECT_SECRET: "connect-secret",
    MISTLE_SANDBOX_TOKENS_CONNECT_ISSUER: "mistle",
    MISTLE_SANDBOX_TOKENS_CONNECT_AUDIENCE: "sandbox-connect",
    MISTLE_SANDBOX_PUBLISH_BASE_DOMAIN: "sandbox.example",
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL: "wss://gateway.example/sandbox",
    MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET: "publish-access-secret",
    MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER: "mistle",
    MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE: "sandbox-publish",
    MISTLE_SANDBOX_DEFAULT_BASE_IMAGE: "ghcr.io/mistlehq/sandbox-base:test",
    MISTLE_SANDBOX_DOCKER_ENABLED: "true",
    MISTLE_SANDBOX_E2B_ENABLED: "true",
    MISTLE_SANDBOX_E2B_API_KEY: "shared-e2b-secret",
    MISTLE_SANDBOX_TENSORLAKE_ENABLED: "true",
    MISTLE_SANDBOX_TENSORLAKE_API_KEY: "shared-tensorlake-secret",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET: "bootstrap-secret",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_ISSUER: "mistle",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_AUDIENCE: "sandbox-bootstrap",
    MISTLE_SANDBOX_TOKENS_EGRESS_SECRET: "egress-secret",
    MISTLE_SANDBOX_TOKENS_EGRESS_ISSUER: "mistle",
    MISTLE_SANDBOX_TOKENS_EGRESS_AUDIENCE: "sandbox-egress",
    MISTLE_SANDBOX_TOKENS_PTY_TRANSPORT_SECRET: "pty-secret",
    MISTLE_SANDBOX_TOKENS_PTY_TRANSPORT_ISSUER: "mistle",
    MISTLE_SANDBOX_TOKENS_PTY_TRANSPORT_AUDIENCE: "sandbox-pty",
    MISTLE_SERVICES_CONTROL_PLANE_API_INTEGRATIONS_ACTIVE_MASTER_ENCRYPTION_KEY_VERSION: "1",
    MISTLE_SERVICES_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON:
      '{"1":"master-encryption-key"}',
  };
}

function buildDataPlaneApiServiceEnv(): NodeJS.ProcessEnv {
  return {
    MISTLE_SERVICES_DATA_PLANE_API_HOST: "0.0.0.0",
    MISTLE_SERVICES_DATA_PLANE_API_PORT: "8082",
    MISTLE_POSTGRES_DATA_PLANE_POOLED_URL: "postgresql://data-plane-pooled.example/mistle",
    MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL: "postgresql://data-plane-direct.example/mistle",
    MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID: "staging",
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL: "http://data-plane-gateway:8084",
    MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: "http://control-plane-api:8080",
    MISTLE_INTERNAL_AUTH_SHARED_TOKEN: "internal-service-token",
    MISTLE_SANDBOX_DOCKER_ENABLED: "true",
    MISTLE_SANDBOX_DOCKER_SOCKET_PATH: "/var/run/docker.sock",
  };
}

function buildControlPlaneWorkerServiceEnv(): NodeJS.ProcessEnv {
  return {
    MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL: "postgresql://control-pooled.example/mistle",
    MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL: "postgresql://control-direct.example/mistle",
    MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID: "staging",
    MISTLE_SERVICES_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY: "4",
    MISTLE_EMAIL_SMTP_FROM_ADDRESS: "no-reply@example.com",
    MISTLE_EMAIL_SMTP_FROM_NAME: "Mistle",
    MISTLE_EMAIL_SMTP_HOST: "smtp.example.com",
    MISTLE_EMAIL_SMTP_PORT: "587",
    MISTLE_EMAIL_SMTP_SECURE: "false",
    MISTLE_EMAIL_SMTP_USERNAME: "smtp-user",
    MISTLE_EMAIL_SMTP_PASSWORD: "smtp-password",
    MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL: "http://data-plane-api:8082",
    MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: "http://control-plane-api:8080",
    MISTLE_INTERNAL_AUTH_SHARED_TOKEN: "internal-service-token",
    MISTLE_SANDBOX_DEFAULT_BASE_IMAGE: "ghcr.io/mistlehq/sandbox-base:test",
  };
}

function runtimeEnvEntriesToProcessEnv(entries: RuntimeEnvExportEntry[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const entry of entries) {
    if (entry.valueFormat === "json") {
      env[entry.name] = JSON.stringify(entry.value);
    } else if (entry.valueFormat === "csv") {
      env[entry.name] = Array.isArray(entry.value) ? entry.value.join(",") : String(entry.value);
    } else {
      env[entry.name] = String(entry.value);
    }
  }

  return env;
}

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

describe("loadControlPlaneMaintenanceConfig", () => {
  it("loads only the control-plane direct database URL from the new env surface", () => {
    const loadedConfig = loadControlPlaneMaintenanceConfig({
      env: {
        MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL: "postgresql://direct.example/mistle",
      },
    });

    expect(loadedConfig.app).toEqual({
      database: {
        migrationUrl: "postgresql://direct.example/mistle",
      },
      telemetry: {
        enabled: false,
        debug: false,
      },
    });
  });

  it("loads maintenance telemetry from the new env surface", () => {
    const loadedConfig = loadControlPlaneMaintenanceConfig({
      env: {
        MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL: "postgresql://direct.example/mistle",
        MISTLE_TELEMETRY_ENABLED: "1",
        MISTLE_TELEMETRY_DEBUG: "true",
        MISTLE_TELEMETRY_TRACES_ENDPOINT: "http://otel.example/v1/traces",
        MISTLE_TELEMETRY_LOGS_ENDPOINT: "http://otel.example/v1/logs",
        MISTLE_TELEMETRY_METRICS_ENDPOINT: "http://otel.example/v1/metrics",
        MISTLE_TELEMETRY_RESOURCE_ATTRIBUTES: "deployment.environment=staging",
      },
    });

    expect(loadedConfig.app.telemetry).toEqual({
      enabled: true,
      debug: true,
      traces: {
        endpoint: "http://otel.example/v1/traces",
      },
      logs: {
        endpoint: "http://otel.example/v1/logs",
      },
      metrics: {
        endpoint: "http://otel.example/v1/metrics",
      },
      resourceAttributes: "deployment.environment=staging",
    });
  });

  it("rejects enabled maintenance telemetry without endpoints", () => {
    expect(() =>
      loadControlPlaneMaintenanceConfig({
        env: {
          MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL: "postgresql://direct.example/mistle",
          MISTLE_TELEMETRY_ENABLED: "true",
        },
      }),
    ).toThrow(/traces/u);
  });

  it("rejects missing maintenance database config when only unrecognized env is set", () => {
    expect(() =>
      loadControlPlaneMaintenanceConfig({
        env: {
          MISTLE_UNKNOWN_CONTROL_PLANE_DIRECT_URL: "postgresql://unknown-direct.example/mistle",
        },
      }),
    ).toThrow(/Set MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL/u);
  });

  it("loads the control-plane direct database URL from central TOML resources", () => {
    const loadedConfig = loadControlPlaneMaintenanceConfig({
      configPath: ConfigSamplePath,
    });

    expect(loadedConfig.app).toEqual({
      database: {
        migrationUrl: "postgresql://mistle:replace-with-password@db:5432/mistle",
      },
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
        resourceAttributes: "deployment.environment=production",
      },
    });
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
    expect(loadedConfig.app.gatewayRelay).toEqual({
      backend: "memory",
    });
  });

  it("loads env control-plane API config without unrelated service config", () => {
    const loadedConfig = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      includeGlobal: false,
      env: buildControlPlaneApiServiceEnv(),
    });

    expect(loadedConfig.app.database).toEqual({
      url: "postgresql://pooled.example/mistle",
      migrationUrl: "postgresql://direct.example/mistle",
    });
    expect(loadedConfig.app.workflow).toEqual({
      databaseUrl: "postgresql://direct.example/mistle",
      migrationUrl: "postgresql://direct.example/mistle",
      namespaceId: "staging",
    });
    expect(loadedConfig.app.sandbox.e2b).toEqual({
      enabled: true,
      apiKey: "shared-e2b-secret",
      domain: "e2b.app",
    });
    expect(loadedConfig.app.sandbox.tensorlake).toEqual({
      enabled: true,
      apiKey: "shared-tensorlake-secret",
    });
  });

  it("loads env data-plane API Docker config when shared E2B env is also present", () => {
    const loadedConfig = loadConfig({
      app: AppIds.DATA_PLANE_API,
      includeGlobal: false,
      env: buildDataPlaneApiServiceEnv(),
    });

    expect(loadedConfig.app.sandbox).toEqual({
      docker: {
        enabled: true,
        socketPath: "/var/run/docker.sock",
      },
    });
  });

  it("keeps control-plane worker Stripe billing disabled when only the secret is provisioned", () => {
    const loadedConfig = loadConfig({
      app: AppIds.CONTROL_PLANE_WORKER,
      includeGlobal: false,
      env: {
        ...buildControlPlaneWorkerServiceEnv(),
        MISTLE_BILLING_STRIPE_SECRET_KEY: "sk_test_secret",
      },
    });

    expect(loadedConfig.app.billing.stripe).toEqual({
      enabled: false,
      secretKey: "sk_test_secret",
    });
  });

  it.each([
    AppIds.CONTROL_PLANE_API,
    AppIds.CONTROL_PLANE_WORKER,
    AppIds.DATA_PLANE_API,
    AppIds.DATA_PLANE_GATEWAY,
    AppIds.DATA_PLANE_WORKER,
  ])("loads %s from its exported service env", (app) => {
    const configFromToml = loadConfig({
      app,
      configPath: ConfigSamplePath,
    });
    const env = runtimeEnvEntriesToProcessEnv(
      exportServiceConfigToEnv({
        app,
        config: configFromToml,
      }),
    );

    expect(() =>
      loadConfig({
        app,
        includeGlobal: false,
        env,
      }),
    ).not.toThrow();
  });

  it("rejects env service config when required resource config is incomplete", () => {
    expect(() =>
      loadConfig({
        app: AppIds.DATA_PLANE_WORKER,
        includeGlobal: false,
        env: {
          MISTLE_POSTGRES_DATA_PLANE_POOLED_URL: "postgresql://runtime.example/mistle",
        },
      }),
    ).toThrow(/enabled/u);
  });
});
