import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { INTEGRATION_WEBHOOKS_ROUTE_BASE_PATH } from "./constants.js";
import * as ingestIntegrationWebhook from "./ingest-integration-webhook/index.js";

export function createIntegrationWebhooksRoutes(): AppRoutes<
  typeof INTEGRATION_WEBHOOKS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(ingestIntegrationWebhook.route, ingestIntegrationWebhook.handler);

  return {
    basePath: INTEGRATION_WEBHOOKS_ROUTE_BASE_PATH,
    routes,
  };
}
