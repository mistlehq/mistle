import { AppIds, loadConfig } from "@mistle/config";
import { DATA_PLANE_SCHEMA_NAME } from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";

import { logger } from "../logger.js";

async function main(): Promise<void> {
  const loadedConfig = loadConfig({
    app: AppIds.DATA_PLANE_API,
    env: process.env,
    includeGlobal: false,
  });

  await runDataPlaneMigrations({
    connectionString: loadedConfig.app.database.migrationUrl,
    schemaName: DATA_PLANE_SCHEMA_NAME,
    migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
    migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
    migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
  });

  logger.info("Data-plane migrations applied.");
}

void main().catch((error) => {
  logger.error({ err: error }, "Failed to run data-plane migrations");
  process.exit(1);
});
