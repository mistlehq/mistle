import { AppIds, loadConfig } from "@mistle/config";
import { CONTROL_PLANE_SCHEMA_NAME } from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";

import { logger } from "../src/logger.js";

async function main(): Promise<void> {
  const loadedConfig = loadConfig({
    app: AppIds.CONTROL_PLANE_API,
    env: process.env,
    includeGlobal: false,
  });

  await runControlPlaneMigrations({
    connectionString: loadedConfig.app.database.migrationUrl,
    schemaName: CONTROL_PLANE_SCHEMA_NAME,
    migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
    migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
    migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
  });

  logger.info("Control-plane migrations applied.");
}

void main().catch((error) => {
  logger.error({ err: error }, "Failed to run control-plane migrations");
  process.exit(1);
});
