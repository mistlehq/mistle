import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { createTriggerWebhook } from "../services/create-trigger-webhook.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const body = ctx.req.valid("json");

  const triggerWebhook = await createTriggerWebhook(
    {
      db,
      integrationRegistry,
    },
    {
      ...body,
      organizationId: session.activeOrganizationId,
    },
  );

  return ctx.json(
    {
      ...triggerWebhook,
      kind: "webhook" as const,
    },
    201,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
