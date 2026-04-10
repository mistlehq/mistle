import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import * as completeGitHubAppInstallationConnection from "../integration-connections/complete-github-app-installation-connection/index.js";
import * as completeOAuth2AuthorizationCodeConnection from "../integration-connections/complete-oauth2-authorization-code-connection/index.js";
import { INTEGRATION_CALLBACKS_ROUTE_BASE_PATH } from "../integration-connections/constants.js";
import type { AppContextBindings, AppRoutes } from "../types.js";

export function createIntegrationCallbacksRoutes(): AppRoutes<
  typeof INTEGRATION_CALLBACKS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(
    completeGitHubAppInstallationConnection.route,
    completeGitHubAppInstallationConnection.handler,
  );
  routes.openapi(
    completeOAuth2AuthorizationCodeConnection.route,
    completeOAuth2AuthorizationCodeConnection.handler,
  );

  return {
    basePath: INTEGRATION_CALLBACKS_ROUTE_BASE_PATH,
    routes,
  };
}
