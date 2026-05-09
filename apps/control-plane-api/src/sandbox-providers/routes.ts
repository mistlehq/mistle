import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { SANDBOX_PROVIDERS_ROUTE_BASE_PATH } from "./constants.js";
import * as listSandboxProviders from "./list-sandbox-providers/index.js";

export function createSandboxProvidersRoutes(): AppRoutes<
  typeof SANDBOX_PROVIDERS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(listSandboxProviders.route, listSandboxProviders.handler);

  return {
    basePath: SANDBOX_PROVIDERS_ROUTE_BASE_PATH,
    routes,
  };
}
