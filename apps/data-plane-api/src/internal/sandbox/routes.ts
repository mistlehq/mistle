import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import { createRequireInternalAuthMiddleware } from "../../middleware/require-internal-auth.js";
import type { AppContextBindings, AppRoutes } from "../../types.js";
import { INTERNAL_SANDBOX_ROUTE_BASE_PATH } from "./constants.js";
import * as createSandboxInstance from "./sandbox-instances/create-sandbox-instance/index.js";
import * as getSandboxInstance from "./sandbox-instances/get-sandbox-instance/index.js";
import * as listSandboxInstances from "./sandbox-instances/list-sandbox-instances/index.js";
import * as resumeSandboxInstance from "./sandbox-instances/resume-sandbox-instance/index.js";
import * as stopSandboxInstance from "./sandbox-instances/stop-sandbox-instance/index.js";

export function createInternalSandboxRoutes(): AppRoutes<typeof INTERNAL_SANDBOX_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.use(
    "*",
    createRequireInternalAuthMiddleware({
      errorCode: "UNAUTHORIZED",
      errorMessage: "Internal service authentication failed.",
    }),
  );

  routes.openapi(createSandboxInstance.route, createSandboxInstance.handler);
  routes.openapi(listSandboxInstances.route, listSandboxInstances.handler);
  routes.openapi(getSandboxInstance.route, getSandboxInstance.handler);
  routes.openapi(resumeSandboxInstance.route, resumeSandboxInstance.handler);
  routes.openapi(stopSandboxInstance.route, stopSandboxInstance.handler);

  return {
    basePath: INTERNAL_SANDBOX_ROUTE_BASE_PATH,
    routes,
  };
}
