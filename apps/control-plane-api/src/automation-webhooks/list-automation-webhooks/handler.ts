import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";
import { listAutomationWebhooks } from "./service.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const query = ctx.req.valid("query");

  const result = await listAutomationWebhooks(
    { db },
    {
      ...query,
      organizationId: session.activeOrganizationId,
    },
  );

  return ctx.json(
    {
      ...result,
      items: result.items.map((automationWebhook) => ({
        ...automationWebhook,
        kind: "webhook" as const,
      })),
    },
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
