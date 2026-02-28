import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";
import { INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH } from "./constants.js";
import {
  IntegrationConnectionsBadRequestResponseSchema,
  listIntegrationConnectionsRoute,
} from "./contracts.js";
import { IntegrationConnectionsBadRequestError } from "./services/errors.js";
import { listIntegrationConnections } from "./services/list-connections.js";

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
