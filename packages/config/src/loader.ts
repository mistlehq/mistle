import { readFileSync } from "node:fs";

import { parse as parseToml } from "smol-toml";

import { controlPlaneApiConfigModule } from "./apps/control-plane-api/index.js";
import { ControlPlaneApiMaintenanceConfigSchema } from "./apps/control-plane-api/schema.js";
import type { ControlPlaneApiMaintenanceConfig } from "./apps/control-plane-api/schema.js";
import { controlPlaneWorkerConfigModule } from "./apps/control-plane-worker/index.js";
import { dataPlaneApiConfigModule } from "./apps/data-plane-api/index.js";
import { getDataPlaneApiSandboxProviderValidationIssue } from "./apps/data-plane-api/schema.js";
import { dataPlaneGatewayConfigModule } from "./apps/data-plane-gateway/index.js";
import { dataPlaneWorkerConfigModule } from "./apps/data-plane-worker/index.js";
import {
  getDataPlaneWorkerPersistentSandboxValidationIssue,
  getDataPlaneWorkerSandboxProviderValidationIssue,
} from "./apps/data-plane-worker/schema.js";
import { mergeConfigRoots } from "./core/merge.js";
import { asObjectRecord, setValueAtPath } from "./core/record.js";
import { GlobalConfigSchema, GlobalSandboxConfigSchema } from "./global/schema.js";
import type { GlobalConfig, GlobalSandboxConfig, GlobalTelemetryConfig } from "./global/schema.js";
import { AppIds, type AppConfigModuleKey, type AppConfigModuleValue } from "./modules.js";
import { loadRootConfigFromEnv as loadRootConfigRecordFromEnv } from "./root/load-env.js";
import { ConfigSchema as RootConfigSchema, type Config as RootConfig } from "./root/schema.js";
import {
  selectControlPlaneApiConfig,
  selectControlPlaneApiMaintenanceConfig,
  selectControlPlaneWorkerConfig,
  selectDataPlaneApiConfig,
  selectDataPlaneGatewayConfig,
  selectDataPlaneWorkerConfig,
  selectGlobalConfig,
} from "./root/selectors.js";
import { type AppConfig } from "./schema.js";

export type LoadConfigSourceOptions = {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
};

export type LoadConfigOptions<TApp extends AppConfigModuleKey = AppConfigModuleKey> =
  LoadConfigSourceOptions & {
    app: TApp;
    includeGlobal?: boolean;
  };

export type LoadConfigResult<TApp extends AppConfigModuleKey = AppConfigModuleKey> = {
  app: AppConfigModuleValue<TApp>;
  global?: AppConfig["global"];
};

export type LoadControlPlaneMaintenanceConfigResult = {
  app: ControlPlaneApiMaintenanceConfig;
};

type EnvDescriptor = {
  envVar: string;
  path: readonly string[];
  parse?: (value: string, envVar: string) => unknown;
};

function resolveConfigPath(options: LoadConfigSourceOptions): string | undefined {
  return options.configPath ?? options.env?.MISTLE_CONFIG_PATH;
}

function resolveLoadInputs(options: LoadConfigSourceOptions): {
  configPath?: string;
  env: NodeJS.ProcessEnv;
} {
  if (options.configPath === undefined && options.env === undefined) {
    throw new Error(
      "Missing config source. Provide at least one of loadConfig({ configPath, ... }) or loadConfig({ env, ... }).",
    );
  }

  const env = options.env ?? {};
  const configPath = resolveConfigPath(options);

  if (configPath === undefined) {
    return { env };
  }

  return { configPath, env };
}

function parseTomlRoot(configPath: string): RootConfig {
  return RootConfigSchema.parse(asObjectRecord(parseToml(readFileSync(configPath, "utf8"))));
}

function applyRootEnvOverrides(rootConfig: RootConfig, env: NodeJS.ProcessEnv): RootConfig {
  return RootConfigSchema.parse(mergeConfigRoots(rootConfig, loadRootConfigRecordFromEnv(env)));
}

export function parseConfigRecord(record: unknown): RootConfig {
  return RootConfigSchema.parse(record);
}

function loadControlPlaneMaintenanceConfigFromEnv(
  env: NodeJS.ProcessEnv,
): ControlPlaneApiMaintenanceConfig {
  const migrationUrl = env.MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL;
  if (migrationUrl === undefined) {
    throw new Error(
      "Missing control-plane maintenance database config. Set MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL.",
    );
  }

  return ControlPlaneApiMaintenanceConfigSchema.parse({
    database: {
      migrationUrl,
    },
    telemetry: loadControlPlaneMaintenanceTelemetryConfigFromEnv(env),
  });
}

