import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { ME_ROUTE_BASE_PATH } from "./constants.js";
import * as deleteProfileImage from "./delete-profile-image/index.js";
import * as getProfileImage from "./get-profile-image/index.js";
import * as putProfileImage from "./put-profile-image/index.js";

export function createMeRoutes(): AppRoutes<typeof ME_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(getProfileImage.route, getProfileImage.handler);
  routes.openapi(putProfileImage.route, putProfileImage.handler);
  routes.openapi(deleteProfileImage.route, deleteProfileImage.handler);

  return {
    basePath: ME_ROUTE_BASE_PATH,
    routes,
  };
}
