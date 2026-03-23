import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import * as completeGitHubAppInstallationConnection from "./complete-github-app-installation-connection/index.js";
import * as completeOAuth2Connection from "./complete-oauth2-connection/index.js";
import { INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH } from "./constants.js";
import * as createApiKeyConnection from "./create-api-key-connection/index.js";
import * as listIntegrationConnectionResources from "./list-integration-connection-resources/index.js";
import * as listIntegrationConnections from "./list-integration-connections/index.js";
import * as refreshIntegrationConnectionResources from "./refresh-integration-connection-resources/index.js";
import * as startGitHubAppInstallationConnection from "./start-github-app-installation-connection/index.js";
import * as startOAuth2Connection from "./start-oauth2-connection/index.js";
import * as updateApiKeyConnection from "./update-api-key-connection/index.js";
import * as updateIntegrationConnection from "./update-integration-connection/index.js";

export function createIntegrationConnectionsRoutes(): AppRoutes<
  typeof INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(listIntegrationConnections.route, listIntegrationConnections.handler);
  routes.openapi(
    listIntegrationConnectionResources.route,
    listIntegrationConnectionResources.handler,
  );
  routes.openapi(
    refreshIntegrationConnectionResources.route,
    refreshIntegrationConnectionResources.handler,
  );
  routes.openapi(createApiKeyConnection.route, createApiKeyConnection.handler);
  routes.openapi(updateIntegrationConnection.route, updateIntegrationConnection.handler);
  routes.openapi(updateApiKeyConnection.route, updateApiKeyConnection.handler);
  routes.openapi(
    startGitHubAppInstallationConnection.route,
    startGitHubAppInstallationConnection.handler,
  );
  routes.openapi(startOAuth2Connection.route, startOAuth2Connection.handler);
  routes.openapi(
    completeGitHubAppInstallationConnection.route,
    completeGitHubAppInstallationConnection.handler,
  );
  routes.openapi(completeOAuth2Connection.route, completeOAuth2Connection.handler);

  return {
    basePath: INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH,
    routes,
  };
}
