import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import { createAuthApp } from "../auth/app.js";
import { createIntegrationTargetsApp } from "../integration-targets/index.js";
import { createAppContextMiddleware } from "../middleware/app-context.js";
import { createCorsMiddleware } from "../middleware/cors.js";
import { withAuthSession } from "../middleware/with-auth-session.js";
import { CONTROL_PLANE_OPENAPI_INFO, CONTROL_PLANE_OPENAPI_PATH } from "../openapi/constants.js";
import { createOrganizationMembershipCapabilitiesApp } from "../organization-membership-capabilities/index.js";
import { createSandboxProfilesApp } from "../sandbox-profiles/index.js";
import type { AppServices, ControlPlaneApiConfig, ControlPlaneApp } from "../types.js";

type RegisterAppRoutesInput = {
  app: ControlPlaneApp;
  config: ControlPlaneApiConfig;
  db: ControlPlaneDatabase;
  services: AppServices;
};

export function registerAppRoutes(input: RegisterAppRoutesInput): void {
  const { app, config, db, services } = input;

  app.use("*", createCorsMiddleware({ trustedOrigins: config.auth.trustedOrigins }));
  app.use(
    "*",
    createAppContextMiddleware({
      config,
      db,
      services,
    }),
  );
  app.doc(CONTROL_PLANE_OPENAPI_PATH, {
    openapi: "3.1.0",
    info: CONTROL_PLANE_OPENAPI_INFO,
  });
  registerApiRouteModules(app);
  app.get("/__healthz", (c) => {
    return c.json({ ok: true });
  });
}

export function registerApiRouteModules(app: ControlPlaneApp): void {
  const authApp = createAuthApp();
  const integrationTargetsApp = withAuthSession(createIntegrationTargetsApp());
  const organizationMembershipCapabilitiesApp = withAuthSession(
    createOrganizationMembershipCapabilitiesApp(),
  );
  const sandboxProfilesApp = withAuthSession(createSandboxProfilesApp());
  app.route(authApp.basePath, authApp.routes);
  app.route(integrationTargetsApp.basePath, integrationTargetsApp.routes);
  app.route(
    organizationMembershipCapabilitiesApp.basePath,
    organizationMembershipCapabilitiesApp.routes,
  );
  app.route(sandboxProfilesApp.basePath, sandboxProfilesApp.routes);
}
