import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import { createRequireInternalAuthMiddleware } from "../../middleware/require-internal-auth.js";
import type { AppContextBindings, AppRoutes } from "../../types.js";
import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../constants.js";
import { INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH } from "./constants.js";
import * as getSandboxInstance from "./get-sandbox-instance/index.js";
import * as mintConnectionToken from "./mint-connection-token/index.js";
import * as startProfileInstance from "./start-profile-instance/index.js";

const InternalSandboxRuntimeErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
} as const;

export function createInternalSandboxRuntimeRoutes(): AppRoutes<
  typeof INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });
  routes.use(
    "*",
    createRequireInternalAuthMiddleware({
      headerName: CONTROL_PLANE_INTERNAL_AUTH_HEADER,
      errorCode: InternalSandboxRuntimeErrorCodes.UNAUTHORIZED,
      errorMessage: "Internal service authentication failed.",
    }),
  );

  routes.openapi(startProfileInstance.route, startProfileInstance.handler);
  routes.openapi(getSandboxInstance.route, getSandboxInstance.handler);
  routes.openapi(mintConnectionToken.route, mintConnectionToken.handler);

  return {
    basePath: INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH,
    routes,
  };
}
