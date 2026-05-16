import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { listInstances } from "../services/list-instances.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const query = ctx.req.valid("query");

  const sandboxInstances = await listInstances(
    {
      db,
      dataPlaneClient,
    },
    {
      organizationId: session.activeOrganizationId,
      userId: session.userId,
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.owner === undefined ? {} : { owner: query.owner }),
      ...(query.startedFrom === undefined ? {} : { startedFrom: query.startedFrom }),
      ...(query.triggerId === undefined ? {} : { triggerId: query.triggerId }),
      ...(query.after === undefined ? {} : { after: query.after }),
      ...(query.before === undefined ? {} : { before: query.before }),
    },
  );

  return ctx.json(sandboxInstances, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
