import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { HOME_ROUTE_BASE_PATH } from "./constants.js";
import * as getHomeSummary from "./get-home-summary/index.js";

export function createHomeRoutes(): AppRoutes<typeof HOME_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(getHomeSummary.route, getHomeSummary.handler);

  return {
    basePath: HOME_ROUTE_BASE_PATH,
    routes,
  };
}
