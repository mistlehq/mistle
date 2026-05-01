import { spawn } from "node:child_process";

import { stopRunnerServicePools } from "../../packages/test-harness/src/environment/runner-service-pool.ts";
import { stopSharedInfraForTestRun } from "../../packages/test-harness/src/services/shared-infra-coordinator.ts";
import { ensureIntegrationRunnerPoolSession } from "./integration-run-id.ts";

const IntegrationNewVitestProjects = [
  {
    projectName: "@mistle/control-plane-api",
    packageName: "@mistle/control-plane-api",
  },
  {
    projectName: "@mistle/data-plane-api",
    packageName: "@mistle/data-plane-api",
  },
  {
    projectName: "@mistle/data-plane-gateway",
    packageName: "@mistle/data-plane-gateway",
  },
  {
    projectName: "@mistle/dashboard",
    packageName: "@mistle/dashboard",
  },
] as const;

type IntegrationNewVitestProject = (typeof IntegrationNewVitestProjects)[number];

const RequiredBuildPackages = [
  "@mistle/control-plane-api",
  "@mistle/data-plane-api",
  "@mistle/data-plane-gateway",
  "@mistle/db",
  "@mistle/test-harness",
  "@mistle/tokenizer-proxy",
] as const;

function normalizeCliArgs(rawArgs: ReadonlyArray<string>): string[] {
  if (rawArgs[0] === "--") {
    return rawArgs.slice(1);
  }

  return [...rawArgs];
}

function parseProjectFilters(args: ReadonlyArray<string>): string[] {
  const projectFilters: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      throw new Error(`Expected an argument at index ${String(index)}.`);
    }
    if (argument === "--project") {
      const projectName = args[index + 1];
      if (projectName === undefined || projectName.length === 0) {
        throw new Error("Expected a project name after --project.");
      }
      projectFilters.push(projectName);
      index += 1;
      continue;
    }

    const projectPrefix = "--project=";
    if (argument.startsWith(projectPrefix)) {
      const projectName = argument.slice(projectPrefix.length);
      if (projectName.length === 0) {
        throw new Error("Expected a non-empty project name in --project=<name>.");
      }
      projectFilters.push(projectName);
    }
  }

  return projectFilters;
}

function resolveSelectedProjects(
  projectFilters: ReadonlyArray<string>,
): IntegrationNewVitestProject[] {
  if (projectFilters.length === 0) {
    return [...IntegrationNewVitestProjects];
  }

  const selectedProjects: IntegrationNewVitestProject[] = [];

  for (const projectFilter of projectFilters) {
    const project = IntegrationNewVitestProjects.find(
      (candidate) => candidate.projectName === projectFilter,
    );
    if (project === undefined) {
      throw new Error(
        `Unknown integration-new Vitest project '${projectFilter}'. Expected one of: ${IntegrationNewVitestProjects.map((candidate) => candidate.projectName).join(", ")}.`,
      );
    }
    if (!selectedProjects.includes(project)) {
      selectedProjects.push(project);
    }
  }

  return selectedProjects;
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)}s`;
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

async function runTimedCommand(input: {
  label: string;
  command: string;
  args: ReadonlyArray<string>;
}): Promise<number> {
  const startedAt = Date.now();
  await runCommand(input.command, input.args);
  const durationMs = Date.now() - startedAt;
  console.info(`[integration-new] ${input.label} completed in ${formatDuration(durationMs)}.`);
  return durationMs;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const runnerPoolSession = ensureIntegrationRunnerPoolSession(process.env);
  const cliArgs = normalizeCliArgs(process.argv.slice(2));
  const projectFilters = parseProjectFilters(cliArgs);
  const selectedProjects = resolveSelectedProjects(projectFilters);
  const selectedBuildPackages = new Set<string>(RequiredBuildPackages);

  for (const project of selectedProjects) {
    selectedBuildPackages.add(project.packageName);
  }

  console.info(`Using integration-new run id ${runnerPoolSession.runId}.`);

  await runTimedCommand({
    label: "build",
    command: "pnpm",
    args: [
      "turbo",
      "run",
      "build",
      ...Array.from(selectedBuildPackages).flatMap((packageName) => [
        "--filter",
        `${packageName}...`,
      ]),
    ],
  });

  try {
    await runTimedCommand({
      label: "vitest",
      command: "pnpm",
      args: ["exec", "vitest", "run", "-c", "vitest.integration-new.root.ts", ...cliArgs],
    });
  } finally {
    const cleanupStartedAt = Date.now();
    await stopRunnerServicePools({
      runId: runnerPoolSession.runId,
      coordinatorDir: runnerPoolSession.coordinatorDir,
    });
    await stopSharedInfraForTestRun(runnerPoolSession.runId);
    console.info(
      `[integration-new] pooled service/infra cleanup completed in ${formatDuration(Date.now() - cleanupStartedAt)}.`,
    );
  }

  console.info(`[integration-new] total completed in ${formatDuration(Date.now() - startedAt)}.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exitCode = 1;
});
