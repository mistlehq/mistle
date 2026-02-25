import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import type { AppServices, ControlPlaneApiConfig, ControlPlaneApp } from "../types.js";

import { createAuthApp } from "../auth/app.js";
import { createAppContextMiddleware } from "../middleware/app-context.js";
import { createCorsMiddleware } from "../middleware/cors.js";
import { withAuthSession } from "../middleware/with-auth-session.js";
import { createSandboxProfilesApp } from "../sandbox-profiles/index.js";

type RegisterAppRoutesInput = {
  app: ControlPlaneApp;
  config: ControlPlaneApiConfig;
  db: ControlPlaneDatabase;
  services: AppServices;
};

export function registerAppRoutes(input: RegisterAppRoutesInput): void {
  const { app, config, db, services } = input;
  const authApp = createAuthApp();
  const sandboxProfilesApp = withAuthSession(createSandboxProfilesApp());

  app.use("*", createCorsMiddleware({ trustedOrigins: config.auth.trustedOrigins }));
  app.use(
    "*",
    createAppContextMiddleware({
      config,
      db,
      services,
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
}
