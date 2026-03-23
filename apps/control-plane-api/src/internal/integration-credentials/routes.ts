import { OpenAPIHono } from "@hono/zod-openapi";

import { createRequireInternalAuthMiddleware } from "../../middleware/require-internal-auth.js";
import type { AppContextBindings, AppRoutes } from "../../types.js";
import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../constants.js";
import { INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH } from "./constants.js";
import * as resolveIntegrationCredential from "./resolve-integration-credential/index.js";
import * as resolveIntegrationTargetSecrets from "./resolve-integration-target-secrets/index.js";
import { InternalIntegrationCredentialsErrorCodes } from "./services/errors.js";

export function createInternalIntegrationCredentialsRoutes(): AppRoutes<
  typeof INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();
  routes.use(
    "*",
    createRequireInternalAuthMiddleware({
      headerName: CONTROL_PLANE_INTERNAL_AUTH_HEADER,
      errorCode: InternalIntegrationCredentialsErrorCodes.UNAUTHORIZED,
      errorMessage: "Internal service authentication failed.",
    }),
  );

  routes.openapi(resolveIntegrationCredential.route, resolveIntegrationCredential.handler);
  routes.openapi(resolveIntegrationTargetSecrets.route, resolveIntegrationTargetSecrets.handler);

  return {
    basePath: INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH,
    routes,
  };
}
