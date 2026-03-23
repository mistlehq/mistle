import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { ORGANIZATION_MEMBERSHIP_CAPABILITIES_ROUTE_BASE_PATH } from "./constants.js";
import * as getOrganizationMembershipCapabilities from "./get-organization-membership-capabilities/index.js";

export function createOrganizationMembershipCapabilitiesRoutes(): AppRoutes<
  typeof ORGANIZATION_MEMBERSHIP_CAPABILITIES_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(
    getOrganizationMembershipCapabilities.route,
    getOrganizationMembershipCapabilities.handler,
  );

  return {
    basePath: ORGANIZATION_MEMBERSHIP_CAPABILITIES_ROUTE_BASE_PATH,
    routes,
  };
}
