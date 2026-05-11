import type { ChildProcess, SpawnSyncReturns } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseToml } from "smol-toml";

import {
  getLocalDevDockerRegistrySandboxBaseImageRef,
  getLocalPreparedRuntimeSandboxBaseImageRef,
} from "../../packages/config/src/sandbox-base-images.js";
import {
  SandboxBaseImagePublishModes,
  SandboxBaseImageSourceKinds,
  createDockerBaseImageBuilder,
} from "../../packages/sandbox/src/index.js";
import { ensureDevObjectStoreBucketExists } from "./ensure-object-store-bucket.ts";
import { createControlPlaneStartupCommands } from "./start-commands.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEV_CONFIG_PATH = resolve(REPO_ROOT, "config", "config.development.toml");
const DEV_COMPOSE_PATH = resolve(REPO_ROOT, "dev", "docker-compose.yml");
const DEV_CLOUDFLARED_CONFIG_DIR = resolve(REPO_ROOT, "dev", ".generated");
const DEV_CLOUDFLARED_CONFIG_PATH = resolve(DEV_CLOUDFLARED_CONFIG_DIR, "cloudflared-config.yml");

const TUNNEL_SERVICE_NAME = "tunnel";
const LOCAL_REGISTRY_HOST = "127.0.0.1:5001";
const SANDBOX_BASE_IMAGE_TAG = getLocalPreparedRuntimeSandboxBaseImageRef();
const SANDBOX_BASE_IMAGE_REGISTRY_TAG = getLocalDevDockerRegistrySandboxBaseImageRef();
const SANDBOX_BASE_DOCKERFILE_PATH = "packages/sandboxd/Dockerfile";
const SANDBOX_BASE_CACHE_DIR = resolve(REPO_ROOT, ".local", "sandbox-base");
const SANDBOX_BASE_CACHE_KEY_PATH = resolve(SANDBOX_BASE_CACHE_DIR, ".cache-key");

const SANDBOX_BASE_BUILD_INPUT_PATHS: readonly string[] = [
  "packages/sandboxd",
  "packages/sandboxd/scripts/cmddir",
  ".dockerignore",
  SANDBOX_BASE_DOCKERFILE_PATH,
];

let localInfraStartAttempted = false;
let localInfraEnv: NodeJS.ProcessEnv | undefined;
let appDevProcess: ChildProcess | undefined;
let terminated = false;

type CloudflaredConfigInput = {
  controlPlaneApiTunnelHostname: string;
  controlPlaneApiLocalPort: number;
  dataPlaneGatewayLocalPort: number;
  dataPlaneGatewayTunnelHostname: string;
};

type RunInput = {
  command: string;
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "pipe";
};

type SandboxProvider = "docker" | "e2b";

function readDevStartOptions(): void {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    throw new Error(`Unsupported dev start option(s): ${args.join(", ")}`);
  }
}

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

function readControlPlaneApiLocalPort(configPath: string): number {
  return readRequiredIntegerTomlValue(
    configPath,
    ["services", "control_plane_api", "port"],
    "services.control_plane_api.port",
  );
}

function readDataPlaneGatewayLocalPort(configPath: string): number {
  return readRequiredIntegerTomlValue(
    configPath,
    ["services", "data_plane_gateway", "port"],
    "services.data_plane_gateway.port",
  );
}

