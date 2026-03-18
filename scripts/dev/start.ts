import type { ChildProcess, SpawnSyncReturns } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseToml } from "smol-toml";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEV_CONFIG_PATH = resolve(REPO_ROOT, "config", "config.development.toml");
const DEV_COMPOSE_PATH = resolve(REPO_ROOT, "infra", "local", "docker-compose.yml");
const DEV_CLOUDFLARED_CONFIG_DIR = resolve(REPO_ROOT, "infra", "local", ".generated");
const DEV_CLOUDFLARED_CONFIG_PATH = resolve(DEV_CLOUDFLARED_CONFIG_DIR, "cloudflared-config.yml");

const TUNNEL_SERVICE_NAME = "tunnel";
const LOCAL_REGISTRY_HOST = "127.0.0.1:5001";
const SANDBOX_BASE_IMAGE_TAG = "mistle/sandbox-base:dev";
const SANDBOX_BASE_IMAGE_REGISTRY_TAG = `${LOCAL_REGISTRY_HOST}/mistle/sandbox-base:dev`;

const SEA_OUTPUT_DIR = resolve(REPO_ROOT, "apps/sandbox-runtime/dist-sea");
const SEA_CACHE_KEY_PATH = resolve(SEA_OUTPUT_DIR, ".cache-key");

const SEA_BUILD_INPUT_PATHS: readonly string[] = [
  "packages/sandbox-rs-napi",
  "apps/sandbox-runtime",
  "packages/integrations-core",
  "packages/integrations-definitions",
  "packages/sandbox-session-client",
  "packages/sandbox-session-protocol",
  "packages/time",
  "scripts/build/build-sandbox-runtime-sea-linux.mjs",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
];

let localInfraStartAttempted = false;
let localInfraEnv: NodeJS.ProcessEnv | undefined;
let appDevProcess: ChildProcess | undefined;
let terminated = false;

type CloudflaredConfigInput = {
  controlPlaneApiTunnelHostname: string;
  controlPlaneApiLocalPort: number;
  dataPlaneApiLocalPort: number;
  dataPlaneTunnelHostname: string;
};

type RunInput = {
  command: string;
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "pipe";
};

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

function readRequiredIntegerTomlValue(
  configPath: string,
  path: readonly string[],
  pathLabel: string,
): number {
  const parsed = parseToml(readFileSync(configPath, "utf8"));
  const resolvedValue = getValueAtPath(parsed, path);

  if (typeof resolvedValue !== "number" || Number.isInteger(resolvedValue) === false) {
    throw new Error(`Missing or invalid ${pathLabel} in config/config.development.toml.`);
  }

  return resolvedValue;
}

function readControlPlaneApiLocalPort(configPath: string): number {
  return readRequiredIntegerTomlValue(
    configPath,
    ["apps", "control_plane_api", "server", "port"],
    "apps.control_plane_api.server.port",
  );
}

function readDataPlaneApiLocalPort(configPath: string): number {
  return readRequiredIntegerTomlValue(
    configPath,
    ["apps", "data_plane_api", "server", "port"],
    "apps.data_plane_api.server.port",
  );
}

function readRequiredEnv(envVarName: string): string {
  const value = process.env[envVarName];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${envVarName}`);
  }

  return value.trim();
}

function writeCloudflaredConfig(input: CloudflaredConfigInput): void {
  const configContent = [
    "ingress:",
    `  - hostname: ${input.controlPlaneApiTunnelHostname}`,
    `    service: http://host.docker.internal:${input.controlPlaneApiLocalPort}`,
    `  - hostname: ${input.dataPlaneTunnelHostname}`,
    `    service: http://host.docker.internal:${input.dataPlaneApiLocalPort}`,
    "  - service: http_status:404",
    "",
  ].join("\n");

  mkdirSync(DEV_CLOUDFLARED_CONFIG_DIR, { recursive: true });
  writeFileSync(DEV_CLOUDFLARED_CONFIG_PATH, configContent, "utf8");
}

function runOrThrow(input: RunInput): SpawnSyncReturns<string> {
  const result = spawnSync(input.command, input.args, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...(input.env ?? {}),
    },
    stdio: input.stdio ?? "inherit",
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `Command failed (${input.command} ${input.args.join(" ")}), exit code ${String(result.status)}.`,
    );
  }

  return result;
}

function runComposeDown(env: NodeJS.ProcessEnv | undefined): SpawnSyncReturns<Buffer> {
  return spawnSync("docker", ["compose", "-f", DEV_COMPOSE_PATH, "down", "--remove-orphans"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...(env ?? {}),
    },
    stdio: "inherit",
  });
}

function hasRunningComposeServices(env: NodeJS.ProcessEnv | undefined): boolean {
  const result = spawnSync(
    "docker",
    ["compose", "-f", DEV_COMPOSE_PATH, "ps", "--status", "running", "-q"],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ...(env ?? {}),
      },
      stdio: "pipe",
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    return false;
  }

  const output = result.stdout ?? "";
  return output.trim().length > 0;
}

