import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { buildDashboardUrl } from "../../dashboard-url.js";
import type { AppContextBindings } from "../../types.js";
import { completeOAuth2Connection } from "../services/complete-oauth2-connection.js";
import { route } from "./route.js";

const DashboardOrganizationIntegrationsPath = "/settings/organization/integrations";

function buildDashboardIntegrationsUrl(dashboardBaseUrl: string): string {
  return buildDashboardUrl(dashboardBaseUrl, DashboardOrganizationIntegrationsPath);
}

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const params = ctx.req.valid("param");
  const query = ctx.req.valid("query");

  await completeOAuth2Connection(
    {
      db: ctx.get("db"),
      integrationRegistry: ctx.get("integrationRegistry"),
      integrationsConfig: ctx.get("config").integrations,
    },
    {
      targetKey: params.targetKey,
      query,
      controlPlaneBaseUrl: ctx.get("config").auth.baseUrl,
    },
  );

  return ctx.redirect(buildDashboardIntegrationsUrl(ctx.get("config").dashboard.baseUrl), 302);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
