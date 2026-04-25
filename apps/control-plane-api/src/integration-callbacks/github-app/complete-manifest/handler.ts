import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { completeGitHubAppManifestConnection } from "../../../integration-connections/github-app/services/complete-manifest.js";
import { buildDashboardUrl } from "../../../lib/dashboard-url.js";
import type { AppContextBindings } from "../../../types.js";
import { route } from "./route.js";

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const config = ctx.get("config");
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const query = ctx.req.valid("query");

  const completedConnection = await completeGitHubAppManifestConnection(
    {
      db,
      integrationRegistry,
      integrationsConfig: config.integrations,
    },
    {
      query,
    },
  );

  return ctx.redirect(
    buildDashboardUrl(
      config.dashboard.baseUrl,
      `/integrations/${encodeURIComponent(completedConnection.targetKey)}/${encodeURIComponent(completedConnection.id)}/github-app/setup?githubAppManifest=created`,
    ),
    302,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
