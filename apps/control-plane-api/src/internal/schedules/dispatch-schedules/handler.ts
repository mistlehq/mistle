import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";
import { systemClock } from "@mistle/time";

import { logger } from "../../../logger.js";
import type { AppContextBindings } from "../../../types.js";
import { enqueueScheduleDispatch } from "../services/enqueue-schedule-dispatch.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const result = await enqueueScheduleDispatch({
    clock: systemClock,
    openWorkflow: ctx.get("openWorkflow"),
  });

  logger.info(
    {
      eventName: "schedule.dispatch.enqueued",
      "mistle.schedule.cutoff_minute": result.cutoffMinute,
      "mistle.schedule.idempotency_key": result.idempotencyKey,
    },
    "Enqueued schedule dispatch workflow",
  );

  return ctx.json(result, 202);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
