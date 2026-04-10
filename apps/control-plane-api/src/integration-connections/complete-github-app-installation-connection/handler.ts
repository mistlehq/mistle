import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { buildDashboardUrl } from "../../lib/dashboard-url.js";
import type { AppContextBindings } from "../../types.js";
import { completeGitHubAppInstallationConnection } from "../services/complete-github-app-installation-connection.js";
import { route } from "./route.js";

function buildDashboardIntegrationDetailUrl(input: {
  dashboardBaseUrl: string;
  targetKey: string;
}): string {
  return buildDashboardUrl(
    input.dashboardBaseUrl,
    `/integrations/${encodeURIComponent(input.targetKey)}`,
  );
}

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const config = ctx.get("config");
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const query = ctx.req.valid("query");

  const completedConnection = await completeGitHubAppInstallationConnection(
    {
      db,
      integrationRegistry,
    },
    {
      query,
    },
  );

  return ctx.redirect(
    buildDashboardIntegrationDetailUrl({
      dashboardBaseUrl: config.dashboard.baseUrl,
      targetKey: completedConnection.targetKey,
    }),
    302,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
