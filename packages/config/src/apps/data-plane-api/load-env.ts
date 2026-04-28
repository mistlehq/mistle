import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  type PartialDataPlaneApiConfigInput,
  DataPlaneApiControlPlaneApiConfigSchema,
  DataPlaneApiDatabaseConfigSchema,
  DataPlaneApiRuntimeStateConfigSchema,
  DataPlaneApiSandboxDockerConfigSchema,
  DataPlaneApiSandboxE2BConfigSchema,
  DataPlaneApiServerConfigSchema,
  DataPlaneApiWorkflowConfigSchema,
  PartialDataPlaneApiConfigSchema,
} from "./schema.js";

export const DataPlaneApiServerEnvDescriptors = [
  {
    key: "host",
    envVar: "MISTLE_APPS_DATA_PLANE_API_HOST",
  },
  {
    key: "port",
    envVar: "MISTLE_APPS_DATA_PLANE_API_PORT",
    parse: Number,
  },
] satisfies Parameters<typeof createEnvLoader<typeof DataPlaneApiServerConfigSchema>>[0];

export const DataPlaneApiDatabaseEnvDescriptors = [
  {
    key: "url",
    envVar: "MISTLE_APPS_DATA_PLANE_API_DATABASE_URL",
  },
  {
    key: "migrationUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_API_DATABASE_MIGRATION_URL",
  },
] satisfies Parameters<typeof createEnvLoader<typeof DataPlaneApiDatabaseConfigSchema>>[0];

export const DataPlaneApiWorkflowEnvDescriptors = [
  {
    key: "databaseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_API_WORKFLOW_DATABASE_URL",
  },
  {
    key: "namespaceId",
    envVar: "MISTLE_APPS_DATA_PLANE_API_WORKFLOW_NAMESPACE_ID",
  },
] satisfies Parameters<typeof createEnvLoader<typeof DataPlaneApiWorkflowConfigSchema>>[0];

export const DataPlaneApiRuntimeStateEnvDescriptors = [
  {
    key: "gatewayBaseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_API_RUNTIME_STATE_GATEWAY_BASE_URL",
  },
] satisfies Parameters<typeof createEnvLoader<typeof DataPlaneApiRuntimeStateConfigSchema>>[0];

export const DataPlaneApiControlPlaneApiEnvDescriptors = [
  {
    key: "baseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_API_CONTROL_PLANE_API_BASE_URL",
  },
] satisfies Parameters<typeof createEnvLoader<typeof DataPlaneApiControlPlaneApiConfigSchema>>[0];

export const DataPlaneApiSandboxDockerEnvDescriptors = [
  {
    key: "socketPath",
    envVar: "MISTLE_APPS_DATA_PLANE_API_SANDBOX_DOCKER_SOCKET_PATH",
  },
] satisfies Parameters<typeof createEnvLoader<typeof DataPlaneApiSandboxDockerConfigSchema>>[0];

export const DataPlaneApiSandboxE2BEnvDescriptors = [
  {
    key: "apiKey",
    envVar: "MISTLE_APPS_DATA_PLANE_API_SANDBOX_E2B_API_KEY",
  },
  {
    key: "domain",
    envVar: "MISTLE_APPS_DATA_PLANE_API_SANDBOX_E2B_DOMAIN",
  },
] satisfies Parameters<typeof createEnvLoader<typeof DataPlaneApiSandboxE2BConfigSchema>>[0];

const loadServerEnv = createEnvLoader<typeof DataPlaneApiServerConfigSchema>(
  DataPlaneApiServerEnvDescriptors,
);
const loadDatabaseEnv = createEnvLoader<typeof DataPlaneApiDatabaseConfigSchema>(
  DataPlaneApiDatabaseEnvDescriptors,
);
const loadWorkflowEnv = createEnvLoader<typeof DataPlaneApiWorkflowConfigSchema>(
  DataPlaneApiWorkflowEnvDescriptors,
);
const loadRuntimeStateEnv = createEnvLoader<typeof DataPlaneApiRuntimeStateConfigSchema>(
  DataPlaneApiRuntimeStateEnvDescriptors,
);
const loadControlPlaneApiEnv = createEnvLoader<typeof DataPlaneApiControlPlaneApiConfigSchema>(
  DataPlaneApiControlPlaneApiEnvDescriptors,
);
const loadSandboxDockerEnv = createEnvLoader<typeof DataPlaneApiSandboxDockerConfigSchema>(
  DataPlaneApiSandboxDockerEnvDescriptors,
);
const loadSandboxE2BEnv = createEnvLoader<typeof DataPlaneApiSandboxE2BConfigSchema>(
  DataPlaneApiSandboxE2BEnvDescriptors,
);

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

  const controlPlaneApi = loadControlPlaneApiEnv(env);
  if (hasEntries(controlPlaneApi)) {
    partialConfig.controlPlaneApi = controlPlaneApi;
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
