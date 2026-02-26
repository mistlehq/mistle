import { AppIds, loadConfig } from "@mistle/config";
import { DATA_PLANE_SCHEMA_NAME } from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";

async function main(): Promise<void> {
  const loadedConfig = loadConfig({
    app: AppIds.DATA_PLANE_API,
    env: process.env,
    includeGlobal: false,
  });

  await runDataPlaneMigrations({
    connectionString: loadedConfig.app.database.url,
    schemaName: DATA_PLANE_SCHEMA_NAME,
    migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
    migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
    migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
  });

  console.log("Data-plane migrations applied.");
}

void main().catch((error) => {
  if (error instanceof Error) {
    console.error("Failed to run data-plane migrations:", error.message);
  } else {
    console.error("Failed to run data-plane migrations:", String(error));
  }

  process.exit(1);
});
