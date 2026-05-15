import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { logger } from "../../logger.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { listOperationEvents } from "../services/list-operation-events.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const { instanceId } = ctx.req.valid("param");
  const query = ctx.req.valid("query");

  try {
    const response = await listOperationEvents(
      {
        dataPlaneClient,
      },
      {
        organizationId: session.activeOrganizationId,
        sandboxInstanceId: instanceId,
        operationId: query.operationId,
        ...(query.afterSequence === undefined ? {} : { afterSequence: query.afterSequence }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      },
    );

    return ctx.json(response, 200);
  } catch (error) {
    logger.error(
      {
        eventName: "sandbox_instance.operation_events_lookup_failed",
        "mistle.organization.id": session.activeOrganizationId,
        "mistle.sandbox.instance_id": instanceId,
        "mistle.sandbox.operation_id": query.operationId,
        err: error,
      },
      "Failed to resolve sandbox operation events.",
    );
    throw error;
  }
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
