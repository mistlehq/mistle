import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

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
  const pool = new Pool({
    connectionString: input.connectionString,
  });

  try {
    await pool.query(`create schema if not exists "${input.schemaName}"`);

    const database = drizzle(pool);

    await migrate(database, {
      migrationsFolder: input.migrationsFolder,
      migrationsSchema: input.migrationsSchema,
      migrationsTable: input.migrationsTable,
    });
  } finally {
    await pool.end();
  }
}
