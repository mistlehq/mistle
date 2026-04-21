import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const controlPlaneApiDir = dirname(scriptDir);
const workspaceRoot = resolve(controlPlaneApiDir, "..", "..");
const commitSignDir = resolve(workspaceRoot, "packages", "commit-sign");
const commitSignBinaryPath = resolve(commitSignDir, "target", "debug", "commit-sign");

function ensureCommitSignBinary(): void {
  const result = spawnSync("cargo", ["build", "--locked", "--bin", "commit-sign"], {
    cwd: commitSignDir,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runDevServer(): void {
  const child = spawn("tsx", ["watch", "--import", "./src/instrument.ts", "src/index.ts"], {
    cwd: controlPlaneApiDir,
    stdio: "inherit",
    env: {
      ...process.env,
      MISTLE_APPS_CONTROL_PLANE_API_COMMIT_SIGN_BINARY_PATH: commitSignBinaryPath,
    },
  });

  child.on("exit", (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

ensureCommitSignBinary();
runDevServer();
