import { fileURLToPath } from "node:url";

import { runRuntimeCommand } from "./cli/run-runtime-command.js";

function lookupEnv(key: string): string | undefined {
  return process.env[key];
}

async function main(): Promise<void> {
  await runRuntimeCommand({
    lookupEnv,
    processArgv: process.argv,
    processExecArgv: process.execArgv,
    currentEntrypointPath: fileURLToPath(import.meta.url),
    stdin: process.stdin,
    stderr: process.stderr,
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`sandbox runtime exited with error: ${message}\n`);
  process.exitCode = 1;
});
