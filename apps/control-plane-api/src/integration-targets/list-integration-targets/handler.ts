import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../types.js";
import { listIntegrationTargets } from "../services/list-integration-targets.js";
import { route } from "./route.js";

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const db = ctx.get("db");
  const query = ctx.req.valid("query");

  const result = await listIntegrationTargets(
    {
      db,
    },
    query,
  );

  return ctx.json(result, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
