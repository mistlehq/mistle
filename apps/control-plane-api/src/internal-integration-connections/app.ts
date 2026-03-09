import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import {
  IntegrationConnectionsNotFoundResponseSchema,
  RefreshIntegrationConnectionResourcesResponseSchema,
} from "../integration-connections/contracts.js";
import {
  IntegrationConnectionsBadRequestError,
  IntegrationConnectionsNotFoundError,
} from "../integration-connections/services/errors.js";
import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../internal-integration-credentials/constants.js";
import { createRequireInternalAuthMiddleware } from "../middleware/require-internal-auth.js";
import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";
import { INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH } from "./constants.js";
import {
  InternalIntegrationConnectionsBadRequestResponseSchema,
  internalRefreshIntegrationConnectionResourcesRoute,
} from "./contracts.js";

const InternalIntegrationConnectionsErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
} as const;

export function createInternalIntegrationConnectionsApp(): AppRoutes<
  typeof INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();
  routes.use(
    "*",
    createRequireInternalAuthMiddleware({
      headerName: CONTROL_PLANE_INTERNAL_AUTH_HEADER,
      errorCode: InternalIntegrationConnectionsErrorCodes.UNAUTHORIZED,
      errorMessage: "Internal service authentication failed.",
    }),
  );

  routes.openapi(internalRefreshIntegrationConnectionResourcesRoute, async (ctx) => {
    try {
      const body = ctx.req.valid("json");
      const result = await ctx.get("services").integrationConnections.requestResourceRefresh(body);
      const responseBody: z.infer<typeof RefreshIntegrationConnectionResourcesResponseSchema> =
        result;
      return ctx.json(responseBody, 202);
    } catch (error) {
      return handleRequestResourceRefreshError(ctx, error);
    }
  });

  return {
    basePath: INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH,
    routes,
  };
}

function handleRequestResourceRefreshError(ctx: AppContext, error: unknown) {
  if (error instanceof IntegrationConnectionsBadRequestError) {
    const responseBody: z.infer<typeof InternalIntegrationConnectionsBadRequestResponseSchema> = {
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
