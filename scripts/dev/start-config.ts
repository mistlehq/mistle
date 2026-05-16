import { readFileSync } from "node:fs";

import { parse as parseToml } from "smol-toml";

type GatewayRelayConfig =
  | {
      backend: "memory";
    }
  | {
      backend: "nats";
      nats: {
        namePrefix: string;
        url: string;
      };
    };

export type LocalDevInfraPlan = {
  dockerSandboxProviderEnabled: boolean;
  gatewayRelay: GatewayRelayConfig;
  serviceNames: string[];
  summary: string;
};

type ReadEnv = Pick<NodeJS.ProcessEnv, string>;

const BaseInfraServiceNames = [
  "seaweedfs",
  "postgres",
  "pgbouncer",
  "mailpit",
  "otel-lgtm",
  "valkey",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getValueAtPath(root: unknown, path: readonly string[]): unknown {
  let current: unknown = root;

  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function readTomlConfigRoot(configPath: string): Record<string, unknown> {
  const parsed = parseToml(readFileSync(configPath, "utf8"));

  if (!isRecord(parsed)) {
    throw new Error(`Missing or invalid TOML object in ${configPath}.`);
  }

  return parsed;
}

function readOptionalEnv(env: ReadEnv, envVarName: string): string | undefined {
  const value = env[envVarName]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function readOptionalStringTomlValue(
  root: Record<string, unknown>,
  path: readonly string[],
): string | undefined {
  const resolvedValue = getValueAtPath(root, path);
  return typeof resolvedValue === "string" ? resolvedValue.trim() : undefined;
}

function readRequiredIntegerTomlValue(
  configPath: string,
  path: readonly string[],
  pathLabel: string,
): number {
  const parsed = readTomlConfigRoot(configPath);
  const resolvedValue = getValueAtPath(parsed, path);

  if (typeof resolvedValue !== "number" || Number.isInteger(resolvedValue) === false) {
    throw new Error(`Missing or invalid ${pathLabel} in config/config.development.toml.`);
  }

  return resolvedValue;
}

export function readControlPlaneApiLocalPort(configPath: string): number {
  return readRequiredIntegerTomlValue(
    configPath,
    ["services", "control_plane_api", "port"],
    "services.control_plane_api.port",
  );
}

export function readDataPlaneGatewayLocalPort(configPath: string): number {
  return readRequiredIntegerTomlValue(
    configPath,
    ["services", "data_plane_gateway", "port"],
    "services.data_plane_gateway.port",
  );
}

export function readDockerSandboxProviderEnabled(
  configPath: string,
  env: ReadEnv = process.env,
): boolean {
  const configuredEnabled = readOptionalEnv(env, "MISTLE_SANDBOX_DOCKER_ENABLED");
  if (configuredEnabled === "true") {
    return true;
  }
  if (configuredEnabled === "false") {
    return false;
  }
  if (configuredEnabled !== undefined) {
    throw new Error("MISTLE_SANDBOX_DOCKER_ENABLED must be 'true' or 'false' when set.");
  }
  const parsed = readTomlConfigRoot(configPath);
  const resolvedValue = getValueAtPath(parsed, ["sandbox", "docker", "enabled"]);
  return resolvedValue !== false && getValueAtPath(parsed, ["sandbox", "docker"]) !== undefined;
}

export function readGatewayRelayConfig(
  configPath: string,
  env: ReadEnv = process.env,
): GatewayRelayConfig {
  const parsed = readTomlConfigRoot(configPath);
  const backend =
    readOptionalEnv(env, "MISTLE_GATEWAY_RELAY_BACKEND") ??
    readOptionalStringTomlValue(parsed, ["gateway_relay", "backend"]) ??
    "memory";

  if (backend === "memory") {
    return { backend };
  }

  if (backend !== "nats") {
    throw new Error("gateway_relay.backend must be 'memory' or 'nats'.");
  }

  const url =
    readOptionalEnv(env, "MISTLE_GATEWAY_RELAY_NATS_URL") ??
    readOptionalStringTomlValue(parsed, ["gateway_relay", "nats", "url"]);
  const namePrefix =
    readOptionalEnv(env, "MISTLE_GATEWAY_RELAY_NATS_NAME_PREFIX") ??
    readOptionalStringTomlValue(parsed, ["gateway_relay", "nats", "name_prefix"]);

  if (url === undefined) {
    throw new Error("gateway_relay.nats.url is required when gateway_relay.backend is 'nats'.");
  }

  if (!isNatsUrl(url)) {
    throw new Error("gateway_relay.nats.url must be a nats or tls URL.");
  }

  if (namePrefix === undefined) {
    throw new Error(
      "gateway_relay.nats.name_prefix is required when gateway_relay.backend is 'nats'.",
    );
  }

  return {
    backend,
    nats: {
      url,
      namePrefix,
    },
  };
}

export function createLocalDevInfraPlan(
  configPath: string,
  env: ReadEnv = process.env,
): LocalDevInfraPlan {
  const dockerSandboxProviderEnabled = readDockerSandboxProviderEnabled(configPath, env);
  const gatewayRelay = readGatewayRelayConfig(configPath, env);
  const serviceNames = [...BaseInfraServiceNames];
  const summaryParts = ["SeaweedFS", "Postgres 18", "PgBouncer", "Mailpit", "OTel LGTM", "Valkey"];

  if (dockerSandboxProviderEnabled) {
    serviceNames.splice(4, 0, "registry");
    serviceNames.push("data-plane-gateway-relay");
    summaryParts.splice(4, 0, "Registry");
    summaryParts.push("Docker gateway bridge");
  }

  if (gatewayRelay.backend === "nats") {
    serviceNames.push("nats");
    summaryParts.push("NATS gateway relay");
  }

  return {
    dockerSandboxProviderEnabled,
    gatewayRelay,
    serviceNames,
    summary: summaryParts.join(", "),
  };
}

function isNatsUrl(value: string): boolean {
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "nats:" || parsedUrl.protocol === "tls:";
  } catch {
    return false;
  }
}
