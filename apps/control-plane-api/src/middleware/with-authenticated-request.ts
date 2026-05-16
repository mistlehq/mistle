import { OpenAPIHono } from "@hono/zod-openapi";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { createRequireAuthenticatedRequestMiddleware } from "./require-authenticated-request.js";

export function withAuthenticatedRequest<BasePath>(
  appRoutes: AppRoutes<BasePath>,
): AppRoutes<BasePath> {
  const routes = new OpenAPIHono<AppContextBindings>();
  routes.use("*", createRequireAuthenticatedRequestMiddleware());
  routes.route("/", appRoutes.routes);

  return {
    basePath: appRoutes.basePath,
    routes,
  };
}
