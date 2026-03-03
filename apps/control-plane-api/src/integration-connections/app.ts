import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";
import { INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH } from "./constants.js";
import {
  completeOAuthConnectionRoute,
  createApiKeyConnectionRoute,
  IntegrationConnectionsBadRequestResponseSchema,
  IntegrationConnectionsNotFoundResponseSchema,
  listIntegrationConnectionsRoute,
  startOAuthConnectionRoute,
} from "./contracts.js";
import { completeOAuthConnection } from "./services/complete-oauth-connection.js";
import { createApiKeyConnection } from "./services/create-api-key-connection.js";
import {
  IntegrationConnectionsBadRequestError,
  IntegrationConnectionsNotFoundError,
} from "./services/errors.js";
import { listIntegrationConnections } from "./services/list-connections.js";
import { startOAuthConnection } from "./services/start-oauth-connection.js";

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

      const result = await listIntegrationConnections(ctx.get("db"), {
        ...query,
        organizationId: session.session.activeOrganizationId,
      });

      return ctx.json(result, 200);
    } catch (error) {
      return handleListIntegrationConnectionsError(ctx, error);
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
          apiKey: body.apiKey,
          connectionSecrets: body.secrets ?? {},
        },
      );

      return ctx.json(createdConnection, 201);
    } catch (error) {
      return handleIntegrationConnectionMutationError(ctx, error);
    }
  });

  routes.openapi(startOAuthConnectionRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
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
      const body = ctx.req.valid("json");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const completedConnection = await completeOAuthConnection(
        ctx.get("db"),
        ctx.get("config").integrations,
        {
          organizationId: session.session.activeOrganizationId,
          targetKey: params.targetKey,
          query: body.query,
          connectionSecrets: body.secrets ?? {},
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
