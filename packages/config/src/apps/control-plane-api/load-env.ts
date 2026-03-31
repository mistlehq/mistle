import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import { asObjectRecord } from "../../core/record.js";
import {
  type PartialControlPlaneApiConfigInput,
  ControlPlaneApiAuthConfigSchema,
  ControlPlaneApiDashboardConfigSchema,
  ControlPlaneApiDataPlaneApiConfigSchema,
  ControlPlaneApiDatabaseConfigSchema,
  ControlPlaneApiIntegrationsConfigSchema,
  ControlPlaneApiMediaConfigSchema,
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
  {
    key: "migrationUrl",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_DATABASE_MIGRATION_URL",
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

const loadMediaEnv = createEnvLoader<typeof ControlPlaneApiMediaConfigSchema>([
  {
    key: "mediaBaseUrl",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_MEDIA_BASE_URL",
  },
  {
    key: "bucket",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_MEDIA_BUCKET",
  },
  {
    key: "provider",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_MEDIA_PROVIDER",
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

  const integrations = loadIntegrationsEnv(env);
  if (hasEntries(integrations)) {
    partialConfig.integrations = integrations;
  }

  const media = loadMediaEnv(env);
  const mediaS3Region = env.MISTLE_APPS_CONTROL_PLANE_API_MEDIA_S3_REGION;
  const mediaS3AccessKeyId = env.MISTLE_APPS_CONTROL_PLANE_API_MEDIA_S3_ACCESS_KEY_ID;
  const mediaS3SecretAccessKey = env.MISTLE_APPS_CONTROL_PLANE_API_MEDIA_S3_SECRET_ACCESS_KEY;
  const mediaS3ForcePathStyle = env.MISTLE_APPS_CONTROL_PLANE_API_MEDIA_S3_FORCE_PATH_STYLE;
  const mediaS3Endpoint = env.MISTLE_APPS_CONTROL_PLANE_API_MEDIA_S3_ENDPOINT;
  if (
    mediaS3Region !== undefined ||
    mediaS3AccessKeyId !== undefined ||
    mediaS3SecretAccessKey !== undefined ||
    mediaS3ForcePathStyle !== undefined ||
    mediaS3Endpoint !== undefined
  ) {
    media.s3 = {
      region: mediaS3Region ?? "",
      accessKeyId: mediaS3AccessKeyId ?? "",
      secretAccessKey: mediaS3SecretAccessKey ?? "",
      forcePathStyle: mediaS3ForcePathStyle === "true",
      ...(mediaS3Endpoint === undefined ? {} : { endpoint: mediaS3Endpoint }),
    };
  }

  const mediaGcsProjectId = env.MISTLE_APPS_CONTROL_PLANE_API_MEDIA_GCS_PROJECT_ID;
  const mediaGcsCredentialsJson = env.MISTLE_APPS_CONTROL_PLANE_API_MEDIA_GCS_CREDENTIALS_JSON;
  if (mediaGcsProjectId !== undefined || mediaGcsCredentialsJson !== undefined) {
    media.gcs = {
      projectId: mediaGcsProjectId ?? "",
      credentialsJson: mediaGcsCredentialsJson ?? "",
    };
  }

  if (hasEntries(media)) {
    partialConfig.media = media;
  }

  return PartialControlPlaneApiConfigSchema.parse(partialConfig);
}