function loadControlPlaneMaintenanceTelemetryConfigFromEnv(
  env: NodeJS.ProcessEnv,
): ControlPlaneApiMaintenanceConfig["telemetry"] {
  const enabled = readBooleanEnv(env, "MISTLE_TELEMETRY_ENABLED");
  const debug = readBooleanEnv(env, "MISTLE_TELEMETRY_DEBUG");
  const tracesEndpoint = env.MISTLE_TELEMETRY_TRACES_ENDPOINT;
  const logsEndpoint = env.MISTLE_TELEMETRY_LOGS_ENDPOINT;
  const metricsEndpoint = env.MISTLE_TELEMETRY_METRICS_ENDPOINT;
  const resourceAttributes = env.MISTLE_TELEMETRY_RESOURCE_ATTRIBUTES;

  return ControlPlaneApiMaintenanceConfigSchema.shape.telemetry.parse({
    enabled: enabled ?? false,
    debug: debug ?? false,
    ...(enabled === true
      ? {
          traces: {
            endpoint: tracesEndpoint,
          },
          logs: {
            endpoint: logsEndpoint,
          },
          metrics: {
            endpoint: metricsEndpoint,
          },
        }
      : {
          ...(tracesEndpoint === undefined
            ? {}
            : {
                traces: {
                  endpoint: tracesEndpoint,
                },
              }),
          ...(logsEndpoint === undefined
            ? {}
            : {
                logs: {
                  endpoint: logsEndpoint,
                },
              }),
          ...(metricsEndpoint === undefined
            ? {}
            : {
                metrics: {
                  endpoint: metricsEndpoint,
                },
              }),
        }),
    ...(resourceAttributes === undefined
      ? {}
      : {
          resourceAttributes,
        }),
  });
}

function readBooleanEnv(env: NodeJS.ProcessEnv, envVar: string): boolean | undefined {
  const rawValue = env[envVar];
  if (rawValue === undefined) {
    return undefined;
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (normalizedValue === "1" || normalizedValue === "true") {
    return true;
  }
  if (normalizedValue === "0" || normalizedValue === "false") {
    return false;
  }

  throw new Error(`${envVar} must be one of: 1, true or 0, false.`);
}

function parseStrictBooleanEnv(value: string, envVar: string): boolean {
  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue === "true") {
    return true;
  }
  if (normalizedValue === "false") {
    return false;
  }

  throw new Error(`${envVar} must be one of: true or false.`);
}

function parseNumberEnv(value: string, envVar: string): number {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    throw new Error(`${envVar} must be a finite number.`);
  }

  return parsedValue;
}

function parseCsvEnv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseJsonStringRecordEnv(value: string, envVar: string): Record<string, string> {
  const parsedValue: unknown = JSON.parse(value);
  const parsedRecord = asObjectRecord(parsedValue);
  const normalizedRecord: Record<string, string> = {};

  for (const [key, entry] of Object.entries(parsedRecord)) {
    if (typeof entry !== "string") {
      throw new Error(`${envVar} must be a JSON object with string values.`);
    }

    normalizedRecord[key] = entry;
  }

  return normalizedRecord;
}

function loadEnvObject(
  descriptors: readonly EnvDescriptor[],
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  let config: Record<string, unknown> = {};

  for (const descriptor of descriptors) {
    const rawValue = env[descriptor.envVar];
    if (rawValue === undefined) {
      continue;
    }

    const value =
      descriptor.parse === undefined ? rawValue : descriptor.parse(rawValue, descriptor.envVar);
    config = setValueAtPath(config, descriptor.path, value);
  }

  return config;
}

const TelemetryEnvDescriptors = [
  {
    envVar: "MISTLE_TELEMETRY_ENABLED",
    path: ["enabled"],
    parse: parseStrictBooleanEnv,
  },
  {
    envVar: "MISTLE_TELEMETRY_DEBUG",
    path: ["debug"],
    parse: parseStrictBooleanEnv,
  },
  {
    envVar: "MISTLE_TELEMETRY_TRACES_ENDPOINT",
    path: ["traces", "endpoint"],
  },
  {
    envVar: "MISTLE_TELEMETRY_LOGS_ENDPOINT",
    path: ["logs", "endpoint"],
  },
  {
    envVar: "MISTLE_TELEMETRY_METRICS_ENDPOINT",
    path: ["metrics", "endpoint"],
  },
  {
    envVar: "MISTLE_TELEMETRY_RESOURCE_ATTRIBUTES",
    path: ["resourceAttributes"],
  },
] satisfies readonly EnvDescriptor[];