function shouldTeardownLocalInfra(): boolean {
  if (localInfraStartAttempted) {
    return true;
  }

  return hasRunningComposeServices(localInfraEnv);
}

function cleanupAndExit(exitCode: number): never {
  if (shouldTeardownLocalInfra()) {
    try {
      teardownLocalInfra(localInfraEnv);
      localInfraStartAttempted = false;
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message);
      } else {
        console.error(String(error));
      }
      process.exit(1);
    }
  }

  process.exit(exitCode);
}

function forwardSignal(signal: NodeJS.Signals): void {
  if (terminated) {
    return;
  }

  terminated = true;

  if (appDevProcess !== undefined) {
    try {
      appDevProcess.kill(signal);
    } catch {
      // Process can already be gone if it handled the signal first.
    }
  }

  cleanupAndExit(signalExitCode(signal));
}

function teardownLocalInfra(env: NodeJS.ProcessEnv | undefined): void {
  const firstAttempt = runComposeDown(env);

  if (firstAttempt.status === 0) {
    return;
  }

  if (firstAttempt.status === 130) {
    const secondAttempt = runComposeDown(env);

    if (secondAttempt.status === 0 || hasRunningComposeServices(env) === false) {
      return;
    }
  }

  if (hasRunningComposeServices(env) === false) {
    return;
  }

  throw new Error(
    `Failed to shutdown local infra cleanly (exit code ${String(firstAttempt.status)}).`,
  );
}

function signalExitCode(signal: NodeJS.Signals): number {
  if (signal === "SIGINT") {
    return 130;
  }

  if (signal === "SIGTERM") {
    return 143;
  }

  return 1;
}

process.once("SIGINT", () => {
  forwardSignal("SIGINT");
});
process.once("SIGTERM", () => {
  forwardSignal("SIGTERM");
});

function computeSeaBuildCacheKey(): string {
  const result = spawnSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...SEA_BUILD_INPUT_PATHS,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  if (result.status !== 0) {
    throw new Error(`Failed to list tracked files for SEA cache key: ${result.stderr ?? ""}`);
  }

  const files = result.stdout.split("\0").filter(Boolean).sort();
  const hash = createHash("sha256");

  for (const file of files) {
    const filePath = resolve(REPO_ROOT, file);

    if (!existsSync(filePath)) {
      hash.update(file);
      hash.update("\0deleted\0");
      continue;
    }

    const content = readFileSync(filePath);
    hash.update(file);
    hash.update("\0");
    hash.update(content);
  }

  return hash.digest("hex");
}

function checkSeaBuildCache(): { hit: boolean; cacheKey: string } {
  const cacheKey = computeSeaBuildCacheKey();

  if (!existsSync(SEA_OUTPUT_DIR)) {
    return { hit: false, cacheKey };
  }

  try {
    const storedKey = readFileSync(SEA_CACHE_KEY_PATH, "utf8").trim();
    return { hit: storedKey === cacheKey, cacheKey };
  } catch {
    return { hit: false, cacheKey };
  }
}

function writeSeaBuildCacheKey(key: string): void {
  writeFileSync(SEA_CACHE_KEY_PATH, key + "\n", "utf8");
}

function dockerImageExists(imageTag: string): boolean {
  const result = spawnSync("docker", ["image", "inspect", imageTag], {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });

  return result.status === 0;
}

