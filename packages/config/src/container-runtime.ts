import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { stringify } from "smol-toml";

import { mergeConfigRoots } from "./core/merge.js";
import { loadRootConfigFromEnv } from "./root/load-env.js";
import { ConfigSchema } from "./root/schema.js";

type ConfigRecord = Record<string, unknown>;
type ContainerProfile = "docker-sandbox" | "remote-sandbox";

export const DefaultGeneratedConfigPath = "/run/mistle/config.toml";
export const DefaultGeneratedSecretsPath = "/var/lib/mistle/generated-secrets.env";

const GeneratedSecretEnvVars = [
  "MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_SECRET",
  "MISTLE_SERVICES_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON",
  "MISTLE_INTERNAL_AUTH_SHARED_TOKEN",
  "MISTLE_SANDBOX_TOKENS_CONNECT_SECRET",
  "MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET",
  "MISTLE_SANDBOX_TOKENS_EGRESS_SECRET",
  "MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET",
  "MISTLE_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET",
];

const CommonRequiredEnvVars = [
  "MISTLE_SERVICES_DASHBOARD_PUBLIC_URL",
  "MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL",
  "MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL",
  "MISTLE_SERVICES_TOKENIZER_PROXY_PUBLIC_URL",
  "MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL",
  "MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL",
  "MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL",
  "MISTLE_POSTGRES_DATA_PLANE_POOLED_URL",
  "MISTLE_KV_DATA_PLANE_URL",
  "MISTLE_OBJECT_STORE_ASSETS_BUCKET_NAME",
  "MISTLE_OBJECT_STORE_ASSETS_REGION",
  "MISTLE_OBJECT_STORE_ASSETS_ENDPOINT",
  "MISTLE_OBJECT_STORE_ASSETS_ACCESS_KEY_ID",
  "MISTLE_OBJECT_STORE_ASSETS_SECRET_ACCESS_KEY",
  "MISTLE_EMAIL_SMTP_FROM_ADDRESS",
  "MISTLE_EMAIL_SMTP_HOST",
  "MISTLE_EMAIL_SMTP_USERNAME",
  "MISTLE_EMAIL_SMTP_PASSWORD",
  "MISTLE_SANDBOX_DEFAULT_BASE_IMAGE",
  "MISTLE_SANDBOX_PUBLISH_BASE_DOMAIN",
];

const RemoteSandboxRequiredEnvVars = [
  "MISTLE_SANDBOX_E2B_API_KEY",
  "MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY",
  "MISTLE_SANDBOX_STORAGE_ARCHIL_REGION",
  "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_BUCKET_NAME",
  "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ENDPOINT",
  "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ACCESS_KEY_ID",
  "MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY",
];

function createSecret(): string {
  return randomBytes(32).toString("base64url");
}

function readOptionalEnv(env: NodeJS.ProcessEnv, envVar: string): string | undefined {
  const value = env[envVar]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function readRequiredEnv(env: NodeJS.ProcessEnv, envVar: string): string {
  const value = readOptionalEnv(env, envVar);
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }

  return value;
}

function readProfile(env: NodeJS.ProcessEnv): ContainerProfile {
  const profile = readRequiredEnv(env, "MISTLE_PROFILE");
  if (profile === "docker-sandbox" || profile === "remote-sandbox") {
    return profile;
  }

  throw new Error(
    `Unsupported MISTLE_PROFILE '${profile}'. Expected 'docker-sandbox' or 'remote-sandbox'.`,
  );
}

function requireProfileEnv(input: { profile: ContainerProfile; env: NodeJS.ProcessEnv }): void {
  const requiredEnvVars =
    input.profile === "remote-sandbox"
      ? [...CommonRequiredEnvVars, ...RemoteSandboxRequiredEnvVars]
      : CommonRequiredEnvVars;

  for (const envVar of requiredEnvVars) {
    readRequiredEnv(input.env, envVar);
  }
}

function buildGeneratedSecretsEnv(): Record<string, string> {
  return {
    MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_SECRET: createSecret(),
    MISTLE_SERVICES_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON: JSON.stringify({
      "1": createSecret(),
    }),
    MISTLE_INTERNAL_AUTH_SHARED_TOKEN: createSecret(),
    MISTLE_SANDBOX_TOKENS_CONNECT_SECRET: createSecret(),
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET: createSecret(),
    MISTLE_SANDBOX_TOKENS_EGRESS_SECRET: createSecret(),
    MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET: createSecret(),
    MISTLE_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET: createSecret(),
  };
}

