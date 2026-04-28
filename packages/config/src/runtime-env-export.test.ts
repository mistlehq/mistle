import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadConfig, type LoadConfigResult } from "./loader.js";
import { AppIds } from "./modules.js";
import { exportServiceConfigToEnv, type RuntimeEnvExportEntry } from "./runtime-env-export.js";
import type { AppConfig } from "./schema.js";

const ConfigSamplePath = fileURLToPath(
  new URL("../../../config/config.sample.toml", import.meta.url),
);

const GlobalConfig = {
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
    resourceAttributes: "deployment.environment=staging",
  },
  internalAuth: {
    serviceToken: "secret://MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN",
  },
  sandbox: {
    provider: "docker",
    storage: {
      backend: "archil",
    },
    defaultBaseImage: "ghcr.io/mistlehq/sandbox-base:staging",
    gatewayWsUrl: "wss://gateway.mistle.example/tunnel/sandbox",
    internalGatewayWsUrl: "ws://data-plane-gateway:8084/tunnel/sandbox",
    connect: {
      tokenSecret: "connect-token-secret",
      tokenIssuer: "control-plane-api",
      tokenAudience: "data-plane-gateway",
    },
    bootstrap: {
      tokenSecret: "bootstrap-token-secret",
      tokenIssuer: "data-plane-worker",
      tokenAudience: "data-plane-gateway",
    },
    egress: {
      tokenSecret: "egress-token-secret",
      tokenIssuer: "data-plane-worker",
      tokenAudience: "tokenizer-proxy",
    },
    publish: {
      baseDomain: "mistle.example",
      access: {
        tokenSecret: "publish-token-secret",
        tokenIssuer: "control-plane-api",
        tokenAudience: "data-plane-gateway",
      },
      session: {
        cookieSigningSecret: "publish-cookie-secret",
      },
    },
  },
} satisfies AppConfig["global"];

function expectEntry(
  entries: readonly RuntimeEnvExportEntry[],
  expected: RuntimeEnvExportEntry,
): void {
  expect(entries).toContainEqual(expected);
}

