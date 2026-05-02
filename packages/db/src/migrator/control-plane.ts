import { fileURLToPath } from "node:url";

import { CONTROL_PLANE_SCHEMA_NAME } from "../control-plane/schema/namespace.js";
import { type RunPostgresMigrationsInput } from "./runner.js";
import { runSchemaScopedPostgresMigrations } from "./schema-scoped-migrations.js";

export type RunControlPlaneMigrationsInput = RunPostgresMigrationsInput;

export const CONTROL_PLANE_MIGRATIONS_FOLDER_PATH = fileURLToPath(
  new URL("../../migrations/control-plane", import.meta.url),
);

export async function runControlPlaneMigrations(
  input: RunControlPlaneMigrationsInput,
): Promise<void> {
  await runSchemaScopedPostgresMigrations({
    defaultSchemaName: CONTROL_PLANE_SCHEMA_NAME,
    migrations: input,
  });
}
