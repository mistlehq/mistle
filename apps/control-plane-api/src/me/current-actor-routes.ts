import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { ME_ROUTE_BASE_PATH } from "./constants.js";
import * as getCurrentActor from "./get-current-actor/index.js";

export function createCurrentActorMeRoutes(): AppRoutes<typeof ME_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(getCurrentActor.route, getCurrentActor.handler);

  return {
    basePath: ME_ROUTE_BASE_PATH,
    routes,
  };
}
