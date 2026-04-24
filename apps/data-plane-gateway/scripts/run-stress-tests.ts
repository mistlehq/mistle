import { spawn } from "node:child_process";

import {
  DataPlaneGatewayStressBuildPackageFilters,
  DataPlaneGatewayStressEnvironment,
  resolveDataPlaneGatewayStressCases,
  resolveDataPlaneGatewayStressIterationCount,
} from "../integration/stress-config.js";

async function runCommand(input: {
  command: string;
  args: readonly string[];
  environment: NodeJS.ProcessEnv;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: process.cwd(),
      env: input.environment,
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
          `${input.command} ${input.args.join(" ")} exited with code ${String(code)}${signal === null ? "" : ` and signal ${signal}`}.`,
        ),
      );
    });
  });
}

async function main(): Promise<void> {
  const selectedStressCases = resolveDataPlaneGatewayStressCases(process.env);
  const stressEnvironment = {
    ...process.env,
    ...DataPlaneGatewayStressEnvironment,
  };

  console.info(
    `Running data-plane-gateway stress cases: ${selectedStressCases.map((stressCase) => stressCase.name).join(", ")}.`,
  );

  await runCommand({
    command: "pnpm",
    args: [
      ...DataPlaneGatewayStressBuildPackageFilters.flatMap((packageFilter) => [
        "--filter",
        packageFilter,
      ]),
      "build",
    ],
    environment: stressEnvironment,
  });

  for (const stressCase of selectedStressCases) {
    const iterationCount = resolveDataPlaneGatewayStressIterationCount({
      environment: stressEnvironment,
      stressCase,
    });

    console.info(
      `data-plane-gateway stress: ${stressCase.name} (${String(iterationCount)} iterations)`,
    );

    await runCommand({
      command: "pnpm",
      args: [
        "exec",
        "vitest",
        "run",
        "-c",
        "vitest.stress.config.ts",
        stressCase.filePath,
        "--passWithNoTests",
      ],
      environment: {
        ...stressEnvironment,
        [stressCase.iterationsEnvironmentVariable]: String(iterationCount),
      },
    });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exitCode = 1;
});
