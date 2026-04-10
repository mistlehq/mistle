import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { cancelDeviceAuthorizationAttempt } from "../services/cancel-device-authorization-attempt.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const { attemptId, targetKey } = ctx.req.valid("param");

  const attempt = await cancelDeviceAuthorizationAttempt(
    {
      db,
    },
    {
      organizationId: session.activeOrganizationId,
      targetKey,
      attemptId,
    },
  );

  return ctx.json(attempt, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
