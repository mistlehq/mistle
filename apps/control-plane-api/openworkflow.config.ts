import { AppIds, loadConfig } from "@mistle/config";
import { defineConfig } from "@openworkflow/cli";
import { BackendPostgres } from "openworkflow/postgres";

import { ControlPlaneOpenWorkflowSchema } from "./workflows/constants.js";

const loadedConfig = loadConfig({
  app: AppIds.CONTROL_PLANE_API,
  env: process.env,
  includeGlobal: false,
});

export default defineConfig({
  backend: await BackendPostgres.connect(loadedConfig.app.workflow.databaseUrl, {
    namespaceId: loadedConfig.app.workflow.namespaceId,
    runMigrations: false,
    schema: ControlPlaneOpenWorkflowSchema,
  }),
  dirs: "./workflows",
});
