import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { SANDBOX_INSTANCES_ROUTE_BASE_PATH } from "./constants.js";
import * as createSandboxInstanceConnectionToken from "./create-sandbox-instance-connection-token/index.js";
import * as getSandboxInstance from "./get-sandbox-instance/index.js";
import * as listSandboxInstances from "./list-sandbox-instances/index.js";
import * as resumeSandboxInstance from "./resume-sandbox-instance/index.js";

export function createSandboxInstancesRoutes(): AppRoutes<
  typeof SANDBOX_INSTANCES_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(listSandboxInstances.route, listSandboxInstances.handler);
  routes.openapi(getSandboxInstance.route, getSandboxInstance.handler);
  routes.openapi(resumeSandboxInstance.route, resumeSandboxInstance.handler);
  routes.openapi(
    createSandboxInstanceConnectionToken.route,
    createSandboxInstanceConnectionToken.handler,
  );

  return {
    basePath: SANDBOX_INSTANCES_ROUTE_BASE_PATH,
    routes,
  };
}
