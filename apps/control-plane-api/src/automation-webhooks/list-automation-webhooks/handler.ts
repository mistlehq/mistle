import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationAccess } from "../../auth/services/organization-authorization.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { listAutomationWebhooks } from "../services/list-automation-webhooks.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session, user }: AppSession,
) => {
  const db = ctx.get("db");
  const query = ctx.req.valid("query");

  await requireActiveOrganizationAccess({
    db,
    actorUserId: user.id,
    activeOrganizationId: session.activeOrganizationId,
  });

  const result = await listAutomationWebhooks(
    { db },
    {
      ...query,
      organizationId: session.activeOrganizationId,
    },
  );

  return ctx.json(result, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
