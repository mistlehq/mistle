import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { runPostgresMigrations, type RunPostgresMigrationsInput } from "./runner.js";

export async function runSchemaScopedPostgresMigrations(input: {
  defaultSchemaName: string;
  migrations: RunPostgresMigrationsInput;
}): Promise<void> {
  if (input.migrations.schemaName === input.defaultSchemaName) {
    await runPostgresMigrations(input.migrations);
    return;
  }

  const rewrittenMigrationsFolder = await createSchemaScopedMigrationsFolder({
    sourceFolder: input.migrations.migrationsFolder,
    sourceSchemaName: input.defaultSchemaName,
    targetSchemaName: input.migrations.schemaName,
  });

  try {
    await runPostgresMigrations({
      ...input.migrations,
      migrationsFolder: rewrittenMigrationsFolder,
    });
  } finally {
    await rm(rewrittenMigrationsFolder, {
      force: true,
      recursive: true,
    });
  }
}

async function createSchemaScopedMigrationsFolder(input: {
  sourceFolder: string;
  sourceSchemaName: string;
  targetSchemaName: string;
}): Promise<string> {
  const targetFolder = await mkdtemp(
    join(tmpdir(), `${basename(input.sourceFolder)}-${input.targetSchemaName}-`),
  );

  await copyMigrationsWithSchemaName({
    sourceFolder: input.sourceFolder,
    targetFolder,
    sourceSchemaName: input.sourceSchemaName,
    targetSchemaName: input.targetSchemaName,
  });

  return targetFolder;
}

async function copyMigrationsWithSchemaName(input: {
  sourceFolder: string;
  targetFolder: string;
  sourceSchemaName: string;
  targetSchemaName: string;
}): Promise<void> {
  await mkdir(input.targetFolder, {
    recursive: true,
  });

  const entries = await readdir(input.sourceFolder, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const sourcePath = join(input.sourceFolder, entry.name);
    const targetPath = join(input.targetFolder, entry.name);

    if (entry.isDirectory()) {
      await copyMigrationsWithSchemaName({
        sourceFolder: sourcePath,
        targetFolder: targetPath,
        sourceSchemaName: input.sourceSchemaName,
        targetSchemaName: input.targetSchemaName,
      });
      continue;
    }

    const fileContents = await readFile(sourcePath, "utf8");
    const targetContents = entry.name.endsWith(".sql")
      ? rewriteSchemaReferences({
          sqlText: fileContents,
          sourceSchemaName: input.sourceSchemaName,
          targetSchemaName: input.targetSchemaName,
        })
      : fileContents;

    await writeFile(targetPath, targetContents);
  }
}

function rewriteSchemaReferences(input: {
  sqlText: string;
  sourceSchemaName: string;
  targetSchemaName: string;
}): string {
  return input.sqlText.replaceAll(
    quoteSqlIdentifier(input.sourceSchemaName),
    quoteSqlIdentifier(input.targetSchemaName),
  );
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
