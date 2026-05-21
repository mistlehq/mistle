import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";
import { systemClock } from "@mistle/time";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { TriggerScheduleKinds } from "../constants.js";
import { toTriggerScheduleResponse } from "../services/trigger-schedule-response.js";
import { updateTriggerSchedule } from "../services/update-trigger-schedule.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const openWorkflow = ctx.get("openWorkflow");
  const { triggerId } = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const triggerSchedule = await updateTriggerSchedule(
    {
      db,
      openWorkflow,
    },
    {
      ...body,
      triggerId,
      organizationId: session.activeOrganizationId,
      now: systemClock.nowDate(),
    },
  );

  return ctx.json(
    {
      ...toTriggerScheduleResponse(triggerSchedule),
      kind: TriggerScheduleKinds.SCHEDULE,
    },
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
