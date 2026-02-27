import { createEnvLoader, hasEntries, parseBooleanEnv } from "../../core/load-env.js";
import {
  type PartialDataPlaneWorkerConfigInput,
  DataPlaneWorkerDatabaseConfigSchema,
  DataPlaneWorkerSandboxConfigSchema,
  DataPlaneWorkerSandboxModalConfigSchema,
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

const loadSandboxModalEnv = createEnvLoader<typeof DataPlaneWorkerSandboxModalConfigSchema>([
  {
    key: "tokenId",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_MODAL_TOKEN_ID",
  },
  {
    key: "tokenSecret",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_MODAL_TOKEN_SECRET",
  },
  {
    key: "appName",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_MODAL_APP_NAME",
  },
  {
    key: "environmentName",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_MODAL_ENVIRONMENT_NAME",
  },
]);

const loadSandboxEnv = createEnvLoader<typeof DataPlaneWorkerSandboxConfigSchema>([
  {
    key: "provider",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_PROVIDER",
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

  const sandbox = loadSandboxEnv(env);
  const sandboxModal = loadSandboxModalEnv(env);
  if (hasEntries(sandbox) || hasEntries(sandboxModal)) {
    partialConfig.sandbox = {
      ...sandbox,
      ...(hasEntries(sandboxModal) ? { modal: sandboxModal } : {}),
    };
  }

  return PartialDataPlaneWorkerConfigSchema.parse(partialConfig);
}
