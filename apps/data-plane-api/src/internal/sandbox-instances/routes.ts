import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import { createRequireInternalAuthMiddleware } from "../../middleware/require-internal-auth.js";
import type { AppContextBindings, AppRoutes } from "../../types.js";
import { INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH } from "./constants.js";
import * as getSandboxInstance from "./get-sandbox-instance/index.js";
import * as listSandboxInstances from "./list-sandbox-instances/index.js";
import * as resumeSandboxInstance from "./resume-sandbox-instance/index.js";
import * as startSandboxInstance from "./start-sandbox-instance/index.js";
import * as stopSandboxInstance from "./stop-sandbox-instance/index.js";

export function createInternalSandboxInstancesRoutes(): AppRoutes<
  typeof INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH
> {
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

  routes.openapi(startSandboxInstance.route, startSandboxInstance.handler);
  routes.openapi(getSandboxInstance.route, getSandboxInstance.handler);
  routes.openapi(resumeSandboxInstance.route, resumeSandboxInstance.handler);
  routes.openapi(stopSandboxInstance.route, stopSandboxInstance.handler);
  routes.openapi(listSandboxInstances.route, listSandboxInstances.handler);

  return {
    basePath: INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH,
    routes,
  };
}
