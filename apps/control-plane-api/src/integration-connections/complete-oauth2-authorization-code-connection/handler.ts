import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { buildDashboardUrl } from "../../lib/dashboard-url.js";
import type { AppContextBindings } from "../../types.js";
import { completeOAuth2AuthorizationCodeConnection } from "../services/complete-oauth2-authorization-code-connection.js";
import { route } from "./route.js";

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const config = ctx.get("config");
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const { targetKey } = ctx.req.valid("param");
  const query = ctx.req.valid("query");

  await completeOAuth2AuthorizationCodeConnection(
    {
      db,
      integrationRegistry,
      integrationsConfig: config.integrations,
    },
    {
      targetKey,
      query,
      controlPlaneBaseUrl: config.auth.baseUrl,
    },
  );

  return ctx.redirect(
    buildDashboardUrl(config.dashboard.baseUrl, `/integrations/${encodeURIComponent(targetKey)}`),
    302,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
