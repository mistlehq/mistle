import { parseBooleanEnv } from "../core/load-env.js";
import { asObjectRecord, getValueAtPath, setValueAtPath } from "../core/record.js";

type EnvValueParser = (value: string, envVar: string) => unknown;

type RootEnvDescriptor = {
  envVar: string;
  path: readonly string[];
  parse?: EnvValueParser;
};

function parseNumberEnv(value: string): number {
  return Number(value);
}

function parseCsvEnv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseJsonObjectEnv(value: string, envVar: string): Record<string, string> {
  try {
    const parsedValue = asObjectRecord(JSON.parse(value));
    const normalizedValue: Record<string, string> = {};

    for (const [key, parsedEntry] of Object.entries(parsedValue)) {
      if (typeof parsedEntry !== "string") {
        throw new Error(`Invalid value for key '${key}'. Expected a string value.`);
      }

      normalizedValue[key] = parsedEntry;
    }

    return normalizedValue;
  } catch (error) {
    throw new Error(`Invalid ${envVar}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseArchilMountObjectStoreEnv(
  value: string,
  envVar: string,
): Record<string, unknown> | undefined {
  try {
    const parsedValue = JSON.parse(value);
    if (!Array.isArray(parsedValue)) {
      throw new Error("Expected a JSON array.");
    }

    if (parsedValue.length === 0) {
      return undefined;
    }

    if (parsedValue.length > 1) {
      throw new Error("Expected at most one mount.");
    }

    const mount = asObjectRecord(parsedValue[0]);
    if (mount.type !== "s3-compatible") {
      throw new Error("Only s3-compatible mounts can be mapped to object_store.sandbox_storage.");
    }

    return {
      bucket_name: mount.bucket,
      endpoint: mount.endpoint,
      access_key_id: mount.accessKeyId,
      secret_access_key: mount.secretAccessKey,
    };
  } catch (error) {
    throw new Error(`Invalid ${envVar}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseArchilMountObjectStoreSelectorEnv(
  value: string,
  envVar: string,
): "sandbox_storage" | undefined {
  return parseArchilMountObjectStoreEnv(value, envVar) === undefined
    ? undefined
    : "sandbox_storage";
}

function valuesAreEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyDescriptor(
  root: Record<string, unknown>,
  descriptor: RootEnvDescriptor,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const rawValue = env[descriptor.envVar];
  if (rawValue === undefined) {
    return root;
  }

  const value =
    descriptor.parse === undefined ? rawValue : descriptor.parse(rawValue, descriptor.envVar);
  if (value === undefined) {
    return root;
  }

  const existingValue = getValueAtPath(root, descriptor.path);
  if (existingValue !== undefined && !valuesAreEqual(existingValue, value)) {
    throw new Error(
      `Conflicting env overrides for ${descriptor.path.join(".")}. ${descriptor.envVar} tried to set a different value than an earlier env override.`,
    );
  }

  return setValueAtPath(root, descriptor.path, value);
}

const RootEnvDescriptors: readonly RootEnvDescriptor[] = [
  {
    envVar: "NODE_ENV",
    path: ["global", "env"],
    parse: (value) => (value === "production" ? "production" : "development"),
  },
  {
    envVar: "MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN",
    path: ["internal_auth", "shared_token", "token"],
  },
  {
    envVar: "MISTLE_GLOBAL_TELEMETRY_ENABLED",
    path: ["telemetry", "enabled"],
    parse: parseBooleanEnv,
  },
  {
    envVar: "MISTLE_GLOBAL_TELEMETRY_DEBUG",
    path: ["telemetry", "debug"],
    parse: parseBooleanEnv,
  },
  {
    envVar: "MISTLE_GLOBAL_TELEMETRY_TRACES_ENDPOINT",
    path: ["telemetry", "traces", "endpoint"],
  },
  {
    envVar: "MISTLE_GLOBAL_TELEMETRY_LOGS_ENDPOINT",
    path: ["telemetry", "logs", "endpoint"],
  },
  {
    envVar: "MISTLE_GLOBAL_TELEMETRY_METRICS_ENDPOINT",
    path: ["telemetry", "metrics", "endpoint"],
  },
  {
    envVar: "MISTLE_GLOBAL_TELEMETRY_RESOURCE_ATTRIBUTES",
    path: ["telemetry", "resource_attributes"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_SECRET",
    path: ["sandbox", "tokens", "bootstrap", "secret"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_ISSUER",
    path: ["sandbox", "tokens", "bootstrap", "issuer"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_AUDIENCE",
    path: ["sandbox", "tokens", "bootstrap", "audience"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_SECRET",
    path: ["sandbox", "tokens", "connect", "secret"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_ISSUER",
    path: ["sandbox", "tokens", "connect", "issuer"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_AUDIENCE",
    path: ["sandbox", "tokens", "connect", "audience"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_SECRET",
    path: ["sandbox", "tokens", "egress", "secret"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_ISSUER",
    path: ["sandbox", "tokens", "egress", "issuer"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_AUDIENCE",
    path: ["sandbox", "tokens", "egress", "audience"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET",
    path: ["sandbox", "publish", "access_token", "secret"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER",
    path: ["sandbox", "publish", "access_token", "issuer"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE",
    path: ["sandbox", "publish", "access_token", "audience"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET",
    path: ["sandbox", "publish", "session", "cookie_signing_secret"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_PUBLISH_BASE_DOMAIN",
    path: ["sandbox", "publish_base_domain"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_PROVIDER",
    path: ["sandbox", "provider"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_DEFAULT_BASE_IMAGE",
    path: ["sandbox", "default_base_image"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_GATEWAY_WS_URL",
    path: ["services", "data_plane_gateway", "sandbox_ws_public_url"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_INTERNAL_GATEWAY_WS_URL",
    path: ["services", "data_plane_gateway", "sandbox_ws_internal_url"],
  },
  {
    envVar: "MISTLE_GLOBAL_SANDBOX_STORAGE_BACKEND",
    path: ["sandbox", "storage", "backend"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_HOST",
    path: ["services", "control_plane_api", "host"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_PORT",
    path: ["services", "control_plane_api", "port"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL",
    path: ["postgres", "control_plane", "pooled_url"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_DATABASE_MIGRATION_URL",
    path: ["postgres", "control_plane", "direct_url"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_BUCKET_NAME",
    path: ["object_store", "assets", "bucket_name"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_REGION",
    path: ["object_store", "assets", "region"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_ENDPOINT",
    path: ["object_store", "assets", "endpoint"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_FORCE_PATH_STYLE",
    path: ["object_store", "assets", "force_path_style"],
    parse: parseBooleanEnv,
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_ACCESS_KEY_ID",
    path: ["object_store", "assets", "access_key_id"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_SECRET_ACCESS_KEY",
    path: ["object_store", "assets", "secret_access_key"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL",
    path: ["services", "control_plane_api", "public_url"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_SECRET",
    path: ["services", "control_plane_api", "auth", "secret"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS",
    path: ["services", "control_plane_api", "auth", "trusted_origins"],
    parse: parseCsvEnv,
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_LENGTH",
    path: ["services", "control_plane_api", "auth", "otp", "length"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_EXPIRES_IN_SECONDS",
    path: ["services", "control_plane_api", "auth", "otp", "expires_in_seconds"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_ALLOWED_ATTEMPTS",
    path: ["services", "control_plane_api", "auth", "otp", "allowed_attempts"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_ID",
    path: ["services", "control_plane_api", "auth", "google", "client_id"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_SECRET",
    path: ["services", "control_plane_api", "auth", "google", "client_secret"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_DASHBOARD_BASE_URL",
    path: ["services", "dashboard", "public_url"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL",
    path: ["services", "dashboard", "control_plane_api_origin"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_DATABASE_URL",
    path: ["postgres", "control_plane", "pooled_url"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_MIGRATION_URL",
    path: ["postgres", "control_plane", "direct_url"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID",
    path: ["workflow", "control_plane", "namespace_id"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL",
    path: ["services", "data_plane_api", "internal_url"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_ACTIVE_MASTER_ENCRYPTION_KEY_VERSION",
    path: ["services", "control_plane_api", "integrations", "active_master_encryption_key_version"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON",
    path: ["services", "control_plane_api", "integrations", "master_encryption_keys"],
    parse: parseJsonObjectEnv,
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_DATABASE_URL",
    path: ["postgres", "control_plane", "pooled_url"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_NAMESPACE_ID",
    path: ["workflow", "control_plane", "namespace_id"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY",
    path: ["services", "control_plane_worker", "workflow_concurrency"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_EMAIL_FROM_ADDRESS",
    path: ["email", "smtp", "from_address"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_EMAIL_FROM_NAME",
    path: ["email", "smtp", "from_name"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_HOST",
    path: ["email", "smtp", "host"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PORT",
    path: ["email", "smtp", "port"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_SECURE",
    path: ["email", "smtp", "secure"],
    parse: parseBooleanEnv,
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_USERNAME",
    path: ["email", "smtp", "username"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PASSWORD",
    path: ["email", "smtp", "password"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL",
    path: ["services", "data_plane_api", "internal_url"],
  },
  {
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL",
    path: ["services", "control_plane_api", "internal_url"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_API_HOST",
    path: ["services", "data_plane_api", "host"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_API_PORT",
    path: ["services", "data_plane_api", "port"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_API_DATABASE_URL",
    path: ["postgres", "data_plane", "pooled_url"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_API_DATABASE_MIGRATION_URL",
    path: ["postgres", "data_plane", "direct_url"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_API_WORKFLOW_DATABASE_URL",
    path: ["postgres", "data_plane", "pooled_url"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_API_WORKFLOW_MIGRATION_URL",
    path: ["postgres", "data_plane", "direct_url"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_API_WORKFLOW_NAMESPACE_ID",
    path: ["workflow", "data_plane", "namespace_id"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_API_RUNTIME_STATE_GATEWAY_BASE_URL",
    path: ["services", "data_plane_gateway", "internal_url"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_API_CONTROL_PLANE_API_BASE_URL",
    path: ["services", "control_plane_api", "internal_url"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_API_SANDBOX_DOCKER_SOCKET_PATH",
    path: ["sandbox", "docker", "socket_path"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_API_SANDBOX_E2B_API_KEY",
    path: ["sandbox", "e2b", "api_key"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_API_SANDBOX_E2B_DOMAIN",
    path: ["sandbox", "e2b", "domain"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_HOST",
    path: ["services", "data_plane_gateway", "host"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_PORT",
    path: ["services", "data_plane_gateway", "port"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_DATABASE_URL",
    path: ["postgres", "data_plane", "pooled_url"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_BACKEND",
    path: ["kv", "data_plane", "backend"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_VALKEY_URL",
    path: ["kv", "data_plane", "url"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_VALKEY_KEY_PREFIX",
    path: ["kv", "data_plane", "key_prefix"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_DATA_PLANE_API_BASE_URL",
    path: ["services", "data_plane_api", "internal_url"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_CONTROL_PLANE_API_BASE_URL",
    path: ["services", "control_plane_api", "internal_url"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL",
    path: ["postgres", "data_plane", "pooled_url"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL",
    path: ["postgres", "data_plane", "pooled_url"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID",
    path: ["workflow", "data_plane", "namespace_id"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY",
    path: ["services", "data_plane_worker", "workflow_concurrency"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_RUNTIME_STATE_GATEWAY_BASE_URL",
    path: ["services", "data_plane_gateway", "internal_url"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL",
    path: ["services", "control_plane_api", "internal_url"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SOCKET_PATH",
    path: ["sandbox", "docker", "socket_path"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_NETWORK_NAME",
    path: ["sandbox", "docker", "network_name"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_API_KEY",
    path: ["sandbox", "e2b", "api_key"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_DOMAIN",
    path: ["sandbox", "e2b", "domain"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_CPU_COUNT",
    path: ["sandbox", "e2b", "cpu_count"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_MEMORY_MB",
    path: ["sandbox", "e2b", "memory_mb"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL",
    path: ["services", "tokenizer_proxy", "egress_url"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_API_KEY",
    path: ["sandbox", "storage", "archil", "api_key"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_REGION",
    path: ["sandbox", "storage", "archil", "region"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_NAME_PREFIX",
    path: ["sandbox", "storage", "archil", "name_prefix"],
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON",
    path: ["object_store", "sandbox_storage"],
    parse: parseArchilMountObjectStoreEnv,
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON",
    path: ["sandbox", "storage", "archil", "mount_object_store"],
    parse: parseArchilMountObjectStoreSelectorEnv,
  },
  {
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_DOCKER_VOLUME_NAME_PREFIX",
    path: ["sandbox", "storage", "docker_volume", "name_prefix"],
  },
  {
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_HOST",
    path: ["services", "tokenizer_proxy", "host"],
  },
  {
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_PORT",
    path: ["services", "tokenizer_proxy", "port"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_CONTROL_PLANE_API_BASE_URL",
    path: ["services", "control_plane_api", "internal_url"],
  },
  {
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_CONTROL_PLANE_API_PUBLIC_BASE_URL",
    path: ["services", "control_plane_api", "public_url"],
  },
];

export function loadRootConfigFromEnv(env: NodeJS.ProcessEnv): Record<string, unknown> {
  let root: Record<string, unknown> = {};

  for (const descriptor of RootEnvDescriptors) {
    root = applyDescriptor(root, descriptor, env);
  }

  return root;
}
