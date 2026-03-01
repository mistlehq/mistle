import { existsSync } from "node:fs";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

export type RunPostgresMigrationsInput = {
  connectionString: string;
  schemaName: string;
  migrationsFolder: string;
  migrationsSchema: string;
  migrationsTable: string;
  /**
   * When true, ensures the target schema exists before running migrations.
   * Defaults to true.
   */
  ensureSchemaExists?: boolean;
};

/**
 * Runs Drizzle migrations against a Postgres schema.
 * The target schema can be created before migrations when enabled.
 */
export async function runPostgresMigrations(input: RunPostgresMigrationsInput): Promise<void> {
  const migrationJournalPath = join(input.migrationsFolder, "meta", "_journal.json");
  if (!existsSync(migrationJournalPath)) {
    throw new Error(
      `Migration journal file does not exist at "${migrationJournalPath}". Generate migrations with drizzle-kit before running migrator.`,
    );
  }

  const databaseClient = new Client({
    connectionString: input.connectionString,
  });
  await databaseClient.connect();

  try {
    const ensureSchemaExists = input.ensureSchemaExists ?? true;
    if (ensureSchemaExists) {
      await databaseClient.query(`create schema if not exists "${input.schemaName}"`);
    }

    const database = drizzle(databaseClient);

    await migrate(database, {
      migrationsFolder: input.migrationsFolder,
      migrationsSchema: input.migrationsSchema,
      migrationsTable: input.migrationsTable,
    });
  } finally {
    await databaseClient.end();
  }
}
