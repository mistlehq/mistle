import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import { asObjectRecord } from "../../core/record.js";
import {
  type PartialControlPlaneApiConfigInput,
  ControlPlaneApiAuthConfigSchema,
  ControlPlaneApiDataPlaneApiConfigSchema,
  ControlPlaneApiDatabaseConfigSchema,
  ControlPlaneApiIntegrationsConfigSchema,
  ControlPlaneApiSandboxConfigSchema,
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
    key: "invitationAcceptBaseUrl",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_INVITATION_ACCEPT_BASE_URL",
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

const loadSandboxEnv = createEnvLoader<typeof ControlPlaneApiSandboxConfigSchema>([
  {
    key: "defaultBaseImage",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_SANDBOX_DEFAULT_BASE_IMAGE",
  },
  {
    key: "gatewayWsUrl",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_SANDBOX_GATEWAY_WS_URL",
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
        const parsedValue = asObjectRecord(JSON.parse(value));
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

function readOptionalEnv(env: NodeJS.ProcessEnv, envVar: string): string | undefined {
  const value = env[envVar];
  return value === undefined ? undefined : value;
}

function hasDefinedValues(record: Record<string, string | undefined>): boolean {
  return Object.values(record).some((value) => value !== undefined);
}

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

  const workflow = loadWorkflowEnv(env);
  if (hasEntries(workflow)) {
    partialConfig.workflow = workflow;
  }

  const dataPlaneApi = loadDataPlaneApiEnv(env);
  if (hasEntries(dataPlaneApi)) {
    partialConfig.dataPlaneApi = dataPlaneApi;
  }

  const sandbox = loadSandboxEnv(env);
  if (hasEntries(sandbox)) {
    partialConfig.sandbox = sandbox;
  }

  const integrations = loadIntegrationsEnv(env);
  const githubTargetCatalog = {
    appSlug: readOptionalEnv(env, "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_GITHUB_APP_SLUG"),
    appId: readOptionalEnv(env, "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_GITHUB_APP_ID"),
    clientId: readOptionalEnv(env, "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_GITHUB_CLIENT_ID"),
    apiBaseUrl: readOptionalEnv(
      env,
      "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_GITHUB_API_BASE_URL",
    ),
    webBaseUrl: readOptionalEnv(
      env,
      "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_GITHUB_WEB_BASE_URL",
    ),
  };
  const openAiTargetCatalog = {
    apiBaseUrl: readOptionalEnv(
      env,
      "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_OPENAI_API_BASE_URL",
    ),
  };
  const githubEnterpriseTargetCatalog = {
    appSlug: readOptionalEnv(
      env,
      "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_GITHUB_ENTERPRISE_APP_SLUG",
    ),
    appId: readOptionalEnv(
      env,
      "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_GITHUB_ENTERPRISE_APP_ID",
    ),
    clientId: readOptionalEnv(
      env,
      "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_GITHUB_ENTERPRISE_CLIENT_ID",
    ),
    apiBaseUrl: readOptionalEnv(
      env,
      "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_GITHUB_ENTERPRISE_API_BASE_URL",
    ),
    webBaseUrl: readOptionalEnv(
      env,
      "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_GITHUB_ENTERPRISE_WEB_BASE_URL",
    ),
  };
  const targetCatalog = {
    ...(hasDefinedValues(githubTargetCatalog) ? { github: githubTargetCatalog } : {}),
    ...(hasDefinedValues(githubEnterpriseTargetCatalog)
      ? { githubEnterprise: githubEnterpriseTargetCatalog }
      : {}),
    ...(hasDefinedValues(openAiTargetCatalog) ? { openai: openAiTargetCatalog } : {}),
  };
  if (hasEntries(integrations)) {
    partialConfig.integrations = {
      ...integrations,
      ...(hasEntries(targetCatalog) ? { targetCatalog } : {}),
    };
  } else if (hasEntries(targetCatalog)) {
    partialConfig.integrations = {
      targetCatalog,
    };
  }

  return PartialControlPlaneApiConfigSchema.parse(partialConfig);
}