function parseGeneratedSecretsFile(path: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 1) {
      throw new Error(`Invalid generated secrets file line in ${path}: ${line}`);
    }

    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    result[key] = value;
  }

  for (const envVar of GeneratedSecretEnvVars) {
    if (result[envVar] === undefined || result[envVar].trim().length === 0) {
      throw new Error(`Generated secrets file ${path} is missing ${envVar}.`);
    }
  }

  return result;
}

function writeGeneratedSecretsFile(input: { path: string; values: Record<string, string> }): void {
  mkdirSync(dirname(input.path), { recursive: true, mode: 0o700 });
  const tempPath = `${input.path}.tmp`;
  const content = GeneratedSecretEnvVars.map((envVar) => `${envVar}=${input.values[envVar]}`).join(
    "\n",
  );

  writeFileSync(tempPath, `${content}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tempPath, input.path);
}

function loadOrCreateGeneratedSecrets(path: string): Record<string, string> {
  try {
    return parseGeneratedSecretsFile(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      const values = buildGeneratedSecretsEnv();
      writeGeneratedSecretsFile({ path, values });
      return values;
    }

    throw error;
  }
}

function buildCommonBaseConfig(env: NodeJS.ProcessEnv): ConfigRecord {
  const dashboardPublicUrl = readRequiredEnv(env, "MISTLE_SERVICES_DASHBOARD_PUBLIC_URL");
  const controlPlaneApiPublicUrl = readRequiredEnv(
    env,
    "MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL",
  );

  return {
    global: {
      env: "production",
    },
    telemetry: {
      enabled: false,
      debug: false,
      resource_attributes: "deployment.environment=production",
    },
    services: {
      dashboard: {
        public_url: dashboardPublicUrl,
        control_plane_api_origin:
          readOptionalEnv(env, "MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN") ??
          controlPlaneApiPublicUrl,
      },
      control_plane_api: {
        host: "0.0.0.0",
        port: 5100,
        public_url: controlPlaneApiPublicUrl,
        internal_url: "http://127.0.0.1:5100",
        auth: {
          trusted_origins: [dashboardPublicUrl],
          enabled_methods: ["otp"],
          otp: {
            length: 6,
            expires_in_seconds: 300,
            allowed_attempts: 3,
          },
        },
        integrations: {
          active_master_encryption_key_version: 1,
        },
      },
      data_plane_api: {
        host: "127.0.0.1",
        port: 5200,
        internal_url: "http://127.0.0.1:5200",
      },
      data_plane_gateway: {
        host: "0.0.0.0",
        port: 5202,
        internal_url: "http://127.0.0.1:5202",
        sandbox_ws_public_url: readRequiredEnv(
          env,
          "MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL",
        ),
      },
      tokenizer_proxy: {
        host: "0.0.0.0",
        port: 5205,
        public_url: readRequiredEnv(env, "MISTLE_SERVICES_TOKENIZER_PROXY_PUBLIC_URL"),
        internal_url: "http://127.0.0.1:5205",
      },
      control_plane_worker: {
        workflow_concurrency: 4,
      },
      data_plane_worker: {
        workflow_concurrency: 4,
      },
    },
    workflow: {
      control_plane: {
        namespace_id: "production",
      },
      data_plane: {
        namespace_id: "production",
      },
    },
    kv: {
      data_plane: {
        backend: "valkey",
        key_prefix: "mistle:runtime-state",
      },
    },
    object_store: {
      assets: {
        force_path_style: true,
      },
    },
    email: {
      smtp: {
        from_name: "Mistle",
        port: 587,
        secure: false,
      },
    },
    internal_auth: {
      method: "shared_token",
    },
    sandbox: {
      default_base_image: readRequiredEnv(env, "MISTLE_SANDBOX_DEFAULT_BASE_IMAGE"),
      publish_base_domain: readRequiredEnv(env, "MISTLE_SANDBOX_PUBLISH_BASE_DOMAIN"),
      tokens: {
        connect: {
          issuer: "control-plane-api",
          audience: "data-plane-gateway",
        },
        bootstrap: {
          issuer: "data-plane-worker",
          audience: "data-plane-gateway",
        },
        egress: {
          issuer: "data-plane-worker",
          audience: "tokenizer-proxy",
        },
      },
      publish: {
        access_token: {
          issuer: "control-plane-api",
          audience: "data-plane-gateway",
        },
        session: {},
      },
    },
  };
}

function buildDockerSandboxBaseConfig(env: NodeJS.ProcessEnv): ConfigRecord {
  return mergeConfigRoots(buildCommonBaseConfig(env), {
    services: {
      data_plane_gateway: {
        sandbox_ws_internal_url:
          readOptionalEnv(env, "MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL") ??
          "ws://mistle-single-container:5202/tunnel/sandbox",
      },
    },
    sandbox: {
      provider: "docker",
      storage: {
        backend: "docker_volume",
        docker_volume: {
          name_prefix: "mistle-",
        },
      },
      docker: {
        socket_path: "/var/run/docker.sock",
        network_name: "mistle-single-container-network",
      },
    },
  });
}

function buildRemoteSandboxBaseConfig(env: NodeJS.ProcessEnv): ConfigRecord {
  const sandboxGatewayPublicUrl = readRequiredEnv(
    env,
    "MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL",
  );

  return mergeConfigRoots(buildCommonBaseConfig(env), {
    services: {
      data_plane_gateway: {
        sandbox_ws_internal_url:
          readOptionalEnv(env, "MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL") ??
          sandboxGatewayPublicUrl,
      },
    },
    object_store: {
      sandbox_storage: {
        force_path_style: true,
      },
    },
    sandbox: {
      provider: "e2b",
      storage: {
        backend: "archil",
        archil: {
          mount_object_store: "sandbox_storage",
        },
      },
    },
  });
}

function buildGeneratedSecretsConfig(env: Record<string, string>): ConfigRecord {
  const readGeneratedEnv = (envVar: string): string => {
    const value = env[envVar];
    if (value === undefined) {
      throw new Error(`Generated secrets are missing ${envVar}.`);
    }

    return value;
  };

  return {
    services: {
      control_plane_api: {
        auth: {
          secret: readGeneratedEnv("MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_SECRET"),
        },
        integrations: {
          master_encryption_keys: JSON.parse(
            readGeneratedEnv(
              "MISTLE_SERVICES_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON",
            ),
          ),
        },
      },
    },
    internal_auth: {
      shared_token: {
        token: readGeneratedEnv("MISTLE_INTERNAL_AUTH_SHARED_TOKEN"),
      },
    },
    sandbox: {
      tokens: {
        connect: {
          secret: readGeneratedEnv("MISTLE_SANDBOX_TOKENS_CONNECT_SECRET"),
        },
        bootstrap: {
          secret: readGeneratedEnv("MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET"),
        },
        egress: {
          secret: readGeneratedEnv("MISTLE_SANDBOX_TOKENS_EGRESS_SECRET"),
        },
      },
      publish: {
        access_token: {
          secret: readGeneratedEnv("MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET"),
        },
        session: {
          cookie_signing_secret: readGeneratedEnv(
            "MISTLE_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET",
          ),
        },
      },
    },
  };
}

export function generateContainerRuntimeConfig(input: {
  env: NodeJS.ProcessEnv;
  secretsPath?: string;
}): ConfigRecord {
  const profile = readProfile(input.env);
  requireProfileEnv({ profile, env: input.env });

  const baseConfig =
    profile === "docker-sandbox"
      ? buildDockerSandboxBaseConfig(input.env)
      : buildRemoteSandboxBaseConfig(input.env);
  const generatedSecretsConfig = buildGeneratedSecretsConfig(
    loadOrCreateGeneratedSecrets(input.secretsPath ?? DefaultGeneratedSecretsPath),
  );

  return ConfigSchema.parse(
    mergeConfigRoots(
      mergeConfigRoots(baseConfig, generatedSecretsConfig),
      loadRootConfigFromEnv(input.env),
    ),
  );
}

export function stringifyContainerRuntimeConfig(config: ConfigRecord): string {
  return [
    "# Generated by `mistle-config generate`.",
    "# Edit the container environment and restart the container instead of editing this file.",
    "",
    stringify(config),
  ].join("\n");
}
