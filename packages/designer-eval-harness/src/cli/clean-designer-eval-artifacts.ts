import { readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { RepositoryRootPath, resolveRepositoryPath } from "./paths.ts";

type CleanDesignerEvalArtifactsOptions = {
  artifactRoot: string;
  beforeDate?: string;
  caseId?: string;
  date?: string;
  dryRun: boolean;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const targets = await resolveCleanupTargets(options);

  if (targets.length === 0) {
    console.log("No Designer eval artifacts matched.");
    return;
  }

  for (const target of targets) {
    if (options.dryRun) {
      console.log(`Would remove ${target}`);
      continue;
    }
    await rm(target, { recursive: true, force: true });
    console.log(`Removed ${target}`);
  }
}

async function resolveCleanupTargets(
  options: CleanDesignerEvalArtifactsOptions,
): Promise<readonly string[]> {
  if (options.date !== undefined && options.beforeDate !== undefined) {
    throw new Error("Use either --date or --before, not both.");
  }

  const rootExists = await pathExists(options.artifactRoot);
  if (!rootExists) {
    return [];
  }

  if (
    options.date === undefined &&
    options.beforeDate === undefined &&
    options.caseId === undefined
  ) {
    return [options.artifactRoot];
  }

  const dates = await listDateDirs(options.artifactRoot);
  const matchingDates = dates.filter((date) => dateMatches({ date, options }));
  const targets: string[] = [];

  for (const date of matchingDates) {
    const dateDir = join(options.artifactRoot, date);
    if (options.caseId === undefined) {
      targets.push(dateDir);
      continue;
    }

    const caseDir = join(dateDir, options.caseId);
    if (await pathExists(caseDir)) {
      targets.push(caseDir);
    }
  }

  return targets;
}

async function listDateDirs(artifactRoot: string): Promise<readonly string[]> {
  const entries = await readdir(artifactRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && isDateString(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function dateMatches(input: { date: string; options: CleanDesignerEvalArtifactsOptions }): boolean {
  if (input.options.date !== undefined) {
    return input.date === input.options.date;
  }
  if (input.options.beforeDate !== undefined) {
    return input.date < input.options.beforeDate;
  }

  return true;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function parseArgs(args: readonly string[]): CleanDesignerEvalArtifactsOptions {
  let artifactRoot = resolve(RepositoryRootPath, ".local/designer-evals/runs");
  let beforeDate: string | undefined;
  let caseId: string | undefined;
  let date: string | undefined;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--") {
      continue;
    }
    if (arg === "--artifact-root" && next !== undefined) {
      artifactRoot = resolveRepositoryPath(next);
      index += 1;
      continue;
    }
    if (arg === "--before" && next !== undefined) {
      beforeDate = parseDateArg(next, "--before");
      index += 1;
      continue;
    }
    if (arg === "--case-id" && next !== undefined) {
      caseId = next;
      index += 1;
      continue;
    }
    if (arg === "--date" && next !== undefined) {
      date = parseDateArg(next, "--date");
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown or incomplete argument '${arg ?? ""}'.`);
  }

  return {
    artifactRoot,
    ...(beforeDate === undefined ? {} : { beforeDate }),
    ...(caseId === undefined ? {} : { caseId }),
    ...(date === undefined ? {} : { date }),
    dryRun,
  };
}

function parseDateArg(value: string, label: string): string {
  if (!isDateString(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format.`);
  }
  return value;
}

function isDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function printHelp(): void {
  console.log(`Usage: pnpm designer:eval:clean [options]

Removes local Designer eval artifacts under .local/designer-evals/runs.

Options:
  --artifact-root <dir>       Artifact root. Defaults to .local/designer-evals/runs.
  --before <YYYY-MM-DD>       Remove date folders older than this date.
  --case-id <id>              Remove only this case under matching date folders.
  --date <YYYY-MM-DD>         Remove one date folder.
  --dry-run                   Print matched paths without removing them.
`);
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