function start(): void {
  console.log(
    "Starting local infra dependencies (Postgres 18, PgBouncer, Mailpit, Registry, OTel LGTM, tokenizer relay, gateway relay)...",
  );
  const controlPlaneApiLocalPort = readControlPlaneApiLocalPort(DEV_CONFIG_PATH);
  const dataPlaneApiLocalPort = readDataPlaneApiLocalPort(DEV_CONFIG_PATH);
  const cloudflareTunnelToken = readRequiredEnv("CLOUDFLARE_TUNNEL_TOKEN");
  const controlPlaneApiTunnelHostname = readRequiredEnv("CONTROL_PLANE_API_TUNNEL_HOSTNAME");
  const dataPlaneTunnelHostname = readRequiredEnv("DATA_PLANE_API_TUNNEL_HOSTNAME");

  writeCloudflaredConfig({
    controlPlaneApiTunnelHostname,
    controlPlaneApiLocalPort,
    dataPlaneApiLocalPort,
    dataPlaneTunnelHostname,
  });

  const sharedDevEnv: NodeJS.ProcessEnv = {
    MISTLE_CONFIG_PATH: DEV_CONFIG_PATH,
    CONTROL_PLANE_API_LOCAL_PORT: String(controlPlaneApiLocalPort),
    CLOUDFLARE_TUNNEL_TOKEN: cloudflareTunnelToken,
    CONTROL_PLANE_API_TUNNEL_HOSTNAME: controlPlaneApiTunnelHostname,
    DATA_PLANE_API_TUNNEL_HOSTNAME: dataPlaneTunnelHostname,
    CLOUDFLARED_CONFIG_PATH: DEV_CLOUDFLARED_CONFIG_PATH,
  };
  localInfraEnv = sharedDevEnv;
  localInfraStartAttempted = true;

  runOrThrow({
    command: "docker",
    args: [
      "compose",
      "-f",
      DEV_COMPOSE_PATH,
      "up",
      "-d",
      "--wait",
      "postgres",
      "pgbouncer",
      "mailpit",
      "registry",
      "otel-lgtm",
      "tokenizer-proxy-relay",
      "data-plane-gateway-relay",
    ],
    env: sharedDevEnv,
  });

  console.log("Checking sandbox runtime base image cache...");
  const { hit: seaCacheHit, cacheKey: seaCacheKey } = checkSeaBuildCache();

  if (!seaCacheHit) {
    console.log("Building sandbox runtime SEA (inputs changed)...");
    runOrThrow({
      command: "pnpm",
      args: ["build:sandbox-runtime:sea:linux"],
      env: sharedDevEnv,
    });
  }

  if (!seaCacheHit || !dockerImageExists(SANDBOX_BASE_IMAGE_TAG)) {
    if (seaCacheHit) {
      console.log("SEA build cache valid but Docker image missing, rebuilding image...");
    }
    console.log("Building sandbox runtime base image...");
    runOrThrow({
      command: "docker",
      args: [
        "build",
        "--target",
        "sandbox-base-dev",
        "-f",
        "apps/sandbox-runtime/Dockerfile",
        "-t",
        SANDBOX_BASE_IMAGE_TAG,
        ".",
      ],
      env: sharedDevEnv,
    });
  } else {
    console.log("Sandbox runtime base image is up to date.");
  }

  console.log("Pushing sandbox runtime base image to local registry...");
  runOrThrow({
    command: "docker",
    args: ["tag", SANDBOX_BASE_IMAGE_TAG, SANDBOX_BASE_IMAGE_REGISTRY_TAG],
    env: sharedDevEnv,
  });
  runOrThrow({
    command: "docker",
    args: ["push", SANDBOX_BASE_IMAGE_REGISTRY_TAG],
    env: sharedDevEnv,
  });

  if (!seaCacheHit) {
    writeSeaBuildCacheKey(seaCacheKey);
  }

  console.log("Building migration dependencies...");
  runOrThrow({
    command: "pnpm",
    args: ["--filter", "@mistle/config", "build"],
    env: sharedDevEnv,
  });
  runOrThrow({
    command: "pnpm",
    args: ["--filter", "@mistle/db", "build"],
    env: sharedDevEnv,
  });
  runOrThrow({
    command: "pnpm",
    args: ["--filter", "@mistle/logging", "build"],
    env: sharedDevEnv,
  });

  console.log("Running control-plane DB migrations...");
  runOrThrow({
    command: "pnpm",
    args: ["--filter", "@mistle/control-plane-api", "db:migrate"],
    env: sharedDevEnv,
  });

  console.log("Running data-plane DB migrations...");
  runOrThrow({
    command: "pnpm",
    args: ["--filter", "@mistle/data-plane-api", "db:migrate"],
    env: sharedDevEnv,
  });

  console.log("Starting public tunnels...");
  runOrThrow({
    command: "docker",
    args: ["compose", "-f", DEV_COMPOSE_PATH, "up", "-d", TUNNEL_SERVICE_NAME],
    env: sharedDevEnv,
  });

  const controlPlaneApiPublicUrl = `https://${controlPlaneApiTunnelHostname}`;
  const dataPlaneApiPublicUrl = `https://${dataPlaneTunnelHostname}`;

  console.log("");
  console.log("Public tunnel URLs:");
  console.log(`- control-plane-api: ${controlPlaneApiPublicUrl}`);
  console.log(`- data-plane-api: ${dataPlaneApiPublicUrl}`);
  console.log(`- data-plane tunnel route: ${dataPlaneApiPublicUrl}/tunnel`);
  console.log("- mailpit ui: http://127.0.0.1:8025");
  console.log("- grafana (otel-lgtm): http://127.0.0.1:3000");
  console.log(`- local registry: http://${LOCAL_REGISTRY_HOST}`);
  console.log("");

  appDevProcess = spawn("pnpm", ["dev:workspace"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...sharedDevEnv,
    },
    stdio: "inherit",
  });

  appDevProcess.on("exit", (code, signal) => {
    if (terminated) {
      return;
    }

    if (signal !== null) {
      cleanupAndExit(signalExitCode(signal));
    }

    cleanupAndExit(code ?? 0);
  });
}

try {
  start();
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }

  cleanupAndExit(1);
}
