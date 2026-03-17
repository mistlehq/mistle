import { fileURLToPath } from "node:url";

import { runBootstrap } from "./run.js";

function lookupEnv(key: string): string | undefined {
  return process.env[key];
}

async function main(): Promise<void> {
  await runBootstrap({
    lookupEnv,
    processArgv: process.argv,
    bootstrapEntrypointPath: fileURLToPath(import.meta.url),
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`sandbox bootstrap exited with error: ${message}\n`);
  process.exitCode = 1;
});
