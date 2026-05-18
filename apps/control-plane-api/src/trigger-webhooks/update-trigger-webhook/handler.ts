import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { updateTriggerWebhook } from "../services/update-trigger-webhook.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const { triggerId } = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const triggerWebhook = await updateTriggerWebhook(
    {
      db,
      integrationRegistry,
    },
    {
      ...body,
      triggerId,
      organizationId: session.activeOrganizationId,
    },
  );

  return ctx.json(
    {
      ...triggerWebhook,
      kind: "webhook" as const,
    },
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
