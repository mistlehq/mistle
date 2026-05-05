import { createControlPlaneDatabase } from "@mistle/db/control-plane";
import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";
import { Pool } from "pg";

import { logger } from "../src/logger.js";
import { loadIntegrationTargetsSyncConfigFromModuleUrl } from "./integration-targets-sync-config-path.js";
import {
  loadIntegrationTargetsManifest,
  seedIntegrationTargets,
} from "./integration-targets/seed-integration-targets.js";
import { syncIntegrationTargets } from "./integration-targets/sync-integration-targets.js";
import { isDirectEntrypoint } from "./script-entrypoint.js";

async function main(): Promise<void> {
  const loadedConfig = loadIntegrationTargetsSyncConfigFromModuleUrl({
    environment: process.env,
    moduleUrl: import.meta.url,
  });

  const pool = new Pool({
    connectionString: loadedConfig.databaseUrl,
  });
  const db = createControlPlaneDatabase(
    pool,
    loadedConfig.schemaName === undefined ? undefined : { schemaName: loadedConfig.schemaName },
  );
  const integrationRegistry = createIntegrationRegistry();

  try {
    const syncedTargets = await syncIntegrationTargets(db, integrationRegistry);
    logger.info(
      {
        syncedTargets,
      },
      "Synced integration targets from integration registry.",
    );

    const loadedManifest = loadIntegrationTargetsManifest({
      env: process.env,
      startDirectory: process.cwd(),
    });
    if (loadedManifest === undefined) {
      logger.info("No integration target manifest found. Sync completed without target seeding.");
      return;
    }

    const seededTargets = await seedIntegrationTargets({
      db,
      integrationRegistry,
      manifest: loadedManifest.manifest,
    });

    logger.info(
      {
        manifestSource: loadedManifest.source,
        manifestSourceValue: loadedManifest.sourceValue,
        seededTargets,
      },
      "Seeded integration targets from manifest.",
    );
  } finally {
    await pool.end();
  }
}

if (isDirectEntrypoint({ argvPath: process.argv[1], moduleUrl: import.meta.url })) {
  void main().catch((error) => {
    logger.error({ err: error }, "Failed to sync integration targets");
    process.exit(1);
  });
}
