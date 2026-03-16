import { coerceConfigObjectNode } from "../../core/config-object-node.js";
import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  type PartialControlPlaneApiConfigInput,
  ControlPlaneApiAuthConfigSchema,
  ControlPlaneApiDashboardConfigSchema,
  ControlPlaneApiDataPlaneApiConfigSchema,
  ControlPlaneApiDatabaseConfigSchema,
  ControlPlaneApiIntegrationsConfigSchema,
  ControlPlaneApiServerConfigSchema,
  ControlPlaneApiWorkflowConfigSchema,
  PartialControlPlaneApiConfigSchema,
} from "./schema.js";

const loadServerEnv = createEnvLoader<typeof ControlPlaneApiServerConfigSchema>([
  {
    key: "host",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_HOST",
  },
  {
    key: "port",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_PORT",
    parse: Number,
  },
]);

const loadDatabaseEnv = createEnvLoader<typeof ControlPlaneApiDatabaseConfigSchema>([
  {
    key: "url",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL",
  },
]);

const loadAuthEnv = createEnvLoader<typeof ControlPlaneApiAuthConfigSchema>([
  {
    key: "baseUrl",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL",
  },
  {
    key: "secret",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_SECRET",
  },
  {
    key: "trustedOrigins",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS",
    parse: (value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
  },
  {
    key: "otpLength",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_LENGTH",
    parse: Number,
  },
  {
    key: "otpExpiresInSeconds",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_EXPIRES_IN_SECONDS",
    parse: Number,
  },
  {
    key: "otpAllowedAttempts",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_ALLOWED_ATTEMPTS",
    parse: Number,
  },
]);

const loadDashboardEnv = createEnvLoader<typeof ControlPlaneApiDashboardConfigSchema>([
  {
    key: "baseUrl",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_DASHBOARD_BASE_URL",
  },
]);

const loadWorkflowEnv = createEnvLoader<typeof ControlPlaneApiWorkflowConfigSchema>([
  {
    key: "databaseUrl",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_DATABASE_URL",
  },
  {
    key: "namespaceId",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID",
  },
]);

const loadDataPlaneApiEnv = createEnvLoader<typeof ControlPlaneApiDataPlaneApiConfigSchema>([
  {
    key: "baseUrl",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL",
  },
]);

const loadIntegrationsEnv = createEnvLoader<typeof ControlPlaneApiIntegrationsConfigSchema>([
  {
    key: "activeMasterEncryptionKeyVersion",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_ACTIVE_MASTER_ENCRYPTION_KEY_VERSION",
    parse: Number,
  },
  {
    key: "masterEncryptionKeys",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON",
    parse: (value): Record<string, string> => {
      try {
        const parsedValue = coerceConfigObjectNode(JSON.parse(value));
        const normalizedValue: Record<string, string> = {};

        for (const [version, keyValue] of Object.entries(parsedValue)) {
          if (typeof keyValue !== "string") {
            throw new Error(
              `Invalid value for version '${version}'. Expected a string key material value.`,
            );
          }

          normalizedValue[version] = keyValue;
        }

        return normalizedValue;
      } catch (error) {
        throw new Error(
          `Invalid MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  },
]);

export function loadControlPlaneApiFromEnv(
  env: NodeJS.ProcessEnv,
): PartialControlPlaneApiConfigInput {
  const partialConfig: PartialControlPlaneApiConfigInput = {};

  const server = loadServerEnv(env);
  if (hasEntries(server)) {
    partialConfig.server = server;
  }

  const database = loadDatabaseEnv(env);
  if (hasEntries(database)) {
    partialConfig.database = database;
  }

  const auth = loadAuthEnv(env);
  if (hasEntries(auth)) {
    partialConfig.auth = auth;
  }

  const dashboard = loadDashboardEnv(env);
  if (hasEntries(dashboard)) {
    partialConfig.dashboard = dashboard;
  }

  const workflow = loadWorkflowEnv(env);
  if (hasEntries(workflow)) {
    partialConfig.workflow = workflow;
  }

  const dataPlaneApi = loadDataPlaneApiEnv(env);
  if (hasEntries(dataPlaneApi)) {
    partialConfig.dataPlaneApi = dataPlaneApi;
  }

  const integrations = loadIntegrationsEnv(env);
  if (hasEntries(integrations)) {
    partialConfig.integrations = integrations;
  }

  return PartialControlPlaneApiConfigSchema.parse(partialConfig);
}
