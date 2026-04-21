import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  DataPlaneGatewayControlPlaneApiConfigSchema,
  DataPlaneGatewayDatabaseConfigSchema,
  DataPlaneGatewayDataPlaneApiConfigSchema,
  PartialDataPlaneGatewayLifecycleConfigSchema,
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

const loadControlPlaneApiEnv = createEnvLoader<typeof DataPlaneGatewayControlPlaneApiConfigSchema>([
  {
    key: "baseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_CONTROL_PLANE_API_BASE_URL",
  },
]);

const loadLifecycleEnv = createEnvLoader<typeof PartialDataPlaneGatewayLifecycleConfigSchema>([
  {
    key: "idleTimeoutMs",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_LIFECYCLE_IDLE_TIMEOUT_MS",
    parse: Number,
  },
  {
    key: "bootstrapDisconnectGraceMs",
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_LIFECYCLE_BOOTSTRAP_DISCONNECT_GRACE_MS",
    parse: Number,
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

  const controlPlaneApi = loadControlPlaneApiEnv(env);
  if (hasEntries(controlPlaneApi)) {
    partialConfig.controlPlaneApi = controlPlaneApi;
  }

  const lifecycle = loadLifecycleEnv(env);
  if (hasEntries(lifecycle)) {
    partialConfig.lifecycle = lifecycle;
  }

  return PartialDataPlaneGatewayConfigSchema.parse(partialConfig);
}
