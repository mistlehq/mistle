import { pathToFileURL } from "node:url";

import { AppIds, loadConfig } from "@mistle/config";
import { createControlPlaneDatabase } from "@mistle/db/control-plane";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";
import { Pool } from "pg";

import { logger } from "../src/logger.js";
import { syncIntegrationTargets } from "./integration-targets/sync-integration-targets.js";

async function main(): Promise<void> {
  const loadedConfig = loadConfig({
    app: AppIds.CONTROL_PLANE_API,
    env: process.env,
    includeGlobal: false,
  });

  const pool = new Pool({
    connectionString: loadedConfig.app.database.url,
  });
  const db = createControlPlaneDatabase(pool);
  const integrationRegistry = createIntegrationRegistry();

  try {
    const syncedTargets = await syncIntegrationTargets(db, integrationRegistry);

    logger.info(
      {
        syncedTargets,
      },
      "Synced integration targets from integration registry.",
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    logger.error({ err: error }, "Failed to sync integration targets");
    process.exit(1);
  });
}
