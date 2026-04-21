import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { listSessionSidebarGroups } from "../services/list-instances.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const query = ctx.req.valid("query");

  const sessionSidebarGroups = await listSessionSidebarGroups(
    {
      db,
      dataPlaneClient,
    },
    {
      organizationId: session.activeOrganizationId,
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    },
  );

  return ctx.json(sessionSidebarGroups, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
