import { OpenAPIHono } from "@hono/zod-openapi";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { AUTOMATION_WEBHOOKS_ROUTE_BASE_PATH } from "./constants.js";
import * as createAutomationWebhook from "./create-automation-webhook/index.js";
import * as deleteAutomationWebhook from "./delete-automation-webhook/index.js";
import * as getAutomationWebhook from "./get-automation-webhook/index.js";
import * as listAutomationWebhooks from "./list-automation-webhooks/index.js";
import * as updateAutomationWebhook from "./update-automation-webhook/index.js";

export function createAutomationWebhooksRoutes(): AppRoutes<
  typeof AUTOMATION_WEBHOOKS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();

  routes.openapi(listAutomationWebhooks.route, listAutomationWebhooks.handler);
  routes.openapi(createAutomationWebhook.route, createAutomationWebhook.handler);
  routes.openapi(getAutomationWebhook.route, getAutomationWebhook.handler);
  routes.openapi(updateAutomationWebhook.route, updateAutomationWebhook.handler);
  routes.openapi(deleteAutomationWebhook.route, deleteAutomationWebhook.handler);

  return {
    basePath: AUTOMATION_WEBHOOKS_ROUTE_BASE_PATH,
    routes,
  };
}
