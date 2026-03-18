import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { buildDashboardUrl } from "../dashboard-url.js";
import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";
import { INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH } from "./constants.js";
import {
  completeOAuth2ConnectionRoute,
  completeGitHubAppInstallationConnectionRoute,
  createApiKeyConnectionRoute,
  IntegrationConnectionsBadRequestResponseSchema,
  IntegrationConnectionsConflictResponseSchema,
  IntegrationConnectionsNotFoundResponseSchema,
  listIntegrationConnectionResourcesRoute,
  listIntegrationConnectionsRoute,
  refreshIntegrationConnectionResourcesRoute,
  startOAuth2ConnectionRoute,
  startGitHubAppInstallationConnectionRoute,
  updateApiKeyConnectionRoute,
  updateIntegrationConnectionRoute,
} from "./contracts.js";
import { completeGitHubAppInstallationConnection } from "./services/complete-github-app-installation-connection.js";
import { completeOAuth2Connection } from "./services/complete-oauth2-connection.js";
import { createApiKeyConnection } from "./services/create-api-key-connection.js";
import {
  IntegrationConnectionsBadRequestError,
  IntegrationConnectionsConflictError,
  IntegrationConnectionsNotFoundError,
} from "./services/errors.js";
import { listIntegrationConnectionResources } from "./services/list-connection-resources.js";
import { listIntegrationConnections } from "./services/list-connections.js";
import { startGitHubAppInstallationConnection } from "./services/start-github-app-installation-connection.js";
import { startOAuth2Connection } from "./services/start-oauth2-connection.js";
import { updateApiKeyConnection } from "./services/update-api-key-connection.js";
import { updateIntegrationConnection } from "./services/update-connection.js";

const DashboardOrganizationIntegrationsPath = "/settings/organization/integrations";

export function createIntegrationConnectionsApp(): AppRoutes<
  typeof INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();

  routes.openapi(listIntegrationConnectionsRoute, async (ctx) => {
    try {
      const query = ctx.req.valid("query");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const result = await listIntegrationConnections(
        ctx.get("db"),
        ctx.get("integrationRegistry"),
        {
          ...query,
          organizationId: session.session.activeOrganizationId,
        },
      );

      return ctx.json(result, 200);
    } catch (error) {
      return handleListIntegrationConnectionsError(ctx, error);
    }
  });

  routes.openapi(listIntegrationConnectionResourcesRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const query = ctx.req.valid("query");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const result = await listIntegrationConnectionResources(
        ctx.get("db"),
        ctx.get("integrationRegistry"),
        {
          organizationId: session.session.activeOrganizationId,
          connectionId: params.connectionId,
          ...query,
        },
      );

      return ctx.json(result, 200);
    } catch (error) {
      return handleListIntegrationConnectionResourcesError(ctx, error);
    }
  });

  routes.openapi(refreshIntegrationConnectionResourcesRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const result = await ctx.get("services").integrationConnections.requestResourceRefresh({
        organizationId: session.session.activeOrganizationId,
        connectionId: params.connectionId,
        kind: params.kind,
      });

      return ctx.json(result, 202);
    } catch (error) {
      return handleIntegrationConnectionMutationError(ctx, error);
    }
  });

  routes.openapi(createApiKeyConnectionRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const body = ctx.req.valid("json");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const createdConnection = await createApiKeyConnection(
        ctx.get("db"),
        ctx.get("config").integrations,
        {
          organizationId: session.session.activeOrganizationId,
          targetKey: params.targetKey,
          displayName: body.displayName,
          apiKey: body.apiKey,
        },
      );

      return ctx.json(createdConnection, 201);
    } catch (error) {
      return handleIntegrationConnectionMutationError(ctx, error);
    }
  });

  routes.openapi(updateIntegrationConnectionRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const body = ctx.req.valid("json");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const updatedConnection = await updateIntegrationConnection(ctx.get("db"), {
        organizationId: session.session.activeOrganizationId,
        connectionId: params.connectionId,
        displayName: body.displayName,
      });

      return ctx.json(updatedConnection, 200);
    } catch (error) {
      return handleIntegrationConnectionMutationError(ctx, error);
    }
  });

  routes.openapi(updateApiKeyConnectionRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const body = ctx.req.valid("json");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const updatedConnection = await updateApiKeyConnection(
        ctx.get("db"),
        ctx.get("config").integrations,
        {
          organizationId: session.session.activeOrganizationId,
          connectionId: params.connectionId,
          displayName: body.displayName,
          apiKey: body.apiKey,
        },
      );

      return ctx.json(updatedConnection, 200);
    } catch (error) {
      return handleIntegrationConnectionMutationError(ctx, error);
    }
  });

  routes.openapi(startGitHubAppInstallationConnectionRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const body = ctx.req.valid("json");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const startedGitHubAppInstallationConnection = await startGitHubAppInstallationConnection(
        ctx.get("db"),
        ctx.get("config").integrations,
        {
          organizationId: session.session.activeOrganizationId,
          targetKey: params.targetKey,
          ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
        },
      );

      return ctx.json(startedGitHubAppInstallationConnection, 200);
    } catch (error) {
      return handleIntegrationConnectionMutationError(ctx, error);
    }
  });

  routes.openapi(startOAuth2ConnectionRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const body = ctx.req.valid("json");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const startedOAuth2Connection = await startOAuth2Connection(
        ctx.get("db"),
        ctx.get("config").integrations,
        {
          organizationId: session.session.activeOrganizationId,
          targetKey: params.targetKey,
          ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
          controlPlaneBaseUrl: ctx.get("config").auth.baseUrl,
        },
      );

      return ctx.json(startedOAuth2Connection, 200);
    } catch (error) {
      return handleIntegrationConnectionMutationError(ctx, error);
    }
  });

  routes.openapi(completeGitHubAppInstallationConnectionRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const query = ctx.req.valid("query");

      await completeGitHubAppInstallationConnection(ctx.get("db"), ctx.get("config").integrations, {
        targetKey: params.targetKey,
        query,
      });

      return ctx.redirect(buildDashboardIntegrationsUrl(ctx.get("config").dashboard.baseUrl), 302);
    } catch (error) {
      return handleIntegrationConnectionMutationError(ctx, error);
    }
  });

  routes.openapi(completeOAuth2ConnectionRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const query = ctx.req.valid("query");

      await completeOAuth2Connection(ctx.get("db"), ctx.get("config").integrations, {
        targetKey: params.targetKey,
        query,
        controlPlaneBaseUrl: ctx.get("config").auth.baseUrl,
      });

      return ctx.redirect(buildDashboardIntegrationsUrl(ctx.get("config").dashboard.baseUrl), 302);
    } catch (error) {
      return handleIntegrationConnectionMutationError(ctx, error);
    }
  });

  return {
    basePath: INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH,
    routes,
  };
}

