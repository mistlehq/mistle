import { AppIds, loadConfig } from "@mistle/config";

import { logger } from "../src/logger.js";
import { createControlPlaneBackend } from "../src/openworkflow/index.js";

async function main(): Promise<void> {
  const loadedConfig = loadConfig({
    app: AppIds.CONTROL_PLANE_API,
    env: process.env,
    includeGlobal: false,
  });

  const workflowBackend = await createControlPlaneBackend({
    url: loadedConfig.app.workflow.databaseUrl,
    namespaceId: loadedConfig.app.workflow.namespaceId,
    runMigrations: true,
  });

  await workflowBackend.stop();
  logger.info("Control-plane workflow migrations applied.");
}

void main().catch((error) => {
  logger.error({ err: error }, "Failed to run control-plane workflow migrations");
  process.exit(1);
});
