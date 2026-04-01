import { createEnvLoader, hasEntries, parseBooleanEnv } from "../core/load-env.js";
import {
  PartialGlobalTelemetryConfigSchema,
  PartialGlobalTelemetrySignalConfigSchema,
  PartialGlobalConfigSchema,
  PartialGlobalSandboxConfigSchema,
  PartialGlobalSandboxPublishConfigSchema,
  GlobalSandboxTokenConfigSchema,
  GlobalSandboxPublishSessionConfigSchema,
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

const loadSandboxPublishAccessTokenEnv = createEnvLoader<typeof GlobalSandboxTokenConfigSchema>([
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
]);

const loadSandboxPublishSessionEnv = createEnvLoader<
  typeof GlobalSandboxPublishSessionConfigSchema
>([
  {
    key: "cookieSigningSecret",
    envVar: "MISTLE_GLOBAL_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET",
  },
]);

const loadSandboxPublishEnv = createEnvLoader<typeof PartialGlobalSandboxPublishConfigSchema>([
  {
    key: "baseDomain",
    envVar: "MISTLE_GLOBAL_SANDBOX_PUBLISH_BASE_DOMAIN",
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

function parseTelemetryHeadersEnv(value: string, envVar: string): Record<string, string> {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid ${envVar}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (typeof parsedValue !== "object" || parsedValue === null || Array.isArray(parsedValue)) {
    throw new Error(`Invalid ${envVar}: Expected a JSON object.`);
  }

  const normalizedValue: Record<string, string> = {};

  for (const [headerName, headerValue] of Object.entries(parsedValue)) {
    if (typeof headerValue !== "string") {
      throw new Error(
        `Invalid ${envVar}: Invalid value for header '${headerName}'. Expected a string.`,
      );
    }

    normalizedValue[headerName] = headerValue;
  }

  return normalizedValue;
}

function loadTelemetrySignalFromEnv(input: {
  env: NodeJS.ProcessEnv;
  endpointEnvVar: string;
  headersEnvVar: string;
}): Record<string, unknown> {
  return createEnvLoader<typeof PartialGlobalTelemetrySignalConfigSchema>([
    {
      key: "endpoint",
      envVar: input.endpointEnvVar,
    },
    {
      key: "headers",
      envVar: input.headersEnvVar,
      parse: (value) => parseTelemetryHeadersEnv(value, input.headersEnvVar),
    },
  ])(input.env);
}

export function loadGlobalFromEnv(env: NodeJS.ProcessEnv): PartialGlobalConfigInput {
  const partialGlobal = loadGlobalEnv(env);
  const partialTelemetry = loadTelemetryEnv(env);
  const partialTelemetryTraces = loadTelemetrySignalFromEnv({
    env,
    endpointEnvVar: "MISTLE_GLOBAL_TELEMETRY_TRACES_ENDPOINT",
    headersEnvVar: "MISTLE_GLOBAL_TELEMETRY_TRACES_HEADERS_JSON",
  });
  const partialTelemetryLogs = loadTelemetrySignalFromEnv({
    env,
    endpointEnvVar: "MISTLE_GLOBAL_TELEMETRY_LOGS_ENDPOINT",
    headersEnvVar: "MISTLE_GLOBAL_TELEMETRY_LOGS_HEADERS_JSON",
  });
  const partialTelemetryMetrics = loadTelemetrySignalFromEnv({
    env,
    endpointEnvVar: "MISTLE_GLOBAL_TELEMETRY_METRICS_ENDPOINT",
    headersEnvVar: "MISTLE_GLOBAL_TELEMETRY_METRICS_HEADERS_JSON",
  });
  const partialSandbox = loadSandboxEnv(env);
  const partialSandboxBootstrapToken = loadSandboxBootstrapTokenEnv(env);
  const partialSandboxConnectToken = loadSandboxConnectTokenEnv(env);
  const partialSandboxEgressToken = loadSandboxEgressTokenEnv(env);
  const partialSandboxPublish = loadSandboxPublishEnv(env);
  const partialSandboxPublishAccessToken = loadSandboxPublishAccessTokenEnv(env);
  const partialSandboxPublishSession = loadSandboxPublishSessionEnv(env);

  if (
    hasEntries(partialTelemetry) ||
    hasEntries(partialTelemetryTraces) ||
    hasEntries(partialTelemetryLogs) ||
    hasEntries(partialTelemetryMetrics)
  ) {
    partialGlobal.telemetry = {
      ...partialTelemetry,
      ...(hasEntries(partialTelemetryTraces)
        ? {
            traces: partialTelemetryTraces,
          }
        : {}),
      ...(hasEntries(partialTelemetryLogs)
        ? {
            logs: partialTelemetryLogs,
          }
        : {}),
      ...(hasEntries(partialTelemetryMetrics)
        ? {
            metrics: partialTelemetryMetrics,
          }
        : {}),
    };
  }

  if (
    hasEntries(partialSandbox) ||
    hasEntries(partialSandboxBootstrapToken) ||
    hasEntries(partialSandboxConnectToken) ||
    hasEntries(partialSandboxEgressToken) ||
    hasEntries(partialSandboxPublish) ||
    hasEntries(partialSandboxPublishAccessToken) ||
    hasEntries(partialSandboxPublishSession)
  ) {
    const partialExistingSandboxPublish = partialSandbox.publish ?? {};

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
      ...(hasEntries(partialSandboxPublish) ||
      hasEntries(partialSandboxPublishAccessToken) ||
      hasEntries(partialSandboxPublishSession)
        ? {
            publish: {
              ...partialExistingSandboxPublish,
              ...partialSandboxPublish,
              ...(hasEntries(partialSandboxPublishAccessToken)
                ? {
                    access: partialSandboxPublishAccessToken,
                  }
                : {}),
              ...(hasEntries(partialSandboxPublishSession)
                ? {
                    session: partialSandboxPublishSession,
                  }
                : {}),
            },
          }
        : {}),
    };
  }

  return PartialGlobalConfigSchema.parse(partialGlobal);
}
