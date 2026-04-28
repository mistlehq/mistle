import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import { createRequireInternalAuthMiddleware } from "../../middleware/require-internal-auth.js";
import type { AppContextBindings, AppRoutes } from "../../types.js";
import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../constants.js";
import { INTERNAL_SCHEDULES_ROUTE_BASE_PATH } from "./constants.js";
import * as dispatchSchedules from "./dispatch-schedules/index.js";

const InternalSchedulesErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
} as const;

export function createInternalSchedulesRoutes(): AppRoutes<
  typeof INTERNAL_SCHEDULES_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.use(
    "*",
    createRequireInternalAuthMiddleware({
      headerName: CONTROL_PLANE_INTERNAL_AUTH_HEADER,
      errorCode: InternalSchedulesErrorCodes.UNAUTHORIZED,
      errorMessage: "Internal service authentication failed.",
    }),
  );

  routes.openapi(dispatchSchedules.route, dispatchSchedules.handler);

  return {
    basePath: INTERNAL_SCHEDULES_ROUTE_BASE_PATH,
    routes,
  };
}
