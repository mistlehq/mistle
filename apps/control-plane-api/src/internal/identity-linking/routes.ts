import { OpenAPIHono } from "@hono/zod-openapi";

import { createRequireInternalAuthMiddleware } from "../../middleware/require-internal-auth.js";
import type { AppContextBindings, AppRoutes } from "../../types.js";
import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../constants.js";
import { INTERNAL_IDENTITY_LINKING_ROUTE_BASE_PATH } from "./constants.js";
import * as resolvePrincipalCredential from "./resolve-principal-credential/index.js";
import { InternalIdentityLinkingErrorCodes } from "./services/errors.js";
import * as signCommitPayload from "./sign-commit-payload/index.js";

export function createInternalIdentityLinkingRoutes(): AppRoutes<
  typeof INTERNAL_IDENTITY_LINKING_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();
  routes.use(
    "*",
    createRequireInternalAuthMiddleware({
      headerName: CONTROL_PLANE_INTERNAL_AUTH_HEADER,
      errorCode: InternalIdentityLinkingErrorCodes.UNAUTHORIZED,
      errorMessage: "Internal service authentication failed.",
    }),
  );

  routes.openapi(resolvePrincipalCredential.route, resolvePrincipalCredential.handler);
  routes.openapi(signCommitPayload.route, signCommitPayload.handler);

  return {
    basePath: INTERNAL_IDENTITY_LINKING_ROUTE_BASE_PATH,
    routes,
  };
}
