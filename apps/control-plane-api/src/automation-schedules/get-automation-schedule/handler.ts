import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { AutomationScheduleKinds } from "../constants.js";
import { loadScheduleAutomationAggregateOrThrow } from "../services/load-schedule-automation-aggregate-or-throw.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const { automationId } = ctx.req.valid("param");

  const automationSchedule = await loadScheduleAutomationAggregateOrThrow(
    { db },
    {
      automationId,
      organizationId: session.activeOrganizationId,
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
