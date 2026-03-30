import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  type PartialDataPlaneApiConfigInput,
  DataPlaneApiDatabaseConfigSchema,
  DataPlaneApiRuntimeStateConfigSchema,
  DataPlaneApiSandboxDockerConfigSchema,
  DataPlaneApiSandboxE2BConfigSchema,
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
  {
    key: "migrationUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_API_DATABASE_MIGRATION_URL",
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

const loadSandboxDockerEnv = createEnvLoader<typeof DataPlaneApiSandboxDockerConfigSchema>([
  {
    key: "socketPath",
    envVar: "MISTLE_APPS_DATA_PLANE_API_SANDBOX_DOCKER_SOCKET_PATH",
  },
]);

const loadSandboxE2BEnv = createEnvLoader<typeof DataPlaneApiSandboxE2BConfigSchema>([
  {
    key: "apiKey",
    envVar: "MISTLE_APPS_DATA_PLANE_API_SANDBOX_E2B_API_KEY",
  },
  {
    key: "domain",
    envVar: "MISTLE_APPS_DATA_PLANE_API_SANDBOX_E2B_DOMAIN",
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

  const sandboxDocker = loadSandboxDockerEnv(env);
  const sandboxE2B = loadSandboxE2BEnv(env);
  if (hasEntries(sandboxDocker) || hasEntries(sandboxE2B)) {
    partialConfig.sandbox = {
      ...(hasEntries(sandboxDocker) ? { docker: sandboxDocker } : {}),
      ...(hasEntries(sandboxE2B) ? { e2b: sandboxE2B } : {}),
    };
  }

  return PartialDataPlaneApiConfigSchema.parse(partialConfig);
}
