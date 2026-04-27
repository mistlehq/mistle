import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { completeSlackAppInstallation } from "../../../integration-connections/slack-app/services/complete-installation.js";
import { buildDashboardUrl } from "../../../lib/dashboard-url.js";
import type { AppContextBindings } from "../../../types.js";
import { route } from "./route.js";

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const config = ctx.get("config");
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const query = ctx.req.valid("query");

  const completedConnection = await completeSlackAppInstallation(
    {
      db,
      integrationRegistry,
      integrationsConfig: config.integrations,
    },
    {
      query,
      controlPlaneBaseUrl: config.auth.baseUrl,
    },
  );

  return ctx.redirect(
    buildDashboardUrl(
      config.dashboard.baseUrl,
      `/integrations/${encodeURIComponent(completedConnection.targetKey)}?connectionId=${encodeURIComponent(completedConnection.id)}&connectionNotice=installed`,
    ),
    302,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
