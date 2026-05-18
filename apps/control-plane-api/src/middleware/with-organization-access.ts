import { OpenAPIHono } from "@hono/zod-openapi";

import type { OrganizationPermission } from "../auth/services/organization-policy.js";
import type { AppContextBindings, AppRoutes } from "../types.js";
import { createRequireAuthenticatedRequestMiddleware } from "./require-authenticated-request.js";
import { createRequireOrganizationAccessMiddleware } from "./require-organization-access.js";

type WithOrganizationAccessOptions = {
  permission?: OrganizationPermission;
};

export function withOrganizationAccess<BasePath>(
  appRoutes: AppRoutes<BasePath>,
  options: WithOrganizationAccessOptions = {},
): AppRoutes<BasePath> {
  const routes = new OpenAPIHono<AppContextBindings>();
  routes.use("*", createRequireAuthenticatedRequestMiddleware());
  routes.use("*", createRequireOrganizationAccessMiddleware(options));
  routes.route("/", appRoutes.routes);

  return {
    basePath: appRoutes.basePath,
    routes,
  };
}
