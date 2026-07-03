import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ExtractDesignerTranscriptOptions = {
  container: string;
  outDir: string;
  threadId: string | null;
};

type CodexThreadRow = {
  cwd: string;
  id: string;
  rollout_path: string;
  title: string;
  updated_at_ms: number;
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_OUTPUT_ROOT = resolve(REPO_ROOT, ".local", "designer-transcripts");
const CodexStateGlob = "/root/.codex/state_*.sqlite";
const CodexLogsGlob = "/root/.codex/logs_*.sqlite";

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = prepareOutputDirectory(options.outDir);
  const stateDir = join(outputDir, "codex-state");
  mkdirSync(stateDir, { recursive: true });

  const copiedStateDatabases = copyCodexDatabases({
    container: options.container,
    glob: CodexStateGlob,
    outputDir: stateDir,
  });
  const copiedLogDatabases = copyCodexDatabases({
    container: options.container,
    glob: CodexLogsGlob,
    outputDir: stateDir,
  });
  const thread = selectThread({
    copiedStateDatabases,
    threadId: options.threadId,
  });
  const rolloutPath = copyRolloutFile({
    container: options.container,
    outputDir,
    rolloutPath: thread.rollout_path,
  });
  const metadataPath = join(outputDir, "metadata.json");
  writeJson(metadataPath, {
    container: options.container,
    copiedLogDatabases,
    copiedStateDatabases,
    outputDir,
    rolloutPath,
    sourceRolloutPath: thread.rollout_path,
    thread,
  });

  console.log(`Extracted Designer transcript artifacts to ${outputDir}`);
  console.log(`Rollout JSONL: ${rolloutPath}`);
  console.log(`Metadata: ${metadataPath}`);
}

