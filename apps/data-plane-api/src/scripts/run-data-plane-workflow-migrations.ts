import { AppIds, DataPlaneApiWorkflowConfigSchema, loadConfigSection } from "@mistle/config";

import { logger } from "../logger.js";
import { createDataPlaneBackend } from "../openworkflow/index.js";

async function main(): Promise<void> {
  const workflowConfig = loadConfigSection({
    app: AppIds.DATA_PLANE_API,
    env: process.env,
    path: ["workflow"],
    schema: DataPlaneApiWorkflowConfigSchema,
  });

  const workflowBackend = await createDataPlaneBackend({
    url: workflowConfig.databaseUrl,
    namespaceId: workflowConfig.namespaceId,
    runMigrations: true,
  });

  await workflowBackend.stop();
  logger.info("Data-plane workflow migrations applied.");
}

void main().catch((error) => {
  logger.error({ err: error }, "Failed to run data-plane workflow migrations");
  process.exit(1);
});
