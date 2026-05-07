import type { EnvValueFormat } from "./core/load-env.js";
import { asObjectRecord, getValueAtPath } from "./core/record.js";
import type { LoadConfigResult } from "./loader.js";
import { AppIds, type AppConfigModuleKey } from "./modules.js";

export type RuntimeEnvExportValueFormat = EnvValueFormat;

export type RuntimeEnvExportEntry = {
  name: string;
  value: unknown;
  valueFormat?: RuntimeEnvExportValueFormat;
};

type RuntimeEnvExportDescriptor = {
  envVar: string;
  path?: readonly string[];
  valueFormat?: RuntimeEnvExportValueFormat;
  readValue?: (root: unknown) => unknown;
};

export type RuntimeEnvExportInput<TApp extends AppConfigModuleKey = AppConfigModuleKey> = {
  app: TApp;
  config: LoadConfigResult<TApp>;
};

const GlobalResourceRuntimeEnvExports: readonly RuntimeEnvExportDescriptor[] = [
  { path: ["env"], envVar: "MISTLE_ENV" },
  { path: ["internalAuth", "serviceToken"], envVar: "MISTLE_INTERNAL_AUTH_SHARED_TOKEN" },
  { path: ["telemetry", "enabled"], envVar: "MISTLE_TELEMETRY_ENABLED" },
  { path: ["telemetry", "debug"], envVar: "MISTLE_TELEMETRY_DEBUG" },
  {
    path: ["telemetry", "traces", "endpoint"],
    envVar: "MISTLE_TELEMETRY_TRACES_ENDPOINT",
  },
  { path: ["telemetry", "logs", "endpoint"], envVar: "MISTLE_TELEMETRY_LOGS_ENDPOINT" },
  {
    path: ["telemetry", "metrics", "endpoint"],
    envVar: "MISTLE_TELEMETRY_METRICS_ENDPOINT",
  },
  {
    path: ["telemetry", "resourceAttributes"],
    envVar: "MISTLE_TELEMETRY_RESOURCE_ATTRIBUTES",
  },
  { path: ["sandbox", "provider"], envVar: "MISTLE_SANDBOX_PROVIDER" },
  { path: ["sandbox", "defaultBaseImage"], envVar: "MISTLE_SANDBOX_DEFAULT_BASE_IMAGE" },
  {
    path: ["sandbox", "gatewayWsUrl"],
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL",
  },
  {
    path: ["sandbox", "internalGatewayWsUrl"],
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL",
  },
  { path: ["sandbox", "storage", "backend"], envVar: "MISTLE_SANDBOX_STORAGE_BACKEND" },
  {
    path: ["sandbox", "bootstrap", "tokenSecret"],
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET",
  },
  {
    path: ["sandbox", "bootstrap", "tokenIssuer"],
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_ISSUER",
  },
  {
    path: ["sandbox", "bootstrap", "tokenAudience"],
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_AUDIENCE",
  },
  {
    path: ["sandbox", "connect", "tokenSecret"],
    envVar: "MISTLE_SANDBOX_TOKENS_CONNECT_SECRET",
  },
  {
    path: ["sandbox", "connect", "tokenIssuer"],
    envVar: "MISTLE_SANDBOX_TOKENS_CONNECT_ISSUER",
  },
  {
    path: ["sandbox", "connect", "tokenAudience"],
    envVar: "MISTLE_SANDBOX_TOKENS_CONNECT_AUDIENCE",
  },
  {
    path: ["sandbox", "egress", "tokenSecret"],
    envVar: "MISTLE_SANDBOX_TOKENS_EGRESS_SECRET",
  },
  {
    path: ["sandbox", "egress", "tokenIssuer"],
    envVar: "MISTLE_SANDBOX_TOKENS_EGRESS_ISSUER",
  },
  {
    path: ["sandbox", "egress", "tokenAudience"],
    envVar: "MISTLE_SANDBOX_TOKENS_EGRESS_AUDIENCE",
  },
  { path: ["sandbox", "publish", "baseDomain"], envVar: "MISTLE_SANDBOX_PUBLISH_BASE_DOMAIN" },
  {
    path: ["sandbox", "publish", "access", "tokenSecret"],
    envVar: "MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET",
  },
  {
    path: ["sandbox", "publish", "access", "tokenIssuer"],
    envVar: "MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER",
  },
  {
    path: ["sandbox", "publish", "access", "tokenAudience"],
    envVar: "MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE",
  },
  {
    path: ["sandbox", "publish", "session", "cookieSigningSecret"],
    envVar: "MISTLE_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET",
  },
];