const SandboxEnvDescriptors = [
  {
    envVar: "MISTLE_SANDBOX_PROVIDER",
    path: ["provider"],
  },
  {
    envVar: "MISTLE_SANDBOX_DEFAULT_BASE_IMAGE",
    path: ["defaultBaseImage"],
  },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL",
    path: ["gatewayWsUrl"],
  },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL",
    path: ["internalGatewayWsUrl"],
  },
  {
    envVar: "MISTLE_SANDBOX_STORAGE_BACKEND",
    path: ["storage", "backend"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_CONNECT_SECRET",
    path: ["connect", "tokenSecret"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_CONNECT_ISSUER",
    path: ["connect", "tokenIssuer"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_CONNECT_AUDIENCE",
    path: ["connect", "tokenAudience"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET",
    path: ["bootstrap", "tokenSecret"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_ISSUER",
    path: ["bootstrap", "tokenIssuer"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_AUDIENCE",
    path: ["bootstrap", "tokenAudience"],
  },
  {
    envVar: "MISTLE_SANDBOX_PUBLISH_BASE_DOMAIN",
    path: ["publish", "baseDomain"],
  },
  {
    envVar: "MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET",
    path: ["publish", "access", "tokenSecret"],
  },
  {
    envVar: "MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER",
    path: ["publish", "access", "tokenIssuer"],
  },
  {
    envVar: "MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE",
    path: ["publish", "access", "tokenAudience"],
  },
  {
    envVar: "MISTLE_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET",
    path: ["publish", "session", "cookieSigningSecret"],
  },
] satisfies readonly EnvDescriptor[];

function loadTelemetryConfigFromEnv(env: NodeJS.ProcessEnv): GlobalTelemetryConfig {
  return GlobalConfigSchema.shape.telemetry.parse(loadEnvObject(TelemetryEnvDescriptors, env));
}

function loadSandboxConfigFromEnv(env: NodeJS.ProcessEnv): GlobalSandboxConfig {
  return GlobalSandboxConfigSchema.parse(loadEnvObject(SandboxEnvDescriptors, env));
}

function loadGlobalConfigFromEnv(env: NodeJS.ProcessEnv): GlobalConfig {
  return GlobalConfigSchema.parse({
    env: env.MISTLE_ENV,
    telemetry: loadTelemetryConfigFromEnv(env),
    internalAuth: {
      serviceToken: env.MISTLE_INTERNAL_AUTH_SHARED_TOKEN,
    },
    sandbox: loadSandboxConfigFromEnv(env),
  });
}

const ControlPlaneApiEnvDescriptors = [
  { envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_HOST", path: ["server", "host"] },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_PORT",
    path: ["server", "port"],
    parse: parseNumberEnv,
  },
  { envVar: "MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL", path: ["database", "url"] },
  {
    envVar: "MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL",
    path: ["database", "migrationUrl"],
  },
  {
    envVar: "MISTLE_OBJECT_STORE_ASSETS_BUCKET_NAME",
    path: ["objectStore", "bucketName"],
  },
  { envVar: "MISTLE_OBJECT_STORE_ASSETS_REGION", path: ["objectStore", "region"] },
  { envVar: "MISTLE_OBJECT_STORE_ASSETS_ENDPOINT", path: ["objectStore", "endpoint"] },
  {
    envVar: "MISTLE_OBJECT_STORE_ASSETS_FORCE_PATH_STYLE",
    path: ["objectStore", "forcePathStyle"],
    parse: parseStrictBooleanEnv,
  },
  {
    envVar: "MISTLE_OBJECT_STORE_ASSETS_ACCESS_KEY_ID",
    path: ["objectStore", "accessKeyId"],
  },
  {
    envVar: "MISTLE_OBJECT_STORE_ASSETS_SECRET_ACCESS_KEY",
    path: ["objectStore", "secretAccessKey"],
  },
  { envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL", path: ["auth", "baseUrl"] },
  { envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_SECRET", path: ["auth", "secret"] },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS",
    path: ["auth", "trustedOrigins"],
    parse: parseCsvEnv,
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_ALLOW_SIGNUPS",
    path: ["auth", "allowSignups"],
    parse: parseStrictBooleanEnv,
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_OTP_LENGTH",
    path: ["auth", "otpLength"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_OTP_EXPIRES_IN_SECONDS",
    path: ["auth", "otpExpiresInSeconds"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_OTP_ALLOWED_ATTEMPTS",
    path: ["auth", "otpAllowedAttempts"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_ID",
    path: ["auth", "google", "clientId"],
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_SECRET",
    path: ["auth", "google", "clientSecret"],
  },
  { envVar: "MISTLE_SERVICES_DASHBOARD_PUBLIC_URL", path: ["dashboard", "baseUrl"] },
  {
    envVar: "MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL",
    path: ["workflow", "databaseUrl"],
  },
  {
    envVar: "MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL",
    path: ["workflow", "migrationUrl"],
  },
  {
    envVar: "MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID",
    path: ["workflow", "namespaceId"],
  },
  { envVar: "MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL", path: ["dataPlaneApi", "baseUrl"] },
  { envVar: "MISTLE_INTERNAL_AUTH_SHARED_TOKEN", path: ["internalAuth", "serviceToken"] },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_CONNECT_SECRET",
    path: ["connectionToken", "secret"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_CONNECT_ISSUER",
    path: ["connectionToken", "issuer"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_CONNECT_AUDIENCE",
    path: ["connectionToken", "audience"],
  },
  { envVar: "MISTLE_SANDBOX_PUBLISH_BASE_DOMAIN", path: ["portAccess", "baseDomain"] },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL",
    path: ["portAccess", "gatewayWsUrl"],
  },
  {
    envVar: "MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET",
    path: ["portAccess", "access", "tokenSecret"],
  },
  {
    envVar: "MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER",
    path: ["portAccess", "access", "tokenIssuer"],
  },
  {
    envVar: "MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE",
    path: ["portAccess", "access", "tokenAudience"],
  },
  { envVar: "MISTLE_SANDBOX_DEFAULT_BASE_IMAGE", path: ["sandbox", "defaultBaseImage"] },
  { envVar: "MISTLE_SANDBOX_PROVIDER", path: ["sandbox", "provider"] },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL",
    path: ["sandbox", "gatewayWsUrl"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET",
    path: ["sandbox", "bootstrap", "tokenSecret"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_ISSUER",
    path: ["sandbox", "bootstrap", "tokenIssuer"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_AUDIENCE",
    path: ["sandbox", "bootstrap", "tokenAudience"],
  },
  { envVar: "MISTLE_SANDBOX_STORAGE_BACKEND", path: ["sandbox", "storageBackend"] },
  { envVar: "MISTLE_SANDBOX_E2B_API_KEY", path: ["sandbox", "e2b", "apiKey"] },
  { envVar: "MISTLE_SANDBOX_E2B_DOMAIN", path: ["sandbox", "e2b", "domain"] },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_INTEGRATIONS_ACTIVE_MASTER_ENCRYPTION_KEY_VERSION",
    path: ["integrations", "activeMasterEncryptionKeyVersion"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON",
    path: ["integrations", "masterEncryptionKeys"],
    parse: parseJsonStringRecordEnv,
  },
] satisfies readonly EnvDescriptor[];

const ControlPlaneWorkerEnvDescriptors = [
  { envVar: "MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL", path: ["database", "url"] },
  { envVar: "MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL", path: ["workflow", "databaseUrl"] },
  {
    envVar: "MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID",
    path: ["workflow", "namespaceId"],
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY",
    path: ["workflow", "concurrency"],
    parse: parseNumberEnv,
  },
  { envVar: "MISTLE_EMAIL_SMTP_FROM_ADDRESS", path: ["email", "fromAddress"] },
  { envVar: "MISTLE_EMAIL_SMTP_FROM_NAME", path: ["email", "fromName"] },
  { envVar: "MISTLE_EMAIL_SMTP_HOST", path: ["email", "smtpHost"] },
  { envVar: "MISTLE_EMAIL_SMTP_PORT", path: ["email", "smtpPort"], parse: parseNumberEnv },
  {
    envVar: "MISTLE_EMAIL_SMTP_SECURE",
    path: ["email", "smtpSecure"],
    parse: parseStrictBooleanEnv,
  },
  { envVar: "MISTLE_EMAIL_SMTP_USERNAME", path: ["email", "smtpUsername"] },
  { envVar: "MISTLE_EMAIL_SMTP_PASSWORD", path: ["email", "smtpPassword"] },
  { envVar: "MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL", path: ["dataPlaneApi", "baseUrl"] },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL",
    path: ["controlPlaneApi", "baseUrl"],
  },
  { envVar: "MISTLE_INTERNAL_AUTH_SHARED_TOKEN", path: ["internalAuth", "serviceToken"] },
  { envVar: "MISTLE_SANDBOX_DEFAULT_BASE_IMAGE", path: ["sandbox", "defaultBaseImage"] },
] satisfies readonly EnvDescriptor[];

const DataPlaneApiEnvDescriptors = [
  { envVar: "MISTLE_SERVICES_DATA_PLANE_API_HOST", path: ["server", "host"] },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_API_PORT",
    path: ["server", "port"],
    parse: parseNumberEnv,
  },
  { envVar: "MISTLE_POSTGRES_DATA_PLANE_POOLED_URL", path: ["database", "url"] },
  { envVar: "MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL", path: ["database", "migrationUrl"] },
  { envVar: "MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL", path: ["workflow", "databaseUrl"] },
  {
    envVar: "MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL",
    path: ["workflow", "migrationUrl"],
  },
  { envVar: "MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID", path: ["workflow", "namespaceId"] },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL",
    path: ["runtimeState", "gatewayBaseUrl"],
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL",
    path: ["controlPlaneApi", "baseUrl"],
  },
  { envVar: "MISTLE_INTERNAL_AUTH_SHARED_TOKEN", path: ["internalAuth", "serviceToken"] },
  { envVar: "MISTLE_SANDBOX_PROVIDER", path: ["sandbox", "provider"] },
  { envVar: "MISTLE_SANDBOX_STORAGE_BACKEND", path: ["sandbox", "storage", "backend"] },
  { envVar: "MISTLE_SANDBOX_DOCKER_SOCKET_PATH", path: ["sandbox", "docker", "socketPath"] },
  { envVar: "MISTLE_SANDBOX_E2B_API_KEY", path: ["sandbox", "e2b", "apiKey"] },
  { envVar: "MISTLE_SANDBOX_E2B_DOMAIN", path: ["sandbox", "e2b", "domain"] },
] satisfies readonly EnvDescriptor[];

const DataPlaneGatewayEnvDescriptors = [
  { envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_HOST", path: ["server", "host"] },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_PORT",
    path: ["server", "port"],
    parse: parseNumberEnv,
  },
  { envVar: "MISTLE_POSTGRES_DATA_PLANE_POOLED_URL", path: ["database", "url"] },
  { envVar: "MISTLE_KV_DATA_PLANE_BACKEND", path: ["runtimeState", "backend"] },
  { envVar: "MISTLE_KV_DATA_PLANE_URL", path: ["runtimeState", "valkey", "url"] },
  { envVar: "MISTLE_KV_DATA_PLANE_KEY_PREFIX", path: ["runtimeState", "valkey", "keyPrefix"] },
  { envVar: "MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL", path: ["dataPlaneApi", "baseUrl"] },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL",
    path: ["controlPlaneApi", "baseUrl"],
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL",
    path: ["controlPlaneApi", "publicBaseUrl"],
  },
  { envVar: "MISTLE_INTERNAL_AUTH_SHARED_TOKEN", path: ["internalAuth", "serviceToken"] },
] satisfies readonly EnvDescriptor[];

const DataPlaneWorkerEnvDescriptors = [
  { envVar: "MISTLE_POSTGRES_DATA_PLANE_POOLED_URL", path: ["database", "url"] },
  { envVar: "MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL", path: ["workflow", "databaseUrl"] },
  { envVar: "MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID", path: ["workflow", "namespaceId"] },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY",
    path: ["workflow", "concurrency"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL",
    path: ["runtimeState", "gatewayBaseUrl"],
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL",
    path: ["controlPlaneApi", "baseUrl"],
  },
  { envVar: "MISTLE_INTERNAL_AUTH_SHARED_TOKEN", path: ["internalAuth", "serviceToken"] },
  { envVar: "MISTLE_SANDBOX_PROVIDER", path: ["sandbox", "provider"] },
  { envVar: "MISTLE_SANDBOX_STORAGE_BACKEND", path: ["sandbox", "storage", "backend"] },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL",
    path: ["sandbox", "internalGatewayWsUrl"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET",
    path: ["sandbox", "bootstrap", "tokenSecret"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_ISSUER",
    path: ["sandbox", "bootstrap", "tokenIssuer"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_AUDIENCE",
    path: ["sandbox", "bootstrap", "tokenAudience"],
  },
  {
    envVar: "MISTLE_TEST_SANDBOXD_TEST_FAULTS_ENABLED",
    path: ["sandbox", "sandboxdTestFaultsEnabled"],
    parse: parseStrictBooleanEnv,
  },
  { envVar: "MISTLE_SANDBOX_DOCKER_SOCKET_PATH", path: ["sandbox", "docker", "socketPath"] },
  { envVar: "MISTLE_SANDBOX_DOCKER_NETWORK_NAME", path: ["sandbox", "docker", "networkName"] },
  { envVar: "MISTLE_SANDBOX_E2B_API_KEY", path: ["sandbox", "e2b", "apiKey"] },
  { envVar: "MISTLE_SANDBOX_E2B_DOMAIN", path: ["sandbox", "e2b", "domain"] },
  {
    envVar: "MISTLE_SANDBOX_E2B_CPU_COUNT",
    path: ["sandbox", "e2b", "cpuCount"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SANDBOX_E2B_MEMORY_MB",
    path: ["sandbox", "e2b", "memoryMb"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY",
    path: ["sandboxStorage", "archil", "apiKey"],
  },
  {
    envVar: "MISTLE_SANDBOX_STORAGE_ARCHIL_REGION",
    path: ["sandboxStorage", "archil", "region"],
  },
  {
    envVar: "MISTLE_SANDBOX_STORAGE_ARCHIL_NAME_PREFIX",
    path: ["sandboxStorage", "archil", "namePrefix"],
  },
  {
    envVar: "MISTLE_SANDBOX_STORAGE_DOCKER_VOLUME_NAME_PREFIX",
    path: ["sandboxStorage", "dockerVolume", "namePrefix"],
  },
] satisfies readonly EnvDescriptor[];

function applyWorkflowRunMigrationsFalse(config: Record<string, unknown>): Record<string, unknown> {
  return setValueAtPath(config, ["workflow", "runMigrations"], false);
}

function applyDataPlaneWorkerArchilMount(config: Record<string, unknown>, env: NodeJS.ProcessEnv) {
  if (env.MISTLE_SANDBOX_STORAGE_ARCHIL_MOUNT_OBJECT_STORE === undefined) {
    return config;
  }

  if (env.MISTLE_SANDBOX_STORAGE_ARCHIL_MOUNT_OBJECT_STORE !== "sandbox_storage") {
    throw new Error(
      "MISTLE_SANDBOX_STORAGE_ARCHIL_MOUNT_OBJECT_STORE must be 'sandbox_storage' when set.",
    );
  }

  const mount = loadEnvObject(
    [
      {
        envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_BUCKET_NAME",
        path: ["bucket"],
      },
      {
        envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ENDPOINT",
        path: ["endpoint"],
      },
      {
        envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ACCESS_KEY_ID",
        path: ["accessKeyId"],
      },
      {
        envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY",
        path: ["secretAccessKey"],
      },
    ],
    env,
  );

  return setValueAtPath(
    config,
    ["sandboxStorage", "archil", "mounts"],
    [
      {
        type: "s3-compatible",
        ...mount,
      },
    ],
  );
}

function selectAppConfig(
  appId: typeof AppIds.CONTROL_PLANE_API,
  rootConfig: RootConfig,
): AppConfigModuleValue<typeof AppIds.CONTROL_PLANE_API>;
function selectAppConfig(
  appId: typeof AppIds.CONTROL_PLANE_WORKER,
  rootConfig: RootConfig,
): AppConfigModuleValue<typeof AppIds.CONTROL_PLANE_WORKER>;
function selectAppConfig(
  appId: typeof AppIds.DATA_PLANE_API,
  rootConfig: RootConfig,
): AppConfigModuleValue<typeof AppIds.DATA_PLANE_API>;
function selectAppConfig(
  appId: typeof AppIds.DATA_PLANE_GATEWAY,
  rootConfig: RootConfig,
): AppConfigModuleValue<typeof AppIds.DATA_PLANE_GATEWAY>;
function selectAppConfig(
  appId: typeof AppIds.DATA_PLANE_WORKER,
  rootConfig: RootConfig,
): AppConfigModuleValue<typeof AppIds.DATA_PLANE_WORKER>;
function selectAppConfig<TApp extends AppConfigModuleKey>(
  appId: TApp,
  rootConfig: RootConfig,
): AppConfigModuleValue<TApp>;
function selectAppConfig(
  appId: AppConfigModuleKey,
  rootConfig: RootConfig,
): AppConfigModuleValue<AppConfigModuleKey> {
  if (appId === AppIds.CONTROL_PLANE_API) {
    return controlPlaneApiConfigModule.schema.parse(selectControlPlaneApiConfig(rootConfig));
  }

  if (appId === AppIds.CONTROL_PLANE_WORKER) {
    return controlPlaneWorkerConfigModule.schema.parse(selectControlPlaneWorkerConfig(rootConfig));
  }

  if (appId === AppIds.DATA_PLANE_API) {
    return dataPlaneApiConfigModule.schema.parse(selectDataPlaneApiConfig(rootConfig));
  }

  if (appId === AppIds.DATA_PLANE_GATEWAY) {
    return dataPlaneGatewayConfigModule.schema.parse(selectDataPlaneGatewayConfig(rootConfig));
  }

  if (appId === AppIds.DATA_PLANE_WORKER) {
    return dataPlaneWorkerConfigModule.schema.parse(selectDataPlaneWorkerConfig(rootConfig));
  }

  throw new Error("Unsupported app id.");
}

function loadControlPlaneApiConfigFromEnv(env: NodeJS.ProcessEnv) {
  return controlPlaneApiConfigModule.schema.parse(
    loadEnvObject(ControlPlaneApiEnvDescriptors, env),
  );
}

function loadControlPlaneWorkerConfigFromEnv(env: NodeJS.ProcessEnv) {
  return controlPlaneWorkerConfigModule.schema.parse(
    applyWorkflowRunMigrationsFalse(loadEnvObject(ControlPlaneWorkerEnvDescriptors, env)),
  );
}

function loadDataPlaneApiConfigFromEnv(env: NodeJS.ProcessEnv) {
  return dataPlaneApiConfigModule.schema.parse(loadEnvObject(DataPlaneApiEnvDescriptors, env));
}

function loadDataPlaneGatewayConfigFromEnv(env: NodeJS.ProcessEnv) {
  let config = loadEnvObject(DataPlaneGatewayEnvDescriptors, env);
  config = setValueAtPath(config, ["sandbox"], loadSandboxConfigFromEnv(env));
  config = setValueAtPath(config, ["telemetry"], loadTelemetryConfigFromEnv(env));

  return dataPlaneGatewayConfigModule.schema.parse(config);
}

function loadDataPlaneWorkerConfigFromEnv(env: NodeJS.ProcessEnv) {
  let config = applyWorkflowRunMigrationsFalse(loadEnvObject(DataPlaneWorkerEnvDescriptors, env));
  config = applyDataPlaneWorkerArchilMount(config, env);
  config = setValueAtPath(config, ["telemetry"], loadTelemetryConfigFromEnv(env));

  return dataPlaneWorkerConfigModule.schema.parse(config);
}

function validateSelectedAppConfig(appId: AppConfigModuleKey, rootConfig: RootConfig): void {
  if (appId === AppIds.DATA_PLANE_API) {
    validateDataPlaneApiConfig(selectAppConfig(AppIds.DATA_PLANE_API, rootConfig));
  } else if (appId === AppIds.DATA_PLANE_WORKER) {
    validateDataPlaneWorkerConfig(selectAppConfig(AppIds.DATA_PLANE_WORKER, rootConfig));
  }
}

function validateDataPlaneApiConfig(
  config: AppConfigModuleValue<typeof AppIds.DATA_PLANE_API>,
): void {
  const issue = getDataPlaneApiSandboxProviderValidationIssue({
    appSandbox: config.sandbox,
  });

  if (issue !== null) {
    throw new Error(issue.message);
  }
}

function validateDataPlaneWorkerConfig(
  config: AppConfigModuleValue<typeof AppIds.DATA_PLANE_WORKER>,
): void {
  const issue = getDataPlaneWorkerSandboxProviderValidationIssue({
    appSandbox: config.sandbox,
  });

  if (issue !== null) {
    throw new Error(issue.message);
  }

  const persistentIssue = getDataPlaneWorkerPersistentSandboxValidationIssue({
    appConfig: config,
  });

  if (persistentIssue !== null) {
    throw new Error(persistentIssue.message);
  }
}

function loadRootConfig(configPath: string, env: NodeJS.ProcessEnv): RootConfig {
  return applyRootEnvOverrides(parseTomlRoot(configPath), env);
}

function loadEnvConfig(
  appId: typeof AppIds.CONTROL_PLANE_API,
  env: NodeJS.ProcessEnv,
  includeGlobal: boolean,
): LoadConfigResult<typeof AppIds.CONTROL_PLANE_API>;
function loadEnvConfig(
  appId: typeof AppIds.CONTROL_PLANE_WORKER,
  env: NodeJS.ProcessEnv,
  includeGlobal: boolean,
): LoadConfigResult<typeof AppIds.CONTROL_PLANE_WORKER>;
function loadEnvConfig(
  appId: typeof AppIds.DATA_PLANE_API,
  env: NodeJS.ProcessEnv,
  includeGlobal: boolean,
): LoadConfigResult<typeof AppIds.DATA_PLANE_API>;
function loadEnvConfig(
  appId: typeof AppIds.DATA_PLANE_GATEWAY,
  env: NodeJS.ProcessEnv,
  includeGlobal: boolean,
): LoadConfigResult<typeof AppIds.DATA_PLANE_GATEWAY>;
function loadEnvConfig(
  appId: typeof AppIds.DATA_PLANE_WORKER,
  env: NodeJS.ProcessEnv,
  includeGlobal: boolean,
): LoadConfigResult<typeof AppIds.DATA_PLANE_WORKER>;
function loadEnvConfig<TApp extends AppConfigModuleKey>(
  appId: TApp,
  env: NodeJS.ProcessEnv,
  includeGlobal: boolean,
): LoadConfigResult<TApp>;
function loadEnvConfig(
  appId: AppConfigModuleKey,
  env: NodeJS.ProcessEnv,
  includeGlobal: boolean,
): LoadConfigResult<AppConfigModuleKey> {
  const globalConfig = includeGlobal ? loadGlobalConfigFromEnv(env) : undefined;

  if (appId === AppIds.CONTROL_PLANE_API) {
    const appConfig = loadControlPlaneApiConfigFromEnv(env);

    return {
      ...(globalConfig === undefined ? {} : { global: globalConfig }),
      app: appConfig,
    };
  }

  if (appId === AppIds.CONTROL_PLANE_WORKER) {
    const appConfig = loadControlPlaneWorkerConfigFromEnv(env);

    return {
      ...(globalConfig === undefined ? {} : { global: globalConfig }),
      app: appConfig,
    };
  }

  if (appId === AppIds.DATA_PLANE_API) {
    const appConfig = loadDataPlaneApiConfigFromEnv(env);
    validateDataPlaneApiConfig(appConfig);

    return {
      ...(globalConfig === undefined ? {} : { global: globalConfig }),
      app: appConfig,
    };
  }

  if (appId === AppIds.DATA_PLANE_GATEWAY) {
    const appConfig = loadDataPlaneGatewayConfigFromEnv(env);

    return {
      ...(globalConfig === undefined ? {} : { global: globalConfig }),
      app: appConfig,
    };
  }

  if (appId === AppIds.DATA_PLANE_WORKER) {
    const appConfig = loadDataPlaneWorkerConfigFromEnv(env);
    validateDataPlaneWorkerConfig(appConfig);

    return {
      ...(globalConfig === undefined ? {} : { global: globalConfig }),
      app: appConfig,
    };
  }

  throw new Error("Unsupported app id.");
}

export function loadConfig<TApp extends AppConfigModuleKey>(
  options: LoadConfigOptions<TApp>,
): LoadConfigResult<TApp>;
export function loadConfig(options: LoadConfigOptions<AppConfigModuleKey>): LoadConfigResult {
  const { configPath, env } = resolveLoadInputs(options);

  if (configPath === undefined) {
    const envConfig = loadEnvConfig(options.app, env, options.includeGlobal !== false);

    if (options.includeGlobal === false) {
      return {
        app: envConfig.app,
      };
    }

    return envConfig;
  }

  const rootConfig = loadRootConfig(configPath, env);
  const appConfig = selectAppConfig(options.app, rootConfig);

  if (options.includeGlobal === false) {
    validateSelectedAppConfig(options.app, rootConfig);

    return {
      app: appConfig,
    };
  }

  validateSelectedAppConfig(options.app, rootConfig);

  return {
    global: selectGlobalConfig(rootConfig),
    app: appConfig,
  };
}

export function loadControlPlaneMaintenanceConfig(
  options: LoadConfigSourceOptions,
): LoadControlPlaneMaintenanceConfigResult {
  const { configPath, env } = resolveLoadInputs(options);

  if (configPath === undefined) {
    return {
      app: loadControlPlaneMaintenanceConfigFromEnv(env),
    };
  }

  const rootConfig = loadRootConfig(configPath, env);

  return {
    app: ControlPlaneApiMaintenanceConfigSchema.parse(
      selectControlPlaneApiMaintenanceConfig(rootConfig),
    ),
  };
}
