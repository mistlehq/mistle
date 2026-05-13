import { describe, expect, it } from "vitest";

import { loadRootConfigFromEnv } from "./load-env.js";

describe("loadRootConfigFromEnv", () => {
  it("maps new env names to central root config paths", () => {
    const rootConfig = loadRootConfigFromEnv({
      MISTLE_ENV: "production",
      MISTLE_INTERNAL_AUTH_METHOD: "shared_token",
      MISTLE_INTERNAL_AUTH_SHARED_TOKEN: "internal-token",
      MISTLE_TELEMETRY_ENABLED: "true",
      MISTLE_TELEMETRY_DEBUG: "false",
      MISTLE_TELEMETRY_TRACES_ENDPOINT: "http://otel:4318/v1/traces",
      MISTLE_TELEMETRY_LOGS_ENDPOINT: "http://otel:4318/v1/logs",
      MISTLE_TELEMETRY_METRICS_ENDPOINT: "http://otel:4318/v1/metrics",
      MISTLE_TELEMETRY_RESOURCE_ATTRIBUTES: "deployment.environment=staging",
      MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL: "postgresql://control-direct/mistle",
      MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL: "postgresql://control-pooled/mistle",
      MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL: "postgresql://data-direct/mistle",
      MISTLE_POSTGRES_DATA_PLANE_POOLED_URL: "postgresql://data-pooled/mistle",
      MISTLE_KV_CONTROL_PLANE_BACKEND: "valkey",
      MISTLE_KV_CONTROL_PLANE_URL: "redis://control-valkey:6379",
      MISTLE_KV_CONTROL_PLANE_KEY_PREFIX: "mistle:control",
      MISTLE_KV_DATA_PLANE_BACKEND: "valkey",
      MISTLE_KV_DATA_PLANE_URL: "redis://data-valkey:6379",
      MISTLE_KV_DATA_PLANE_KEY_PREFIX: "mistle:data",
      MISTLE_OBJECT_STORE_ASSETS_BUCKET_NAME: "assets",
      MISTLE_OBJECT_STORE_ASSETS_REGION: "us-east-1",
      MISTLE_OBJECT_STORE_ASSETS_ENDPOINT: "https://assets.example",
      MISTLE_OBJECT_STORE_ASSETS_FORCE_PATH_STYLE: "true",
      MISTLE_OBJECT_STORE_ASSETS_ACCESS_KEY_ID: "assets-access",
      MISTLE_OBJECT_STORE_ASSETS_SECRET_ACCESS_KEY: "assets-secret",
      MISTLE_OBJECT_STORE_SANDBOX_STORAGE_BUCKET_NAME: "sandbox-storage",
      MISTLE_OBJECT_STORE_SANDBOX_STORAGE_REGION: "us-central1",
      MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ENDPOINT: "https://sandbox-storage.example",
      MISTLE_OBJECT_STORE_SANDBOX_STORAGE_FORCE_PATH_STYLE: "false",
      MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ACCESS_KEY_ID: "sandbox-access",
      MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY: "sandbox-secret",
      MISTLE_EMAIL_SMTP_FROM_ADDRESS: "no-reply@example.com",
      MISTLE_EMAIL_SMTP_FROM_NAME: "Mistle",
      MISTLE_EMAIL_SMTP_HOST: "smtp.example.com",
      MISTLE_EMAIL_SMTP_PORT: "587",
      MISTLE_EMAIL_SMTP_SECURE: "false",
      MISTLE_EMAIL_SMTP_USERNAME: "smtp-user",
      MISTLE_EMAIL_SMTP_PASSWORD: "smtp-password",
      MISTLE_SERVICES_DASHBOARD_PUBLIC_URL: "https://app.example.com",
      MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN: "https://api.example.com",
      MISTLE_SERVICES_CONTROL_PLANE_API_HOST: "0.0.0.0",
      MISTLE_SERVICES_CONTROL_PLANE_API_PORT: "8080",
      MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL: "https://api.example.com",
      MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: "http://control-plane-api:8080",
      MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_SECRET: "auth-secret",
      MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS: "https://app.example.com",
      MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_ENABLED_METHODS: "otp,google",
      MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_ALLOW_SIGNUPS: "false",
      MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_OTP_LENGTH: "6",
      MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_OTP_EXPIRES_IN_SECONDS: "300",
      MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_OTP_ALLOWED_ATTEMPTS: "3",
      MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_ID: "google-client-id",
      MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_SECRET: "google-client-secret",
      MISTLE_SERVICES_CONTROL_PLANE_API_INTEGRATIONS_ACTIVE_MASTER_ENCRYPTION_KEY_VERSION: "1",
      MISTLE_SERVICES_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON:
        '{"1":"master-key"}',
      MISTLE_SERVICES_DATA_PLANE_API_HOST: "0.0.0.0",
      MISTLE_SERVICES_DATA_PLANE_API_PORT: "8082",
      MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL: "http://data-plane-api:8082",
      MISTLE_SERVICES_DATA_PLANE_GATEWAY_HOST: "0.0.0.0",
      MISTLE_SERVICES_DATA_PLANE_GATEWAY_PORT: "8084",
      MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL: "http://data-plane-gateway:8084",
      MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL:
        "wss://gateway.example.com/tunnel/sandbox",
      MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL:
        "ws://data-plane-gateway:8084/tunnel/sandbox",
      MISTLE_SERVICES_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY: "4",
      MISTLE_SERVICES_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY: "5",
      MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID: "control",
      MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID: "data",
      MISTLE_SANDBOX_DEFAULT_BASE_IMAGE: "registry.example.com/sandbox:latest",
      MISTLE_SANDBOX_STORAGE_BACKEND: "archil",
      MISTLE_SANDBOX_DOCKER_ENABLED: "true",
      MISTLE_SANDBOX_DOCKER_SOCKET_PATH: "/var/run/docker.sock",
      MISTLE_SANDBOX_DOCKER_NETWORK_NAME: "mistle-sandbox",
      MISTLE_SANDBOX_E2B_ENABLED: "true",
      MISTLE_SANDBOX_E2B_API_KEY: "e2b-api-key",
      MISTLE_SANDBOX_E2B_DOMAIN: "e2b.example.com",
      MISTLE_SANDBOX_E2B_CPU_COUNT: "4",
      MISTLE_SANDBOX_E2B_MEMORY_MB: "8192",
      MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY: "archil-api-key",
      MISTLE_SANDBOX_STORAGE_ARCHIL_REGION: "gcp-us-central1",
      MISTLE_SANDBOX_STORAGE_ARCHIL_NAME_PREFIX: "mistle-",
      MISTLE_SANDBOX_STORAGE_ARCHIL_MOUNT_OBJECT_STORE: "sandbox_storage",
      MISTLE_SANDBOX_STORAGE_DOCKER_VOLUME_NAME_PREFIX: "mistle-",
      MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET: "bootstrap-secret",
      MISTLE_SANDBOX_TOKENS_BOOTSTRAP_ISSUER: "data-plane-worker",
      MISTLE_SANDBOX_TOKENS_BOOTSTRAP_AUDIENCE: "data-plane-gateway",
      MISTLE_SANDBOX_TOKENS_CONNECT_SECRET: "connect-secret",
      MISTLE_SANDBOX_TOKENS_CONNECT_ISSUER: "control-plane-api",
      MISTLE_SANDBOX_TOKENS_CONNECT_AUDIENCE: "data-plane-gateway",
      MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET: "publish-access-secret",
      MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER: "control-plane-api",
      MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE: "data-plane-gateway",
      MISTLE_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET: "publish-session-secret",
      MISTLE_SANDBOX_PUBLISH_BASE_DOMAIN: "mistle.example",
      MISTLE_TEST_SANDBOXD_TEST_FAULTS_ENABLED: "true",
    });

    expect(rootConfig).toEqual({
      global: {
        env: "production",
      },
      internal_auth: {
        method: "shared_token",
        shared_token: {
          token: "internal-token",
        },
      },
      telemetry: {
        enabled: true,
        debug: false,
        traces: {
          endpoint: "http://otel:4318/v1/traces",
        },
        logs: {
          endpoint: "http://otel:4318/v1/logs",
        },
        metrics: {
          endpoint: "http://otel:4318/v1/metrics",
        },
        resource_attributes: "deployment.environment=staging",
      },
      postgres: {
        control_plane: {
          direct_url: "postgresql://control-direct/mistle",
          pooled_url: "postgresql://control-pooled/mistle",
        },
        data_plane: {
          direct_url: "postgresql://data-direct/mistle",
          pooled_url: "postgresql://data-pooled/mistle",
        },
      },
      kv: {
        control_plane: {
          backend: "valkey",
          url: "redis://control-valkey:6379",
          key_prefix: "mistle:control",
        },
        data_plane: {
          backend: "valkey",
          url: "redis://data-valkey:6379",
          key_prefix: "mistle:data",
        },
      },
      object_store: {
        assets: {
          bucket_name: "assets",
          region: "us-east-1",
          endpoint: "https://assets.example",
          force_path_style: true,
          access_key_id: "assets-access",
          secret_access_key: "assets-secret",
        },
        sandbox_storage: {
          bucket_name: "sandbox-storage",
          region: "us-central1",
          endpoint: "https://sandbox-storage.example",
          force_path_style: false,
          access_key_id: "sandbox-access",
          secret_access_key: "sandbox-secret",
        },
      },
      email: {
        smtp: {
          from_address: "no-reply@example.com",
          from_name: "Mistle",
          host: "smtp.example.com",
          port: 587,
          secure: false,
          username: "smtp-user",
          password: "smtp-password",
        },
      },
      services: {
        dashboard: {
          public_url: "https://app.example.com",
          control_plane_api_origin: "https://api.example.com",
        },
        control_plane_api: {
          host: "0.0.0.0",
          port: 8080,
          public_url: "https://api.example.com",
          internal_url: "http://control-plane-api:8080",
          auth: {
            secret: "auth-secret",
            trusted_origins: ["https://app.example.com"],
            enabled_methods: ["otp", "google"],
            allow_signups: false,
            otp: {
              length: 6,
              expires_in_seconds: 300,
              allowed_attempts: 3,
            },
            google: {
              client_id: "google-client-id",
              client_secret: "google-client-secret",
            },
          },
          integrations: {
            active_master_encryption_key_version: 1,
            master_encryption_keys: {
              "1": "master-key",
            },
          },
        },
        data_plane_api: {
          host: "0.0.0.0",
          port: 8082,
          internal_url: "http://data-plane-api:8082",
        },
        data_plane_gateway: {
          host: "0.0.0.0",
          port: 8084,
          internal_url: "http://data-plane-gateway:8084",
          sandbox_ws_public_url: "wss://gateway.example.com/tunnel/sandbox",
          sandbox_ws_internal_url: "ws://data-plane-gateway:8084/tunnel/sandbox",
        },
        control_plane_worker: {
          workflow_concurrency: 4,
        },
        data_plane_worker: {
          workflow_concurrency: 5,
        },
      },
      workflow: {
        control_plane: {
          namespace_id: "control",
        },
        data_plane: {
          namespace_id: "data",
        },
      },
      sandbox: {
        default_base_image: "registry.example.com/sandbox:latest",
        publish_base_domain: "mistle.example",
        storage: {
          backend: "archil",
          archil: {
            api_key: "archil-api-key",
            region: "gcp-us-central1",
            name_prefix: "mistle-",
            mount_object_store: "sandbox_storage",
          },
          docker_volume: {
            name_prefix: "mistle-",
          },
        },
        docker: {
          enabled: true,
          socket_path: "/var/run/docker.sock",
          network_name: "mistle-sandbox",
        },
        e2b: {
          enabled: true,
          api_key: "e2b-api-key",
          domain: "e2b.example.com",
          cpu_count: 4,
          memory_mb: 8192,
        },
        tokens: {
          bootstrap: {
            secret: "bootstrap-secret",
            issuer: "data-plane-worker",
            audience: "data-plane-gateway",
          },
          connect: {
            secret: "connect-secret",
            issuer: "control-plane-api",
            audience: "data-plane-gateway",
          },
        },
        publish: {
          access_token: {
            secret: "publish-access-secret",
            issuer: "control-plane-api",
            audience: "data-plane-gateway",
          },
          session: {
            cookie_signing_secret: "publish-session-secret",
          },
        },
        sandboxd_test_faults_enabled: true,
      },
    });
  });

  it("ignores unrecognized env names", () => {
    const rootConfig = loadRootConfigFromEnv({
      MISTLE_UNKNOWN_DATA_PLANE_DATABASE_URL: "postgresql://unknown/mistle",
    });

    expect(rootConfig).toEqual({});
  });
});
