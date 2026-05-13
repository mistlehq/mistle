import { randomBytes } from "node:crypto";

import { stringify as stringifyToml } from "smol-toml";

import {
  getValueAtPath,
  isObjectRecord,
  setValueAtPath,
} from "../../packages/config/src/core/record.js";
import { getLocalDevDockerRegistrySandboxBaseImageRef } from "../../packages/config/src/sandbox-base-images.js";

export type ConfigRecord = Record<string, unknown>;

type CommentedSection = {
  heading: string;
  comments: readonly string[];
};

const TomlConfigComments: readonly CommentedSection[] = [
  {
    heading: "[postgres.control_plane]",
    comments: [
      "# Each plane can point at separate Postgres instances. For local and simple",
      "# deployments, direct_url and pooled_url may still target the same database.",
      "# Use direct_url for migrations and pooled_url for app runtime traffic.",
    ],
  },
  {
    heading: "[kv.data_plane]",
    comments: [
      "# Valkey is modeled as a shared dependency. Services consume the plane-specific",
      "# KV backend they need instead of owning duplicated Valkey config.",
    ],
  },
  {
    heading: "[object_store.sandbox_storage]",
    comments: [
      '# Used when sandbox.storage.archil.mount_object_store = "sandbox_storage".',
      "# For real Archil-backed runs, point this at a remote S3-compatible bucket.",
    ],
  },
  {
    heading: "[internal_auth]",
    comments: [
      "# Service-to-service auth is currently a shared token. The method field keeps",
      "# the shape explicit if this later moves to signed workload identity/JWTs.",
    ],
  },
  {
    heading: "[sandbox.storage]",
    comments: [
      "# docker_volume is the lightest local storage backend. archil requires the",
      "# sandbox.storage.archil section and, when mounted, object_store.sandbox_storage.",
    ],
  },
];

function createSecret(): string {
  return randomBytes(32).toString("base64url");
}

function readOptionalEnv(environment: NodeJS.ProcessEnv, envVar: string): string | undefined {
  const value = environment[envVar]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function readRequiredEnv(environment: NodeJS.ProcessEnv, envVar: string): string {
  const value = readOptionalEnv(environment, envVar);
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }

  return value;
}

function readOptionalIntegerEnv(
  environment: NodeJS.ProcessEnv,
  envVar: string,
): number | undefined {
  const value = readOptionalEnv(environment, envVar);
  if (value === undefined) {
    return undefined;
  }

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue)) {
    throw new Error(`Invalid value for ${envVar}. Expected an integer.`);
  }

  return parsedValue;
}

function readOptionalBooleanEnv(
  environment: NodeJS.ProcessEnv,
  envVar: string,
): boolean | undefined {
  const value = readOptionalEnv(environment, envVar);
  if (value === undefined) {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`Invalid value for ${envVar}. Expected 'true' or 'false'.`);
}

function deleteValueAtPath(root: ConfigRecord, path: readonly string[]): ConfigRecord {
  if (path.length === 0) {
    return root;
  }

  const [head, ...tail] = path;
  if (head === undefined) {
    throw new Error("Deletion path contained an undefined segment.");
  }

  const updatedRoot: ConfigRecord = { ...root };

  if (tail.length === 0) {
    delete updatedRoot[head];
    return updatedRoot;
  }

  const childValue = updatedRoot[head];
  if (!isObjectRecord(childValue)) {
    return updatedRoot;
  }

  const updatedChild = deleteValueAtPath(childValue, tail);
  if (Object.keys(updatedChild).length === 0) {
    delete updatedRoot[head];
    return updatedRoot;
  }

  updatedRoot[head] = updatedChild;
  return updatedRoot;
}

function readSandboxObjectStoreFromEnv(environment: NodeJS.ProcessEnv): ConfigRecord {
  return {
    bucket_name: readRequiredEnv(environment, "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_BUCKET_NAME"),
    region:
      readOptionalEnv(environment, "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_REGION") ?? "us-east-1",
    endpoint: readRequiredEnv(environment, "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ENDPOINT"),
    force_path_style:
      readOptionalBooleanEnv(environment, "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_FORCE_PATH_STYLE") ??
      true,
    access_key_id: readRequiredEnv(
      environment,
      "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ACCESS_KEY_ID",
    ),
    secret_access_key: readRequiredEnv(
      environment,
      "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY",
    ),
  };
}

