import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";
import { systemClock } from "@mistle/time";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { AutomationScheduleKinds } from "../constants.js";
import { createAutomationSchedule } from "../services/create-automation-schedule.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const body = ctx.req.valid("json");

  const automationSchedule = await createAutomationSchedule(
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
      ...automationSchedule,
      kind: AutomationScheduleKinds.SCHEDULE,
    },
    201,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
