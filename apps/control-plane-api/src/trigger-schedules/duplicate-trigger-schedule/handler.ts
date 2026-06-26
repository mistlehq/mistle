import type { RouteHandler, z } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";
import { systemClock } from "@mistle/time";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { TriggerScheduleKinds } from "../constants.js";
import { RecurringTriggerScheduleSchema } from "../schemas.js";
import { duplicateTriggerSchedule } from "../services/duplicate-trigger-schedule.js";
import type { TriggerScheduleAggregate } from "../services/load-schedule-trigger-aggregate-or-throw.js";
import { toTriggerScheduleResponse } from "../services/trigger-schedule-response.js";
import { route } from "./route.js";

type DuplicateTriggerScheduleResponse = z.infer<typeof RecurringTriggerScheduleSchema>;

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const openWorkflow = ctx.get("openWorkflow");
  const { triggerId } = ctx.req.valid("param");

  const triggerSchedule = await duplicateTriggerSchedule(
    {
      db,
      openWorkflow,
    },
    {
      triggerId,
      organizationId: session.activeOrganizationId,
      now: systemClock.nowDate(),
    },
  );
  const response = toDuplicateTriggerScheduleResponse(triggerSchedule);

  return ctx.json(response, 201);
};

function toDuplicateTriggerScheduleResponse(
  triggerSchedule: TriggerScheduleAggregate,
): DuplicateTriggerScheduleResponse {
  const response = toTriggerScheduleResponse(triggerSchedule);

  if (response.schedule.kind !== "recurring") {
    throw new Error(`Duplicated scheduled trigger '${response.id}' is not recurring.`);
  }

  return {
    ...response,
    kind: TriggerScheduleKinds.SCHEDULE,
    schedule: {
      ...response.schedule,
      kind: response.schedule.kind,
    },
  };
}

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
