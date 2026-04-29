import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { AUTH_ROUTE_BASE_PATH } from "./constants.js";
import * as getAuthMethods from "./get-auth-methods/index.js";

export function createAuthRoutes(): AppRoutes<typeof AUTH_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(getAuthMethods.route, getAuthMethods.handler);
  routes.all("*", (ctx) => {
    return ctx.get("auth").handler(ctx.req.raw);
  });

  return {
    basePath: AUTH_ROUTE_BASE_PATH,
    routes,
  };
}
