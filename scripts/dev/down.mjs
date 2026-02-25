import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEV_COMPOSE_PATH = resolve(REPO_ROOT, "infra", "local", "docker-compose.yml");

const result = spawnSync(
  "docker",
  ["compose", "-f", DEV_COMPOSE_PATH, "down", "--remove-orphans"],
  {
    cwd: REPO_ROOT,
    stdio: "inherit",
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
