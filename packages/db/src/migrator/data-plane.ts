import { fileURLToPath } from "node:url";

import { DATA_PLANE_SCHEMA_NAME } from "../data-plane/schema/namespace.js";
import { type RunPostgresMigrationsInput } from "./runner.js";
import { runSchemaScopedPostgresMigrations } from "./schema-scoped-migrations.js";

export type RunDataPlaneMigrationsInput = RunPostgresMigrationsInput;

export const DATA_PLANE_MIGRATIONS_FOLDER_PATH = fileURLToPath(
  new URL("../../migrations/data-plane", import.meta.url),
);

export async function runDataPlaneMigrations(input: RunDataPlaneMigrationsInput): Promise<void> {
  await runSchemaScopedPostgresMigrations({
    defaultSchemaName: DATA_PLANE_SCHEMA_NAME,
    migrations: {
      ...input,
      ensureSchemaExists: false,
    },
  });
}
