import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { buildDashboardUrl } from "../../lib/dashboard-url.js";
import type { AppContextBindings } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const dashboardBaseUrl = ctx.get("config").dashboard.baseUrl;
  const { instanceId } = ctx.req.valid("param");

  return ctx.redirect(
    buildDashboardUrl(dashboardBaseUrl, `/sessions/${encodeURIComponent(instanceId)}`),
    302,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
