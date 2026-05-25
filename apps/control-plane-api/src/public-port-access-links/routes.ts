import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { PUBLIC_PORT_ACCESS_LINKS_ROUTE_BASE_PATH } from "./constants.js";
import * as getPublicPortAccessLink from "./get-public-port-access-link/index.js";

export function createPublicPortAccessLinksRoutes(): AppRoutes<
  typeof PUBLIC_PORT_ACCESS_LINKS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(getPublicPortAccessLink.route, getPublicPortAccessLink.handler);

  return {
    basePath: PUBLIC_PORT_ACCESS_LINKS_ROUTE_BASE_PATH,
    routes,
  };
}
