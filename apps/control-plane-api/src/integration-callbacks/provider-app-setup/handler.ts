import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { IntegrationConnectionsBadRequestCodes } from "../../integration-connections/constants.js";
import { completeProviderAppSetup } from "../../integration-connections/services/provider-app-setup.js";
import { buildDashboardUrl } from "../../lib/dashboard-url.js";
import type { AppContextBindings } from "../../types.js";
import { route } from "./route.js";

const GitHubAppManifestCallbackRouteKey = "github-app-manifest";
const GitHubAppInstallationCallbackRouteKey = "github-app-installation";
const SlackAppInstallationCallbackRouteKey = "slack-app-installation";

function buildProviderAppSetupCallbackRedirectUrl(input: {
  callbackRouteKey: string;
  connectionId: string;
  dashboardBaseUrl: string;
  routeSegment: string;
  targetKey: string;
}): string {
  if (input.callbackRouteKey === GitHubAppManifestCallbackRouteKey) {
    return buildDashboardUrl(
      input.dashboardBaseUrl,
      `/integrations/${encodeURIComponent(input.targetKey)}/${encodeURIComponent(input.connectionId)}/${encodeURIComponent(input.routeSegment)}/setup?githubAppManifest=created`,
    );
  }

  if (
    input.callbackRouteKey === GitHubAppInstallationCallbackRouteKey ||
    input.callbackRouteKey === SlackAppInstallationCallbackRouteKey
  ) {
    return buildDashboardUrl(
      input.dashboardBaseUrl,
      `/integrations/${encodeURIComponent(input.targetKey)}?connectionId=${encodeURIComponent(input.connectionId)}&connectionNotice=installed`,
    );
  }

  throw new Error(
    `Provider app setup callback route key '${input.callbackRouteKey}' has no dashboard redirect destination.`,
  );
}

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const config = ctx.get("config");
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const { callbackRouteKey } = ctx.req.valid("param");
  const query = ctx.req.valid("query");

  const completedConnection = await completeProviderAppSetup(
    {
      db,
      integrationRegistry,
      integrationsConfig: config.integrations,
      controlPlaneBaseUrl: config.auth.baseUrl,
    },
    {
      callbackRouteKey,
      query,
      invalidInputCode:
        IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT,
    },
  );

  return ctx.redirect(
    buildProviderAppSetupCallbackRedirectUrl({
      callbackRouteKey: completedConnection.callbackRouteKey,
      connectionId: completedConnection.id,
      dashboardBaseUrl: config.dashboard.baseUrl,
      routeSegment: completedConnection.routeSegment,
      targetKey: completedConnection.targetKey,
    }),
    302,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
