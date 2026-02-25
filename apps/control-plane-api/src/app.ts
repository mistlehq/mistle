import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { SMTPEmailSender } from "@mistle/emails";
import { Hono } from "hono";
import { Pool } from "pg";

import type { AppContextBindings, ControlPlaneApiConfig, ControlPlaneApp } from "./types.js";

import { createAuthApp } from "./auth/app.js";
import { createControlPlaneAuth } from "./auth/index.js";
import { createAppContextMiddleware } from "./middleware/app-context.js";
import { createCorsMiddleware } from "./middleware/cors.js";

type AppRuntimeResources = {
  db: ControlPlaneDatabase;
  dbPool: Pool;
};

const AppResourcesByInstance = new WeakMap<ControlPlaneApp, AppRuntimeResources>();

function getAppResources(app: ControlPlaneApp): AppRuntimeResources {
  const appResources = AppResourcesByInstance.get(app);

  if (appResources === undefined) {
    throw new Error("Control plane app instance is unknown.");
  }

  return appResources;
}

export function createApp(config: ControlPlaneApiConfig): ControlPlaneApp {
  const app = new Hono<AppContextBindings>();
  const authApp = createAuthApp();
  const dbPool = new Pool({
    connectionString: config.database.url,
  });
  const db = createControlPlaneDatabase(dbPool);
  const emailSender = SMTPEmailSender.fromTransportOptions({
    host: config.email.smtpHost,
    port: config.email.smtpPort,
    secure: config.email.smtpSecure,
    auth: {
      user: config.email.smtpUsername,
      pass: config.email.smtpPassword,
    },
  });
  const auth = createControlPlaneAuth({
    config: {
      authBaseUrl: config.auth.baseUrl,
      authSecret: config.auth.secret,
      authTrustedOrigins: config.auth.trustedOrigins,
      authOTPLength: config.auth.otpLength,
      authOTPExpiresInSeconds: config.auth.otpExpiresInSeconds,
      authOTPAllowedAttempts: config.auth.otpAllowedAttempts,
      emailFromAddress: config.email.fromAddress,
      emailFromName: config.email.fromName,
    },
    db,
    emailSender,
  });

  app.use("*", createCorsMiddleware({ trustedOrigins: config.auth.trustedOrigins }));
  app.use(
    "*",
    createAppContextMiddleware({
      config,
      db,
      services: { auth },
    }),
  );
  app.route(authApp.basePath, authApp.routes);

  app.get("/__healthz", (c) => {
    return c.json({ ok: true });
  });

  AppResourcesByInstance.set(app, {
    db,
    dbPool,
  });

  return app;
}

export async function stopApp(app: ControlPlaneApp): Promise<void> {
  const appResources = getAppResources(app);

  AppResourcesByInstance.delete(app);
  await appResources.dbPool.end();
}

export function getAppDatabase(app: ControlPlaneApp): ControlPlaneDatabase {
  return getAppResources(app).db;
}
