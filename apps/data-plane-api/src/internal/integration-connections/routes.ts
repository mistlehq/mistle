import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import { createRequireInternalAuthMiddleware } from "../../middleware/require-internal-auth.js";
import type { AppContextBindings, AppRoutes } from "../../types.js";
import { INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH } from "./constants.js";
import * as invalidateCredentialCache from "./invalidate-credential-cache/index.js";

export function createInternalIntegrationConnectionRoutes(): AppRoutes<
  typeof INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.use(
    "*",
    createRequireInternalAuthMiddleware({
      errorCode: "UNAUTHORIZED",
      errorMessage: "Internal service authentication failed.",
    }),
  );

  routes.openapi(invalidateCredentialCache.route, invalidateCredentialCache.handler);

  return {
    basePath: INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH,
    routes,
  };
}
