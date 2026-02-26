import { createEnvLoader, hasEntries, parseBooleanEnv } from "../../core/load-env.js";
import {
  type PartialDataPlaneWorkerConfigInput,
  DataPlaneWorkerDatabaseConfigSchema,
  DataPlaneWorkerServerConfigSchema,
  DataPlaneWorkerWorkflowConfigSchema,
  PartialDataPlaneWorkerConfigSchema,
} from "./schema.js";

const loadServerEnv = createEnvLoader<typeof DataPlaneWorkerServerConfigSchema>([
  {
    key: "host",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_HOST",
  },
  {
    key: "port",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_PORT",
    parse: Number,
  },
]);

const loadDatabaseEnv = createEnvLoader<typeof DataPlaneWorkerDatabaseConfigSchema>([
  {
    key: "url",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL",
  },
]);

const loadWorkflowEnv = createEnvLoader<typeof DataPlaneWorkerWorkflowConfigSchema>([
  {
    key: "databaseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL",
  },
  {
    key: "namespaceId",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID",
  },
  {
    key: "runMigrations",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS",
    parse: (value) =>
      parseBooleanEnv(value, "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS"),
  },
  {
    key: "concurrency",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY",
    parse: Number,
  },
]);

export function loadDataPlaneWorkerFromEnv(
  env: NodeJS.ProcessEnv,
): PartialDataPlaneWorkerConfigInput {
  const partialConfig: PartialDataPlaneWorkerConfigInput = {};

  const server = loadServerEnv(env);
  if (hasEntries(server)) {
    partialConfig.server = server;
  }

  const database = loadDatabaseEnv(env);
  if (hasEntries(database)) {
    partialConfig.database = database;
  }

  const workflow = loadWorkflowEnv(env);
  if (hasEntries(workflow)) {
    partialConfig.workflow = workflow;
  }

  return PartialDataPlaneWorkerConfigSchema.parse(partialConfig);
}
