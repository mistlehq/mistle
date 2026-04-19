import { OpenAPIHono } from "@hono/zod-openapi";
import { readRepositoryVersion } from "@mistle/config";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import type { OpenWorkflow } from "openworkflow";

import { createAuthRoutes } from "./auth/routes.js";
import { createAutomationWebhooksRoutes } from "./automation-webhooks/index.js";
import { createHomeRoutes } from "./home/index.js";
import { createIdentityLinkingCallbacksRoutes } from "./identity-linking-callbacks/index.js";
import { createIntegrationCallbacksRoutes } from "./integration-callbacks/index.js";
import { createIntegrationConnectionsRoutes } from "./integration-connections/index.js";
import { createIntegrationTargetsRoutes } from "./integration-targets/index.js";
import { createIntegrationWebhooksRoutes } from "./integration-webhooks/index.js";
import { createInternalIdentityLinkingRoutes } from "./internal/identity-linking/index.js";
import { createInternalIntegrationConnectionsRoutes } from "./internal/integration-connections/index.js";
import { createInternalIntegrationCredentialsRoutes } from "./internal/integration-credentials/index.js";
import { createInternalSandboxRuntimeRoutes } from "./internal/sandbox-runtime/index.js";
import { createInternalSandboxStorageRoutes } from "./internal/sandbox-storage/index.js";
import { createMeRoutes } from "./me/index.js";
import { createAppContextMiddleware } from "./middleware/app-context.js";
import { createCorsMiddleware } from "./middleware/cors.js";
import { withActiveOrganizationAccess } from "./middleware/with-active-organization-access.js";
import { withAuthSession } from "./middleware/with-auth-session.js";
import { createOrganizationRoutes } from "./organizations/index.js";
import { createPublicSessionLinksRoutes } from "./public-session-links/index.js";
import { createSandboxInstancesRoutes } from "./sandbox-instances/index.js";
import { createSandboxProfilesRoutes } from "./sandbox-profiles/index.js";
import type {
  AppContextBindings,
  AppContextVariables,
  ControlPlaneApiConfig,
  ControlPlaneApiSandboxRuntimeConfig,
  ControlPlaneApp,
} from "./types.js";

const ControlPlaneOpenApiPath = "/openapi.json";
const ControlPlaneReleaseVersion = readRepositoryVersion(import.meta.url);

const ControlPlaneOpenApiInfo = {
  title: "Mistle Control Plane API",
  version: ControlPlaneReleaseVersion,
};

export type CreateAppInput = {
  config: ControlPlaneApiConfig;
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
  internalAuthServiceToken: string;
  db: ControlPlaneDatabase;
  objectStore: AppContextVariables["objectStore"];
  integrationRegistry: IntegrationRegistry;
  dataPlaneClient: DataPlaneSandboxInstancesClient;
  connectionTokenConfig: AppContextBindings["Variables"]["connectionTokenConfig"];
  portAccessConfig: AppContextBindings["Variables"]["portAccessConfig"];
  openWorkflow: OpenWorkflow;
  auth: AppContextVariables["auth"];
};

export function createApp(input: CreateAppInput): ControlPlaneApp {
  const app = new OpenAPIHono<AppContextBindings>();

  configureApp({
    app,
    config: input.config,
    sandboxConfig: input.sandboxConfig,
    internalAuthServiceToken: input.internalAuthServiceToken,
    db: input.db,
    objectStore: input.objectStore,
    integrationRegistry: input.integrationRegistry,
    dataPlaneClient: input.dataPlaneClient,
    connectionTokenConfig: input.connectionTokenConfig,
    portAccessConfig: input.portAccessConfig,
    openWorkflow: input.openWorkflow,
    auth: input.auth,
  });

  return app;
}

