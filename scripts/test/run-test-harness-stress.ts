import { spawn } from "node:child_process";

import { ensureRunnerPoolSession } from "../../packages/test-harness/src/environment/runner-pool-session.ts";
import { stopRunnerServicePools } from "../../packages/test-harness/src/environment/runner-service-pool.ts";

function normalizeCliArgs(rawArgs: ReadonlyArray<string>): string[] {
  return rawArgs.filter((argument) => argument !== "--");
}

async function runCommand(command: string, args: ReadonlyArray<string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${String(code)}${signal === null ? "" : ` and signal ${signal}`}.`,
        ),
      );
    });
  });
}

async function main(): Promise<void> {
  const session = ensureRunnerPoolSession(process.env);
  const cliArgs = normalizeCliArgs(process.argv.slice(2));

  try {
    await runCommand("pnpm", [
      "exec",
      "vitest",
      "run",
      "-c",
      "vitest.stress.config.ts",
      ...cliArgs,
    ]);
  } finally {
    await stopRunnerServicePools({
      runId: session.runId,
      coordinatorDir: session.coordinatorDir,
    });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exitCode = 1;
});
