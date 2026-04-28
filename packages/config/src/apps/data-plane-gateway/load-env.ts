import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  DataPlaneGatewayControlPlaneApiEnvDescriptors,
  DataPlaneGatewayDatabaseEnvDescriptors,
  DataPlaneGatewayDataPlaneApiEnvDescriptors,
  DataPlaneGatewayRuntimeStateEnvDescriptors,
  DataPlaneGatewayRuntimeStateValkeyEnvDescriptors,
  DataPlaneGatewayServerEnvDescriptors,
} from "./legacy-env-descriptors.js";
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

export {
  DataPlaneGatewayControlPlaneApiEnvDescriptors,
  DataPlaneGatewayDatabaseEnvDescriptors,
  DataPlaneGatewayDataPlaneApiEnvDescriptors,
  DataPlaneGatewayRuntimeStateEnvDescriptors,
  DataPlaneGatewayRuntimeStateValkeyEnvDescriptors,
  DataPlaneGatewayServerEnvDescriptors,
} from "./legacy-env-descriptors.js";

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
