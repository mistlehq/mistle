import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ScriptDirectoryPath = dirname(fileURLToPath(import.meta.url));
const RepositoryRootPath = resolve(ScriptDirectoryPath, "../..");

function runCommand(command, args, cwd = RepositoryRootPath) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
  });
}

runCommand("pnpm", ["build:sandbox-runtime:sea:linux"]);
runCommand("node", ["./apps/sandbox-runtime/scripts/smoke-packaged-startup.mjs"]);