function handleListIntegrationConnectionsError(ctx: AppContext, error: unknown) {
  if (error instanceof IntegrationConnectionsBadRequestError) {
    const responseBody: z.infer<typeof IntegrationConnectionsBadRequestResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 400);
  }

  throw error;
}

function buildDashboardIntegrationsUrl(dashboardBaseUrl: string): string {
  return buildDashboardUrl(dashboardBaseUrl, DashboardOrganizationIntegrationsPath);
}

function handleIntegrationConnectionMutationError(ctx: AppContext, error: unknown) {
  if (error instanceof IntegrationConnectionsBadRequestError) {
    const responseBody: z.infer<typeof IntegrationConnectionsBadRequestResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 400);
  }

  if (error instanceof IntegrationConnectionsNotFoundError) {
    const responseBody: z.infer<typeof IntegrationConnectionsNotFoundResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 404);
  }

  throw error;
}

function handleListIntegrationConnectionResourcesError(ctx: AppContext, error: unknown) {
  if (error instanceof IntegrationConnectionsBadRequestError) {
    const responseBody: z.infer<typeof IntegrationConnectionsBadRequestResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 400);
  }

  if (error instanceof IntegrationConnectionsNotFoundError) {
    const responseBody: z.infer<typeof IntegrationConnectionsNotFoundResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 404);
  }

  if (error instanceof IntegrationConnectionsConflictError) {
    const responseBody: z.infer<typeof IntegrationConnectionsConflictResponseSchema> = {
      code: error.code,
      message: error.message,
      ...(error.lastErrorCode === null ? {} : { lastErrorCode: error.lastErrorCode }),
      ...(error.lastErrorMessage === null ? {} : { lastErrorMessage: error.lastErrorMessage }),
    };

    return ctx.json(responseBody, 409);
  }

  throw error;
}
