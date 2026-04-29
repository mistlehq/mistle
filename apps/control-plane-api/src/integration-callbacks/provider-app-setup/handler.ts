import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";
import type { IntegrationProviderAppSetupCompletionRedirect } from "@mistle/integrations-core";

import { IntegrationConnectionsBadRequestCodes } from "../../integration-connections/constants.js";
import { completeProviderAppSetup } from "../../integration-connections/services/provider-app-setup.js";
import { buildDashboardUrl } from "../../lib/dashboard-url.js";
import type { AppContextBindings } from "../../types.js";
import { route } from "./route.js";

function buildProviderAppSetupCallbackRedirectUrl(input: {
  connectionId: string;
  completionRedirect: IntegrationProviderAppSetupCompletionRedirect;
  dashboardBaseUrl: string;
  routeSegment: string;
  targetKey: string;
}): string {
  if (input.completionRedirect.kind === "setup-route") {
    const queryParams = new URLSearchParams(input.completionRedirect.query);
    const query = queryParams.size === 0 ? "" : `?${queryParams.toString()}`;

    return buildDashboardUrl(
      input.dashboardBaseUrl,
      `/integrations/${encodeURIComponent(input.targetKey)}/${encodeURIComponent(input.connectionId)}/${encodeURIComponent(input.routeSegment)}/setup${query}`,
    );
  }

  const queryParams = new URLSearchParams();
  queryParams.set("connectionId", input.connectionId);
  if (input.completionRedirect.notice !== undefined) {
    queryParams.set("connectionNotice", input.completionRedirect.notice);
  }

  return buildDashboardUrl(
    input.dashboardBaseUrl,
    `/integrations/${encodeURIComponent(input.targetKey)}?${queryParams.toString()}`,
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
      connectionId: completedConnection.id,
      completionRedirect: completedConnection.completionRedirect,
      dashboardBaseUrl: config.dashboard.baseUrl,
      routeSegment: completedConnection.routeSegment,
      targetKey: completedConnection.targetKey,
    }),
    302,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
