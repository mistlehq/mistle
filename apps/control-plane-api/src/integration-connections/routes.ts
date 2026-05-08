import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import { createRequireAuthSessionMiddleware } from "../middleware/require-auth-session.js";
import type { AppContextBindings, AppRoutes } from "../types.js";
import * as cancelDeviceAuthorizationAttempt from "./cancel-device-authorization-attempt/index.js";
import { INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH } from "./constants.js";
import * as createDraftFormConnection from "./create-draft-form-connection/index.js";
import * as createFormConnection from "./create-form-connection/index.js";
import * as createIntegrationWebhookSource from "./create-integration-webhook-source/index.js";
import * as deleteIntegrationConnection from "./delete-integration-connection/index.js";
import * as deleteIntegrationWebhookSource from "./delete-integration-webhook-source/index.js";
import * as getDeviceAuthorizationAttempt from "./get-device-authorization-attempt/index.js";
import * as getIntegrationWebhookSource from "./get-integration-webhook-source/index.js";
import * as listIntegrationConnectionResources from "./list-integration-connection-resources/index.js";
import * as listIntegrationConnections from "./list-integration-connections/index.js";
import * as listIntegrationWebhookSources from "./list-integration-webhook-sources/index.js";
import * as refreshAllIntegrationConnectionResources from "./refresh-all-integration-connection-resources/index.js";
import * as refreshIntegrationConnectionResources from "./refresh-integration-connection-resources/index.js";
import * as refreshWebhookTriggerCapabilities from "./refresh-webhook-trigger-capabilities/index.js";
import * as startDeviceAuthorizationConnection from "./start-device-authorization-connection/index.js";
import * as startOAuth2AuthorizationCodeConnection from "./start-oauth2-authorization-code-connection/index.js";
import * as startProviderAppSetup from "./start-provider-app-setup/index.js";
import * as updateFormConnection from "./update-form-connection/index.js";
import * as updateIntegrationConnection from "./update-integration-connection/index.js";

export function createIntegrationConnectionsRoutes(): AppRoutes<
  typeof INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });
  const requireAuthSession = createRequireAuthSessionMiddleware();

  routes.use(listIntegrationConnections.route.path, requireAuthSession);
  routes.openapi(listIntegrationConnections.route, listIntegrationConnections.handler);

  routes.use(listIntegrationConnectionResources.route.path, requireAuthSession);
  routes.openapi(
    listIntegrationConnectionResources.route,
    listIntegrationConnectionResources.handler,
  );

  routes.use(listIntegrationWebhookSources.route.path, requireAuthSession);
  routes.openapi(listIntegrationWebhookSources.route, listIntegrationWebhookSources.handler);

  routes.use(createIntegrationWebhookSource.route.path, requireAuthSession);
  routes.openapi(createIntegrationWebhookSource.route, createIntegrationWebhookSource.handler);

  routes.use(refreshWebhookTriggerCapabilities.route.path, requireAuthSession);
  routes.openapi(
    refreshWebhookTriggerCapabilities.route,
    refreshWebhookTriggerCapabilities.handler,
  );

  routes.on(
    getIntegrationWebhookSource.route.method,
    getIntegrationWebhookSource.route.path,
    requireAuthSession,
  );
  routes.openapi(getIntegrationWebhookSource.route, getIntegrationWebhookSource.handler);

  routes.on(
    deleteIntegrationWebhookSource.route.method,
    deleteIntegrationWebhookSource.route.path,
    requireAuthSession,
  );
  routes.openapi(deleteIntegrationWebhookSource.route, deleteIntegrationWebhookSource.handler);

  routes.use(refreshIntegrationConnectionResources.route.path, requireAuthSession);
  routes.openapi(
    refreshIntegrationConnectionResources.route,
    refreshIntegrationConnectionResources.handler,
  );

  routes.use(refreshAllIntegrationConnectionResources.route.path, requireAuthSession);
  routes.openapi(
    refreshAllIntegrationConnectionResources.route,
    refreshAllIntegrationConnectionResources.handler,
  );

  routes.use(createFormConnection.route.path, requireAuthSession);
  routes.openapi(createFormConnection.route, createFormConnection.handler);
  routes.use(createDraftFormConnection.route.path, requireAuthSession);
  routes.openapi(createDraftFormConnection.route, createDraftFormConnection.handler);

  routes.on(
    updateIntegrationConnection.route.method,
    updateIntegrationConnection.route.path,
    requireAuthSession,
  );
  routes.openapi(updateIntegrationConnection.route, updateIntegrationConnection.handler);

  routes.on(
    deleteIntegrationConnection.route.method,
    deleteIntegrationConnection.route.path,
    requireAuthSession,
  );
  routes.openapi(deleteIntegrationConnection.route, deleteIntegrationConnection.handler);

  routes.use(updateFormConnection.route.path, requireAuthSession);
  routes.openapi(updateFormConnection.route, updateFormConnection.handler);

  routes.use(startProviderAppSetup.route.path, requireAuthSession);
  routes.openapi(startProviderAppSetup.route, startProviderAppSetup.handler);

  routes.use(startOAuth2AuthorizationCodeConnection.route.path, requireAuthSession);
  routes.openapi(
    startOAuth2AuthorizationCodeConnection.route,
    startOAuth2AuthorizationCodeConnection.handler,
  );

  routes.use(startDeviceAuthorizationConnection.route.path, requireAuthSession);
  routes.openapi(
    startDeviceAuthorizationConnection.route,
    startDeviceAuthorizationConnection.handler,
  );

  routes.on(
    getDeviceAuthorizationAttempt.route.method,
    getDeviceAuthorizationAttempt.route.path,
    requireAuthSession,
  );
  routes.openapi(getDeviceAuthorizationAttempt.route, getDeviceAuthorizationAttempt.handler);

  routes.use(cancelDeviceAuthorizationAttempt.route.path, requireAuthSession);
  routes.openapi(cancelDeviceAuthorizationAttempt.route, cancelDeviceAuthorizationAttempt.handler);

  return {
    basePath: INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH,
    routes,
  };
}
