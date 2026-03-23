import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { INTEGRATION_TARGETS_ROUTE_BASE_PATH } from "./constants.js";
import * as listIntegrationTargets from "./list-integration-targets/index.js";

export function createIntegrationTargetsRoutes(): AppRoutes<
  typeof INTEGRATION_TARGETS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(listIntegrationTargets.route, listIntegrationTargets.handler);

  return {
    basePath: INTEGRATION_TARGETS_ROUTE_BASE_PATH,
    routes,
  };
}
