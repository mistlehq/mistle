import { pathToFileURL } from "node:url";

import { AppIds, loadConfig } from "@mistle/config";
import { createControlPlaneDatabase } from "@mistle/db/control-plane";
import { Pool } from "pg";

import { seedDefaultIntegrationTargets } from "../integration-targets/services/seed-default-targets.js";
import { logger } from "../logger.js";

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

  try {
    const seededTargets = await seedDefaultIntegrationTargets(
      db,
      loadedConfig.app.integrations.targetCatalog,
    );

    logger.info(
      {
        seededTargets,
      },
      "Seeded integration targets.",
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    logger.error({ err: error }, "Failed to seed integration targets");
    process.exit(1);
  });
}