function upsertOptionalValueAtPath(
  root: ConfigRecord,
  path: readonly string[],
  value: unknown,
): ConfigRecord {
  if (value === undefined) {
    return root;
  }

  return setValueAtPath(root, path, value);
}

export function buildDevelopmentTomlConfig(): ConfigRecord {
  const postgresDirectUrl = "postgresql://mistle:mistle@127.0.0.1:5432/mistle_dev";
  const postgresPooledUrl = "postgresql://mistle:mistle@127.0.0.1:6432/mistle_dev";
  const controlPlaneApiUrl = "http://localhost:5100";
  const dataPlaneApiUrl = "http://localhost:5200";
  const dataPlaneGatewayUrl = "http://127.0.0.1:5202";

  return {
    global: {
      env: "development",
    },
    telemetry: {
      enabled: true,
      debug: false,
      resource_attributes: "deployment.environment=development",
      traces: {
        endpoint: "http://127.0.0.1:4318/v1/traces",
      },
      logs: {
        endpoint: "http://127.0.0.1:4318/v1/logs",
      },
      metrics: {
        endpoint: "http://127.0.0.1:4318/v1/metrics",
      },
    },
    services: {
      dashboard: {
        public_url: "http://localhost:5173",
        control_plane_api_origin: controlPlaneApiUrl,
      },
      control_plane_api: {
        host: "127.0.0.1",
        port: 5100,
        public_url: controlPlaneApiUrl,
        internal_url: controlPlaneApiUrl,
        auth: {
          secret: createSecret(),
          trusted_origins: [
            "http://127.0.0.1:3000",
            "http://localhost:3000",
            "http://127.0.0.1:5173",
            "http://localhost:5173",
          ],
          enabled_methods: ["otp"],
          otp: {
            length: 6,
            expires_in_seconds: 300,
            allowed_attempts: 3,
          },
        },
        integrations: {
          active_master_encryption_key_version: 1,
          master_encryption_keys: {
            "1": createSecret(),
          },
        },
      },
      data_plane_api: {
        host: "127.0.0.1",
        port: 5200,
        internal_url: dataPlaneApiUrl,
      },
      data_plane_gateway: {
        host: "127.0.0.1",
        port: 5202,
        internal_url: dataPlaneGatewayUrl,
        sandbox_ws_public_url: "ws://localhost:5202/tunnel/sandbox",
        sandbox_ws_internal_url: "ws://data-plane-gateway-relay:5202/tunnel/sandbox",
      },
      control_plane_worker: {
        workflow_concurrency: 1,
      },
      data_plane_worker: {
        workflow_concurrency: 1,
      },
    },
    workflow: {
      control_plane: {
        namespace_id: "development",
      },
      data_plane: {
        namespace_id: "development",
      },
    },
    postgres: {
      control_plane: {
        direct_url: postgresDirectUrl,
        pooled_url: postgresPooledUrl,
      },
      data_plane: {
        direct_url: postgresDirectUrl,
        pooled_url: postgresPooledUrl,
      },
    },
    kv: {
      control_plane: {
        backend: "valkey",
        url: "redis://127.0.0.1:6379",
        key_prefix: "mistle:control:development",
      },
      data_plane: {
        backend: "valkey",
        url: "redis://127.0.0.1:6379",
        key_prefix: "mistle:runtime-state:development",
      },
    },
    object_store: {
      assets: {
        bucket_name: "mistle-assets",
        region: "us-east-1",
        endpoint: "http://127.0.0.1:8333",
        force_path_style: true,
        access_key_id: "mistle-access-key",
        secret_access_key: "mistle-secret-key",
      },
      sandbox_storage: {
        bucket_name: "mistle-sandbox-storage",
        region: "us-east-1",
        endpoint: "http://seaweedfs:8333",
        force_path_style: true,
        access_key_id: "replace-with-archil-mount-access-key-id",
        secret_access_key: "replace-with-archil-mount-secret-access-key",
      },
    },
    email: {
      smtp: {
        from_address: "no-reply@mistle.local",
        from_name: "Mistle (Local)",
        host: "127.0.0.1",
        port: 1025,
        secure: false,
        username: "mailpit",
        password: "mailpit",
      },
    },
    internal_auth: {
      method: "shared_token",
      shared_token: {
        token: createSecret(),
      },
    },
    sandbox: {
      default_base_image: getLocalDevDockerRegistrySandboxBaseImageRef(),
      publish_base_domain: "mistle.localhost",
      storage: {
        backend: "archil",
        archil: {
          api_key: "replace-with-archil-api-key",
          region: "gcp-us-central1",
          name_prefix: "mistle-",
          mount_object_store: "sandbox_storage",
        },
      },
      tokens: {
        connect: {
          secret: createSecret(),
          issuer: "control-plane-api",
          audience: "data-plane-gateway",
        },
        bootstrap: {
          secret: createSecret(),
          issuer: "data-plane-worker",
          audience: "data-plane-gateway",
        },
      },
      publish: {
        access_token: {
          secret: createSecret(),
          issuer: "control-plane-api",
          audience: "data-plane-gateway",
        },
        session: {
          cookie_signing_secret: createSecret(),
        },
      },
      docker: {
        enabled: true,
        socket_path: "/var/run/docker.sock",
        network_name: "mistle-sandbox-dev",
      },
    },
  };
}

