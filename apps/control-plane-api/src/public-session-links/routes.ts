import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { PUBLIC_SESSION_LINKS_ROUTE_BASE_PATH } from "./constants.js";
import * as getPublicSessionLink from "./get-public-session-link/index.js";

export function createPublicSessionLinksRoutes(): AppRoutes<
  typeof PUBLIC_SESSION_LINKS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(getPublicSessionLink.route, getPublicSessionLink.handler);

  return {
    basePath: PUBLIC_SESSION_LINKS_ROUTE_BASE_PATH,
    routes,
  };
}