export function configureApp(input: CreateAppInput & { app: ControlPlaneApp }): void {
  const { app, config, db, auth } = input;

  app.use("*", createCorsMiddleware({ trustedOrigins: config.auth.trustedOrigins }));
  app.use(
    "*",
    createAppContextMiddleware({
      config,
      sandboxConfig: input.sandboxConfig,
      internalAuthServiceToken: input.internalAuthServiceToken,
      db,
      objectStore: input.objectStore,
      integrationRegistry: input.integrationRegistry,
      dataPlaneClient: input.dataPlaneClient,
      connectionTokenConfig: input.connectionTokenConfig,
      portAccessConfig: input.portAccessConfig,
      openWorkflow: input.openWorkflow,
      auth,
    }),
  );
  app.doc(ControlPlaneOpenApiPath, {
    openapi: "3.1.0",
    info: ControlPlaneOpenApiInfo,
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
  const automationWebhooksRoutes = withActiveOrganizationAccess(createAutomationWebhooksRoutes());
  const homeRoutes = withActiveOrganizationAccess(createHomeRoutes());
  const identityLinkingCallbacksRoutes = createIdentityLinkingCallbacksRoutes();
  const integrationCallbacksRoutes = createIntegrationCallbacksRoutes();
  const integrationConnectionsRoutes = withActiveOrganizationAccess(
    createIntegrationConnectionsRoutes(),
  );
  const integrationTargetsRoutes = withAuthSession(createIntegrationTargetsRoutes());
  const integrationWebhooksRoutes = createIntegrationWebhooksRoutes();
  const meRoutes = withAuthSession(createMeRoutes());
  const organizationRoutes = withActiveOrganizationAccess(createOrganizationRoutes());
  const publicSessionLinksRoutes = createPublicSessionLinksRoutes();
  const sandboxInstancesRoutes = withActiveOrganizationAccess(createSandboxInstancesRoutes());
  const sandboxProfilesRoutes = withActiveOrganizationAccess(createSandboxProfilesRoutes());

  app.route(authRoutes.basePath, authRoutes.routes);
  app.route(automationWebhooksRoutes.basePath, automationWebhooksRoutes.routes);
  app.route(homeRoutes.basePath, homeRoutes.routes);
  app.route(identityLinkingCallbacksRoutes.basePath, identityLinkingCallbacksRoutes.routes);
  app.route(integrationCallbacksRoutes.basePath, integrationCallbacksRoutes.routes);
  app.route(integrationConnectionsRoutes.basePath, integrationConnectionsRoutes.routes);
  app.route(integrationTargetsRoutes.basePath, integrationTargetsRoutes.routes);
  app.route(integrationWebhooksRoutes.basePath, integrationWebhooksRoutes.routes);
  app.route(meRoutes.basePath, meRoutes.routes);
  app.route(organizationRoutes.basePath, organizationRoutes.routes);
  app.route(publicSessionLinksRoutes.basePath, publicSessionLinksRoutes.routes);
  app.route(sandboxInstancesRoutes.basePath, sandboxInstancesRoutes.routes);
  app.route(sandboxProfilesRoutes.basePath, sandboxProfilesRoutes.routes);
}

export function registerInternalApiRouteModules(app: ControlPlaneApp): void {
  const internalIntegrationConnectionsRoutes = createInternalIntegrationConnectionsRoutes();
  const internalIntegrationCredentialsRoutes = createInternalIntegrationCredentialsRoutes();
  const internalIdentityLinkingRoutes = createInternalIdentityLinkingRoutes();
  const internalSandboxStorageRoutes = createInternalSandboxStorageRoutes();
  const internalSandboxRuntimeRoutes = createInternalSandboxRuntimeRoutes();

  app.route(
    internalIntegrationConnectionsRoutes.basePath,
    internalIntegrationConnectionsRoutes.routes,
  );
  app.route(
    internalIntegrationCredentialsRoutes.basePath,
    internalIntegrationCredentialsRoutes.routes,
  );
  app.route(internalIdentityLinkingRoutes.basePath, internalIdentityLinkingRoutes.routes);
  app.route(internalSandboxStorageRoutes.basePath, internalSandboxStorageRoutes.routes);
  app.route(internalSandboxRuntimeRoutes.basePath, internalSandboxRuntimeRoutes.routes);
}
