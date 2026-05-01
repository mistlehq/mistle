import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_PLANE_SCHEMA_NAME } from "../data-plane/schema/namespace.js";
import { runPostgresMigrations, type RunPostgresMigrationsInput } from "./runner.js";

export type RunDataPlaneMigrationsInput = RunPostgresMigrationsInput;

export const DATA_PLANE_MIGRATIONS_FOLDER_PATH = fileURLToPath(
  new URL("../../migrations/data-plane", import.meta.url),
);

export async function runDataPlaneMigrations(input: RunDataPlaneMigrationsInput): Promise<void> {
  if (input.schemaName !== DATA_PLANE_SCHEMA_NAME) {
    const rewrittenMigrationsFolder = await createSchemaScopedMigrationsFolder({
      sourceFolder: input.migrationsFolder,
      schemaName: input.schemaName,
    });

    try {
      await runPostgresMigrations({
        ...input,
        migrationsFolder: rewrittenMigrationsFolder,
        ensureSchemaExists: false,
      });
    } finally {
      await rm(rewrittenMigrationsFolder, {
        force: true,
        recursive: true,
      });
    }

    return;
  }

  await runPostgresMigrations({
    ...input,
    ensureSchemaExists: false,
  });
}

async function createSchemaScopedMigrationsFolder(input: {
  sourceFolder: string;
  schemaName: string;
}): Promise<string> {
  const targetFolder = await mkdtemp(
    join(tmpdir(), `${basename(input.sourceFolder)}-${input.schemaName}-`),
  );

  await copyMigrationsWithSchemaName({
    sourceFolder: input.sourceFolder,
    targetFolder,
    schemaName: input.schemaName,
  });

  return targetFolder;
}

async function copyMigrationsWithSchemaName(input: {
  sourceFolder: string;
  targetFolder: string;
  schemaName: string;
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
        schemaName: input.schemaName,
      });
      continue;
    }

    const fileContents = await readFile(sourcePath, "utf8");
    const targetContents = entry.name.endsWith(".sql")
      ? rewriteDataPlaneSchemaReferences({
          sqlText: fileContents,
          schemaName: input.schemaName,
        })
      : fileContents;

    await writeFile(targetPath, targetContents);
  }
}

function rewriteDataPlaneSchemaReferences(input: { sqlText: string; schemaName: string }): string {
  return input.sqlText.replaceAll(
    quoteSqlIdentifier(DATA_PLANE_SCHEMA_NAME),
    quoteSqlIdentifier(input.schemaName),
  );
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
