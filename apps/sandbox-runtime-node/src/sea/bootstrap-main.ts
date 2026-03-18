import { resolvePackagedRuntimeExecutablePath, runBootstrap } from "../bootstrap/run.js";

function lookupEnv(key: string): string | undefined {
  return process.env[key];
}

async function main(): Promise<void> {
  await runBootstrap({
    lookupEnv,
    processArgv: process.argv,
    runtimeExecTarget: {
      kind: "packaged-binary",
      runtimeExecutablePath: resolvePackagedRuntimeExecutablePath(process.execPath),
    },
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`sandbox bootstrap exited with error: ${message}\n`);
  process.exitCode = 1;
});
