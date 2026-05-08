import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildPrepareEnvironment } from "./prepare-system-env.mjs";

function run(command, args, env) {
  execFileSync(command, args, {
    stdio: "inherit",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env,
  });
}

const env = buildPrepareEnvironment(process.env);

run("pnpm", ["--dir", "..", "config:init:integration"], env);
run(
  "pnpm",
  [
    "--filter",
    "@mistle/control-plane-api...",
    "--filter",
    "@mistle/control-plane-worker...",
    "--filter",
    "@mistle/data-plane-api...",
    "--filter",
    "@mistle/data-plane-worker...",
    "--filter",
    "@mistle/data-plane-gateway...",
    "build",
  ],
  env,
);
run("pnpm", ["--dir", "..", "run", "test-harness:prepare-runtime"], env);
