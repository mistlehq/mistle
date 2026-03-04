import { readFile } from "node:fs/promises";

import { AppIds, loadConfig } from "@mistle/config";
import { createControlPlaneDatabase, CONTROL_PLANE_SCHEMA_NAME } from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";
import { Pool } from "pg";

import { logger } from "../src/logger.js";
import {
  discoverIntegrationTargetProvisionManifestPath,
  parseIntegrationTargetsProvisionManifest,
  provisionIntegrationTargets,
  resolveRepositoryRootFromDirectory,
} from "./integration-targets/provision-integration-targets.js";
import { syncIntegrationTargets } from "./integration-targets/sync-integration-targets.js";

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

  logger.info("Control-plane migrations applied.");

  const dbPool = new Pool({
    connectionString: loadedConfig.app.database.url,
  });
  const db = createControlPlaneDatabase(dbPool);
  const integrationRegistry = createIntegrationRegistry();

  try {
    const syncedTargets = await syncIntegrationTargets(db, integrationRegistry);
    logger.info({ syncedTargets }, "Synced integration targets from integration registry.");

    const repositoryRoot = resolveRepositoryRootFromDirectory(process.cwd());
    const provisionManifestPath = discoverIntegrationTargetProvisionManifestPath({
      startDirectory: process.cwd(),
      repositoryRoot,
    });
    if (provisionManifestPath === undefined) {
      logger.info(
        "No integration target provision manifest found. Skipping integration target provision.",
      );
      return;
    }

    const provisionManifestContent = await readFile(provisionManifestPath, "utf8");
    const provisionManifest = parseIntegrationTargetsProvisionManifest(provisionManifestContent);

    const provisionedTargets = await provisionIntegrationTargets({
      db,
      integrationRegistry,
      integrationsConfig: {
        activeMasterEncryptionKeyVersion:
          loadedConfig.app.integrations.activeMasterEncryptionKeyVersion,
        masterEncryptionKeys: loadedConfig.app.integrations.masterEncryptionKeys,
      },
      manifest: provisionManifest,
    });

    logger.info(
      { provisionManifestPath, provisionedTargets },
      "Provisioned integration targets from manifest.",
    );
  } finally {
    await dbPool.end();
  }
}

void main().catch((error) => {
  logger.error({ err: error }, "Failed to run control-plane migrations");
  process.exit(1);
});
