import type { RouteHandler } from "@hono/zod-openapi";
import { BadRequestError, withHttpErrorHandler } from "@mistle/http/errors.js";
import type { IntegrationProviderAppSetupCompletionRedirect } from "@mistle/integrations-core";

import { IntegrationConnectionsBadRequestCodes } from "../../integration-connections/constants.js";
import {
  completeProviderAppSetup,
  resolveProviderAppSetupStatelessErrorRedirectTarget,
} from "../../integration-connections/services/provider-app-setup.js";
import { buildDashboardUrl } from "../../lib/dashboard-url.js";
import type { AppContextBindings } from "../../types.js";
import { route } from "./route.js";

const ProviderAppSetupErrorQueryValue = "missing-state";

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

function buildProviderAppSetupCallbackErrorRedirectUrl(input: {
  dashboardBaseUrl: string;
  targetKey: string;
}): string {
  const queryParams = new URLSearchParams();
  queryParams.set("providerAppSetupError", ProviderAppSetupErrorQueryValue);

  return buildDashboardUrl(
    input.dashboardBaseUrl,
    `/integrations/${encodeURIComponent(input.targetKey)}?${queryParams.toString()}`,
  );
}

function shouldRedirectProviderAppSetupStatelessError(input: {
  error: unknown;
  query: { installation_id?: string | undefined; state?: string | undefined };
}): boolean {
  return (
    input.error instanceof BadRequestError &&
    input.error.code ===
      IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT &&
    input.query.state === undefined &&
    input.query.installation_id !== undefined
  );
}

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const config = ctx.get("config");
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const { callbackRouteKey } = ctx.req.valid("param");
  const query = ctx.req.valid("query");

  let completedConnection;
  try {
    completedConnection = await completeProviderAppSetup(
      {
        db,
        integrationRegistry,
        integrationsConfig: config.integrations,
        controlPlaneBaseUrl: config.auth.baseUrl,
      },
      {
        callbackRouteKey,
        query,
      },
    );
  } catch (error) {
    if (!shouldRedirectProviderAppSetupStatelessError({ error, query })) {
      throw error;
    }

    const redirectTarget = await resolveProviderAppSetupStatelessErrorRedirectTarget({
      callbackRouteKey,
      db,
      integrationRegistry,
      queryParams: new URLSearchParams(query),
    });
    if (redirectTarget === null) {
      throw error;
    }

    return ctx.redirect(
      buildProviderAppSetupCallbackErrorRedirectUrl({
        dashboardBaseUrl: config.dashboard.baseUrl,
        targetKey: redirectTarget.targetKey,
      }),
      302,
    );
  }

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
