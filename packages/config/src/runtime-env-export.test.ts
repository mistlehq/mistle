import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadConfig, type LoadConfigResult } from "./loader.js";
import { AppIds } from "./modules.js";
import { exportServiceConfigToEnv, type RuntimeEnvExportEntry } from "./runtime-env-export.js";

const ConfigSamplePath = fileURLToPath(
  new URL("../../../config/config.sample.toml", import.meta.url),
);

function expectEntry(
  entries: readonly RuntimeEnvExportEntry[],
  expected: RuntimeEnvExportEntry,
): void {
  expect(entries).toContainEqual(expected);
}

describe("exportServiceConfigToEnv", () => {
  it("exports control plane API config to resource env entries", () => {
    const loadedConfig = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      configPath: ConfigSamplePath,
    });

    const entries = exportServiceConfigToEnv({
      app: AppIds.CONTROL_PLANE_API,
      config: loadedConfig,
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
  });

  it("exports control plane worker config to resource env entries", () => {
    const loadedConfig = loadConfig({
      app: AppIds.CONTROL_PLANE_WORKER,
      configPath: ConfigSamplePath,
    });

    const entries = exportServiceConfigToEnv({
      app: AppIds.CONTROL_PLANE_WORKER,
      config: loadedConfig,
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
    });

    expectEntry(entries, {
      name: "MISTLE_SERVICES_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY",
      value: 4,
    });
    expectEntry(entries, {
      name: "MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL",
      value: "postgresql://mistle:replace-with-password@db:5432/mistle",
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
  });

  it("exports tokenizer proxy config to resource env entries", () => {
    const loadedConfig = loadConfig({
      app: AppIds.TOKENIZER_PROXY,
      configPath: ConfigSamplePath,
    });

    const entries = exportServiceConfigToEnv({
      app: AppIds.TOKENIZER_PROXY,
      config: loadedConfig,
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
