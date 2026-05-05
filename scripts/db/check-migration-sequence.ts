import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

type MigrationPlaneName = "control-plane" | "data-plane";

type JournalEntry = {
  idx: number;
  tag: string;
};

type MigrationPlaneSnapshot = {
  journalEntries: readonly JournalEntry[];
  rootPath: string;
  snapshotIndexes: readonly string[];
  sqlMigrations: readonly SqlMigration[];
};

type MigrationSequenceCheckInput = {
  base: MigrationPlaneSnapshot;
  baseLabel: string;
  current: MigrationPlaneSnapshot;
  plane: MigrationPlaneName;
};

type ParsedCliArguments = {
  baseRef: string;
};

type SqlMigration = {
  index: number;
  indexText: string;
  relativePath: string;
  tag: string;
};

type MigrationIndexMaps = {
  journalByIndex: ReadonlyMap<number, JournalEntry>;
  snapshotIndexes: ReadonlySet<string>;
  sqlByIndex: ReadonlyMap<number, SqlMigration>;
  sqlByTag: ReadonlyMap<string, SqlMigration>;
};

const DefaultBaseRef = "origin/main";
const MigrationPlanes: readonly MigrationPlaneName[] = ["control-plane", "data-plane"];
const MigrationFilePattern = /^(\d{4})_[^/]+\.sql$/u;
const SnapshotFilePattern = /^(\d{4})_snapshot\.json$/u;

function readCurrentPlaneSnapshot(plane: MigrationPlaneName): MigrationPlaneSnapshot {
  const rootPath = join("packages/db/migrations", plane);
  const metaPath = join(rootPath, "meta");

  if (!existsSync(rootPath)) {
    throw new Error(`Current migration directory does not exist: ${rootPath}`);
  }

  return {
    journalEntries: parseJournalEntries(readFileSync(join(metaPath, "_journal.json"), "utf8")),
    rootPath,
    snapshotIndexes: readSnapshotIndexesFromDirectory(metaPath),
    sqlMigrations: readSqlMigrationsFromDirectory(rootPath),
  };
}

function readBasePlaneSnapshot(plane: MigrationPlaneName, baseRef: string): MigrationPlaneSnapshot {
  const rootPath = join("packages/db/migrations", plane);
  const baseRootPath = `${baseRef}:${rootPath}`;
  const baseJournalPath = `${baseRef}:${rootPath}/meta/_journal.json`;

  try {
    return {
      journalEntries: parseJournalEntries(readGitFile(baseJournalPath, baseRef)),
      rootPath,
      snapshotIndexes: readSnapshotIndexesFromGit(baseRef, rootPath),
      sqlMigrations: readSqlMigrationsFromGit(baseRef, rootPath),
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(
        `Could not read base migration tree ${baseRootPath}. Fetch the base ref before running migration sequence validation. Underlying error: ${error.message}`,
      );
    }

    throw error;
  }
}

function readSqlMigrationsFromDirectory(rootPath: string): readonly SqlMigration[] {
  const migrations: SqlMigration[] = [];
  const entries = readdirSync(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const migration = parseSqlMigrationPath(rootPath, join(rootPath, entry.name));
    if (migration !== null) {
      migrations.push(migration);
    }
  }

  return migrations.toSorted(compareSqlMigrations);
}

function readSnapshotIndexesFromDirectory(metaPath: string): readonly string[] {
  const indexes: string[] = [];
  const entries = readdirSync(metaPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const match = SnapshotFilePattern.exec(entry.name);
    if (match === null) {
      continue;
    }

    const indexText = match[1];
    if (indexText === undefined) {
      throw new Error(`Could not parse snapshot index from ${entry.name}.`);
    }

    indexes.push(indexText);
  }

  return indexes.toSorted();
}

function readSqlMigrationsFromGit(baseRef: string, rootPath: string): readonly SqlMigration[] {
  return readGitPaths(baseRef, rootPath)
    .map((filePath) => parseSqlMigrationPath(rootPath, filePath))
    .filter(isSqlMigration)
    .toSorted(compareSqlMigrations);
}

function readSnapshotIndexesFromGit(baseRef: string, rootPath: string): readonly string[] {
  const metaPath = `${rootPath}/meta`;
  const indexes: string[] = [];

  for (const filePath of readGitPaths(baseRef, metaPath)) {
    const match = SnapshotFilePattern.exec(basename(filePath));
    if (match === null) {
      continue;
    }

    const indexText = match[1];
    if (indexText === undefined) {
      throw new Error(`Could not parse snapshot index from ${filePath}.`);
    }

    indexes.push(indexText);
  }

  return indexes.toSorted();
}

