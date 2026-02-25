import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEV_CONFIG_PATH = resolve(REPO_ROOT, "config", "config.development.toml");
const DEV_COMPOSE_PATH = resolve(REPO_ROOT, "infra", "local", "docker-compose.yml");

const TUNNEL_SERVICES = ["tunnel-control-plane-api", "tunnel-data-plane-edge"];
const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/g;
const TUNNEL_DISCOVERY_TIMEOUT_MS = 45_000;
const TUNNEL_DISCOVERY_POLL_INTERVAL_MS = 1_000;
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

function sleep(durationMs) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, durationMs);
  });
}

function readTunnelUrl(serviceName) {
  const result = runOrThrow({
    command: "docker",
    args: ["compose", "-f", DEV_COMPOSE_PATH, "logs", "--no-color", "--no-log-prefix", serviceName],
    stdio: "pipe",
  });

  const stdout = result.stdout ?? "";
  const matches = stdout.match(TUNNEL_URL_PATTERN);
  if (matches === null || matches.length === 0) {
    return undefined;
  }

  return matches[matches.length - 1];
}

async function waitForTunnelUrl(serviceName) {
  const deadline = Date.now() + TUNNEL_DISCOVERY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const tunnelUrl = readTunnelUrl(serviceName);
    if (tunnelUrl !== undefined) {
      return tunnelUrl;
    }

    await sleep(TUNNEL_DISCOVERY_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for tunnel URL for service '${serviceName}' after ${String(TUNNEL_DISCOVERY_TIMEOUT_MS)}ms.`,
  );
}

async function start() {
  console.log("Initializing development config...");
  runOrThrow({
    command: "pnpm",
    args: ["config:init:dev"],
  });

  console.log("Starting local infra dependencies (Postgres 18, PgBouncer, Caddy)...");
  const controlPlaneApiLocalPort = readControlPlaneApiLocalPort(DEV_CONFIG_PATH);
  const sharedDevEnv = {
    MISTLE_CONFIG_PATH: DEV_CONFIG_PATH,
    CONTROL_PLANE_API_LOCAL_PORT: String(controlPlaneApiLocalPort),
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
    ],
    env: sharedDevEnv,
  });
  localInfraStarted = true;

  console.log("Running control-plane DB migrations...");
  runOrThrow({
    command: "pnpm",
    args: ["--filter", "@mistle/control-plane-api", "db:migrate"],
    env: sharedDevEnv,
  });

  console.log("Starting public tunnels...");
  runOrThrow({
    command: "docker",
    args: ["compose", "-f", DEV_COMPOSE_PATH, "up", "-d", ...TUNNEL_SERVICES],
    env: sharedDevEnv,
  });

  const controlPlaneApiPublicUrl = await waitForTunnelUrl("tunnel-control-plane-api");
  const dataPlaneEdgePublicUrl = await waitForTunnelUrl("tunnel-data-plane-edge");

  console.log("");
  console.log("Public tunnel URLs:");
  console.log(`- control-plane-api: ${controlPlaneApiPublicUrl}`);
  console.log(`- data-plane tunnel base: ${dataPlaneEdgePublicUrl}`);
  console.log(`- data-plane tunnel route: ${dataPlaneEdgePublicUrl}/tunnel`);
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