export function parseArgs(argv: readonly string[]): ExtractDesignerTranscriptOptions {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  let container: string | null = null;
  let outDir: string | null = null;
  let threadId: string | null = null;

  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const argument = normalizedArgv[index];

    if (argument === "--container") {
      container = requireFlagValue(normalizedArgv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--out") {
      outDir = requireFlagValue(normalizedArgv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--thread") {
      threadId = requireFlagValue(normalizedArgv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unsupported argument: ${argument}`);
  }

  if (container === null) {
    throw new Error("Missing required --container <id-or-name>.");
  }

  return {
    container,
    outDir: outDir === null ? createDefaultOutputDir() : resolve(REPO_ROOT, outDir),
    threadId,
  };
}

function printUsage(): void {
  console.log(`Usage: pnpm dev:designer:transcript -- --container <id-or-name> [options]

Extracts raw Codex transcript artifacts from a live Designer sandbox container.

Options:
  --container <id>   Docker container id or name.
  --thread <id>      Codex thread id. Defaults to the newest thread in Codex state.
  --out <path>       Output directory. Defaults to .local/designer-transcripts/<timestamp>.
`);
}

function requireFlagValue(argv: readonly string[], index: number, flagName: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flagName}.`);
  }

  return value;
}

function createDefaultOutputDir(): string {
  return join(DEFAULT_OUTPUT_ROOT, new Date().toISOString().replaceAll(":", "-"));
}

function prepareOutputDirectory(outputDir: string): string {
  const resolved = resolve(REPO_ROOT, outputDir);
  if (existsSync(resolved)) {
    throw new Error(`Output directory already exists: ${resolved}`);
  }

  mkdirSync(resolved, { recursive: true });
  return resolved;
}

function copyCodexDatabases(input: {
  container: string;
  glob: string;
  outputDir: string;
}): string[] {
  const databasePaths = listContainerFiles({
    container: input.container,
    glob: input.glob,
  });

  return databasePaths.map((databasePath) =>
    copySqliteDatabase({
      container: input.container,
      databasePath,
      outputDir: input.outputDir,
    }),
  );
}

function listContainerFiles(input: { container: string; glob: string }): string[] {
  const output = execFileSync(
    "docker",
    [
      "exec",
      input.container,
      "sh",
      "-lc",
      `for file in ${input.glob}; do [ -e "$file" ] && printf '%s\\n' "$file"; done`,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function copySqliteDatabase(input: {
  container: string;
  databasePath: string;
  outputDir: string;
}): string {
  const destinationPath = join(input.outputDir, basename(input.databasePath));
  copyFromContainer({
    container: input.container,
    destinationPath,
    sourcePath: input.databasePath,
  });

  for (const suffix of ["-wal", "-shm"]) {
    const sourcePath = `${input.databasePath}${suffix}`;
    if (!containerPathExists({ container: input.container, path: sourcePath })) {
      continue;
    }

    copyFromContainer({
      container: input.container,
      destinationPath: `${destinationPath}${suffix}`,
      sourcePath,
    });
  }

  return destinationPath;
}

function containerPathExists(input: { container: string; path: string }): boolean {
  try {
    execFileSync("docker", ["exec", input.container, "test", "-e", input.path], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function copyFromContainer(input: {
  container: string;
  destinationPath: string;
  sourcePath: string;
}): void {
  const temporaryPath = `${input.destinationPath}.copying`;
  rmSync(temporaryPath, { force: true });
  execFileSync("docker", ["cp", `${input.container}:${input.sourcePath}`, temporaryPath], {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });
  copyFileSync(temporaryPath, input.destinationPath);
  rmSync(temporaryPath, { force: true });
}

function selectThread(input: {
  copiedStateDatabases: readonly string[];
  threadId: string | null;
}): CodexThreadRow {
  const threads = input.copiedStateDatabases.flatMap((databasePath) =>
    readThreadsFromStateDatabase(databasePath),
  );
  if (threads.length === 0) {
    throw new Error("No Codex threads found in copied state databases.");
  }

  if (input.threadId !== null) {
    const thread = threads.find((candidate) => candidate.id === input.threadId);
    if (thread === undefined) {
      throw new Error(`Thread not found in copied Codex state: ${input.threadId}`);
    }

    return thread;
  }

  const newestThread = threads.sort((left, right) => right.updated_at_ms - left.updated_at_ms)[0];
  if (newestThread === undefined) {
    throw new Error("No Codex threads found in copied state databases.");
  }

  return newestThread;
}

function readThreadsFromStateDatabase(databasePath: string): CodexThreadRow[] {
  const output = execFileSync(
    "sqlite3",
    [
      "-json",
      databasePath,
      [
        "select id, cwd, title, rollout_path, updated_at_ms",
        "from threads",
        "where rollout_path is not null and rollout_path <> ''",
        "order by updated_at_ms desc",
      ].join(" "),
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed)) {
    throw new Error(`Unexpected sqlite3 JSON output for ${databasePath}.`);
  }

  return parsed.map((value) => readThreadRow(databasePath, value));
}

function readThreadRow(databasePath: string, value: unknown): CodexThreadRow {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Unexpected thread row in ${databasePath}.`);
  }

  const id = readRequiredString(value, "id", databasePath);
  const cwd = readRequiredString(value, "cwd", databasePath);
  const title = readRequiredString(value, "title", databasePath);
  const rolloutPath = readRequiredString(value, "rollout_path", databasePath);
  const updatedAtMs = readRequiredNumber(value, "updated_at_ms", databasePath);

  return {
    cwd,
    id,
    rollout_path: rolloutPath,
    title,
    updated_at_ms: updatedAtMs,
  };
}

function readRequiredString(value: object, key: string, databasePath: string): string {
  const fieldValue = Reflect.get(value, key);
  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    throw new Error(`Unexpected ${key} value in ${databasePath}.`);
  }

  return fieldValue;
}

function readRequiredNumber(value: object, key: string, databasePath: string): number {
  const fieldValue = Reflect.get(value, key);
  if (typeof fieldValue !== "number") {
    throw new Error(`Unexpected ${key} value in ${databasePath}.`);
  }

  return fieldValue;
}

function copyRolloutFile(input: {
  container: string;
  outputDir: string;
  rolloutPath: string;
}): string {
  const destinationPath = join(input.outputDir, "rollout.jsonl");
  copyFromContainer({
    container: input.container,
    destinationPath,
    sourcePath: input.rolloutPath,
  });
  return destinationPath;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const entrypointUrl = process.argv[1] === undefined ? null : fileURLToPath(import.meta.url);
if (entrypointUrl !== null && process.argv[1] === entrypointUrl) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
