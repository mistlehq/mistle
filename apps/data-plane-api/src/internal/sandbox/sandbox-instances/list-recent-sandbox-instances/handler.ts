import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../../types.js";
import { listRecentSandboxInstances } from "../../../sandbox-instances/services/list-sandbox-instances.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("resources").db;
  const runtimeStateReader = ctx.get("resources").runtimeStateReader;
  const sandboxAdapter = ctx.get("resources").sandboxAdapter;
  const sandboxProvider = ctx.get("sandboxProvider");
  const query = ctx.req.valid("query");

  const response = await listRecentSandboxInstances(
    {
      db,
      runtimeStateReader,
      sandboxAdapter,
      sandboxProvider,
    },
    {
      organizationId: query.organizationId,
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    },
  );

  return ctx.json(response, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