function readSandboxProvider(configPath: string): SandboxProvider {
  const configuredProvider = process.env.MISTLE_SANDBOX_PROVIDER?.trim();

  if (configuredProvider === "docker" || configuredProvider === "e2b") {
    return configuredProvider;
  }

  if (configuredProvider !== undefined && configuredProvider.length > 0) {
    throw new Error(
      `Unsupported sandbox provider '${configuredProvider}' in MISTLE_SANDBOX_PROVIDER.`,
    );
  }

  const parsed = readTomlConfigRoot(configPath);
  const resolvedValue = getValueAtPath(parsed, ["sandbox", "provider"]);

  if (resolvedValue === "docker" || resolvedValue === "e2b") {
    return resolvedValue;
  }

  throw new Error("Missing or invalid sandbox.provider in config/config.development.toml.");
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
    `  - hostname: ${input.dataPlaneGatewayTunnelHostname}`,
    `    service: http://host.docker.internal:${input.dataPlaneGatewayLocalPort}`,
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

function computeSandboxBaseBuildCacheKey(): string {
  const result = spawnSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...SANDBOX_BASE_BUILD_INPUT_PATHS,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `Failed to list tracked files for sandbox base cache key: ${result.stderr ?? ""}`,
    );
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

function checkSandboxBaseBuildCache(): { hit: boolean; cacheKey: string } {
  const cacheKey = computeSandboxBaseBuildCacheKey();

  try {
    const storedKey = readFileSync(SANDBOX_BASE_CACHE_KEY_PATH, "utf8").trim();
    return { hit: storedKey === cacheKey, cacheKey };
  } catch {
    return { hit: false, cacheKey };
  }
}

function writeSandboxBaseBuildCacheKey(key: string): void {
  mkdirSync(SANDBOX_BASE_CACHE_DIR, { recursive: true });
  writeFileSync(SANDBOX_BASE_CACHE_KEY_PATH, key + "\n", "utf8");
}

function dockerImageExists(imageTag: string): boolean {
  const result = spawnSync("docker", ["image", "inspect", imageTag], {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });

  return result.status === 0;
}

async function start(): Promise<void> {
  readDevStartOptions();
  const sandboxProvider = readSandboxProvider(DEV_CONFIG_PATH);
  const infraSummary =
    sandboxProvider === "docker"
      ? "SeaweedFS, Postgres 18, PgBouncer, Mailpit, Registry, OTel LGTM, gateway relay"
      : "SeaweedFS, Postgres 18, PgBouncer, Mailpit, OTel LGTM";
  console.log(`Starting local infra dependencies (${infraSummary})...`);
  const controlPlaneApiLocalPort = readControlPlaneApiLocalPort(DEV_CONFIG_PATH);
  const dataPlaneGatewayLocalPort = readDataPlaneGatewayLocalPort(DEV_CONFIG_PATH);
  const cloudflareTunnelToken = readRequiredEnv("CLOUDFLARE_TUNNEL_TOKEN");
  const controlPlaneApiTunnelHostname = readRequiredEnv("CONTROL_PLANE_API_TUNNEL_HOSTNAME");
  const dataPlaneGatewayTunnelHostname = readRequiredEnv("DATA_PLANE_API_TUNNEL_HOSTNAME");
  const controlPlaneApiPublicUrl = `https://${controlPlaneApiTunnelHostname}`;
  const dataPlaneGatewayPublicUrl = `https://${dataPlaneGatewayTunnelHostname}`;

  writeCloudflaredConfig({
    controlPlaneApiTunnelHostname,
    controlPlaneApiLocalPort,
    dataPlaneGatewayLocalPort,
    dataPlaneGatewayTunnelHostname,
  });

  const sharedDevEnv: NodeJS.ProcessEnv = {
    MISTLE_CONFIG_PATH: DEV_CONFIG_PATH,
    CONTROL_PLANE_API_LOCAL_PORT: String(controlPlaneApiLocalPort),
    CLOUDFLARE_TUNNEL_TOKEN: cloudflareTunnelToken,
    CONTROL_PLANE_API_TUNNEL_HOSTNAME: controlPlaneApiTunnelHostname,
    DATA_PLANE_API_TUNNEL_HOSTNAME: dataPlaneGatewayTunnelHostname,
    CLOUDFLARED_CONFIG_PATH: DEV_CLOUDFLARED_CONFIG_PATH,
    MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL: controlPlaneApiPublicUrl,
  };
  localInfraEnv = sharedDevEnv;
  localInfraStartAttempted = true;

  const infraServiceNames = [
    "seaweedfs",
    "postgres",
    "pgbouncer",
    "mailpit",
    "otel-lgtm",
    "valkey",
  ];

  if (sandboxProvider === "docker") {
    infraServiceNames.splice(4, 0, "registry");
    infraServiceNames.push("data-plane-gateway-relay");
  }

  runOrThrow({
    command: "docker",
    args: ["compose", "-f", DEV_COMPOSE_PATH, "up", "-d", "--wait", ...infraServiceNames],
    env: sharedDevEnv,
  });

  console.log("Ensuring control-plane object-store bucket exists...");
  await ensureDevObjectStoreBucketExists({
    env: sharedDevEnv,
  });

  if (sandboxProvider === "docker") {
    console.log("Checking sandbox base image cache...");
    const { hit: sandboxBaseCacheHit, cacheKey: sandboxBaseCacheKey } =
      checkSandboxBaseBuildCache();

    if (!sandboxBaseCacheHit || !dockerImageExists(SANDBOX_BASE_IMAGE_TAG)) {
      if (sandboxBaseCacheHit) {
        console.log(
          "Sandbox base cache is valid but the Docker image is missing, rebuilding it...",
        );
      }
      console.log("Building sandbox base image...");
      await createDockerBaseImageBuilder({ env: sharedDevEnv }).buildBaseImage({
        source: {
          kind: SandboxBaseImageSourceKinds.DOCKERFILE,
          contextPath: REPO_ROOT,
          dockerfilePath: SANDBOX_BASE_DOCKERFILE_PATH,
          imageId: SANDBOX_BASE_IMAGE_TAG,
          publishMode: SandboxBaseImagePublishModes.LOAD,
          target: "sandbox-base",
        },
      });
    } else {
      console.log("Sandbox base image is up to date.");
    }

    console.log("Pushing sandbox base image to the local registry...");
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

    if (!sandboxBaseCacheHit) {
      writeSandboxBaseBuildCacheKey(sandboxBaseCacheKey);
    }
  } else {
    console.log(
      `Skipping local sandbox image build and registry push because sandbox provider is '${sandboxProvider}'.`,
    );
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

  for (const commandInput of createControlPlaneStartupCommands()) {
    console.log(commandInput.label);
    runOrThrow({
      command: commandInput.command,
      args: commandInput.args,
      env: sharedDevEnv,
    });
  }

  console.log("Running data-plane DB migrations...");
  runOrThrow({
    command: "pnpm",
    args: ["--filter", "@mistle/data-plane-api", "db:migrate"],
    env: sharedDevEnv,
  });

  console.log("Running data-plane workflow migrations...");
  runOrThrow({
    command: "pnpm",
    args: ["--filter", "@mistle/data-plane-api", "workflow:migrate"],
    env: sharedDevEnv,
  });

  console.log("Starting public tunnels...");
  runOrThrow({
    command: "docker",
    args: ["compose", "-f", DEV_COMPOSE_PATH, "up", "-d", TUNNEL_SERVICE_NAME],
    env: sharedDevEnv,
  });

  console.log("");
  console.log("Public tunnel URLs:");
  console.log(`- control-plane-api: ${controlPlaneApiPublicUrl}`);
  console.log(`- data-plane-gateway: ${dataPlaneGatewayPublicUrl}`);
  console.log(`- data-plane tunnel route: ${dataPlaneGatewayPublicUrl}/tunnel`);
  console.log("- mailpit ui: http://127.0.0.1:8025");
  console.log("- grafana (otel-lgtm): http://127.0.0.1:3000");
  if (sandboxProvider === "docker") {
    console.log(`- local registry: http://${LOCAL_REGISTRY_HOST}`);
  }
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
  await start();
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }

  cleanupAndExit(1);
}
