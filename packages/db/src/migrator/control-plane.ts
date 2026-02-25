import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

export type RunControlPlaneMigrationsInput = {
  connectionString: string;
  schemaName: string;
  migrationsFolder: string;
  migrationsSchema: string;
  migrationsTable: string;
};

export const CONTROL_PLANE_MIGRATIONS_FOLDER_PATH = fileURLToPath(
  new URL("../../migrations/control-plane", import.meta.url),
);

export async function runControlPlaneMigrations(
  input: RunControlPlaneMigrationsInput,
): Promise<void> {
  const databaseClient = new Client({
    connectionString: input.connectionString,
  });
  await databaseClient.connect();

  try {
    await databaseClient.query(`create schema if not exists "${input.schemaName}"`);

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