describe("exportServiceConfigToEnv", () => {
  it("exports global and control plane API config to runtime env entries", () => {
    const loadedConfig = {
      global: GlobalConfig,
      app: {
        server: {
          host: "0.0.0.0",
          port: 8080,
        },
        database: {
          url: "secret://MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL",
          migrationUrl: "secret://MISTLE_APPS_CONTROL_PLANE_API_DATABASE_MIGRATION_URL",
        },
        objectStore: {
          bucketName: "mistle-assets",
          region: "us-east-1",
          endpoint: "https://s3.example.com",
          forcePathStyle: true,
          accessKeyId: "asset-access-key",
          secretAccessKey: "secret://MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_SECRET_ACCESS_KEY",
        },
        auth: {
          baseUrl: "https://api.mistle.example",
          secret: "auth-secret",
          trustedOrigins: ["https://app.mistle.example", "https://preview.mistle.example"],
          otpLength: 6,
          otpExpiresInSeconds: 300,
          otpAllowedAttempts: 3,
          google: {
            clientId: "google-client-id",
            clientSecret: "google-client-secret",
          },
        },
        dashboard: {
          baseUrl: "https://app.mistle.example",
        },
        workflow: {
          databaseUrl: "secret://MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_DATABASE_URL",
          migrationUrl: "secret://MISTLE_APPS_CONTROL_PLANE_API_DATABASE_MIGRATION_URL",
          namespaceId: "staging",
        },
        dataPlaneApi: {
          baseUrl: "http://data-plane-api:8082",
        },
        internalAuth: {
          serviceToken: "secret://MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN",
        },
        connectionToken: {
          secret: "connect-token-secret",
          issuer: "control-plane-api",
          audience: "data-plane-gateway",
        },
        portAccess: {
          baseDomain: "mistle.example",
          gatewayWsUrl: "wss://gateway.mistle.example/tunnel/sandbox",
          access: {
            tokenSecret: "publish-token-secret",
            tokenIssuer: "control-plane-api",
            tokenAudience: "data-plane-gateway",
          },
        },
        sandbox: {
          defaultBaseImage: "ghcr.io/mistlehq/sandbox-base:staging",
          gatewayWsUrl: "wss://gateway.mistle.example/tunnel/sandbox",
          bootstrap: {
            tokenSecret: "bootstrap-token-secret",
            tokenIssuer: "data-plane-worker",
            tokenAudience: "data-plane-gateway",
          },
          storageBackend: "archil",
        },
        commitSign: {
          binaryPath: "/app/bin/commit-sign",
        },
        integrations: {
          activeMasterEncryptionKeyVersion: 1,
          masterEncryptionKeys: {
            "1": "master-key",
          },
        },
      },
    } satisfies LoadConfigResult<typeof AppIds.CONTROL_PLANE_API>;

    const entries = exportServiceConfigToEnv({
      app: AppIds.CONTROL_PLANE_API,
      config: loadedConfig,
    });

    expect(entries).toContainEqual({
      name: "MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN",
      value: "secret://MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN",
    });
    expect(entries).toContainEqual({
      name: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS",
      value: ["https://app.mistle.example", "https://preview.mistle.example"],
      valueFormat: "csv",
    });
    expect(entries).toContainEqual({
      name: "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON",
      value: {
        "1": "master-key",
      },
      valueFormat: "json",
    });
    expect(entries).toContainEqual({
      name: "MISTLE_APPS_CONTROL_PLANE_API_COMMIT_SIGN_BINARY_PATH",
      value: "/app/bin/commit-sign",
    });
  });

  it("exports data plane worker config without undefined optional env entries", () => {
    const loadedConfig = {
      global: GlobalConfig,
      app: {
        database: {
          url: "secret://MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL",
        },
        workflow: {
          databaseUrl: "secret://MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL",
          namespaceId: "staging",
          runMigrations: false,
          concurrency: 4,
        },
        runtimeState: {
          gatewayBaseUrl: "http://data-plane-gateway:8084",
        },
        controlPlaneApi: {
          baseUrl: "http://control-plane-api:8080",
        },
        sandbox: {
          provider: GlobalConfig.sandbox.provider,
          storage: GlobalConfig.sandbox.storage,
          internalGatewayWsUrl: GlobalConfig.sandbox.internalGatewayWsUrl,
          bootstrap: GlobalConfig.sandbox.bootstrap,
          egress: GlobalConfig.sandbox.egress,
          tokenizerProxyEgressBaseUrl: "https://api.mistle.example/tokenizer-proxy/egress",
          docker: {
            socketPath: "/var/run/docker.sock",
          },
        },
        sandboxStorage: {
          archil: {
            apiKey: "secret://MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_API_KEY",
            region: "gcp-us-central1",
            mounts: [
              {
                type: "s3-compatible",
                bucket: "mistle-sandbox-storage",
                endpoint: "https://s3.example.com",
                accessKeyId: "secret://ARCHIL_MOUNT_ACCESS_KEY_ID",
                secretAccessKey: "secret://ARCHIL_MOUNT_SECRET_ACCESS_KEY",
              },
            ],
          },
        },
        internalAuth: GlobalConfig.internalAuth,
        telemetry: GlobalConfig.telemetry,
      },
    } satisfies LoadConfigResult<typeof AppIds.DATA_PLANE_WORKER>;

    const entries = exportServiceConfigToEnv({
      app: AppIds.DATA_PLANE_WORKER,
      config: loadedConfig,
    });

    expect(entries).toContainEqual({
      name: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS",
      value: false,
    });
    expect(entries).toContainEqual({
      name: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON",
      value: [
        {
          type: "s3-compatible",
          bucket: "mistle-sandbox-storage",
          endpoint: "https://s3.example.com",
          accessKeyId: "secret://ARCHIL_MOUNT_ACCESS_KEY_ID",
          secretAccessKey: "secret://ARCHIL_MOUNT_SECRET_ACCESS_KEY",
        },
      ],
      valueFormat: "json",
    });
    expect(entries).not.toContainEqual({
      name: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_NETWORK_NAME",
      value: undefined,
    });
    expect(entries.map((entry) => entry.name)).not.toContain(
      "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_NAME_PREFIX",
    );
  });

  it("exports control plane API config to resource env entries", () => {
    const loadedConfig = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      configPath: ConfigSamplePath,
    });

    const entries = exportServiceConfigToEnv({
      app: AppIds.CONTROL_PLANE_API,
      config: loadedConfig,
      envSurface: "resource",
    });

    expectEntry(entries, {
      name: "MISTLE_INTERNAL_AUTH_SHARED_TOKEN",
      value: "replace-with-internal-service-token",
    });
    expectEntry(entries, {
      name: "MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL",
      value: "postgresql://mistle:replace-with-password@pgbouncer:6432/mistle",
    });
    expectEntry(entries, {
      name: "MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL",
      value: "postgresql://mistle:replace-with-password@db:5432/mistle",
    });
    expectEntry(entries, {
      name: "MISTLE_OBJECT_STORE_ASSETS_SECRET_ACCESS_KEY",
      value: "replace-with-object-store-secret-key",
    });
    expectEntry(entries, {
      name: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS",
      value: ["https://app.mistle.example"],
      valueFormat: "csv",
    });
    expectEntry(entries, {
      name: "MISTLE_SERVICES_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON",
      value: {
        "1": "replace-with-master-encryption-key",
      },
      valueFormat: "json",
    });
    expect(entries.map((entry) => entry.name)).not.toContain(
      "MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL",
    );
  });

  it("exports control plane worker config to resource env entries", () => {
    const loadedConfig = loadConfig({
      app: AppIds.CONTROL_PLANE_WORKER,
      configPath: ConfigSamplePath,
    });

    const entries = exportServiceConfigToEnv({
      app: AppIds.CONTROL_PLANE_WORKER,
      config: loadedConfig,
      envSurface: "resource",
    });

    expectEntry(entries, {
      name: "MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL",
      value: "postgresql://mistle:replace-with-password@pgbouncer:6432/mistle",
    });
    expectEntry(entries, {
      name: "MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID",
      value: "production",
    });
    expectEntry(entries, {
      name: "MISTLE_SERVICES_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY",
      value: 4,
    });
    expectEntry(entries, {
      name: "MISTLE_EMAIL_SMTP_PASSWORD",
      value: "replace-with-smtp-password",
    });
    expectEntry(entries, {
      name: "MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL",
      value: "http://control-plane-api:8080",
    });
  });

  it("exports data plane API config to resource env entries", () => {
    const loadedConfig = loadConfig({
      app: AppIds.DATA_PLANE_API,
      configPath: ConfigSamplePath,
    });

    const entries = exportServiceConfigToEnv({
      app: AppIds.DATA_PLANE_API,
      config: loadedConfig,
      envSurface: "resource",
    });

    expectEntry(entries, {
      name: "MISTLE_SERVICES_DATA_PLANE_API_PORT",
      value: 8082,
    });
    expectEntry(entries, {
      name: "MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL",
      value: "postgresql://mistle:replace-with-password@db:5432/mistle",
    });
    expectEntry(entries, {
      name: "MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID",
      value: "production",
    });
    expectEntry(entries, {
      name: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL",
      value: "http://data-plane-gateway:8084",
    });
    expectEntry(entries, {
      name: "MISTLE_SANDBOX_E2B_API_KEY",
      value: "replace-with-e2b-api-key",
    });
  });

  it("exports data plane gateway config to resource env entries", () => {
    const loadedConfig = loadConfig({
      app: AppIds.DATA_PLANE_GATEWAY,
      configPath: ConfigSamplePath,
    });

    const entries = exportServiceConfigToEnv({
      app: AppIds.DATA_PLANE_GATEWAY,
      config: loadedConfig,
      envSurface: "resource",
    });

    expectEntry(entries, {
      name: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_HOST",
      value: "0.0.0.0",
    });
    expectEntry(entries, {
      name: "MISTLE_POSTGRES_DATA_PLANE_POOLED_URL",
      value: "postgresql://mistle:replace-with-password@pgbouncer:6432/mistle",
    });
    expectEntry(entries, {
      name: "MISTLE_KV_DATA_PLANE_URL",
      value: "redis://valkey:6379",
    });
    expectEntry(entries, {
      name: "MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL",
      value: "http://data-plane-api:8082",
    });
  });

  it("exports data plane worker config to resource env entries", () => {
    const loadedConfig = loadConfig({
      app: AppIds.DATA_PLANE_WORKER,
      configPath: ConfigSamplePath,
    });

    const entries = exportServiceConfigToEnv({
      app: AppIds.DATA_PLANE_WORKER,
      config: loadedConfig,
      envSurface: "resource",
    });

    expectEntry(entries, {
      name: "MISTLE_SERVICES_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY",
      value: 4,
    });
    expectEntry(entries, {
      name: "MISTLE_SERVICES_TOKENIZER_PROXY_EGRESS_URL",
      value: "https://api.mistle.example/tokenizer-proxy/egress",
    });
    expectEntry(entries, {
      name: "MISTLE_SANDBOX_E2B_CPU_COUNT",
      value: 4,
    });
    expectEntry(entries, {
      name: "MISTLE_SANDBOX_STORAGE_ARCHIL_MOUNT_OBJECT_STORE",
      value: "sandbox_storage",
    });
    expectEntry(entries, {
      name: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY",
      value: "replace-with-sandbox-storage-secret-key",
    });
    expect(entries.map((entry) => entry.name)).not.toContain(
      "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON",
    );
  });

  it("exports tokenizer proxy config to resource env entries", () => {
    const loadedConfig = loadConfig({
      app: AppIds.TOKENIZER_PROXY,
      configPath: ConfigSamplePath,
    });

    const entries = exportServiceConfigToEnv({
      app: AppIds.TOKENIZER_PROXY,
      config: loadedConfig,
      envSurface: "resource",
    });

    expectEntry(entries, {
      name: "MISTLE_SERVICES_TOKENIZER_PROXY_PORT",
      value: 8085,
    });
    expectEntry(entries, {
      name: "MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL",
      value: "https://api.mistle.example",
    });
    expectEntry(entries, {
      name: "MISTLE_SANDBOX_TOKENS_EGRESS_SECRET",
      value: "replace-with-egress-token-secret",
    });
    expect(entries.map((entry) => entry.name)).not.toContain(
      "MISTLE_APPS_TOKENIZER_PROXY_CONTROL_PLANE_API_BASE_URL",
    );
  });

  it("requires global config to project runtime env entries", () => {
    const loadedConfig = {
      app: {
        server: {
          host: "0.0.0.0",
          port: 8085,
        },
        controlPlaneApi: {
          baseUrl: "http://control-plane-api:8080",
          publicBaseUrl: "https://api.mistle.example",
        },
        internalAuth: {
          serviceToken: "secret://MISTLE_INTERNAL_AUTH_SHARED_TOKEN",
        },
        egressGrant: {
          tokenSecret: "secret://MISTLE_SANDBOX_EGRESS_TOKEN_SECRET",
          tokenIssuer: "data-plane-worker",
          tokenAudience: "tokenizer-proxy",
        },
      },
    } satisfies LoadConfigResult<typeof AppIds.TOKENIZER_PROXY>;

    expect(() =>
      exportServiceConfigToEnv({
        app: AppIds.TOKENIZER_PROXY,
        config: loadedConfig,
      }),
    ).toThrow("Runtime env export requires loadConfig output that includes global config.");
  });
});
