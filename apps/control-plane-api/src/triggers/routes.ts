import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { TRIGGERS_ROUTE_BASE_PATH } from "./constants.js";
import * as getTrigger from "./get-trigger/index.js";
import * as listTriggers from "./list-triggers/index.js";

export function createTriggersRoutes(): AppRoutes<typeof TRIGGERS_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(listTriggers.route, listTriggers.handler);
  routes.openapi(getTrigger.route, getTrigger.handler);

  return {
    basePath: TRIGGERS_ROUTE_BASE_PATH,
    routes,
  };
}
