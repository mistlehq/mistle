import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  DataPlaneGatewayDatabaseConfigSchema,
  DataPlaneGatewayDataPlaneApiConfigSchema,
  PartialDataPlaneGatewayRuntimeStateConfigSchema,
  PartialDataPlaneGatewayRuntimeStateValkeyConfigSchema,
  type PartialDataPlaneGatewayConfigInput,
  DataPlaneGatewayServerConfigSchema,
  PartialDataPlaneGatewayConfigSchema,
} from "./schema.js";

const loadServerEnv = createEnvLoader<typeof DataPlaneGatewayServerConfigSchema>([
  {
    key: "host",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_HOST",
  },
  {
    key: "port",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_PORT",
    parse: Number,
  },
]);

const loadDatabaseEnv = createEnvLoader<typeof DataPlaneGatewayDatabaseConfigSchema>([
  {
    key: "url",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_DATABASE_URL",
  },
]);

const loadRuntimeStateEnv = createEnvLoader<typeof PartialDataPlaneGatewayRuntimeStateConfigSchema>(
  [
    {
      key: "backend",
      envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_BACKEND",
    },
  ],
);

const loadRuntimeStateValkeyEnv = createEnvLoader<
  typeof PartialDataPlaneGatewayRuntimeStateValkeyConfigSchema
>([
  {
    key: "url",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_VALKEY_URL",
  },
  {
    key: "keyPrefix",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_VALKEY_KEY_PREFIX",
  },
]);

const loadDataPlaneApiEnv = createEnvLoader<typeof DataPlaneGatewayDataPlaneApiConfigSchema>([
  {
    key: "baseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_DATA_PLANE_API_BASE_URL",
  },
]);

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

  return PartialDataPlaneGatewayConfigSchema.parse(partialConfig);
}
