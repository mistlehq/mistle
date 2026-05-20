import { OpenAPIHono } from "@hono/zod-openapi";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { createRequireMcpAuthenticatedRequestMiddleware } from "./require-mcp-authenticated-request.js";
import { createRequireOrganizationAccessMiddleware } from "./require-organization-access.js";

export function withMcpOrganizationAccess<BasePath>(
  appRoutes: AppRoutes<BasePath>,
): AppRoutes<BasePath> {
  const routes = new OpenAPIHono<AppContextBindings>();
  routes.use("*", createRequireMcpAuthenticatedRequestMiddleware());
  routes.use("*", createRequireOrganizationAccessMiddleware());
  routes.route("/", appRoutes.routes);

  return {
    basePath: appRoutes.basePath,
    routes,
  };
}
