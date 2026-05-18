import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { TRIGGER_WEBHOOKS_ROUTE_BASE_PATH } from "./constants.js";
import * as createTriggerWebhook from "./create-trigger-webhook/index.js";
import * as deleteTriggerWebhook from "./delete-trigger-webhook/index.js";
import * as getTriggerWebhook from "./get-trigger-webhook/index.js";
import * as updateTriggerWebhook from "./update-trigger-webhook/index.js";

export function createTriggerWebhooksRoutes(): AppRoutes<typeof TRIGGER_WEBHOOKS_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(createTriggerWebhook.route, createTriggerWebhook.handler);
  routes.openapi(getTriggerWebhook.route, getTriggerWebhook.handler);
  routes.openapi(updateTriggerWebhook.route, updateTriggerWebhook.handler);
  routes.openapi(deleteTriggerWebhook.route, deleteTriggerWebhook.handler);

  return {
    basePath: TRIGGER_WEBHOOKS_ROUTE_BASE_PATH,
    routes,
  };
}
