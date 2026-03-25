import { spawn } from "node:child_process";

import { ensureIntegrationRunId } from "./integration-run-id.ts";

const IntegrationProjects = [
  {
    kind: "vitest",
    projectName: "@mistle/control-plane-api",
    packageName: "@mistle/control-plane-api",
  },
  {
    kind: "vitest",
    projectName: "@mistle/control-plane-worker",
    packageName: "@mistle/control-plane-worker",
  },
  {
    kind: "vitest",
    projectName: "@mistle/dashboard",
    packageName: "@mistle/dashboard",
  },
  {
    kind: "vitest",
    projectName: "@mistle/data-plane-api",
    packageName: "@mistle/data-plane-api",
  },
  {
    kind: "vitest",
    projectName: "@mistle/data-plane-gateway",
    packageName: "@mistle/data-plane-gateway",
  },
  {
    kind: "vitest",
    projectName: "@mistle/tokenizer-proxy",
    packageName: "@mistle/tokenizer-proxy",
  },
  {
    kind: "vitest",
    projectName: "@mistle/config",
    packageName: "@mistle/config",
  },
  {
    kind: "vitest",
    projectName: "@mistle/db",
    packageName: "@mistle/db",
  },
  {
    kind: "vitest",
    projectName: "@mistle/emails",
    packageName: "@mistle/emails",
  },
  {
    kind: "vitest",
    projectName: "@mistle/integrations-core",
    packageName: "@mistle/integrations-core",
  },
  {
    kind: "vitest",
    projectName: "@mistle/sandbox",
    packageName: "@mistle/sandbox",
  },
  {
    kind: "command",
    projectName: "@mistle/sandbox-runtime",
    packageName: "@mistle/sandbox-runtime",
    command: ["node", "./scripts/test/run-sandbox-runtime-packaged-startup-linux.mjs"],
  },
  {
    kind: "vitest",
    projectName: "@mistle/test-harness",
    packageName: "@mistle/test-harness",
  },
] as const;

type IntegrationProject = (typeof IntegrationProjects)[number];

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

function stripProjectArgs(args: ReadonlyArray<string>): string[] {
  const forwardedArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      throw new Error(`Expected an argument at index ${String(index)}.`);
    }

    if (argument === "--project") {
      index += 1;
      continue;
    }

    if (argument.startsWith("--project=")) {
      continue;
    }

    forwardedArgs.push(argument);
  }

  return forwardedArgs;
}

function resolveSelectedProjects(projectFilters: ReadonlyArray<string>): IntegrationProject[] {
  if (projectFilters.length === 0) {
    return [...IntegrationProjects];
  }

  const selectedProjects: IntegrationProject[] = [];

  for (const projectFilter of projectFilters) {
    const project = IntegrationProjects.find(
      (candidate) => candidate.projectName === projectFilter,
    );
    if (project === undefined) {
      throw new Error(
        `Unknown integration project '${projectFilter}'. Expected one of: ${IntegrationProjects.map((candidate) => candidate.projectName).join(", ")}.`,
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
  const forwardedCliArgs = stripProjectArgs(cliArgs);
  const selectedProjects = resolveSelectedProjects(projectFilters);
  const selectedVitestProjects = selectedProjects.filter((project) => project.kind === "vitest");
  const selectedCommandProjects = selectedProjects.filter((project) => project.kind === "command");

  console.info(`Using integration run id ${integrationRunId}.`);

  await runCommand("pnpm", [
    "turbo",
    "run",
    "build",
    ...selectedProjects.flatMap((project) => ["--filter", `${project.packageName}...`]),
  ]);

  if (selectedVitestProjects.length > 0) {
    await runCommand("pnpm", [
      "exec",
      "vitest",
      "run",
      "-c",
      "vitest.integration.root.ts",
      ...selectedVitestProjects.flatMap((project) => ["--project", project.projectName]),
      ...forwardedCliArgs,
    ]);
  }

  for (const project of selectedCommandProjects) {
    await runCommand(project.command[0], project.command.slice(1));
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exitCode = 1;
});
