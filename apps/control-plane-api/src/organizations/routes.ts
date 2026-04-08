import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { ORGANIZATIONS_ROUTE_BASE_PATH } from "./constants.js";
import * as deleteLogo from "./delete-logo/index.js";
import * as getLogoContent from "./get-logo-content/index.js";
import * as getLogo from "./get-logo/index.js";
import * as getMembershipCapabilities from "./get-membership-capabilities/index.js";
import * as putLogo from "./put-logo/index.js";

export function createOrganizationsRoutes(): AppRoutes<typeof ORGANIZATIONS_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(getLogo.route, getLogo.handler);
  routes.openapi(getLogoContent.route, getLogoContent.handler);
  routes.openapi(putLogo.route, putLogo.handler);
  routes.openapi(deleteLogo.route, deleteLogo.handler);
  routes.openapi(getMembershipCapabilities.route, getMembershipCapabilities.handler);

  return {
    basePath: ORGANIZATIONS_ROUTE_BASE_PATH,
    routes,
  };
}
