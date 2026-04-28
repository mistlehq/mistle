import { createEnvLoader } from "../../core/load-env.js";
import {
  DataPlaneApiControlPlaneApiConfigSchema,
  DataPlaneApiDatabaseConfigSchema,
  DataPlaneApiRuntimeStateConfigSchema,
  DataPlaneApiSandboxDockerConfigSchema,
  DataPlaneApiSandboxE2BConfigSchema,
  DataPlaneApiServerConfigSchema,
  DataPlaneApiWorkflowConfigSchema,
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
    key: "migrationUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_API_WORKFLOW_MIGRATION_URL",
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
