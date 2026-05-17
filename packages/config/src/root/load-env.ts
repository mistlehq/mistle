import { parseBooleanEnv } from "../core/load-env.js";
import { asObjectRecord, getValueAtPath, setValueAtPath } from "../core/record.js";

type EnvValueParser = (value: string, envVar: string) => unknown;

type RootEnvDescriptor = {
  envVar: string;
  path: readonly string[];
  parse?: EnvValueParser;
};

type AppliedEnvOverride = {
  envVar: string;
  value: unknown;
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

function valuesAreEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyDescriptor(
  root: Record<string, unknown>,
  descriptor: RootEnvDescriptor,
  env: NodeJS.ProcessEnv,
  appliedOverrides: Map<string, AppliedEnvOverride>,
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

  const pathKey = descriptor.path.join(".");
  const appliedOverride = appliedOverrides.get(pathKey);
  const existingValue = getValueAtPath(root, descriptor.path);
  if (existingValue !== undefined && !valuesAreEqual(existingValue, value)) {
    throw new Error(
      `Conflicting env overrides for ${descriptor.path.join(".")}. ${descriptor.envVar} tried to set a different value than ${appliedOverride?.envVar ?? "an earlier env override"}.`,
    );
  }

  appliedOverrides.set(pathKey, {
    envVar: descriptor.envVar,
    value,
  });

  return setValueAtPath(root, descriptor.path, value);
}

const RootEnvDescriptors = [
  {
    envVar: "MISTLE_ENV",
    path: ["global", "env"],
  },
  {
    envVar: "MISTLE_INTERNAL_AUTH_METHOD",
    path: ["internal_auth", "method"],
  },
  {
    envVar: "MISTLE_INTERNAL_AUTH_SHARED_TOKEN",
    path: ["internal_auth", "shared_token", "token"],
  },
  {
    envVar: "MISTLE_BILLING_STRIPE_ENABLED",
    path: ["billing", "stripe", "enabled"],
    parse: parseBooleanEnv,
  },
  {
    envVar: "MISTLE_BILLING_STRIPE_SECRET_KEY",
    path: ["billing", "stripe", "secret_key"],
  },
  {
    envVar: "MISTLE_TELEMETRY_ENABLED",
    path: ["telemetry", "enabled"],
    parse: parseBooleanEnv,
  },
  {
    envVar: "MISTLE_TELEMETRY_DEBUG",
    path: ["telemetry", "debug"],
    parse: parseBooleanEnv,
  },
  {
    envVar: "MISTLE_TELEMETRY_TRACES_ENDPOINT",
    path: ["telemetry", "traces", "endpoint"],
  },
  {
    envVar: "MISTLE_TELEMETRY_LOGS_ENDPOINT",
    path: ["telemetry", "logs", "endpoint"],
  },
  {
    envVar: "MISTLE_TELEMETRY_METRICS_ENDPOINT",
    path: ["telemetry", "metrics", "endpoint"],
  },
  {
    envVar: "MISTLE_TELEMETRY_RESOURCE_ATTRIBUTES",
    path: ["telemetry", "resource_attributes"],
  },
  {
    envVar: "MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL",
    path: ["postgres", "control_plane", "direct_url"],
  },
  {
    envVar: "MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL",
    path: ["postgres", "control_plane", "pooled_url"],
  },
  {
    envVar: "MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL",
    path: ["postgres", "data_plane", "direct_url"],
  },
  {
    envVar: "MISTLE_POSTGRES_DATA_PLANE_POOLED_URL",
    path: ["postgres", "data_plane", "pooled_url"],
  },
  {
    envVar: "MISTLE_KV_CONTROL_PLANE_BACKEND",
    path: ["kv", "control_plane", "backend"],
  },
  {
    envVar: "MISTLE_KV_CONTROL_PLANE_URL",
    path: ["kv", "control_plane", "url"],
  },
  {
    envVar: "MISTLE_KV_CONTROL_PLANE_KEY_PREFIX",
    path: ["kv", "control_plane", "key_prefix"],
  },
  {
    envVar: "MISTLE_KV_DATA_PLANE_BACKEND",
    path: ["kv", "data_plane", "backend"],
  },
  {
    envVar: "MISTLE_KV_DATA_PLANE_URL",
    path: ["kv", "data_plane", "url"],
  },
  {
    envVar: "MISTLE_KV_DATA_PLANE_KEY_PREFIX",
    path: ["kv", "data_plane", "key_prefix"],
  },
  {
    envVar: "MISTLE_GATEWAY_RELAY_BACKEND",
    path: ["gateway_relay", "backend"],
  },
  {
    envVar: "MISTLE_GATEWAY_RELAY_NATS_URL",
    path: ["gateway_relay", "nats", "url"],
  },
  {
    envVar: "MISTLE_GATEWAY_RELAY_NATS_NAME_PREFIX",
    path: ["gateway_relay", "nats", "name_prefix"],
  },
  {
    envVar: "MISTLE_OBJECT_STORE_ASSETS_BUCKET_NAME",
    path: ["object_store", "assets", "bucket_name"],
  },
  {
    envVar: "MISTLE_OBJECT_STORE_ASSETS_REGION",
    path: ["object_store", "assets", "region"],
  },
  {
    envVar: "MISTLE_OBJECT_STORE_ASSETS_ENDPOINT",
    path: ["object_store", "assets", "endpoint"],
  },
  {
    envVar: "MISTLE_OBJECT_STORE_ASSETS_FORCE_PATH_STYLE",
    path: ["object_store", "assets", "force_path_style"],
    parse: parseBooleanEnv,
  },
  {
    envVar: "MISTLE_OBJECT_STORE_ASSETS_ACCESS_KEY_ID",
    path: ["object_store", "assets", "access_key_id"],
  },
  {
    envVar: "MISTLE_OBJECT_STORE_ASSETS_SECRET_ACCESS_KEY",
    path: ["object_store", "assets", "secret_access_key"],
  },
  {
    envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_BUCKET_NAME",
    path: ["object_store", "sandbox_storage", "bucket_name"],
  },
  {
    envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_REGION",
    path: ["object_store", "sandbox_storage", "region"],
  },
  {
    envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ENDPOINT",
    path: ["object_store", "sandbox_storage", "endpoint"],
  },
  {
    envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_FORCE_PATH_STYLE",
    path: ["object_store", "sandbox_storage", "force_path_style"],
    parse: parseBooleanEnv,
  },
  {
    envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ACCESS_KEY_ID",
    path: ["object_store", "sandbox_storage", "access_key_id"],
  },
  {
    envVar: "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY",
    path: ["object_store", "sandbox_storage", "secret_access_key"],
  },
  {
    envVar: "MISTLE_EMAIL_SMTP_FROM_ADDRESS",
    path: ["email", "smtp", "from_address"],
  },
  {
    envVar: "MISTLE_EMAIL_SMTP_FROM_NAME",
    path: ["email", "smtp", "from_name"],
  },
  {
    envVar: "MISTLE_EMAIL_SMTP_HOST",
    path: ["email", "smtp", "host"],
  },
  {
    envVar: "MISTLE_EMAIL_SMTP_PORT",
    path: ["email", "smtp", "port"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_EMAIL_SMTP_SECURE",
    path: ["email", "smtp", "secure"],
    parse: parseBooleanEnv,
  },
  {
    envVar: "MISTLE_EMAIL_SMTP_USERNAME",
    path: ["email", "smtp", "username"],
  },
  {
    envVar: "MISTLE_EMAIL_SMTP_PASSWORD",
    path: ["email", "smtp", "password"],
  },
  {
    envVar: "MISTLE_SERVICES_DASHBOARD_PUBLIC_URL",
    path: ["services", "dashboard", "public_url"],
  },
  {
    envVar: "MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN",
    path: ["services", "dashboard", "control_plane_api_origin"],
  },
  {
    envVar: "MISTLE_SERVICES_DASHBOARD_POSTHOG_ENABLED",
    path: ["services", "dashboard", "posthog", "enabled"],
    parse: parseBooleanEnv,
  },
  {
    envVar: "MISTLE_SERVICES_DASHBOARD_POSTHOG_PROJECT_API_KEY",
    path: ["services", "dashboard", "posthog", "project_api_key"],
  },
  {
    envVar: "MISTLE_SERVICES_DASHBOARD_POSTHOG_HOST",
    path: ["services", "dashboard", "posthog", "host"],
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_HOST",
    path: ["services", "control_plane_api", "host"],
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_PORT",
    path: ["services", "control_plane_api", "port"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL",
    path: ["services", "control_plane_api", "public_url"],
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL",
    path: ["services", "control_plane_api", "internal_url"],
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_SECRET",
    path: ["services", "control_plane_api", "auth", "secret"],
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS",
    path: ["services", "control_plane_api", "auth", "trusted_origins"],
    parse: parseCsvEnv,
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_ENABLED_METHODS",
    path: ["services", "control_plane_api", "auth", "enabled_methods"],
    parse: parseCsvEnv,
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_ALLOW_SIGNUPS",
    path: ["services", "control_plane_api", "auth", "allow_signups"],
    parse: parseBooleanEnv,
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_OTP_LENGTH",
    path: ["services", "control_plane_api", "auth", "otp", "length"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_OTP_EXPIRES_IN_SECONDS",
    path: ["services", "control_plane_api", "auth", "otp", "expires_in_seconds"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_OTP_ALLOWED_ATTEMPTS",
    path: ["services", "control_plane_api", "auth", "otp", "allowed_attempts"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_ID",
    path: ["services", "control_plane_api", "auth", "google", "client_id"],
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_SECRET",
    path: ["services", "control_plane_api", "auth", "google", "client_secret"],
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_INTEGRATIONS_ACTIVE_MASTER_ENCRYPTION_KEY_VERSION",
    path: ["services", "control_plane_api", "integrations", "active_master_encryption_key_version"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON",
    path: ["services", "control_plane_api", "integrations", "master_encryption_keys"],
    parse: parseJsonObjectEnv,
  },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_API_HOST",
    path: ["services", "data_plane_api", "host"],
  },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_API_PORT",
    path: ["services", "data_plane_api", "port"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL",
    path: ["services", "data_plane_api", "internal_url"],
  },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_HOST",
    path: ["services", "data_plane_gateway", "host"],
  },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_PORT",
    path: ["services", "data_plane_gateway", "port"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL",
    path: ["services", "data_plane_gateway", "internal_url"],
  },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL",
    path: ["services", "data_plane_gateway", "sandbox_ws_public_url"],
  },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL",
    path: ["services", "data_plane_gateway", "sandbox_ws_internal_url"],
  },
  {
    envVar: "MISTLE_SERVICES_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY",
    path: ["services", "control_plane_worker", "workflow_concurrency"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SERVICES_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY",
    path: ["services", "data_plane_worker", "workflow_concurrency"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID",
    path: ["workflow", "control_plane", "namespace_id"],
  },
  {
    envVar: "MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID",
    path: ["workflow", "data_plane", "namespace_id"],
  },
  {
    envVar: "MISTLE_SANDBOX_DEFAULT_BASE_IMAGE",
    path: ["sandbox", "default_base_image"],
  },
  {
    envVar: "MISTLE_SANDBOX_STORAGE_BACKEND",
    path: ["sandbox", "storage", "backend"],
  },
  {
    envVar: "MISTLE_SANDBOX_DOCKER_ENABLED",
    path: ["sandbox", "docker", "enabled"],
    parse: parseBooleanEnv,
  },
  {
    envVar: "MISTLE_SANDBOX_DOCKER_SOCKET_PATH",
    path: ["sandbox", "docker", "socket_path"],
  },
  {
    envVar: "MISTLE_SANDBOX_DOCKER_NETWORK_NAME",
    path: ["sandbox", "docker", "network_name"],
  },
  {
    envVar: "MISTLE_SANDBOX_E2B_ENABLED",
    path: ["sandbox", "e2b", "enabled"],
    parse: parseBooleanEnv,
  },
  {
    envVar: "MISTLE_SANDBOX_E2B_API_KEY",
    path: ["sandbox", "e2b", "api_key"],
  },
  {
    envVar: "MISTLE_SANDBOX_E2B_DOMAIN",
    path: ["sandbox", "e2b", "domain"],
  },
  {
    envVar: "MISTLE_SANDBOX_TENSORLAKE_ENABLED",
    path: ["sandbox", "tensorlake", "enabled"],
    parse: parseBooleanEnv,
  },
  {
    envVar: "MISTLE_SANDBOX_TENSORLAKE_API_KEY",
    path: ["sandbox", "tensorlake", "api_key"],
  },
  {
    envVar: "MISTLE_SANDBOX_E2B_CPU_COUNT",
    path: ["sandbox", "e2b", "cpu_count"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SANDBOX_E2B_MEMORY_MB",
    path: ["sandbox", "e2b", "memory_mb"],
    parse: parseNumberEnv,
  },
  {
    envVar: "MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY",
    path: ["sandbox", "storage", "archil", "api_key"],
  },
  {
    envVar: "MISTLE_SANDBOX_STORAGE_ARCHIL_REGION",
    path: ["sandbox", "storage", "archil", "region"],
  },
  {
    envVar: "MISTLE_SANDBOX_STORAGE_ARCHIL_NAME_PREFIX",
    path: ["sandbox", "storage", "archil", "name_prefix"],
  },
  {
    envVar: "MISTLE_SANDBOX_STORAGE_ARCHIL_MOUNT_OBJECT_STORE",
    path: ["sandbox", "storage", "archil", "mount_object_store"],
  },
  {
    envVar: "MISTLE_SANDBOX_STORAGE_DOCKER_VOLUME_NAME_PREFIX",
    path: ["sandbox", "storage", "docker_volume", "name_prefix"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET",
    path: ["sandbox", "tokens", "bootstrap", "secret"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_ISSUER",
    path: ["sandbox", "tokens", "bootstrap", "issuer"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_AUDIENCE",
    path: ["sandbox", "tokens", "bootstrap", "audience"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_EGRESS_SECRET",
    path: ["sandbox", "tokens", "egress", "secret"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_EGRESS_ISSUER",
    path: ["sandbox", "tokens", "egress", "issuer"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_EGRESS_AUDIENCE",
    path: ["sandbox", "tokens", "egress", "audience"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_CONNECT_SECRET",
    path: ["sandbox", "tokens", "connect", "secret"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_CONNECT_ISSUER",
    path: ["sandbox", "tokens", "connect", "issuer"],
  },
  {
    envVar: "MISTLE_SANDBOX_TOKENS_CONNECT_AUDIENCE",
    path: ["sandbox", "tokens", "connect", "audience"],
  },
  {
    envVar: "MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET",
    path: ["sandbox", "publish", "access_token", "secret"],
  },
  {
    envVar: "MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER",
    path: ["sandbox", "publish", "access_token", "issuer"],
  },
  {
    envVar: "MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE",
    path: ["sandbox", "publish", "access_token", "audience"],
  },
  {
    envVar: "MISTLE_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET",
    path: ["sandbox", "publish", "session", "cookie_signing_secret"],
  },
  {
    envVar: "MISTLE_SANDBOX_PUBLISH_BASE_DOMAIN",
    path: ["sandbox", "publish_base_domain"],
  },
  {
    envVar: "MISTLE_TEST_SANDBOXD_TEST_FAULTS_ENABLED",
    path: ["sandbox", "sandboxd_test_faults_enabled"],
    parse: parseBooleanEnv,
  },
] satisfies readonly RootEnvDescriptor[];

export function loadRootConfigFromEnv(env: NodeJS.ProcessEnv): Record<string, unknown> {
  let root: Record<string, unknown> = {};
  const appliedOverrides = new Map<string, AppliedEnvOverride>();

  for (const descriptor of RootEnvDescriptors) {
    root = applyDescriptor(root, descriptor, env, appliedOverrides);
  }

  return root;
}