function parseSqlMigrationPath(rootPath: string, filePath: string): SqlMigration | null {
  const fileName = basename(filePath);
  const match = MigrationFilePattern.exec(fileName);
  if (match === null) {
    return null;
  }

  const indexText = match[1];
  if (indexText === undefined) {
    throw new Error(`Could not parse migration index from ${filePath}.`);
  }

  return {
    index: Number.parseInt(indexText, 10),
    indexText,
    relativePath: relative(dirname(rootPath), filePath),
    tag: fileName.slice(0, -".sql".length),
  };
}

function compareSqlMigrations(left: SqlMigration, right: SqlMigration): number {
  return left.index - right.index || left.tag.localeCompare(right.tag);
}

function readGitPaths(baseRef: string, rootPath: string): readonly string[] {
  const output = execFileSync("git", ["ls-tree", "-r", "--name-only", baseRef, "--", rootPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length !== 0);
}

function readGitFile(gitPath: string, baseRef: string): string {
  try {
    return execFileSync("git", ["show", gitPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Could not read ${gitPath}. Fetch ${baseRef} first. ${error.message}`);
    }

    throw error;
  }
}

function parseJournalEntries(content: string): readonly JournalEntry[] {
  const value: unknown = JSON.parse(content);
  if (!isRecord(value)) {
    throw new Error("Drizzle journal must be a JSON object.");
  }

  const entries = value["entries"];
  if (!Array.isArray(entries)) {
    throw new Error("Drizzle journal must contain an entries array.");
  }

  return entries.map(parseJournalEntry);
}

function parseJournalEntry(value: unknown): JournalEntry {
  if (!isRecord(value)) {
    throw new Error("Drizzle journal entry must be a JSON object.");
  }

  return {
    idx: parseNumber(value["idx"], "journal entry idx"),
    tag: parseString(value["tag"], "journal entry tag"),
  };
}

function parseNumber(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throw new Error(`Expected ${label} to be a number.`);
  }

  return value;
}

function parseString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected ${label} to be a string.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSqlMigration(value: SqlMigration | null): value is SqlMigration {
  return value !== null;
}

export function findMigrationSequenceFailures(
  input: MigrationSequenceCheckInput,
): readonly string[] {
  const failures: string[] = [];

  const currentMaps = buildMigrationIndexMaps(input.current, "current", failures);
  const baseMaps = buildMigrationIndexMaps(input.base, input.baseLabel, failures);

  failures.push(
    ...findBaseComparisonFailures({
      baseLabel: input.baseLabel,
      baseMaps,
      currentMaps,
      plane: input.plane,
    }),
  );

  return failures;
}

function buildMigrationIndexMaps(
  snapshot: MigrationPlaneSnapshot,
  label: string,
  failures: string[],
): MigrationIndexMaps {
  const sqlByIndex = new Map<number, SqlMigration>();
  const sqlByTag = new Map<string, SqlMigration>();
  const journalByIndex = new Map<number, JournalEntry>();
  const snapshotIndexes = new Set<string>();

  for (const migration of snapshot.sqlMigrations) {
    const existingByIndex = sqlByIndex.get(migration.index);
    if (existingByIndex !== undefined) {
      failures.push(
        `${label} ${snapshot.rootPath} has duplicate migration index ${migration.indexText}: ${existingByIndex.relativePath} and ${migration.relativePath}.`,
      );
    }

    const existingByTag = sqlByTag.get(migration.tag);
    if (existingByTag !== undefined) {
      failures.push(
        `${label} ${snapshot.rootPath} has duplicate migration tag ${migration.tag}: ${existingByTag.relativePath} and ${migration.relativePath}.`,
      );
    }

    sqlByIndex.set(migration.index, migration);
    sqlByTag.set(migration.tag, migration);
  }

  for (const entry of snapshot.journalEntries) {
    const existingEntry = journalByIndex.get(entry.idx);
    if (existingEntry !== undefined) {
      failures.push(
        `${label} ${snapshot.rootPath}/meta/_journal.json has duplicate idx ${formatIndex(entry.idx)}: ${existingEntry.tag} and ${entry.tag}.`,
      );
    }

    journalByIndex.set(entry.idx, entry);

    const migration = sqlByTag.get(entry.tag);
    if (migration === undefined) {
      failures.push(
        `${label} ${snapshot.rootPath}/meta/_journal.json entry ${entry.tag} has no matching SQL file.`,
      );
      continue;
    }

    if (migration.index !== entry.idx) {
      failures.push(
        `${label} ${snapshot.rootPath}/meta/_journal.json entry ${entry.tag} uses idx ${formatIndex(entry.idx)}, but the SQL file uses index ${migration.indexText}.`,
      );
    }
  }

  for (const migration of snapshot.sqlMigrations) {
    const journalEntry = journalByIndex.get(migration.index);
    if (journalEntry === undefined) {
      failures.push(
        `${label} ${migration.relativePath} has no matching journal entry with idx ${migration.indexText}.`,
      );
    } else if (journalEntry.tag !== migration.tag) {
      failures.push(
        `${label} ${migration.relativePath} conflicts with journal idx ${migration.indexText}: SQL tag ${migration.tag}, journal tag ${journalEntry.tag}.`,
      );
    }
  }

  for (const indexText of snapshot.snapshotIndexes) {
    if (snapshotIndexes.has(indexText)) {
      failures.push(
        `${label} ${snapshot.rootPath}/meta has duplicate snapshot index ${indexText}.`,
      );
    }

    snapshotIndexes.add(indexText);
  }

  for (const migration of snapshot.sqlMigrations) {
    if (!snapshotIndexes.has(migration.indexText)) {
      failures.push(
        `${label} ${migration.relativePath} has no matching meta/${migration.indexText}_snapshot.json.`,
      );
    }
  }

  return {
    journalByIndex,
    snapshotIndexes,
    sqlByIndex,
    sqlByTag,
  };
}

function findBaseComparisonFailures(input: {
  baseLabel: string;
  baseMaps: MigrationIndexMaps;
  currentMaps: MigrationIndexMaps;
  plane: MigrationPlaneName;
}): readonly string[] {
  const failures: string[] = [];
  const baseMaxIndex = findMaxIndex(input.baseMaps.sqlByIndex);

  for (const baseMigration of input.baseMaps.sqlByIndex.values()) {
    const currentMigration = input.currentMaps.sqlByIndex.get(baseMigration.index);
    if (currentMigration === undefined) {
      failures.push(
        `${input.plane} migration index ${baseMigration.indexText} from ${input.baseLabel} is missing in the current tree: ${baseMigration.relativePath}.`,
      );
      continue;
    }

    if (currentMigration.tag !== baseMigration.tag) {
      failures.push(
        [
          `${input.plane} migration index ${baseMigration.indexText} conflicts with ${input.baseLabel}:`,
          `current ${currentMigration.relativePath},`,
          `base ${baseMigration.relativePath}.`,
          "Regenerate the branch migration on top of the latest base migration.",
        ].join("\n"),
      );
    }
  }

  if (baseMaxIndex === null) {
    return failures;
  }

  for (const currentMigration of input.currentMaps.sqlByIndex.values()) {
    if (input.baseMaps.sqlByTag.has(currentMigration.tag)) {
      continue;
    }

    if (currentMigration.index <= baseMaxIndex) {
      failures.push(
        `${input.plane} migration ${currentMigration.relativePath} is new in the current tree but uses index ${currentMigration.indexText}, which is not greater than ${input.baseLabel}'s max migration index ${formatIndex(baseMaxIndex)}. Regenerate the branch migration on top of the latest base migration.`,
      );
    }
  }

  return failures;
}

function findMaxIndex(migrationsByIndex: ReadonlyMap<number, SqlMigration>): number | null {
  let maxIndex: number | null = null;

  for (const index of migrationsByIndex.keys()) {
    if (maxIndex === null || index > maxIndex) {
      maxIndex = index;
    }
  }

  return maxIndex;
}

function formatIndex(index: number): string {
  return index.toString().padStart(4, "0");
}

function parseCliArguments(argv: readonly string[]): ParsedCliArguments {
  let baseRef = DefaultBaseRef;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      throw new Error("Unexpected missing CLI argument.");
    }

    if (argument === "--base") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("Expected a git ref after --base.");
      }

      baseRef = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return { baseRef };
}

function checkMigrationSequences(): void {
  const { baseRef } = parseCliArguments(process.argv.slice(2));
  const failures: string[] = [];

  for (const plane of MigrationPlanes) {
    failures.push(
      ...findMigrationSequenceFailures({
        base: readBasePlaneSnapshot(plane, baseRef),
        baseLabel: baseRef,
        current: readCurrentPlaneSnapshot(plane),
        plane,
      }),
    );
  }

  if (failures.length !== 0) {
    throw new Error(["Migration sequence validation failed:", ...failures].join("\n\n"));
  }

  process.stdout.write(`Migration sequences are valid relative to ${baseRef}.\n`);
}

const entrypointUrl = process.argv[1] === undefined ? null : pathToFileURL(process.argv[1]).href;

if (entrypointUrl === import.meta.url) {
  checkMigrationSequences();
}
