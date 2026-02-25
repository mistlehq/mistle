import { AppIds, loadConfig } from "@mistle/config";
import { CONTROL_PLANE_SCHEMA_NAME } from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";

async function main(): Promise<void> {
  const loadedConfig = loadConfig({
    app: AppIds.CONTROL_PLANE_API,
    env: process.env,
    includeGlobal: false,
  });

  await runControlPlaneMigrations({
    connectionString: loadedConfig.app.database.url,
    schemaName: CONTROL_PLANE_SCHEMA_NAME,
    migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
    migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
    migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
  });

  console.log("Control-plane migrations applied.");
}

void main().catch((error) => {
  if (error instanceof Error) {
    console.error("Failed to run control-plane migrations:", error.message);
  } else {
    console.error("Failed to run control-plane migrations:", String(error));
  }

  process.exit(1);
});
