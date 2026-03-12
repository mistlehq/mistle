import { AppIds, loadConfig } from "@mistle/config";

import { logger } from "../logger.js";
import { createDataPlaneBackend } from "../openworkflow/index.js";

async function main(): Promise<void> {
  const loadedConfig = loadConfig({
    app: AppIds.DATA_PLANE_API,
    env: process.env,
    includeGlobal: false,
  });

  const workflowBackend = await createDataPlaneBackend({
    url: loadedConfig.app.workflow.databaseUrl,
    namespaceId: loadedConfig.app.workflow.namespaceId,
    runMigrations: true,
  });

  await workflowBackend.stop();
  logger.info("Data-plane workflow migrations applied.");
}

void main().catch((error) => {
  logger.error({ err: error }, "Failed to run data-plane workflow migrations");
  process.exit(1);
});
