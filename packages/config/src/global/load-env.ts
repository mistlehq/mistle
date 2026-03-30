import { createEnvLoader, hasEntries, parseBooleanEnv } from "../core/load-env.js";
import {
  PartialGlobalTelemetryConfigSchema,
  PartialGlobalConfigSchema,
  PartialGlobalSandboxConfigSchema,
  GlobalSandboxTokenConfigSchema,
  type PartialGlobalConfigInput,
} from "./schema.js";

const loadGlobalEnv = createEnvLoader<typeof PartialGlobalConfigSchema>([
  {
    key: "env",
    envVar: "NODE_ENV",
    parse: (value) => (value === "production" ? "production" : "development"),
  },
  {
    key: "internalAuth",
    envVar: "MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN",
    parse: (value) => ({
      serviceToken: value,
    }),
  },
]);

const loadTelemetryEnv = createEnvLoader<typeof PartialGlobalTelemetryConfigSchema>([
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
    parse: (value) => ({
      endpoint: value,
    }),
  },
  {
    key: "logs",
    envVar: "MISTLE_GLOBAL_TELEMETRY_LOGS_ENDPOINT",
    parse: (value) => ({
      endpoint: value,
    }),
  },
  {
    key: "metrics",
    envVar: "MISTLE_GLOBAL_TELEMETRY_METRICS_ENDPOINT",
    parse: (value) => ({
      endpoint: value,
    }),
  },
  {
    key: "resourceAttributes",
    envVar: "MISTLE_GLOBAL_TELEMETRY_RESOURCE_ATTRIBUTES",
  },
]);

const loadSandboxBootstrapTokenEnv = createEnvLoader<typeof GlobalSandboxTokenConfigSchema>([
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
]);

const loadSandboxConnectTokenEnv = createEnvLoader<typeof GlobalSandboxTokenConfigSchema>([
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
]);

const loadSandboxEgressTokenEnv = createEnvLoader<typeof GlobalSandboxTokenConfigSchema>([
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
]);

const loadSandboxEnv = createEnvLoader<typeof PartialGlobalSandboxConfigSchema>([
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
]);

export function loadGlobalFromEnv(env: NodeJS.ProcessEnv): PartialGlobalConfigInput {
  const partialGlobal = loadGlobalEnv(env);
  const partialTelemetry = loadTelemetryEnv(env);
  const partialSandbox = loadSandboxEnv(env);
  const partialSandboxBootstrapToken = loadSandboxBootstrapTokenEnv(env);
  const partialSandboxConnectToken = loadSandboxConnectTokenEnv(env);
  const partialSandboxEgressToken = loadSandboxEgressTokenEnv(env);

  if (hasEntries(partialTelemetry)) {
    partialGlobal.telemetry = partialTelemetry;
  }

  if (
    hasEntries(partialSandbox) ||
    hasEntries(partialSandboxBootstrapToken) ||
    hasEntries(partialSandboxConnectToken) ||
    hasEntries(partialSandboxEgressToken)
  ) {
    partialGlobal.sandbox = {
      ...partialSandbox,
      ...(hasEntries(partialSandboxBootstrapToken)
        ? {
            bootstrap: partialSandboxBootstrapToken,
          }
        : {}),
      ...(hasEntries(partialSandboxConnectToken)
        ? {
            connect: partialSandboxConnectToken,
          }
        : {}),
      ...(hasEntries(partialSandboxEgressToken)
        ? {
            egress: partialSandboxEgressToken,
          }
        : {}),
    };
  }

  return PartialGlobalConfigSchema.parse(partialGlobal);
}
