import { OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import { OpenApiValidationHook, withHttpErrorHandler } from "@mistle/http/errors.js";

import { requestIntegrationConnectionResourceRefresh } from "../integration-connections/services/refresh-integration-connection-resources.js";
import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../internal-integration-credentials/constants.js";
import { createRequireInternalAuthMiddleware } from "../middleware/require-internal-auth.js";
import type { AppContextBindings, AppRoutes } from "../types.js";
import { INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH } from "./constants.js";
import { internalRefreshIntegrationConnectionResourcesRoute } from "./contracts.js";

const InternalIntegrationConnectionsErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
} as const;

export function createInternalIntegrationConnectionsRoutes(): AppRoutes<
  typeof INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });
  routes.use(
    "*",
    createRequireInternalAuthMiddleware({
      headerName: CONTROL_PLANE_INTERNAL_AUTH_HEADER,
      errorCode: InternalIntegrationConnectionsErrorCodes.UNAUTHORIZED,
      errorMessage: "Internal service authentication failed.",
    }),
  );

  const routeHandler: RouteHandler<
    typeof internalRefreshIntegrationConnectionResourcesRoute,
    AppContextBindings
  > = async (ctx) => {
    const body = ctx.req.valid("json");
    const result = await requestIntegrationConnectionResourceRefresh(
      {
        db: ctx.get("db"),
        integrationRegistry: ctx.get("integrationRegistry"),
        openWorkflow: ctx.get("openWorkflow"),
      },
      body,
    );

    return ctx.json(result, 202);
  };

  routes.openapi(
    internalRefreshIntegrationConnectionResourcesRoute,
    withHttpErrorHandler(routeHandler),
  );

  return {
    basePath: INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH,
    routes,
  };
}