export function buildIntegrationTomlConfig(input: {
  provider: "docker" | "e2b";
  environment: NodeJS.ProcessEnv;
  e2bSandboxBaseImage?: string;
}): ConfigRecord {
  let configRoot = buildDevelopmentTomlConfig();

  configRoot = setValueAtPath(
    configRoot,
    ["services", "control_plane_api", "internal_url"],
    "http://control-plane-api:5100",
  );
  configRoot = setValueAtPath(
    configRoot,
    ["services", "data_plane_api", "internal_url"],
    "http://data-plane-api:5200",
  );
  configRoot = setValueAtPath(
    configRoot,
    ["services", "data_plane_gateway", "internal_url"],
    "http://data-plane-gateway:5202",
  );
  configRoot = setValueAtPath(
    configRoot,
    ["services", "data_plane_gateway", "sandbox_ws_internal_url"],
    "ws://data-plane-gateway:5202/tunnel/sandbox",
  );
  if (input.provider === "docker") {
    configRoot = setValueAtPath(configRoot, ["sandbox", "docker", "enabled"], true);
    configRoot = setValueAtPath(configRoot, ["sandbox", "storage"], {
      backend: "docker_volume",
      docker_volume: {
        name_prefix: "it-system-",
      },
    });
    configRoot = deleteValueAtPath(configRoot, ["object_store", "sandbox_storage"]);
    configRoot = deleteValueAtPath(configRoot, ["sandbox", "e2b"]);
    return configRoot;
  }

  const e2bApiKey = readRequiredEnv(input.environment, "MISTLE_SANDBOX_E2B_API_KEY");
  const e2bDomain = readOptionalEnv(input.environment, "MISTLE_SANDBOX_E2B_DOMAIN") ?? "e2b.app";

  configRoot = setValueAtPath(
    configRoot,
    ["sandbox", "default_base_image"],
    input.e2bSandboxBaseImage ?? getLocalDevDockerRegistrySandboxBaseImageRef(),
  );
  configRoot = setValueAtPath(configRoot, ["sandbox", "storage"], {
    backend: "archil",
    archil: {
      api_key: readRequiredEnv(input.environment, "MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY"),
      region: readRequiredEnv(input.environment, "MISTLE_SANDBOX_STORAGE_ARCHIL_REGION"),
      name_prefix:
        readOptionalEnv(input.environment, "MISTLE_SANDBOX_STORAGE_ARCHIL_NAME_PREFIX") ??
        "it-system-",
      mount_object_store: "sandbox_storage",
    },
  });
  configRoot = setValueAtPath(configRoot, ["sandbox", "e2b"], {
    enabled: true,
    api_key: e2bApiKey,
    domain: e2bDomain,
    cpu_count: readOptionalIntegerEnv(input.environment, "MISTLE_SANDBOX_E2B_CPU_COUNT") ?? 4,
    memory_mb: readOptionalIntegerEnv(input.environment, "MISTLE_SANDBOX_E2B_MEMORY_MB") ?? 8192,
  });
  configRoot = setValueAtPath(
    configRoot,
    ["object_store", "sandbox_storage"],
    readSandboxObjectStoreFromEnv(input.environment),
  );
  configRoot = setValueAtPath(
    configRoot,
    ["services", "data_plane_gateway", "sandbox_ws_public_url"],
    "wss://gateway.mistle.example/tunnel/sandbox",
  );
  configRoot = setValueAtPath(
    configRoot,
    ["services", "data_plane_gateway", "sandbox_ws_internal_url"],
    "wss://gateway.mistle.example/tunnel/sandbox",
  );
  configRoot = deleteValueAtPath(configRoot, ["sandbox", "docker"]);

  return configRoot;
}

