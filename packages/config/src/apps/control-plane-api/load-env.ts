import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import { asObjectRecord } from "../../core/record.js";
import {
  type PartialControlPlaneApiConfigInput,
  ControlPlaneApiAuthConfigSchema,
  ControlPlaneApiDashboardConfigSchema,
  ControlPlaneApiDataPlaneApiConfigSchema,
  ControlPlaneApiDatabaseConfigSchema,
  ControlPlaneApiCommitSignConfigSchema,
  ControlPlaneApiIntegrationsConfigSchema,
  ControlPlaneApiObjectStoreConfigSchema,
  ControlPlaneApiServerConfigSchema,
  ControlPlaneApiWorkflowConfigSchema,
  PartialControlPlaneApiConfigSchema,
} from "./schema.js";

export const ControlPlaneApiServerEnvDescriptors = [
  {
    key: "host",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_HOST",
  },
  {
    key: "port",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_PORT",
    parse: Number,
  },
] satisfies Parameters<typeof createEnvLoader<typeof ControlPlaneApiServerConfigSchema>>[0];

export const ControlPlaneApiDatabaseEnvDescriptors = [
  {
    key: "url",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL",
  },
  {
    key: "migrationUrl",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_DATABASE_MIGRATION_URL",
  },
] satisfies Parameters<typeof createEnvLoader<typeof ControlPlaneApiDatabaseConfigSchema>>[0];

export const ControlPlaneApiObjectStoreEnvDescriptors = [
  {
    key: "bucketName",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_BUCKET_NAME",
  },
  {
    key: "region",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_REGION",
  },
  {
    key: "endpoint",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_ENDPOINT",
  },
  {
    key: "forcePathStyle",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_FORCE_PATH_STYLE",
    parse: (value) => value === "true",
  },
  {
    key: "accessKeyId",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_ACCESS_KEY_ID",
  },
  {
    key: "secretAccessKey",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_SECRET_ACCESS_KEY",
  },
] satisfies Parameters<typeof createEnvLoader<typeof ControlPlaneApiObjectStoreConfigSchema>>[0];

export const ControlPlaneApiAuthEnvDescriptors = [
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
    valueFormat: "csv",
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
] satisfies Parameters<typeof createEnvLoader<typeof ControlPlaneApiAuthConfigSchema>>[0];

export const ControlPlaneApiAuthGoogleEnvDescriptors = [
  {
    key: "clientId",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_ID",
  },
  {
    key: "clientSecret",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_SECRET",
  },
] satisfies readonly { key: string; envVar: string }[];

export const ControlPlaneApiDashboardEnvDescriptors = [
  {
    key: "baseUrl",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_DASHBOARD_BASE_URL",
  },
] satisfies Parameters<typeof createEnvLoader<typeof ControlPlaneApiDashboardConfigSchema>>[0];

export const ControlPlaneApiWorkflowEnvDescriptors = [
  {
    key: "databaseUrl",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_DATABASE_URL",
  },
  {
    key: "namespaceId",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID",
  },
] satisfies Parameters<typeof createEnvLoader<typeof ControlPlaneApiWorkflowConfigSchema>>[0];

export const ControlPlaneApiDataPlaneApiEnvDescriptors = [
  {
    key: "baseUrl",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL",
  },
] satisfies Parameters<typeof createEnvLoader<typeof ControlPlaneApiDataPlaneApiConfigSchema>>[0];

export const ControlPlaneApiCommitSignEnvDescriptors = [
  {
    key: "binaryPath",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_COMMIT_SIGN_BINARY_PATH",
  },
] satisfies Parameters<typeof createEnvLoader<typeof ControlPlaneApiCommitSignConfigSchema>>[0];

export const ControlPlaneApiIntegrationsEnvDescriptors = [
  {
    key: "activeMasterEncryptionKeyVersion",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_ACTIVE_MASTER_ENCRYPTION_KEY_VERSION",
    parse: Number,
  },
  {
    key: "masterEncryptionKeys",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON",
    valueFormat: "json",
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
] satisfies Parameters<typeof createEnvLoader<typeof ControlPlaneApiIntegrationsConfigSchema>>[0];

const loadServerEnv = createEnvLoader<typeof ControlPlaneApiServerConfigSchema>(
  ControlPlaneApiServerEnvDescriptors,
);
const loadDatabaseEnv = createEnvLoader<typeof ControlPlaneApiDatabaseConfigSchema>(
  ControlPlaneApiDatabaseEnvDescriptors,
);
const loadObjectStoreEnv = createEnvLoader<typeof ControlPlaneApiObjectStoreConfigSchema>(
  ControlPlaneApiObjectStoreEnvDescriptors,
);
const loadAuthEnv = createEnvLoader<typeof ControlPlaneApiAuthConfigSchema>(
  ControlPlaneApiAuthEnvDescriptors,
);
const loadDashboardEnv = createEnvLoader<typeof ControlPlaneApiDashboardConfigSchema>(
  ControlPlaneApiDashboardEnvDescriptors,
);
const loadWorkflowEnv = createEnvLoader<typeof ControlPlaneApiWorkflowConfigSchema>(
  ControlPlaneApiWorkflowEnvDescriptors,
);
const loadDataPlaneApiEnv = createEnvLoader<typeof ControlPlaneApiDataPlaneApiConfigSchema>(
  ControlPlaneApiDataPlaneApiEnvDescriptors,
);
const loadCommitSignEnv = createEnvLoader<typeof ControlPlaneApiCommitSignConfigSchema>(
  ControlPlaneApiCommitSignEnvDescriptors,
);
const loadIntegrationsEnv = createEnvLoader<typeof ControlPlaneApiIntegrationsConfigSchema>(
  ControlPlaneApiIntegrationsEnvDescriptors,
);

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

  const objectStore = loadObjectStoreEnv(env);
  if (hasEntries(objectStore)) {
    partialConfig.objectStore = objectStore;
  }

  const auth = loadAuthEnv(env);
  const googleClientId = env.MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_ID;
  const googleClientSecret = env.MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_SECRET;
  if (googleClientId !== undefined || googleClientSecret !== undefined) {
    auth.google = {
      clientId: googleClientId ?? "",
      clientSecret: googleClientSecret ?? "",
    };
  }
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

  const commitSign = loadCommitSignEnv(env);
  if (hasEntries(commitSign)) {
    partialConfig.commitSign = commitSign;
  }

  const integrations = loadIntegrationsEnv(env);
  if (hasEntries(integrations)) {
    partialConfig.integrations = integrations;
  }

  return PartialControlPlaneApiConfigSchema.parse(partialConfig);
}
