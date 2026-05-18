import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { TriggerScheduleKinds } from "../constants.js";
import { loadScheduleTriggerAggregateOrThrow } from "../services/load-schedule-trigger-aggregate-or-throw.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const { triggerId } = ctx.req.valid("param");

  const triggerSchedule = await loadScheduleTriggerAggregateOrThrow(
    { db },
    {
      triggerId,
      organizationId: session.activeOrganizationId,
    },
  );

  return ctx.json(
    {
      ...triggerSchedule,
      kind: TriggerScheduleKinds.SCHEDULE,
    },
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