export function applyTomlConfigEnvOverrides(input: {
  configRoot: ConfigRecord;
  environment: NodeJS.ProcessEnv;
}): ConfigRecord {
  let configRoot = input.configRoot;

  configRoot = upsertOptionalValueAtPath(
    configRoot,
    ["sandbox", "docker", "enabled"],
    readOptionalBooleanEnv(input.environment, "MISTLE_SANDBOX_DOCKER_ENABLED"),
  );
  configRoot = upsertOptionalValueAtPath(
    configRoot,
    ["sandbox", "e2b", "enabled"],
    readOptionalBooleanEnv(input.environment, "MISTLE_SANDBOX_E2B_ENABLED"),
  );
  configRoot = upsertOptionalValueAtPath(
    configRoot,
    ["sandbox", "storage", "backend"],
    readOptionalEnv(input.environment, "MISTLE_SANDBOX_STORAGE_BACKEND"),
  );

  const dataPlaneGatewayRuntimeStateUrl = readOptionalEnv(
    input.environment,
    "MISTLE_KV_DATA_PLANE_URL",
  );
  configRoot = upsertOptionalValueAtPath(
    configRoot,
    ["kv", "data_plane", "url"],
    dataPlaneGatewayRuntimeStateUrl,
  );

  const dataPlaneGatewayRuntimeStateKeyPrefix = readOptionalEnv(
    input.environment,
    "MISTLE_KV_DATA_PLANE_KEY_PREFIX",
  );
  configRoot = upsertOptionalValueAtPath(
    configRoot,
    ["kv", "data_plane", "key_prefix"],
    dataPlaneGatewayRuntimeStateKeyPrefix,
  );

  const controlPlaneApiDatabaseUrl = readOptionalEnv(
    input.environment,
    "MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL",
  );
  configRoot = upsertOptionalValueAtPath(
    configRoot,
    ["postgres", "control_plane", "pooled_url"],
    controlPlaneApiDatabaseUrl,
  );
  configRoot = upsertOptionalValueAtPath(
    configRoot,
    ["postgres", "control_plane", "direct_url"],
    readOptionalEnv(input.environment, "MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL") ??
      controlPlaneApiDatabaseUrl,
  );

  const dataPlaneApiDatabaseUrl = readOptionalEnv(
    input.environment,
    "MISTLE_POSTGRES_DATA_PLANE_POOLED_URL",
  );
  configRoot = upsertOptionalValueAtPath(
    configRoot,
    ["postgres", "data_plane", "pooled_url"],
    dataPlaneApiDatabaseUrl,
  );
  configRoot = upsertOptionalValueAtPath(
    configRoot,
    ["postgres", "data_plane", "direct_url"],
    readOptionalEnv(input.environment, "MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL") ??
      dataPlaneApiDatabaseUrl,
  );

  return configRoot;
}

export function stringifyTomlConfig(input: { header: string; configRoot: ConfigRecord }): string {
  const tomlLines = stringifyToml(input.configRoot).split("\n");
  const outputLines: string[] = [];

  for (const line of tomlLines) {
    const comments = TomlConfigComments.find((comment) => comment.heading === line)?.comments;

    if (comments !== undefined) {
      if (outputLines.length > 0 && outputLines[outputLines.length - 1] !== "") {
        outputLines.push("");
      }

      outputLines.push(...comments);
    }

    outputLines.push(line);
  }

  return `${input.header}${outputLines.join("\n")}`;
}

export function isMissingRequiredConfigValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length === 0 || value.startsWith("replace-with-");
  }

  if (Array.isArray(value)) {
    return value.length === 0 || value.some((item) => isMissingRequiredConfigValue(item));
  }

  if (isObjectRecord(value)) {
    const entries = Object.values(value);
    return entries.length === 0 || entries.some((item) => isMissingRequiredConfigValue(item));
  }

  return true;
}

export function getValueAtTomlConfigPath(root: ConfigRecord, path: readonly string[]): unknown {
  return getValueAtPath(root, path);
}
