import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { AUTOMATION_SCHEDULES_ROUTE_BASE_PATH } from "./constants.js";
import * as createAutomationSchedule from "./create-automation-schedule/index.js";
import * as deleteAutomationSchedule from "./delete-automation-schedule/index.js";
import * as getAutomationSchedule from "./get-automation-schedule/index.js";
import * as updateAutomationSchedule from "./update-automation-schedule/index.js";

export function createAutomationSchedulesRoutes(): AppRoutes<
  typeof AUTOMATION_SCHEDULES_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(createAutomationSchedule.route, createAutomationSchedule.handler);
  routes.openapi(getAutomationSchedule.route, getAutomationSchedule.handler);
  routes.openapi(updateAutomationSchedule.route, updateAutomationSchedule.handler);
  routes.openapi(deleteAutomationSchedule.route, deleteAutomationSchedule.handler);

  return {
    basePath: AUTOMATION_SCHEDULES_ROUTE_BASE_PATH,
    routes,
  };
}
