import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { deleteTriggerSchedule } from "../services/delete-trigger-schedule.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const openWorkflow = ctx.get("openWorkflow");
  const { triggerId } = ctx.req.valid("param");

  await deleteTriggerSchedule(
    { db, openWorkflow },
    {
      triggerId,
      organizationId: session.activeOrganizationId,
    },
  );

  return ctx.json(
    {
      triggerId,
    },
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
