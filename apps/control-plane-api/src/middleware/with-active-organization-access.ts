import { OpenAPIHono } from "@hono/zod-openapi";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { createRequireActiveOrganizationAccessMiddleware } from "./require-active-organization-access.js";
import { createRequireAuthSessionMiddleware } from "./require-auth-session.js";

export function withActiveOrganizationAccess<BasePath>(
  appRoutes: AppRoutes<BasePath>,
): AppRoutes<BasePath> {
  const routes = new OpenAPIHono<AppContextBindings>();
  routes.use("*", createRequireAuthSessionMiddleware());
  routes.use("*", createRequireActiveOrganizationAccessMiddleware());
  routes.route("/", appRoutes.routes);

  return {
    basePath: appRoutes.basePath,
    routes,
  };
}
