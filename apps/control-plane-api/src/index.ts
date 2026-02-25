import { AppIds, loadConfig } from "@mistle/config";
import { createControlPlaneDatabase } from "@mistle/db/control-plane";
import { SMTPEmailSender } from "@mistle/emails";
import { Pool } from "pg";

import { createApp } from "./app.js";
import { startServer } from "./server.js";
import { createControlPlaneAuth } from "./services/auth/index.js";

const loadedConfig = loadConfig({
  app: AppIds.CONTROL_PLANE_API,
  env: process.env,
  includeGlobal: false,
});
const appConfig = loadedConfig.app;

const databasePool = new Pool({
  connectionString: appConfig.database.url,
});
const database = createControlPlaneDatabase(databasePool);
const emailSender = SMTPEmailSender.fromTransportOptions({
  host: appConfig.email.smtpHost,
  port: appConfig.email.smtpPort,
  secure: appConfig.email.smtpSecure,
  auth: {
    user: appConfig.email.smtpUsername,
    pass: appConfig.email.smtpPassword,
  },
});
const auth = createControlPlaneAuth({
  config: {
    authBaseUrl: appConfig.auth.baseUrl,
    authSecret: appConfig.auth.secret,
    authTrustedOrigins: appConfig.auth.trustedOrigins,
    authOtpLength: appConfig.auth.otpLength,
    authOtpExpiresInSeconds: appConfig.auth.otpExpiresInSeconds,
    authOtpAllowedAttempts: appConfig.auth.otpAllowedAttempts,
    emailFromAddress: appConfig.email.fromAddress,
    emailFromName: appConfig.email.fromName,
  },
  database,
  emailSender,
});
const app = createApp({
  auth,
  authTrustedOrigins: appConfig.auth.trustedOrigins,
});

startServer({
  app,
  host: appConfig.server.host,
  port: appConfig.server.port,
});

console.log(
  "@mistle/control-plane-api listening on " +
    appConfig.server.host +
    ":" +
    String(appConfig.server.port) +
    " with auth at " +
    appConfig.auth.baseUrl,
);
