import { createEnvLoader, parseBooleanEnv } from "../core/load-env.js";
import {
  PartialGlobalTelemetryConfigSchema,
  PartialGlobalConfigSchema,
  PartialGlobalSandboxConfigSchema,
  PartialGlobalSandboxPublishConfigSchema,
  PartialGlobalSandboxStorageConfigSchema,
  GlobalSandboxTokenConfigSchema,
  GlobalSandboxPublishSessionConfigSchema,
} from "./schema.js";

export const GlobalEnvDescriptors = [
  {
    key: "env",
    envVar: "NODE_ENV",
    parse: (value) => (value === "production" ? "production" : "development"),
  },
  {
    key: "internalAuth",
    envVar: "MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN",
    projectionPath: ["internalAuth", "serviceToken"],
    parse: (value) => ({
      serviceToken: value,
    }),
  },
] satisfies Parameters<typeof createEnvLoader<typeof PartialGlobalConfigSchema>>[0];

export const GlobalTelemetryEnvDescriptors = [
  {
    key: "enabled",
    envVar: "MISTLE_GLOBAL_TELEMETRY_ENABLED",
    parse: (value) => parseBooleanEnv(value, "MISTLE_GLOBAL_TELEMETRY_ENABLED"),
  },
  {
    key: "debug",
    envVar: "MISTLE_GLOBAL_TELEMETRY_DEBUG",
    parse: (value) => parseBooleanEnv(value, "MISTLE_GLOBAL_TELEMETRY_DEBUG"),
  },
  {
    key: "traces",
    envVar: "MISTLE_GLOBAL_TELEMETRY_TRACES_ENDPOINT",
    projectionPath: ["traces", "endpoint"],
    parse: (value) => ({
      endpoint: value,
    }),
  },
  {
    key: "logs",
    envVar: "MISTLE_GLOBAL_TELEMETRY_LOGS_ENDPOINT",
    projectionPath: ["logs", "endpoint"],
    parse: (value) => ({
      endpoint: value,
    }),
  },
  {
    key: "metrics",
    envVar: "MISTLE_GLOBAL_TELEMETRY_METRICS_ENDPOINT",
    projectionPath: ["metrics", "endpoint"],
    parse: (value) => ({
      endpoint: value,
    }),
  },
  {
    key: "resourceAttributes",
    envVar: "MISTLE_GLOBAL_TELEMETRY_RESOURCE_ATTRIBUTES",
  },
] satisfies Parameters<typeof createEnvLoader<typeof PartialGlobalTelemetryConfigSchema>>[0];

export const GlobalSandboxBootstrapTokenEnvDescriptors = [
  {
    key: "tokenSecret",
    envVar: "MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_SECRET",
  },
  {
    key: "tokenIssuer",
    envVar: "MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_ISSUER",
  },
  {
    key: "tokenAudience",
    envVar: "MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_AUDIENCE",
  },
] satisfies Parameters<typeof createEnvLoader<typeof GlobalSandboxTokenConfigSchema>>[0];

export const GlobalSandboxConnectTokenEnvDescriptors = [
  {
    key: "tokenSecret",
    envVar: "MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_SECRET",
  },
  {
    key: "tokenIssuer",
    envVar: "MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_ISSUER",
  },
  {
    key: "tokenAudience",
    envVar: "MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_AUDIENCE",
  },
] satisfies Parameters<typeof createEnvLoader<typeof GlobalSandboxTokenConfigSchema>>[0];

export const GlobalSandboxEgressTokenEnvDescriptors = [
  {
    key: "tokenSecret",
    envVar: "MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_SECRET",
  },
  {
    key: "tokenIssuer",
    envVar: "MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_ISSUER",
  },
  {
    key: "tokenAudience",
    envVar: "MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_AUDIENCE",
  },
] satisfies Parameters<typeof createEnvLoader<typeof GlobalSandboxTokenConfigSchema>>[0];

export const GlobalSandboxPublishAccessTokenEnvDescriptors = [
  {
    key: "tokenSecret",
    envVar: "MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET",
  },
  {
    key: "tokenIssuer",
    envVar: "MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER",
  },
  {
    key: "tokenAudience",
    envVar: "MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE",
  },
] satisfies Parameters<typeof createEnvLoader<typeof GlobalSandboxTokenConfigSchema>>[0];

export const GlobalSandboxPublishSessionEnvDescriptors = [
  {
    key: "cookieSigningSecret",
    envVar: "MISTLE_GLOBAL_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET",
  },
] satisfies Parameters<typeof createEnvLoader<typeof GlobalSandboxPublishSessionConfigSchema>>[0];

export const GlobalSandboxPublishEnvDescriptors = [
  {
    key: "baseDomain",
    envVar: "MISTLE_GLOBAL_SANDBOX_PUBLISH_BASE_DOMAIN",
  },
] satisfies Parameters<typeof createEnvLoader<typeof PartialGlobalSandboxPublishConfigSchema>>[0];

export const GlobalSandboxEnvDescriptors = [
  {
    key: "provider",
    envVar: "MISTLE_GLOBAL_SANDBOX_PROVIDER",
  },
  {
    key: "defaultBaseImage",
    envVar: "MISTLE_GLOBAL_SANDBOX_DEFAULT_BASE_IMAGE",
  },
  {
    key: "gatewayWsUrl",
    envVar: "MISTLE_GLOBAL_SANDBOX_GATEWAY_WS_URL",
  },
  {
    key: "internalGatewayWsUrl",
    envVar: "MISTLE_GLOBAL_SANDBOX_INTERNAL_GATEWAY_WS_URL",
  },
] satisfies Parameters<typeof createEnvLoader<typeof PartialGlobalSandboxConfigSchema>>[0];

export const GlobalSandboxStorageEnvDescriptors = [
  {
    key: "backend",
    envVar: "MISTLE_GLOBAL_SANDBOX_STORAGE_BACKEND",
  },
] satisfies Parameters<typeof createEnvLoader<typeof PartialGlobalSandboxStorageConfigSchema>>[0];