const ControlPlaneApiResourceRuntimeEnvExports: readonly RuntimeEnvExportDescriptor[] = [
  { path: ["server", "host"], envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_HOST" },
  { path: ["server", "port"], envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_PORT" },
  { path: ["database", "url"], envVar: "MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL" },
  {
    path: ["database", "migrationUrl"],
    envVar: "MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL",
  },
  { path: ["objectStore", "bucketName"], envVar: "MISTLE_OBJECT_STORE_ASSETS_BUCKET_NAME" },
  { path: ["objectStore", "region"], envVar: "MISTLE_OBJECT_STORE_ASSETS_REGION" },
  { path: ["objectStore", "endpoint"], envVar: "MISTLE_OBJECT_STORE_ASSETS_ENDPOINT" },
  {
    path: ["objectStore", "forcePathStyle"],
    envVar: "MISTLE_OBJECT_STORE_ASSETS_FORCE_PATH_STYLE",
  },
  {
    path: ["objectStore", "accessKeyId"],
    envVar: "MISTLE_OBJECT_STORE_ASSETS_ACCESS_KEY_ID",
  },
  {
    path: ["objectStore", "secretAccessKey"],
    envVar: "MISTLE_OBJECT_STORE_ASSETS_SECRET_ACCESS_KEY",
  },
  { path: ["auth", "baseUrl"], envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL" },
  { path: ["auth", "secret"], envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_SECRET" },
  {
    path: ["auth", "trustedOrigins"],
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS",
    valueFormat: "csv",
  },
  { path: ["auth", "otpLength"], envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_OTP_LENGTH" },
  {
    path: ["auth", "otpExpiresInSeconds"],
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_OTP_EXPIRES_IN_SECONDS",
  },
  {
    path: ["auth", "otpAllowedAttempts"],
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_OTP_ALLOWED_ATTEMPTS",
  },
  {
    path: ["auth", "google", "clientId"],
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_ID",
  },
  {
    path: ["auth", "google", "clientSecret"],
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_SECRET",
  },
  { path: ["dashboard", "baseUrl"], envVar: "MISTLE_SERVICES_DASHBOARD_PUBLIC_URL" },
  { path: ["workflow", "namespaceId"], envVar: "MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID" },
  { path: ["dataPlaneApi", "baseUrl"], envVar: "MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL" },
  {
    path: ["integrations", "activeMasterEncryptionKeyVersion"],
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_INTEGRATIONS_ACTIVE_MASTER_ENCRYPTION_KEY_VERSION",
  },
  {
    path: ["integrations", "masterEncryptionKeys"],
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON",
    valueFormat: "json",
  },
];

const ControlPlaneWorkerResourceRuntimeEnvExports: readonly RuntimeEnvExportDescriptor[] = [
  { path: ["database", "url"], envVar: "MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL" },
  { path: ["workflow", "databaseUrl"], envVar: "MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL" },
  { path: ["workflow", "namespaceId"], envVar: "MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID" },
  {
    path: ["workflow", "concurrency"],
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY",
  },
  { path: ["email", "fromAddress"], envVar: "MISTLE_EMAIL_SMTP_FROM_ADDRESS" },
  { path: ["email", "fromName"], envVar: "MISTLE_EMAIL_SMTP_FROM_NAME" },
  { path: ["email", "smtpHost"], envVar: "MISTLE_EMAIL_SMTP_HOST" },
  { path: ["email", "smtpPort"], envVar: "MISTLE_EMAIL_SMTP_PORT" },
  { path: ["email", "smtpSecure"], envVar: "MISTLE_EMAIL_SMTP_SECURE" },
  { path: ["email", "smtpUsername"], envVar: "MISTLE_EMAIL_SMTP_USERNAME" },
  { path: ["email", "smtpPassword"], envVar: "MISTLE_EMAIL_SMTP_PASSWORD" },
  { path: ["dataPlaneApi", "baseUrl"], envVar: "MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL" },
  {
    path: ["controlPlaneApi", "baseUrl"],
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL",
  },
];

const DataPlaneApiResourceRuntimeEnvExports: readonly RuntimeEnvExportDescriptor[] = [
  { path: ["server", "host"], envVar: "MISTLE_SERVICES_DATA_PLANE_API_HOST" },
  { path: ["server", "port"], envVar: "MISTLE_SERVICES_DATA_PLANE_API_PORT" },
  { path: ["database", "url"], envVar: "MISTLE_POSTGRES_DATA_PLANE_POOLED_URL" },
  { path: ["database", "migrationUrl"], envVar: "MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL" },
  { path: ["workflow", "namespaceId"], envVar: "MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID" },
  {
    path: ["runtimeState", "gatewayBaseUrl"],
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL",
  },
  {
    path: ["controlPlaneApi", "baseUrl"],
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL",
  },
  { path: ["sandbox", "provider"], envVar: "MISTLE_SANDBOX_PROVIDER" },
  { path: ["sandbox", "storage", "backend"], envVar: "MISTLE_SANDBOX_STORAGE_BACKEND" },
  { path: ["sandbox", "egress", "tokenSecret"], envVar: "MISTLE_SANDBOX_TOKENS_EGRESS_SECRET" },
  { path: ["sandbox", "egress", "tokenIssuer"], envVar: "MISTLE_SANDBOX_TOKENS_EGRESS_ISSUER" },
  {
    path: ["sandbox", "egress", "tokenAudience"],
    envVar: "MISTLE_SANDBOX_TOKENS_EGRESS_AUDIENCE",
  },
  {
    path: ["sandbox", "tokenizerProxyEgressBaseUrl"],
    envVar: "MISTLE_SERVICES_TOKENIZER_PROXY_EGRESS_URL",
  },
  { path: ["sandbox", "docker", "socketPath"], envVar: "MISTLE_SANDBOX_DOCKER_SOCKET_PATH" },
  { path: ["sandbox", "e2b", "apiKey"], envVar: "MISTLE_SANDBOX_E2B_API_KEY" },
  { path: ["sandbox", "e2b", "domain"], envVar: "MISTLE_SANDBOX_E2B_DOMAIN" },
];

const DataPlaneGatewayResourceRuntimeEnvExports: readonly RuntimeEnvExportDescriptor[] = [
  { path: ["server", "host"], envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_HOST" },
  { path: ["server", "port"], envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_PORT" },
  { path: ["database", "url"], envVar: "MISTLE_POSTGRES_DATA_PLANE_POOLED_URL" },
  { path: ["runtimeState", "backend"], envVar: "MISTLE_KV_DATA_PLANE_BACKEND" },
  { path: ["runtimeState", "valkey", "url"], envVar: "MISTLE_KV_DATA_PLANE_URL" },
  { path: ["runtimeState", "valkey", "keyPrefix"], envVar: "MISTLE_KV_DATA_PLANE_KEY_PREFIX" },
  { path: ["dataPlaneApi", "baseUrl"], envVar: "MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL" },
  {
    path: ["controlPlaneApi", "baseUrl"],
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL",
  },
  {
    path: ["controlPlaneApi", "publicBaseUrl"],
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL",
  },
];

function readFirstArchilMountField(root: unknown, field: string): unknown {
  const mounts = getValueAtPath(root, ["sandboxStorage", "archil", "mounts"]);
  if (!Array.isArray(mounts) || mounts.length === 0) {
    return undefined;
  }

  return asObjectRecord(mounts[0])[field];
}

function readArchilMountObjectStore(root: unknown): "sandbox_storage" | undefined {
  const mounts = getValueAtPath(root, ["sandboxStorage", "archil", "mounts"]);
  return Array.isArray(mounts) && mounts.length > 0 ? "sandbox_storage" : undefined;
}

const DataPlaneWorkerResourceRuntimeEnvExports: readonly RuntimeEnvExportDescriptor[] = [
  { path: ["database", "url"], envVar: "MISTLE_POSTGRES_DATA_PLANE_POOLED_URL" },
  { path: ["workflow", "databaseUrl"], envVar: "MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL" },
  { path: ["workflow", "namespaceId"], envVar: "MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID" },
  {
    path: ["workflow", "concurrency"],
    envVar: "MISTLE_SERVICES_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY",
  },
  {
    path: ["runtimeState", "gatewayBaseUrl"],
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL",
  },
  {
    path: ["controlPlaneApi", "baseUrl"],
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL",
  },
  { path: ["sandbox", "provider"], envVar: "MISTLE_SANDBOX_PROVIDER" },
  { path: ["sandbox", "storage", "backend"], envVar: "MISTLE_SANDBOX_STORAGE_BACKEND" },
  {
    path: ["sandbox", "internalGatewayWsUrl"],
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL",
  },
  {
    path: ["sandbox", "bootstrap", "tokenSecret"],
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET",
  },
  {
    path: ["sandbox", "bootstrap", "tokenIssuer"],
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_ISSUER",
  },
  {
    path: ["sandbox", "bootstrap", "tokenAudience"],
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_AUDIENCE",
  },
  {
    path: ["sandbox", "egress", "tokenSecret"],
    envVar: "MISTLE_SANDBOX_TOKENS_EGRESS_SECRET",
  },
  {
    path: ["sandbox", "egress", "tokenIssuer"],
    envVar: "MISTLE_SANDBOX_TOKENS_EGRESS_ISSUER",
  },
  {
    path: ["sandbox", "egress", "tokenAudience"],
    envVar: "MISTLE_SANDBOX_TOKENS_EGRESS_AUDIENCE",
  },
  {
    path: ["sandbox", "tokenizerProxyEgressBaseUrl"],
    envVar: "MISTLE_SERVICES_TOKENIZER_PROXY_EGRESS_URL",
  },
  {
    path: ["sandbox", "sandboxdTestFaultsEnabled"],
    envVar: "MISTLE_TEST_SANDBOXD_TEST_FAULTS_ENABLED",
  },
  { path: ["sandbox", "docker", "socketPath"], envVar: "MISTLE_SANDBOX_DOCKER_SOCKET_PATH" },
  { path: ["sandbox", "docker", "networkName"], envVar: "MISTLE_SANDBOX_DOCKER_NETWORK_NAME" },
  { path: ["sandbox", "e2b", "apiKey"], envVar: "MISTLE_SANDBOX_E2B_API_KEY" },
  { path: ["sandbox", "e2b", "domain"], envVar: "MISTLE_SANDBOX_E2B_DOMAIN" },
  { path: ["sandbox", "e2b", "cpuCount"], envVar: "MISTLE_SANDBOX_E2B_CPU_COUNT" },
  { path: ["sandbox", "e2b", "memoryMb"], envVar: "MISTLE_SANDBOX_E2B_MEMORY_MB" },
  {
    path: ["sandboxStorage", "archil", "apiKey"],
    envVar: "MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY",
  },
  {
    path: ["sandboxStorage", "archil", "region"],
    envVar: "MISTLE_SANDBOX_STORAGE_ARCHIL_REGION",
  },
  {
    path: ["sandboxStorage", "archil", "namePrefix"],
    envVar: "MISTLE_SANDBOX_STORAGE_ARCHIL_NAME_PREFIX",
  },
  {
    envVar: "MISTLE_SANDBOX_STORAGE_ARCHIL_MOUNT_OBJECT_STORE",
    readValue: readArchilMountObjectStore,
  },
  {
    envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_BUCKET_NAME",
    readValue: (root) => readFirstArchilMountField(root, "bucket"),
  },
  {
    envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ENDPOINT",
    readValue: (root) => readFirstArchilMountField(root, "endpoint"),
  },
  {
    envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ACCESS_KEY_ID",
    readValue: (root) => readFirstArchilMountField(root, "accessKeyId"),
  },
  {
    envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY",
    readValue: (root) => readFirstArchilMountField(root, "secretAccessKey"),
  },
  {
    path: ["sandboxStorage", "dockerVolume", "namePrefix"],
    envVar: "MISTLE_SANDBOX_STORAGE_DOCKER_VOLUME_NAME_PREFIX",
  },
];

const TokenizerProxyResourceRuntimeEnvExports: readonly RuntimeEnvExportDescriptor[] = [
  { path: ["server", "host"], envVar: "MISTLE_SERVICES_TOKENIZER_PROXY_HOST" },
  { path: ["server", "port"], envVar: "MISTLE_SERVICES_TOKENIZER_PROXY_PORT" },
  {
    path: ["controlPlaneApi", "baseUrl"],
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL",
  },
  {
    path: ["controlPlaneApi", "publicBaseUrl"],
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL",
  },
  { path: ["egressGrant", "tokenSecret"], envVar: "MISTLE_SANDBOX_TOKENS_EGRESS_SECRET" },
  { path: ["egressGrant", "tokenIssuer"], envVar: "MISTLE_SANDBOX_TOKENS_EGRESS_ISSUER" },
  { path: ["egressGrant", "tokenAudience"], envVar: "MISTLE_SANDBOX_TOKENS_EGRESS_AUDIENCE" },
];

function getAppRuntimeEnvExports(app: AppConfigModuleKey): readonly RuntimeEnvExportDescriptor[] {
  if (app === AppIds.CONTROL_PLANE_API) {
    return ControlPlaneApiResourceRuntimeEnvExports;
  }

  if (app === AppIds.CONTROL_PLANE_WORKER) {
    return ControlPlaneWorkerResourceRuntimeEnvExports;
  }

  if (app === AppIds.DATA_PLANE_API) {
    return DataPlaneApiResourceRuntimeEnvExports;
  }

  if (app === AppIds.DATA_PLANE_GATEWAY) {
    return DataPlaneGatewayResourceRuntimeEnvExports;
  }

  if (app === AppIds.DATA_PLANE_WORKER) {
    return DataPlaneWorkerResourceRuntimeEnvExports;
  }

  if (app === AppIds.TOKENIZER_PROXY) {
    return TokenizerProxyResourceRuntimeEnvExports;
  }

  throw new Error("Unsupported app id.");
}

function exportDescriptor(
  root: unknown,
  descriptor: RuntimeEnvExportDescriptor,
): RuntimeEnvExportEntry | undefined {
  const value =
    descriptor.readValue === undefined
      ? descriptor.path === undefined
        ? undefined
        : getValueAtPath(root, descriptor.path)
      : descriptor.readValue(root);

  if (value === undefined) {
    return undefined;
  }

  return {
    name: descriptor.envVar,
    value,
    ...(descriptor.valueFormat === undefined ? {} : { valueFormat: descriptor.valueFormat }),
  };
}

function appendEntry(entries: RuntimeEnvExportEntry[], entry: RuntimeEnvExportEntry): void {
  const existingEntry = entries.find((candidate) => candidate.name === entry.name);
  if (existingEntry === undefined) {
    entries.push(entry);
    return;
  }

  if (JSON.stringify(existingEntry.value) !== JSON.stringify(entry.value)) {
    throw new Error(`Conflicting runtime env export values for ${entry.name}.`);
  }
}

export function exportServiceConfigToEnv<TApp extends AppConfigModuleKey>(
  input: RuntimeEnvExportInput<TApp>,
): RuntimeEnvExportEntry[] {
  if (input.config.global === undefined) {
    throw new Error("Runtime env export requires loadConfig output that includes global config.");
  }

  const entries: RuntimeEnvExportEntry[] = [];

  for (const descriptor of GlobalResourceRuntimeEnvExports) {
    const entry = exportDescriptor(input.config.global, descriptor);
    if (entry !== undefined) {
      appendEntry(entries, entry);
    }
  }

  for (const descriptor of getAppRuntimeEnvExports(input.app)) {
    const entry = exportDescriptor(input.config.app, descriptor);
    if (entry !== undefined) {
      appendEntry(entries, entry);
    }
  }

  return entries;
}
