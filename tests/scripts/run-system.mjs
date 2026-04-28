import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildPrepareEnvironment } from "./prepare-system-env.mjs";

const env = buildPrepareEnvironment(process.env);
const testsDirectory = fileURLToPath(new URL("..", import.meta.url));

execFileSync("vitest", ["-c", "vitest.system.config.ts", "--run", "--passWithNoTests"], {
  stdio: "inherit",
  cwd: testsDirectory,
  env,
});
