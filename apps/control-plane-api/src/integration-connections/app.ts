import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";
import { INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH } from "./constants.js";
import {
  completeOAuthConnectionRoute,
  createApiKeyConnectionRoute,
  IntegrationConnectionsBadRequestResponseSchema,
  IntegrationConnectionsConflictResponseSchema,
  IntegrationConnectionsNotFoundResponseSchema,
  listIntegrationConnectionResourcesRoute,
  listIntegrationConnectionsRoute,
  refreshIntegrationConnectionResourcesRoute,
  startOAuthConnectionRoute,
  updateIntegrationConnectionRoute,
} from "./contracts.js";
import { completeOAuthConnection } from "./services/complete-oauth-connection.js";
import { createApiKeyConnection } from "./services/create-api-key-connection.js";
import {
  IntegrationConnectionsBadRequestError,
  IntegrationConnectionsConflictError,
  IntegrationConnectionsNotFoundError,
} from "./services/errors.js";
import { listIntegrationConnectionResources } from "./services/list-connection-resources.js";
import { listIntegrationConnections } from "./services/list-connections.js";
import { startOAuthConnection } from "./services/start-oauth-connection.js";
import { updateIntegrationConnection } from "./services/update-api-key-connection.js";

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

      const updatedConnection = await updateIntegrationConnection(
        ctx.get("db"),
        ctx.get("config").integrations,
        {
          organizationId: session.session.activeOrganizationId,
          connectionId: params.connectionId,
          displayName: body.displayName,
          ...(body.apiKey === undefined ? {} : { apiKey: body.apiKey }),
        },
      );

      return ctx.json(updatedConnection, 200);
    } catch (error) {
      return handleIntegrationConnectionMutationError(ctx, error);
    }
  });

  routes.openapi(startOAuthConnectionRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const body = ctx.req.valid("json");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const startedOAuthConnection = await startOAuthConnection(
        ctx.get("db"),
        ctx.get("config").integrations,
        {
          organizationId: session.session.activeOrganizationId,
          targetKey: params.targetKey,
          ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
        },
      );

      return ctx.json(startedOAuthConnection, 200);
    } catch (error) {
      return handleIntegrationConnectionMutationError(ctx, error);
    }
  });

  routes.openapi(completeOAuthConnectionRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const query = ctx.req.valid("query");

      const completedConnection = await completeOAuthConnection(
        ctx.get("db"),
        ctx.get("config").integrations,
        {
          targetKey: params.targetKey,
          query,
        },
      );

      return ctx.json(completedConnection, 201);
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
