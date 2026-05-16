import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { AUTOMATIONS_ROUTE_BASE_PATH } from "./constants.js";
import * as getAutomation from "./get-automation/index.js";
import * as listAutomations from "./list-automations/index.js";

export function createAutomationsRoutes(): AppRoutes<typeof AUTOMATIONS_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(listAutomations.route, listAutomations.handler);
  routes.openapi(getAutomation.route, getAutomation.handler);

  return {
    basePath: AUTOMATIONS_ROUTE_BASE_PATH,
    routes,
  };
}
