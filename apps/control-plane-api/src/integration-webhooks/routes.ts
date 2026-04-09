import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { INTEGRATION_WEBHOOKS_ROUTE_BASE_PATH } from "./constants.js";
import * as ingestSourceKeyedIntegrationWebhook from "./ingest-source-keyed-integration-webhook/index.js";

export function createIntegrationWebhooksRoutes(): AppRoutes<
  typeof INTEGRATION_WEBHOOKS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(
    ingestSourceKeyedIntegrationWebhook.route,
    ingestSourceKeyedIntegrationWebhook.handler,
  );

  return {
    basePath: INTEGRATION_WEBHOOKS_ROUTE_BASE_PATH,
    routes,
  };
}
