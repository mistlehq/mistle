import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { buildDashboardUrl } from "../../lib/dashboard-url.js";
import type { AppContextBindings } from "../../types.js";
import { completeGitHubAppInstallationConnection } from "../services/complete-github-app-installation-connection.js";
import { route } from "./route.js";

const DashboardOrganizationIntegrationsPath = "/settings/organization/integrations";

function buildDashboardIntegrationsUrl(dashboardBaseUrl: string): string {
  return buildDashboardUrl(dashboardBaseUrl, DashboardOrganizationIntegrationsPath);
}

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const config = ctx.get("config");
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const { targetKey } = ctx.req.valid("param");
  const query = ctx.req.valid("query");

  await completeGitHubAppInstallationConnection(
    {
      db,
      integrationRegistry,
      integrationsConfig: config.integrations,
    },
    {
      targetKey,
      query,
    },
  );

  return ctx.redirect(buildDashboardIntegrationsUrl(config.dashboard.baseUrl), 302);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
