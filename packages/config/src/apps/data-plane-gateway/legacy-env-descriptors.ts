import { createEnvLoader } from "../../core/load-env.js";
import {
  DataPlaneGatewayControlPlaneApiConfigSchema,
  DataPlaneGatewayDatabaseConfigSchema,
  DataPlaneGatewayDataPlaneApiConfigSchema,
  PartialDataPlaneGatewayRuntimeStateConfigSchema,
  PartialDataPlaneGatewayRuntimeStateValkeyConfigSchema,
  DataPlaneGatewayServerConfigSchema,
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
