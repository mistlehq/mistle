import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  DataPlaneGatewayDatabaseConfigSchema,
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

  return PartialDataPlaneGatewayConfigSchema.parse(partialConfig);
}
