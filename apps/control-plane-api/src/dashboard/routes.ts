import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { DASHBOARD_ROUTE_BASE_PATH } from "./constants.js";
import * as getCapabilities from "./get-capabilities/index.js";

export function createDashboardRoutes(): AppRoutes<typeof DASHBOARD_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(getCapabilities.route, getCapabilities.handler);

  return {
    basePath: DASHBOARD_ROUTE_BASE_PATH,
    routes,
  };
}
