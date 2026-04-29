import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../types.js";
import { route } from "./route.js";

const routeHandler = (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const config = ctx.get("config");
  return ctx.json(
    {
      methods: {
        emailOtp: true,
        google: config.auth.google !== undefined,
      },
    },
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
