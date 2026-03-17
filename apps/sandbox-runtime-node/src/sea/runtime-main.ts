import { runRuntime } from "../runtime/run.js";

function lookupEnv(key: string): string | undefined {
  return process.env[key];
}

async function main(): Promise<void> {
  await runRuntime({
    lookupEnv,
    stdin: process.stdin,
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`sandbox runtime exited with error: ${message}\n`);
  process.exitCode = 1;
});
