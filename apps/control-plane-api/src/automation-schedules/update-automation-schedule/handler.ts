import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";
import { systemClock } from "@mistle/time";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { AutomationScheduleKinds } from "../constants.js";
import { updateAutomationSchedule } from "../services/update-automation-schedule.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const { automationId } = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const automationSchedule = await updateAutomationSchedule(
    {
      db,
    },
    {
      ...body,
      automationId,
      organizationId: session.activeOrganizationId,
      now: systemClock.nowDate(),
    },
  );

  return ctx.json(
    {
      ...automationSchedule,
      kind: AutomationScheduleKinds.SCHEDULE,
    },
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
