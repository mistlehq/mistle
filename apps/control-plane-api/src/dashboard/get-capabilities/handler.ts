import type { RouteHandler } from "@hono/zod-openapi";
import { readRepositoryVersion } from "@mistle/config";

import type { AppContextBindings } from "../../types.js";
import { route } from "./route.js";
import { DashboardReleaseVersionHeaderName } from "./schema.js";

const ControlPlaneReleaseVersion = readRepositoryVersion(import.meta.url);

const routeHandler = (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const config = ctx.get("config");
  ctx.header(DashboardReleaseVersionHeaderName, ControlPlaneReleaseVersion);

  if (!config.billing.stripe.enabled) {
    return ctx.json({}, 200);
  }

  return ctx.json(
    {
      billing: {
        stripe: {
          enabled: true,
        },
      },
    },
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = routeHandler;
