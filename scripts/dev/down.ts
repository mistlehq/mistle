import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEV_COMPOSE_PATH = resolve(REPO_ROOT, "infra", "local", "docker-compose.yml");
const SANDBOX_PROVIDER_LABEL = "mistle.sandbox.provider=docker";
const INCLUDE_VOLUMES_FLAG = "--volumes";
const REMOVE_LOCAL_IMAGES_FLAG = "--rmi-local";
const includeVolumes = process.argv.includes(INCLUDE_VOLUMES_FLAG);
const removeLocalImages = process.argv.includes(REMOVE_LOCAL_IMAGES_FLAG);

const composeArgs = ["compose", "-f", DEV_COMPOSE_PATH, "down", "--remove-orphans"];

if (includeVolumes) {
  composeArgs.push(INCLUDE_VOLUMES_FLAG);
}

if (removeLocalImages) {
  composeArgs.push("--rmi", "local");
}

function collectDockerContainerIds(args: readonly string[]): string[] {
  const result = spawnSync("docker", args, {
    cwd: REPO_ROOT,
    stdio: "pipe",
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`Command failed (docker ${args.join(" ")}).`);
  }

  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function removeSandboxContainers(): void {
  const sandboxContainerIds = collectDockerContainerIds([
    "ps",
    "-aq",
    "--filter",
    `label=${SANDBOX_PROVIDER_LABEL}`,
  ]);

  if (sandboxContainerIds.length === 0) {
    return;
  }

  console.log(`Removing ${String(sandboxContainerIds.length)} persisted sandbox container(s)...`);
  const result = spawnSync("docker", ["rm", "-f", ...sandboxContainerIds], {
    cwd: REPO_ROOT,
    stdio: "pipe",
    encoding: "utf8",
  });

  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error("Failed to remove sandbox containers during dev reset.");
  }
}

if (includeVolumes) {
  removeSandboxContainers();
}

const result = spawnSync("docker", composeArgs, {
  cwd: REPO_ROOT,
  stdio: "inherit",
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
