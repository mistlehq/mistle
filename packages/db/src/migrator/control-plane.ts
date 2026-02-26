import { fileURLToPath } from "node:url";

import { runPostgresMigrations, type RunPostgresMigrationsInput } from "./runner.js";

export type RunControlPlaneMigrationsInput = RunPostgresMigrationsInput;

export const CONTROL_PLANE_MIGRATIONS_FOLDER_PATH = fileURLToPath(
  new URL("../../migrations/control-plane", import.meta.url),
);

export async function runControlPlaneMigrations(
  input: RunControlPlaneMigrationsInput,
): Promise<void> {
  await runPostgresMigrations(input);
}
