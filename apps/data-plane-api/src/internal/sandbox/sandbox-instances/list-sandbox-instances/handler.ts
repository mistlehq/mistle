import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../../types.js";
import { listSandboxInstances } from "../../../sandbox-instances/services/list-sandbox-instances.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("resources").db;
  const tables = ctx.get("resources").tables;
  const query = ctx.req.valid("query");
  const startedByFilter =
    query.startedByKind === undefined || query.startedById === undefined
      ? {}
      : { startedByKind: query.startedByKind, startedById: query.startedById };

  const response = await listSandboxInstances(
    {
      db,
      tables,
    },
    {
      organizationId: query.organizationId,
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...startedByFilter,
      ...(query.after === undefined ? {} : { after: query.after }),
      ...(query.before === undefined ? {} : { before: query.before }),
    },
  );

  return ctx.json(response, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
