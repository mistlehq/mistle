import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEV_COMPOSE_PATH = resolve(REPO_ROOT, "infra", "local", "docker-compose.yml");
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

const result = spawnSync("docker", composeArgs, {
  cwd: REPO_ROOT,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
