import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { ORGANIZATION_ROUTE_BASE_PATH } from "./constants.js";
import * as deleteLogo from "./delete-logo/index.js";
import * as getLogoContent from "./get-logo-content/index.js";
import * as getLogo from "./get-logo/index.js";
import * as getMembershipCapabilities from "./get-membership-capabilities/index.js";
import * as listInvitations from "./list-invitations/index.js";
import * as listMembers from "./list-members/index.js";
import * as putLogo from "./put-logo/index.js";

export function createOrganizationRoutes(): AppRoutes<typeof ORGANIZATION_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(getLogo.route, getLogo.handler);
  routes.openapi(getLogoContent.route, getLogoContent.handler);
  routes.openapi(putLogo.route, putLogo.handler);
  routes.openapi(deleteLogo.route, deleteLogo.handler);
  routes.openapi(getMembershipCapabilities.route, getMembershipCapabilities.handler);
  routes.openapi(listMembers.route, listMembers.handler);
  routes.openapi(listInvitations.route, listInvitations.handler);

  return {
    basePath: ORGANIZATION_ROUTE_BASE_PATH,
    routes,
  };
}
