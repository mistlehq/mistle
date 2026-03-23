import { OpenAPIHono } from "@hono/zod-openapi";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import { createAuthRoutes } from "./auth/routes.js";
import { createAutomationWebhooksRoutes } from "./automation-webhooks/index.js";
import { createIntegrationConnectionsRoutes } from "./integration-connections/index.js";
import { createIntegrationTargetsRoutes } from "./integration-targets/index.js";
import { createIntegrationWebhooksRoutes } from "./integration-webhooks/index.js";
import { createInternalIntegrationConnectionsRoutes } from "./internal-integration-connections/index.js";
import { createInternalIntegrationCredentialsRoutes } from "./internal-integration-credentials/index.js";
import { createInternalSandboxRuntimeRoutes } from "./internal-sandbox-runtime/index.js";
import { createAppContextMiddleware } from "./middleware/app-context.js";
import { createCorsMiddleware } from "./middleware/cors.js";
import { withAuthSession } from "./middleware/with-auth-session.js";
import { CONTROL_PLANE_OPENAPI_INFO, CONTROL_PLANE_OPENAPI_PATH } from "./openapi/constants.js";
import { createOrganizationMembershipCapabilitiesRoutes } from "./organization-membership-capabilities/index.js";
import { createSandboxInstancesRoutes } from "./sandbox-instances/index.js";
import { createSandboxProfilesRoutes } from "./sandbox-profiles/index.js";
import type {
  AppContextBindings,
  AppServices,
  ControlPlaneApiConfig,
  ControlPlaneApiSandboxRuntimeConfig,
  ControlPlaneApp,
} from "./types.js";

export type CreateAppInput = {
  config: ControlPlaneApiConfig;
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
  internalAuthServiceToken: string;
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  services: AppServices;
};

export function createApp(input: CreateAppInput): ControlPlaneApp {
  const app = new OpenAPIHono<AppContextBindings>();

  configureApp({
    app,
    config: input.config,
    sandboxConfig: input.sandboxConfig,
    internalAuthServiceToken: input.internalAuthServiceToken,
    db: input.db,
    integrationRegistry: input.integrationRegistry,
    services: input.services,
  });

  return app;
}

export function configureApp(input: CreateAppInput & { app: ControlPlaneApp }): void {
  const { app, config, db, services } = input;

  app.use("*", createCorsMiddleware({ trustedOrigins: config.auth.trustedOrigins }));
  app.use(
    "*",
    createAppContextMiddleware({
      config,
      sandboxConfig: input.sandboxConfig,
      internalAuthServiceToken: input.internalAuthServiceToken,
      db,
      integrationRegistry: input.integrationRegistry,
      services,
    }),
  );
  app.doc(CONTROL_PLANE_OPENAPI_PATH, {
    openapi: "3.1.0",
    info: CONTROL_PLANE_OPENAPI_INFO,
  });
  registerApiRouteModules(app);
  app.get("/__healthz", (ctx) => {
    return ctx.json({ ok: true });
  });
}

export function registerApiRouteModules(app: ControlPlaneApp): void {
  registerPublicApiRouteModules(app);
  registerInternalApiRouteModules(app);
}

export function registerPublicApiRouteModules(app: ControlPlaneApp): void {
  const authRoutes = createAuthRoutes();
  const automationWebhooksRoutes = withAuthSession(createAutomationWebhooksRoutes());
  const integrationConnectionsRoutes = createIntegrationConnectionsRoutes();
  const integrationTargetsRoutes = withAuthSession(createIntegrationTargetsRoutes());
  const integrationWebhooksRoutes = createIntegrationWebhooksRoutes();
  const organizationMembershipCapabilitiesRoutes = withAuthSession(
    createOrganizationMembershipCapabilitiesRoutes(),
  );
  const sandboxInstancesRoutes = withAuthSession(createSandboxInstancesRoutes());
  const sandboxProfilesRoutes = withAuthSession(createSandboxProfilesRoutes());

  app.route(authRoutes.basePath, authRoutes.routes);
  app.route(automationWebhooksRoutes.basePath, automationWebhooksRoutes.routes);
  app.route(integrationConnectionsRoutes.basePath, integrationConnectionsRoutes.routes);
  app.route(integrationTargetsRoutes.basePath, integrationTargetsRoutes.routes);
  app.route(integrationWebhooksRoutes.basePath, integrationWebhooksRoutes.routes);
  app.route(
    organizationMembershipCapabilitiesRoutes.basePath,
    organizationMembershipCapabilitiesRoutes.routes,
  );
  app.route(sandboxInstancesRoutes.basePath, sandboxInstancesRoutes.routes);
  app.route(sandboxProfilesRoutes.basePath, sandboxProfilesRoutes.routes);
}

export function registerInternalApiRouteModules(app: ControlPlaneApp): void {
  const internalIntegrationConnectionsRoutes = createInternalIntegrationConnectionsRoutes();
  const internalIntegrationCredentialsRoutes = createInternalIntegrationCredentialsRoutes();
  const internalSandboxRuntimeRoutes = createInternalSandboxRuntimeRoutes();

  app.route(
    internalIntegrationConnectionsRoutes.basePath,
    internalIntegrationConnectionsRoutes.routes,
  );
  app.route(
    internalIntegrationCredentialsRoutes.basePath,
    internalIntegrationCredentialsRoutes.routes,
  );
  app.route(internalSandboxRuntimeRoutes.basePath, internalSandboxRuntimeRoutes.routes);
}
