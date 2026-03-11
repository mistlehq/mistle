import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join } from "node:path";

import {
  acquireSharedPostgresMailpitInfra,
  DEFAULT_SHARED_INTEGRATION_INFRA_KEY,
} from "../../packages/test-harness/src/index.ts";

const INTEGRATION_SCRIPT = "test:integration";
const WORKSPACE_DIRECTORIES: ReadonlyArray<string> = ["apps", "packages"];
const MAX_TARGET_CONCURRENCY_ENV = "MISTLE_INTEGRATION_RUNNER_CONCURRENCY";

type IntegrationTarget = {
  name: string;
};

const DebugEnabled = process.env["MISTLE_INTEGRATION_RUNNER_DEBUG"] === "1";

function debugLog(message: string): void {
  if (!DebugEnabled) {
    return;
  }
  console.error(`[run-integration] ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePositiveInteger(input: {
  value: string | undefined;
  variableName: string;
  defaultValue: number;
}): number {
  if (input.value === undefined || input.value.length === 0) {
    return input.defaultValue;
  }

  const parsed = Number.parseInt(input.value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `Environment variable ${input.variableName} must be a positive integer when provided.`,
    );
  }

  return parsed;
}

function resolveDefaultTargetConcurrency(): number {
  const detected = availableParallelism();
  if (!Number.isInteger(detected) || detected < 1) {
    return 1;
  }

  return detected;
}

function readScriptsField(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const scripts: Record<string, string> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (typeof fieldValue !== "string") {
      continue;
    }
    scripts[key] = fieldValue;
  }
  return scripts;
}

function parsePackageNameAndScripts(
  input: string,
  sourcePath: string,
): IntegrationTarget | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(
      `Failed to parse ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(`Expected ${sourcePath} to contain a JSON object.`);
  }

  const nameField = parsed["name"];
  const scripts = readScriptsField(parsed["scripts"]);

  if (typeof nameField !== "string" || scripts === undefined) {
    return undefined;
  }

  if (scripts[INTEGRATION_SCRIPT] === undefined) {
    return undefined;
  }

  return {
    name: nameField,
  };
}

async function discoverIntegrationTargets(): Promise<IntegrationTarget[]> {
  const targets: IntegrationTarget[] = [];

  for (const workspaceDirectory of WORKSPACE_DIRECTORIES) {
    const entries = await readdir(workspaceDirectory, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageJsonPath = join(workspaceDirectory, entry.name, "package.json");
      let packageJsonContent: string;

      try {
        packageJsonContent = await readFile(packageJsonPath, "utf8");
      } catch {
        continue;
      }

      const target = parsePackageNameAndScripts(packageJsonContent, packageJsonPath);
      if (target !== undefined) {
        targets.push(target);
      }
    }
  }

  targets.sort((left, right) => left.name.localeCompare(right.name));
  return targets;
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

function asError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

async function runTargets(input: {
  targets: ReadonlyArray<IntegrationTarget>;
  maxConcurrency: number;
}): Promise<void> {
  const { targets, maxConcurrency } = input;

  if (targets.length === 0) {
    return;
  }

  if (maxConcurrency === 1) {
    for (const target of targets) {
      console.info(`\n==> ${target.name}`);
      debugLog(`main: running target=${target.name}`);
      await runCommand("pnpm", ["--filter", target.name, INTEGRATION_SCRIPT]);
      debugLog(`main: completed target=${target.name}`);
    }
    return;
  }

  let nextIndex = 0;
  let firstFailure: Error | undefined;

  async function workerLoop(workerId: number): Promise<void> {
    for (;;) {
      if (firstFailure !== undefined) {
        return;
      }

      const targetIndex = nextIndex;
      nextIndex += 1;

      if (targetIndex >= targets.length) {
        return;
      }

      const target = targets[targetIndex];
      if (target === undefined) {
        return;
      }
      console.info(`\n==> ${target.name}`);
      debugLog(`main: worker=${String(workerId)} running target=${target.name}`);

      try {
        await runCommand("pnpm", ["--filter", target.name, INTEGRATION_SCRIPT]);
        debugLog(`main: worker=${String(workerId)} completed target=${target.name}`);
      } catch (error) {
        firstFailure = asError(error);
        debugLog(
          `main: worker=${String(workerId)} failed target=${target.name} error=${firstFailure.message}`,
        );
        return;
      }
    }
  }

  const workerCount = Math.min(maxConcurrency, targets.length);
  await Promise.all(Array.from({ length: workerCount }, (_, index) => workerLoop(index + 1)));

  if (firstFailure !== undefined) {
    throw firstFailure;
  }
}

async function main(): Promise<void> {
  debugLog("main: start");
  const discoveredTargets = await discoverIntegrationTargets();
  debugLog(`main: discoveredTargets=${String(discoveredTargets.length)}`);
  const requestedTargets = process.argv.slice(2).filter((argument) => argument !== "--");
  debugLog(`main: requestedTargets=${requestedTargets.join(",")}`);
  const targets =
    requestedTargets.length === 0
      ? discoveredTargets
      : discoveredTargets.filter((target) => requestedTargets.includes(target.name));

  if (requestedTargets.length > 0) {
    const discoveredTargetNames = new Set(discoveredTargets.map((target) => target.name));
    const unknownTargets = requestedTargets.filter(
      (targetName) => !discoveredTargetNames.has(targetName),
    );
    if (unknownTargets.length > 0) {
      throw new Error(
        `Unknown integration targets: ${unknownTargets.join(", ")}. Use package names (for example: @mistle/control-plane).`,
      );
    }
  }

  if (targets.length === 0) {
    throw new Error("No workspace package with a test:integration script was found.");
  }

  const maxTargetConcurrency = parsePositiveInteger({
    value: process.env[MAX_TARGET_CONCURRENCY_ENV],
    variableName: MAX_TARGET_CONCURRENCY_ENV,
    defaultValue: resolveDefaultTargetConcurrency(),
  });

  debugLog("main: acquiring root shared infra lease");
  const rootInfraLease = await acquireSharedPostgresMailpitInfra({
    key: DEFAULT_SHARED_INTEGRATION_INFRA_KEY,
    postgres: {},
  });
  debugLog("main: acquired root shared infra lease");

  try {
    console.info(
      `Running ${String(targets.length)} integration targets without Turbo (shared infra key: ${DEFAULT_SHARED_INTEGRATION_INFRA_KEY}, target concurrency: ${String(maxTargetConcurrency)}).`,
    );
    await runTargets({
      targets,
      maxConcurrency: maxTargetConcurrency,
    });
  } finally {
    debugLog("main: releasing root shared infra lease");
    await rootInfraLease.release();
    debugLog("main: released root shared infra lease");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exitCode = 1;
});
