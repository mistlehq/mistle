import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../../types.js";
import { readSandboxUsageSummary } from "../../../sandbox-usage/services/read-sandbox-usage-summary.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const resources = ctx.get("resources");
  const input = ctx.req.valid("json");
  const response = await readSandboxUsageSummary(
    {
      db: resources.db,
      tables: resources.tables,
    },
    input,
  );

  return ctx.json(response, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
