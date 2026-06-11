import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import { createRequireInternalAuthMiddleware } from "../../middleware/require-internal-auth.js";
import type { AppContextBindings, AppRoutes } from "../../types.js";
import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../constants.js";
import { INTERNAL_PROVIDER_RESOURCE_ASSOCIATIONS_ROUTE_BASE_PATH } from "./constants.js";
import * as registerProviderResourceAssociation from "./register-provider-resource-association/index.js";

const InternalProviderResourceAssociationsErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
};

export function createInternalProviderResourceAssociationsRoutes(): AppRoutes<
  typeof INTERNAL_PROVIDER_RESOURCE_ASSOCIATIONS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });
  routes.use(
    "*",
    createRequireInternalAuthMiddleware({
      headerName: CONTROL_PLANE_INTERNAL_AUTH_HEADER,
      errorCode: InternalProviderResourceAssociationsErrorCodes.UNAUTHORIZED,
      errorMessage: "Internal service authentication failed.",
    }),
  );

  routes.openapi(
    registerProviderResourceAssociation.route,
    registerProviderResourceAssociation.handler,
  );

  return {
    basePath: INTERNAL_PROVIDER_RESOURCE_ASSOCIATIONS_ROUTE_BASE_PATH,
    routes,
  };
}
