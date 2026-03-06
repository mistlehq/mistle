import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import { createAuthApp } from "../auth/app.js";
import { createIntegrationConnectionsApp } from "../integration-connections/index.js";
import { createIntegrationTargetsApp } from "../integration-targets/index.js";
import { createIntegrationWebhooksApp } from "../integration-webhooks/index.js";
import { createInternalIntegrationCredentialsApp } from "../internal-integration-credentials/index.js";
import { createInternalSandboxRuntimeApp } from "../internal-sandbox-runtime/index.js";
import { createAppContextMiddleware } from "../middleware/app-context.js";
import { createCorsMiddleware } from "../middleware/cors.js";
import { withAuthSession } from "../middleware/with-auth-session.js";
import { CONTROL_PLANE_OPENAPI_INFO, CONTROL_PLANE_OPENAPI_PATH } from "../openapi/constants.js";
import { createOrganizationMembershipCapabilitiesApp } from "../organization-membership-capabilities/index.js";
import { createSandboxConversationsApp } from "../sandbox-conversations/index.js";
import { createSandboxInstancesApp } from "../sandbox-instances/index.js";
import { createSandboxProfilesApp } from "../sandbox-profiles/index.js";
import type {
  AppServices,
  ControlPlaneApiConfig,
  ControlPlaneApiSandboxRuntimeConfig,
  ControlPlaneApp,
} from "../types.js";

type RegisterAppRoutesInput = {
  app: ControlPlaneApp;
  config: ControlPlaneApiConfig;
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
  internalAuthServiceToken: string;
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  services: AppServices;
};

export function registerAppRoutes(input: RegisterAppRoutesInput): void {
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
  app.get("/__healthz", (c) => {
    return c.json({ ok: true });
  });
}

export function registerApiRouteModules(app: ControlPlaneApp): void {
  registerPublicApiRouteModules(app);
  registerInternalApiRouteModules(app);
}

export function registerPublicApiRouteModules(app: ControlPlaneApp): void {
  const authApp = createAuthApp();
  const integrationConnectionsApp = withAuthSession(createIntegrationConnectionsApp());
  const integrationTargetsApp = withAuthSession(createIntegrationTargetsApp());
  const integrationWebhooksApp = createIntegrationWebhooksApp();
  const organizationMembershipCapabilitiesApp = withAuthSession(
    createOrganizationMembershipCapabilitiesApp(),
  );
  const sandboxConversationsApp = withAuthSession(createSandboxConversationsApp());
  const sandboxInstancesApp = withAuthSession(createSandboxInstancesApp());
  const sandboxProfilesApp = withAuthSession(createSandboxProfilesApp());
  app.route(authApp.basePath, authApp.routes);
  app.route(integrationConnectionsApp.basePath, integrationConnectionsApp.routes);
  app.route(integrationTargetsApp.basePath, integrationTargetsApp.routes);
  app.route(integrationWebhooksApp.basePath, integrationWebhooksApp.routes);
  app.route(
    organizationMembershipCapabilitiesApp.basePath,
    organizationMembershipCapabilitiesApp.routes,
  );
  app.route(sandboxConversationsApp.basePath, sandboxConversationsApp.routes);
  app.route(sandboxInstancesApp.basePath, sandboxInstancesApp.routes);
  app.route(sandboxProfilesApp.basePath, sandboxProfilesApp.routes);
}

export function registerInternalApiRouteModules(app: ControlPlaneApp): void {
  const internalIntegrationCredentialsApp = createInternalIntegrationCredentialsApp();
  const internalSandboxRuntimeApp = createInternalSandboxRuntimeApp();

  app.route(internalIntegrationCredentialsApp.basePath, internalIntegrationCredentialsApp.routes);
  app.route(internalSandboxRuntimeApp.basePath, internalSandboxRuntimeApp.routes);
}
