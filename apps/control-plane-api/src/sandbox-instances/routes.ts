import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { SANDBOX_INSTANCES_ROUTE_BASE_PATH } from "./constants.js";
import * as createSandboxInstanceConnectionToken from "./create-sandbox-instance-connection-token/index.js";
import * as createSandboxInstancePortAccess from "./create-sandbox-instance-port-access/index.js";
import * as getSandboxInstanceSessionLink from "./get-sandbox-instance-session-link/index.js";
import * as getSandboxInstance from "./get-sandbox-instance/index.js";
import * as listSandboxInstances from "./list-sandbox-instances/index.js";
import * as patchSandboxInstanceTitle from "./patch-sandbox-instance-title/index.js";
import * as resumeSandboxInstance from "./resume-sandbox-instance/index.js";
import * as stopSandboxInstance from "./stop-sandbox-instance/index.js";

export function createSandboxInstancesRoutes(): AppRoutes<
  typeof SANDBOX_INSTANCES_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(listSandboxInstances.route, listSandboxInstances.handler);
  routes.openapi(getSandboxInstance.route, getSandboxInstance.handler);
  routes.openapi(getSandboxInstanceSessionLink.route, getSandboxInstanceSessionLink.handler);
  routes.openapi(patchSandboxInstanceTitle.route, patchSandboxInstanceTitle.handler);
  routes.openapi(resumeSandboxInstance.route, resumeSandboxInstance.handler);
  routes.openapi(stopSandboxInstance.route, stopSandboxInstance.handler);
  routes.openapi(
    createSandboxInstanceConnectionToken.route,
    createSandboxInstanceConnectionToken.handler,
  );
  routes.openapi(createSandboxInstancePortAccess.route, createSandboxInstancePortAccess.handler);

  return {
    basePath: SANDBOX_INSTANCES_ROUTE_BASE_PATH,
    routes,
  };
}
