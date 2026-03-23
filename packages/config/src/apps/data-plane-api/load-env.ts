import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  type PartialDataPlaneApiConfigInput,
  DataPlaneApiDatabaseConfigSchema,
  DataPlaneApiRuntimeStateConfigSchema,
  DataPlaneApiServerConfigSchema,
  DataPlaneApiWorkflowConfigSchema,
  PartialDataPlaneApiConfigSchema,
} from "./schema.js";

const loadServerEnv = createEnvLoader<typeof DataPlaneApiServerConfigSchema>([
  {
    key: "host",
    envVar: "MISTLE_APPS_DATA_PLANE_API_HOST",
  },
  {
    key: "port",
    envVar: "MISTLE_APPS_DATA_PLANE_API_PORT",
    parse: Number,
  },
]);

const loadDatabaseEnv = createEnvLoader<typeof DataPlaneApiDatabaseConfigSchema>([
  {
    key: "url",
    envVar: "MISTLE_APPS_DATA_PLANE_API_DATABASE_URL",
  },
]);

const loadWorkflowEnv = createEnvLoader<typeof DataPlaneApiWorkflowConfigSchema>([
  {
    key: "databaseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_API_WORKFLOW_DATABASE_URL",
  },
  {
    key: "namespaceId",
    envVar: "MISTLE_APPS_DATA_PLANE_API_WORKFLOW_NAMESPACE_ID",
  },
]);

const loadRuntimeStateEnv = createEnvLoader<typeof DataPlaneApiRuntimeStateConfigSchema>([
  {
    key: "gatewayBaseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_API_RUNTIME_STATE_GATEWAY_BASE_URL",
  },
]);

export function loadDataPlaneApiFromEnv(env: NodeJS.ProcessEnv): PartialDataPlaneApiConfigInput {
  const partialConfig: PartialDataPlaneApiConfigInput = {};

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

  const runtimeState = loadRuntimeStateEnv(env);
  if (hasEntries(runtimeState)) {
    partialConfig.runtimeState = runtimeState;
  }

  return PartialDataPlaneApiConfigSchema.parse(partialConfig);
}
