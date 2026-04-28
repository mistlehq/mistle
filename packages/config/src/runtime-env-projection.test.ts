import { describe, expect, it } from "vitest";

import type { LoadConfigResult } from "./loader.js";
import { AppIds } from "./modules.js";
import { projectServiceConfigToEnv } from "./runtime-env-projection.js";
import type { AppConfig } from "./schema.js";

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

describe("projectServiceConfigToEnv", () => {
  it("projects global and control plane API config to runtime env entries", () => {
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

    const entries = projectServiceConfigToEnv({
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

  it("projects data plane worker config without undefined optional env entries", () => {
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
      },
    } satisfies LoadConfigResult<typeof AppIds.DATA_PLANE_WORKER>;

    const entries = projectServiceConfigToEnv({
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
      projectServiceConfigToEnv({
        app: AppIds.TOKENIZER_PROXY,
        config: loadedConfig,
      }),
    ).toThrow("Runtime env projection requires loadConfig output that includes global config.");
  });
});
