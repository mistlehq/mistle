import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { ORGANIZATIONS_ROUTE_BASE_PATH } from "./constants.js";
import * as getMembershipCapabilities from "./get-membership-capabilities/index.js";

export function createOrganizationsRoutes(): AppRoutes<typeof ORGANIZATIONS_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(getMembershipCapabilities.route, getMembershipCapabilities.handler);

  return {
    basePath: ORGANIZATIONS_ROUTE_BASE_PATH,
    routes,
  };
}
