import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  type PartialControlPlaneApiConfigInput,
  ControlPlaneApiAuthConfigSchema,
  ControlPlaneApiDatabaseConfigSchema,
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

  return PartialControlPlaneApiConfigSchema.parse(partialConfig);
}
