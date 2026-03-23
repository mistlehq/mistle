import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import { createRequireInternalAuthMiddleware } from "../../middleware/require-internal-auth.js";
import type { AppContextBindings, AppRoutes } from "../../types.js";
import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../constants.js";
import { INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH } from "./constants.js";
import * as refreshIntegrationConnectionResources from "./refresh-integration-connection-resources/index.js";

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

  routes.openapi(
    refreshIntegrationConnectionResources.route,
    refreshIntegrationConnectionResources.handler,
  );

  return {
    basePath: INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH,
    routes,
  };
}
