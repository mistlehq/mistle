import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  DataPlaneGatewayControlPlaneApiConfigSchema,
  DataPlaneGatewayDatabaseConfigSchema,
  DataPlaneGatewayDataPlaneApiConfigSchema,
  PartialDataPlaneGatewayRuntimeStateConfigSchema,
  PartialDataPlaneGatewayRuntimeStateValkeyConfigSchema,
  type PartialDataPlaneGatewayConfigInput,
  DataPlaneGatewayServerConfigSchema,
  PartialDataPlaneGatewayConfigSchema,
} from "./schema.js";

export const DataPlaneGatewayServerEnvDescriptors = [
  {
    key: "host",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_HOST",
  },
  {
    key: "port",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_PORT",
    parse: Number,
  },
] satisfies Parameters<typeof createEnvLoader<typeof DataPlaneGatewayServerConfigSchema>>[0];

export const DataPlaneGatewayDatabaseEnvDescriptors = [
  {
    key: "url",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_DATABASE_URL",
  },
] satisfies Parameters<typeof createEnvLoader<typeof DataPlaneGatewayDatabaseConfigSchema>>[0];

export const DataPlaneGatewayRuntimeStateEnvDescriptors = [
  {
    key: "backend",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_BACKEND",
  },
] satisfies Parameters<
  typeof createEnvLoader<typeof PartialDataPlaneGatewayRuntimeStateConfigSchema>
>[0];

export const DataPlaneGatewayRuntimeStateValkeyEnvDescriptors = [
  {
    key: "url",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_VALKEY_URL",
  },
  {
    key: "keyPrefix",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_VALKEY_KEY_PREFIX",
  },
] satisfies Parameters<
  typeof createEnvLoader<typeof PartialDataPlaneGatewayRuntimeStateValkeyConfigSchema>
>[0];

export const DataPlaneGatewayDataPlaneApiEnvDescriptors = [
  {
    key: "baseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_DATA_PLANE_API_BASE_URL",
  },
] satisfies Parameters<typeof createEnvLoader<typeof DataPlaneGatewayDataPlaneApiConfigSchema>>[0];

export const DataPlaneGatewayControlPlaneApiEnvDescriptors = [
  {
    key: "baseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_CONTROL_PLANE_API_BASE_URL",
  },
] satisfies Parameters<
  typeof createEnvLoader<typeof DataPlaneGatewayControlPlaneApiConfigSchema>
>[0];

const loadServerEnv = createEnvLoader<typeof DataPlaneGatewayServerConfigSchema>(
  DataPlaneGatewayServerEnvDescriptors,
);
const loadDatabaseEnv = createEnvLoader<typeof DataPlaneGatewayDatabaseConfigSchema>(
  DataPlaneGatewayDatabaseEnvDescriptors,
);
const loadRuntimeStateEnv = createEnvLoader<typeof PartialDataPlaneGatewayRuntimeStateConfigSchema>(
  DataPlaneGatewayRuntimeStateEnvDescriptors,
);
const loadRuntimeStateValkeyEnv = createEnvLoader<
  typeof PartialDataPlaneGatewayRuntimeStateValkeyConfigSchema
>(DataPlaneGatewayRuntimeStateValkeyEnvDescriptors);
const loadDataPlaneApiEnv = createEnvLoader<typeof DataPlaneGatewayDataPlaneApiConfigSchema>(
  DataPlaneGatewayDataPlaneApiEnvDescriptors,
);
const loadControlPlaneApiEnv = createEnvLoader<typeof DataPlaneGatewayControlPlaneApiConfigSchema>(
  DataPlaneGatewayControlPlaneApiEnvDescriptors,
);

export function loadDataPlaneGatewayFromEnv(
  env: NodeJS.ProcessEnv,
): PartialDataPlaneGatewayConfigInput {
  const partialConfig: PartialDataPlaneGatewayConfigInput = {};

  const server = loadServerEnv(env);
  if (hasEntries(server)) {
    partialConfig.server = server;
  }

  const database = loadDatabaseEnv(env);
  if (hasEntries(database)) {
    partialConfig.database = database;
  }

  const runtimeState = loadRuntimeStateEnv(env);
  const runtimeStateValkey = loadRuntimeStateValkeyEnv(env);
  if (hasEntries(runtimeState) || hasEntries(runtimeStateValkey)) {
    partialConfig.runtimeState = {
      ...runtimeState,
      ...(hasEntries(runtimeStateValkey)
        ? {
            valkey: runtimeStateValkey,
          }
        : {}),
    };
  }

  const dataPlaneApi = loadDataPlaneApiEnv(env);
  if (hasEntries(dataPlaneApi)) {
    partialConfig.dataPlaneApi = dataPlaneApi;
  }

  const controlPlaneApi = loadControlPlaneApiEnv(env);
  if (hasEntries(controlPlaneApi)) {
    partialConfig.controlPlaneApi = controlPlaneApi;
  }

  return PartialDataPlaneGatewayConfigSchema.parse(partialConfig);
}
