import { OpenAPIHono } from "@hono/zod-openapi";
import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  createControlPlaneBackend,
  createControlPlaneOpenWorkflow,
} from "@mistle/workflows/control-plane";
import { Pool } from "pg";

import type { AppContextBindings, ControlPlaneApiConfig, ControlPlaneApp } from "./types.js";

import { createAuthApp } from "./auth/app.js";
import { createControlPlaneAuth } from "./auth/index.js";
import { createAppContextMiddleware } from "./middleware/app-context.js";
import { createCorsMiddleware } from "./middleware/cors.js";
import { withAuthSession } from "./middleware/with-auth-session.js";
import {
  createSandboxProfilesApp,
  createSandboxProfilesService,
} from "./sandbox-profiles/index.js";

type AppRuntimeResources = {
  db: ControlPlaneDatabase;
  dbPool: Pool;
  workflowBackend: Awaited<ReturnType<typeof createControlPlaneBackend>>;
};

const AppResourcesByInstance = new WeakMap<ControlPlaneApp, AppRuntimeResources>();

function getAppResources(app: ControlPlaneApp): AppRuntimeResources {
  const appResources = AppResourcesByInstance.get(app);

  if (appResources === undefined) {
    throw new Error("Control plane app instance is unknown.");
  }

  return appResources;
}

export async function createApp(config: ControlPlaneApiConfig): Promise<ControlPlaneApp> {
  const app = new OpenAPIHono<AppContextBindings>();
  const authApp = createAuthApp();
  const sandboxProfilesApp = withAuthSession(createSandboxProfilesApp());
  const dbPool = new Pool({
    connectionString: config.database.url,
  });
  const db = createControlPlaneDatabase(dbPool);
  const workflowBackend = await createControlPlaneBackend({
    url: config.workflow.databaseUrl,
    namespaceId: config.workflow.namespaceId,
    runMigrations: false,
  });
  const openWorkflow = createControlPlaneOpenWorkflow({ backend: workflowBackend });
  const auth = createControlPlaneAuth({
    config: {
      authBaseUrl: config.auth.baseUrl,
      authSecret: config.auth.secret,
      authTrustedOrigins: config.auth.trustedOrigins,
      authOTPLength: config.auth.otpLength,
      authOTPExpiresInSeconds: config.auth.otpExpiresInSeconds,
      authOTPAllowedAttempts: config.auth.otpAllowedAttempts,
    },
    db,
    openWorkflow,
  });
  const sandboxProfiles = createSandboxProfilesService({
    db,
    openWorkflow,
  });

  app.use("*", createCorsMiddleware({ trustedOrigins: config.auth.trustedOrigins }));
  app.use(
    "*",
    createAppContextMiddleware({
      config,
      db,
      services: { auth, sandboxProfiles },
    }),
  );
  app.doc("/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "Mistle Control Plane API",
      version: "0.0.0",
    },
  });
  app.route(authApp.basePath, authApp.routes);
  app.route(sandboxProfilesApp.basePath, sandboxProfilesApp.routes);

  app.get("/__healthz", (c) => {
    return c.json({ ok: true });
  });

  AppResourcesByInstance.set(app, {
    db,
    dbPool,
    workflowBackend,
  });

  return app;
}

export async function stopApp(app: ControlPlaneApp): Promise<void> {
  const appResources = getAppResources(app);

  AppResourcesByInstance.delete(app);
  await Promise.all([appResources.dbPool.end(), appResources.workflowBackend.stop()]);
}

export function getAppDatabase(app: ControlPlaneApp): ControlPlaneDatabase {
  return getAppResources(app).db;
}
