import { createEnvLoader } from "../../core/load-env.js";
import {
  type PartialControlPlaneApiConfigInput,
  ControlPlaneApiAuthConfigSchema,
  ControlPlaneApiDatabaseConfigSchema,
  ControlPlaneApiEmailConfigSchema,
  ControlPlaneApiServerConfigSchema,
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

function parseSmtpSecureEnv(value: string): boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error("Invalid MISTLE_APPS_CONTROL_PLANE_API_SMTP_SECURE. Expected 'true' or 'false'.");
}

const loadEmailEnv = createEnvLoader<typeof ControlPlaneApiEmailConfigSchema>([
  {
    key: "fromAddress",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_EMAIL_FROM_ADDRESS",
  },
  {
    key: "fromName",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_EMAIL_FROM_NAME",
  },
  {
    key: "smtpHost",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_SMTP_HOST",
  },
  {
    key: "smtpPort",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_SMTP_PORT",
    parse: Number,
  },
  {
    key: "smtpSecure",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_SMTP_SECURE",
    parse: parseSmtpSecureEnv,
  },
  {
    key: "smtpUsername",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_SMTP_USERNAME",
  },
  {
    key: "smtpPassword",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_SMTP_PASSWORD",
  },
]);

function hasEntries(record: Record<string, unknown>): boolean {
  return Object.keys(record).length > 0;
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

  const email = loadEmailEnv(env);
  if (hasEntries(email)) {
    partialConfig.email = email;
  }

  return PartialControlPlaneApiConfigSchema.parse(partialConfig);
}
