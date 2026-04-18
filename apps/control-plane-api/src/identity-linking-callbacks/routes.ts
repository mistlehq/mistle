import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import * as completeLinkedAccountCallback from "./complete-linked-account-callback/index.js";
import { IDENTITY_LINKING_CALLBACKS_ROUTE_BASE_PATH } from "./constants.js";

export function createIdentityLinkingCallbacksRoutes(): AppRoutes<
  typeof IDENTITY_LINKING_CALLBACKS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(completeLinkedAccountCallback.route, completeLinkedAccountCallback.handler);

  return {
    basePath: IDENTITY_LINKING_CALLBACKS_ROUTE_BASE_PATH,
    routes,
  };
}
