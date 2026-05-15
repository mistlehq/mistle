import { OpenAPIHono } from "@hono/zod-openapi";
import { readRepositoryVersion } from "@mistle/config";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { Scalar } from "@scalar/hono-api-reference";
import type { OpenWorkflow } from "openworkflow";

import type { ControlPlaneAuth } from "./auth/index.js";
import { createAuthRoutes } from "./auth/routes.js";
import { createAutomationSchedulesRoutes } from "./automation-schedules/index.js";
import { createAutomationWebhooksRoutes } from "./automation-webhooks/index.js";
import { createAutomationsRoutes } from "./automations/index.js";
import { createHomeRoutes } from "./home/index.js";
import { createIdentityLinkingCallbacksRoutes } from "./identity-linking-callbacks/index.js";
import { createIntegrationCallbacksRoutes } from "./integration-callbacks/index.js";
import { createIntegrationConnectionsRoutes } from "./integration-connections/index.js";
import { createIntegrationTargetsRoutes } from "./integration-targets/index.js";
import { createIntegrationWebhooksRoutes } from "./integration-webhooks/index.js";
import { createInternalIdentityLinkingRoutes } from "./internal/identity-linking/index.js";
import { createInternalIntegrationConnectionsRoutes } from "./internal/integration-connections/index.js";
import { createInternalIntegrationCredentialsRoutes } from "./internal/integration-credentials/index.js";
import { createInternalSandboxProfileVersionSnapshotJobRoutes } from "./internal/sandbox-profile-version-snapshot-jobs/index.js";
import { createInternalSandboxRuntimeRoutes } from "./internal/sandbox-runtime/index.js";
import { createInternalSandboxStorageRoutes } from "./internal/sandbox-storage/index.js";
import { createInternalSchedulesRoutes } from "./internal/schedules/index.js";
import { createMeRoutes } from "./me/index.js";
import { createAppContextMiddleware } from "./middleware/app-context.js";
import { createCorsMiddleware } from "./middleware/cors.js";
import { withActiveOrganizationAccess } from "./middleware/with-active-organization-access.js";
import { withAuthSession } from "./middleware/with-auth-session.js";
import { createOrganizationRoutes } from "./organizations/index.js";
import { createPublicSessionLinksRoutes } from "./public-session-links/index.js";
import { createSandboxInstancesRoutes } from "./sandbox-instances/index.js";
import { createSandboxProfilesRoutes } from "./sandbox-profiles/index.js";
import { createSandboxProvidersRoutes } from "./sandbox-providers/index.js";
import type {
  AppContextBindings,
  AppContextVariables,
  ControlPlaneApiConfig,
  ControlPlaneApiGlobalConfig,
  ControlPlaneApiSandboxRuntimeConfig,
  ControlPlaneApp,
} from "./types.js";

const ControlPlaneOpenApiPath = "/openapi.json";
const ControlPlaneApiReferencePath = "/openapi";
const ControlPlaneReleaseVersion = readRepositoryVersion(import.meta.url);

const ControlPlaneOpenApiInfo = {
  title: "Mistle Control Plane API",
  version: ControlPlaneReleaseVersion,
};

export type CreateAppInput = {
  config: ControlPlaneApiConfig;
  environment: ControlPlaneApiGlobalConfig["env"];
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
  resolveTestContext?: (input: { testEnvironmentId: string }) => Promise<{
    db: ControlPlaneDatabase;
    dataPlaneClient: DataPlaneSandboxInstancesClient;
    openWorkflow: OpenWorkflow;
    auth: ControlPlaneAuth;
  }>;
};

export function createApp(input: CreateAppInput): ControlPlaneApp {
  const app = new OpenAPIHono<AppContextBindings>();

  configureApp({
    app,
    config: input.config,
    environment: input.environment,
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
    ...(input.resolveTestContext === undefined
      ? {}
      : {
          resolveTestContext: input.resolveTestContext,
        }),
  });

  return app;
}

export function configureApp(input: CreateAppInput & { app: ControlPlaneApp }): void {
  const { app, config, db, auth, environment } = input;

  app.use("*", createCorsMiddleware({ trustedOrigins: config.auth.trustedOrigins }));
  app.get("/__healthz", (ctx) => {
    return ctx.json({ ok: true });
  });
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
      ...(input.resolveTestContext === undefined
        ? {}
        : {
            resolveTestContext: input.resolveTestContext,
          }),
    }),
  );
  app.doc(ControlPlaneOpenApiPath, {
    openapi: "3.1.0",
    info: ControlPlaneOpenApiInfo,
  });
  if (environment === "development") {
    app.get(
      ControlPlaneApiReferencePath,
      Scalar({
        pageTitle: "Mistle Control Plane API Reference",
        url: ControlPlaneOpenApiPath,
      }),
    );
  }
  registerApiRouteModules(app);
}

export function registerApiRouteModules(app: ControlPlaneApp): void {
  registerPublicApiRouteModules(app);
  registerInternalApiRouteModules(app);
}

export function registerPublicApiRouteModules(app: ControlPlaneApp): void {
  const authRoutes = createAuthRoutes();
  const automationsRoutes = withActiveOrganizationAccess(createAutomationsRoutes());
  const automationSchedulesRoutes = withActiveOrganizationAccess(createAutomationSchedulesRoutes());
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
  const sandboxProvidersRoutes = withActiveOrganizationAccess(createSandboxProvidersRoutes());
  const sandboxProfilesRoutes = withActiveOrganizationAccess(createSandboxProfilesRoutes());

  app.route(authRoutes.basePath, authRoutes.routes);
  app.route(automationsRoutes.basePath, automationsRoutes.routes);
  app.route(automationSchedulesRoutes.basePath, automationSchedulesRoutes.routes);
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
  app.route(sandboxProvidersRoutes.basePath, sandboxProvidersRoutes.routes);
  app.route(sandboxProfilesRoutes.basePath, sandboxProfilesRoutes.routes);
}

export function registerInternalApiRouteModules(app: ControlPlaneApp): void {
  const internalIntegrationConnectionsRoutes = createInternalIntegrationConnectionsRoutes();
  const internalIntegrationCredentialsRoutes = createInternalIntegrationCredentialsRoutes();
  const internalIdentityLinkingRoutes = createInternalIdentityLinkingRoutes();
  const internalSchedulesRoutes = createInternalSchedulesRoutes();
  const internalSandboxProfileVersionSnapshotJobRoutes =
    createInternalSandboxProfileVersionSnapshotJobRoutes();
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
  app.route(internalSchedulesRoutes.basePath, internalSchedulesRoutes.routes);
  app.route(
    internalSandboxProfileVersionSnapshotJobRoutes.basePath,
    internalSandboxProfileVersionSnapshotJobRoutes.routes,
  );
  app.route(internalSandboxStorageRoutes.basePath, internalSandboxStorageRoutes.routes);
  app.route(internalSandboxRuntimeRoutes.basePath, internalSandboxRuntimeRoutes.routes);
}
