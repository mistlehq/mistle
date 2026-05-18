import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../types.js";
import { route } from "./route.js";

const routeHandler = (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const config = ctx.get("config");

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
