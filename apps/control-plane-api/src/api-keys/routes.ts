import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { API_KEYS_ROUTE_BASE_PATH } from "./constants.js";
import * as createApiKey from "./create-api-key/index.js";
import * as deleteApiKey from "./delete-api-key/index.js";
import * as listApiKeys from "./list-api-keys/index.js";

export function createApiKeysRoutes(): AppRoutes<typeof API_KEYS_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(listApiKeys.route, listApiKeys.handler);
  routes.openapi(createApiKey.route, createApiKey.handler);
  routes.openapi(deleteApiKey.route, deleteApiKey.handler);

  return {
    basePath: API_KEYS_ROUTE_BASE_PATH,
    routes,
  };
}
