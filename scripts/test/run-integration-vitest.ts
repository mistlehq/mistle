import { spawn } from "node:child_process";

import { ensureIntegrationRunId } from "./integration-run-id.ts";

const IntegrationVitestProjects = [
  {
    projectName: "@mistle/control-plane-api",
    packageName: "@mistle/control-plane-api",
  },
  {
    projectName: "@mistle/control-plane-worker",
    packageName: "@mistle/control-plane-worker",
  },
  {
    projectName: "@mistle/dashboard",
    packageName: "@mistle/dashboard",
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
    projectName: "@mistle/tokenizer-proxy",
    packageName: "@mistle/tokenizer-proxy",
  },
  {
    projectName: "@mistle/config",
    packageName: "@mistle/config",
  },
  {
    projectName: "@mistle/db",
    packageName: "@mistle/db",
  },
  {
    projectName: "@mistle/emails",
    packageName: "@mistle/emails",
  },
  {
    projectName: "@mistle/integrations-core",
    packageName: "@mistle/integrations-core",
  },
  {
    projectName: "@mistle/sandbox",
    packageName: "@mistle/sandbox",
  },
  {
    projectName: "@mistle/test-harness",
    packageName: "@mistle/test-harness",
  },
] as const;

type IntegrationVitestProject = (typeof IntegrationVitestProjects)[number];

const AdditionalBuildPackagesByProjectName: Partial<
  Record<IntegrationVitestProject["projectName"], readonly string[]>
> = {
  "@mistle/test-harness": [
    "@mistle/control-plane-api",
    "@mistle/control-plane-worker",
    "@mistle/data-plane-api",
    "@mistle/data-plane-gateway",
    "@mistle/data-plane-worker",
    "@mistle/tokenizer-proxy",
  ],
};

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
): IntegrationVitestProject[] {
  if (projectFilters.length === 0) {
    return [...IntegrationVitestProjects];
  }

  const selectedProjects: IntegrationVitestProject[] = [];

  for (const projectFilter of projectFilters) {
    const project = IntegrationVitestProjects.find(
      (candidate) => candidate.projectName === projectFilter,
    );
    if (project === undefined) {
      throw new Error(
        `Unknown integration Vitest project '${projectFilter}'. Expected one of: ${IntegrationVitestProjects.map((candidate) => candidate.projectName).join(", ")}.`,
      );
    }
    if (!selectedProjects.includes(project)) {
      selectedProjects.push(project);
    }
  }

  return selectedProjects;
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
  const integrationRunId = ensureIntegrationRunId(process.env);
  const cliArgs = normalizeCliArgs(process.argv.slice(2));
  const projectFilters = parseProjectFilters(cliArgs);
  const selectedProjects = resolveSelectedProjects(projectFilters);
  const selectedBuildPackages = new Set<string>();

  for (const project of selectedProjects) {
    selectedBuildPackages.add(project.packageName);

    const additionalBuildPackages = AdditionalBuildPackagesByProjectName[project.projectName];
    if (additionalBuildPackages !== undefined) {
      for (const packageName of additionalBuildPackages) {
        selectedBuildPackages.add(packageName);
      }
    }
  }

  console.info(`Using integration run id ${integrationRunId}.`);

  await runCommand("pnpm", [
    "turbo",
    "run",
    "build",
    ...Array.from(selectedBuildPackages).flatMap((packageName) => [
      "--filter",
      `${packageName}...`,
    ]),
  ]);

  await runCommand("pnpm", [
    "exec",
    "vitest",
    "run",
    "-c",
    "vitest.integration.root.ts",
    ...cliArgs,
  ]);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exitCode = 1;
});
