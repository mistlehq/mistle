import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";
import { systemClock } from "@mistle/time";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { TriggerScheduleKinds } from "../constants.js";
import { createTriggerSchedule } from "../services/create-trigger-schedule.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const body = ctx.req.valid("json");

  const triggerSchedule = await createTriggerSchedule(
    {
      db,
    },
    {
      ...body,
      organizationId: session.activeOrganizationId,
      now: systemClock.nowDate(),
    },
  );

  return ctx.json(
    {
      ...triggerSchedule,
      kind: TriggerScheduleKinds.SCHEDULE,
    },
    201,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
