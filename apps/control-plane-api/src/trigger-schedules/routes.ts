import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { TRIGGER_SCHEDULES_ROUTE_BASE_PATH } from "./constants.js";
import * as createTriggerSchedule from "./create-trigger-schedule/index.js";
import * as deleteTriggerSchedule from "./delete-trigger-schedule/index.js";
import * as getTriggerSchedule from "./get-trigger-schedule/index.js";
import * as updateTriggerSchedule from "./update-trigger-schedule/index.js";

export function createTriggerSchedulesRoutes(): AppRoutes<
  typeof TRIGGER_SCHEDULES_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(createTriggerSchedule.route, createTriggerSchedule.handler);
  routes.openapi(getTriggerSchedule.route, getTriggerSchedule.handler);
  routes.openapi(updateTriggerSchedule.route, updateTriggerSchedule.handler);
  routes.openapi(deleteTriggerSchedule.route, deleteTriggerSchedule.handler);

  return {
    basePath: TRIGGER_SCHEDULES_ROUTE_BASE_PATH,
    routes,
  };
}
