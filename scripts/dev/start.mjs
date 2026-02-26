import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEV_CONFIG_PATH = resolve(REPO_ROOT, "config", "config.development.toml");
const DEV_COMPOSE_PATH = resolve(REPO_ROOT, "infra", "local", "docker-compose.yml");
const DEV_ENV_LOCAL_PATH = resolve(REPO_ROOT, ".env.local");
const DEV_CLOUDFLARED_CONFIG_DIR = resolve(REPO_ROOT, "infra", "local", ".generated");
const DEV_CLOUDFLARED_CONFIG_PATH = resolve(DEV_CLOUDFLARED_CONFIG_DIR, "cloudflared-config.yml");

const TUNNEL_SERVICE_NAME = "tunnel";
let localInfraStarted = false;
let localInfraStartAttempted = false;
let localInfraEnv;
let appDevProcess;
let terminated = false;

function readControlPlaneApiLocalPort(configPath) {
  const parsed = parseToml(readFileSync(configPath, "utf8"));
  const controlPlaneApiPort = parsed?.apps?.control_plane_api?.server?.port;

  if (typeof controlPlaneApiPort !== "number" || Number.isInteger(controlPlaneApiPort) === false) {
    throw new Error(
      "Missing or invalid apps.control_plane_api.server.port in config/config.development.toml.",
    );
  }

  return controlPlaneApiPort;
}

function readDataPlaneApiLocalPort(configPath) {
  const parsed = parseToml(readFileSync(configPath, "utf8"));
  const dataPlaneApiPort = parsed?.apps?.data_plane_api?.server?.port;

  if (typeof dataPlaneApiPort !== "number" || Number.isInteger(dataPlaneApiPort) === false) {
    throw new Error(
      "Missing or invalid apps.data_plane_api.server.port in config/config.development.toml.",
    );
  }

  return dataPlaneApiPort;
}

function readRequiredEnv(envVarName) {
  const value = process.env[envVarName];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${envVarName}`);
  }

  return value.trim();
}

function loadDevelopmentEnvFile() {
  if (!existsSync(DEV_ENV_LOCAL_PATH)) {
    return;
  }

  process.loadEnvFile(DEV_ENV_LOCAL_PATH);
}

function writeCloudflaredConfig(input) {
  const configContent = [
    "ingress:",
    `  - hostname: ${input.controlPlaneApiTunnelHostname}`,
    `    service: http://host.docker.internal:${input.controlPlaneApiLocalPort}`,
    `  - hostname: ${input.dataPlaneEdgeTunnelHostname}`,
    "    service: http://edge:8088",
    "  - service: http_status:404",
    "",
  ].join("\n");

  mkdirSync(DEV_CLOUDFLARED_CONFIG_DIR, { recursive: true });
  writeFileSync(DEV_CLOUDFLARED_CONFIG_PATH, configContent, "utf8");
}

function runOrThrow(input) {
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

function runComposeDown(env) {
  return spawnSync("docker", ["compose", "-f", DEV_COMPOSE_PATH, "down", "--remove-orphans"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...(env ?? {}),
    },
    stdio: "inherit",
  });
}

function hasRunningComposeServices(env) {
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

function shouldTeardownLocalInfra() {
  if (localInfraStartAttempted) {
    return true;
  }

  return hasRunningComposeServices(localInfraEnv);
}

function cleanupAndExit(exitCode) {
  if (shouldTeardownLocalInfra()) {
    try {
      teardownLocalInfra(localInfraEnv);
      localInfraStarted = false;
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

function forwardSignal(signal) {
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

function teardownLocalInfra(env) {
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

function signalExitCode(signal) {
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

async function start() {
  loadDevelopmentEnvFile();

  console.log("Initializing development config...");
  runOrThrow({
    command: "pnpm",
    args: ["config:init:dev"],
  });

  console.log("Starting local infra dependencies (Postgres 18, PgBouncer, Caddy, Mailpit)...");
  const controlPlaneApiLocalPort = readControlPlaneApiLocalPort(DEV_CONFIG_PATH);
  const dataPlaneApiLocalPort = readDataPlaneApiLocalPort(DEV_CONFIG_PATH);
  const cloudflareTunnelToken = readRequiredEnv("CLOUDFLARE_TUNNEL_TOKEN");
  const controlPlaneApiTunnelHostname = readRequiredEnv("CONTROL_PLANE_API_TUNNEL_HOSTNAME");
  const dataPlaneEdgeTunnelHostname = readRequiredEnv("DATA_PLANE_EDGE_TUNNEL_HOSTNAME");

  writeCloudflaredConfig({
    controlPlaneApiTunnelHostname,
    controlPlaneApiLocalPort,
    dataPlaneEdgeTunnelHostname,
  });

  const sharedDevEnv = {
    MISTLE_CONFIG_PATH: DEV_CONFIG_PATH,
    CONTROL_PLANE_API_LOCAL_PORT: String(controlPlaneApiLocalPort),
    CLOUDFLARE_TUNNEL_TOKEN: cloudflareTunnelToken,
    CONTROL_PLANE_API_TUNNEL_HOSTNAME: controlPlaneApiTunnelHostname,
    DATA_PLANE_EDGE_TUNNEL_HOSTNAME: dataPlaneEdgeTunnelHostname,
    CLOUDFLARED_CONFIG_PATH: DEV_CLOUDFLARED_CONFIG_PATH,
    DATA_PLANE_API_UPSTREAM: `host.docker.internal:${String(dataPlaneApiLocalPort)}`,
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
      "edge",
      "mailpit",
    ],
    env: sharedDevEnv,
  });
  localInfraStarted = true;

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

  console.log("Running control-plane DB migrations...");
  runOrThrow({
    command: "pnpm",
    args: ["--filter", "@mistle/control-plane-api", "db:migrate"],
    env: sharedDevEnv,
  });

  console.log("Starting public tunnels...");
  runOrThrow({
    command: "docker",
    args: ["compose", "-f", DEV_COMPOSE_PATH, "up", "-d", TUNNEL_SERVICE_NAME],
    env: sharedDevEnv,
  });

  const controlPlaneApiPublicUrl = `https://${controlPlaneApiTunnelHostname}`;
  const dataPlaneEdgePublicUrl = `https://${dataPlaneEdgeTunnelHostname}`;

  console.log("");
  console.log("Public tunnel URLs:");
  console.log(`- control-plane-api: ${controlPlaneApiPublicUrl}`);
  console.log(`- data-plane tunnel base: ${dataPlaneEdgePublicUrl}`);
  console.log(`- data-plane tunnel route: ${dataPlaneEdgePublicUrl}/tunnel`);
  console.log("- mailpit ui: http://127.0.0.1:8025");
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

start().catch((error) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }

  cleanupAndExit(1);
});
