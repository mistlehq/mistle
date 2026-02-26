import { fileURLToPath } from "node:url";

import { runPostgresMigrations, type RunPostgresMigrationsInput } from "./runner.js";

export type RunDataPlaneMigrationsInput = RunPostgresMigrationsInput;

export const DATA_PLANE_MIGRATIONS_FOLDER_PATH = fileURLToPath(
  new URL("../../migrations/data-plane", import.meta.url),
);

export async function runDataPlaneMigrations(input: RunDataPlaneMigrationsInput): Promise<void> {
  await runPostgresMigrations(input);
}
