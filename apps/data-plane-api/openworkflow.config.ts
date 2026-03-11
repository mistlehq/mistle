import { AppIds, loadConfig } from "@mistle/config";
import { DataPlaneOpenWorkflow } from "@mistle/workflows/data-plane";
import { defineConfig } from "@openworkflow/cli";
import { BackendPostgres } from "openworkflow/postgres";

const loadedConfig = loadConfig({
  app: AppIds.DATA_PLANE_API,
  env: process.env,
  includeGlobal: false,
});

export default defineConfig({
  backend: await BackendPostgres.connect(loadedConfig.app.workflow.databaseUrl, {
    namespaceId: loadedConfig.app.workflow.namespaceId,
    runMigrations: false,
    schema: DataPlaneOpenWorkflow.SCHEMA,
  }),
  dirs: "./workflows",
});
